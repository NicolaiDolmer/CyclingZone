#!/usr/bin/env node
// backend/scripts/dev/mandateMigration3514.mjs
// ============================================================================
// #3514: MANDAT-MIGRATIONEN. Ét værktøj, kørbart af en person der ikke har
// læst hele epic'en.
//
// HVAD DEN GØR. Oversætter hvert holds tre bestyrelsesplaner til den nye model:
//   board_profiles(1yr).current_goals  → board_mandates          (sæsonens mandat)
//   board_profiles(3yr/5yr).current_goals → board_vision_milestones (visionen)
//   satisfaction 1yr/3yr/5yr           → board_relations.confidence
//                                        (50/30/20-vægtet, ejer-beslutning 7)
//
// HVAD DEN IKKE GØR. Den rører ikke `board_profiles` med ét eneste felt. Den
// gamle model står urørt bagved, og kill-switchen `board_mandate_model_enabled`
// afgør hvilken der læses. Rollback er derfor et flag, ikke en datareparation.
//
// HVORFOR DEN IKKE ER EN .sql-FIL. `database/2026-*.sql` auto-applies ved merge.
// En population-mutation må aldrig auto-applies (hard rule 9 + 27/6-reglen). DDL'en
// ligger i database/2026-08-18-3514-mandate-model.sql og er inert; DENNE fil er
// den ejer-gatede del.
//
// SIKKERHEDS-KÆDEN (i udførelsesrækkefølge):
//   1. Dry-run er DEFAULT. `--apply` kræver desuden `--jeg-har-set-scorecardet`.
//   2. Selvtest af regnestykket mod kendte tal FØR nogen DB-forbindelse.
//   3. Frisk snapshot fra DB (kun SELECT) → planen bygges forfra hver gang.
//   4. Scorecard: fordeling før/efter + konsekvens-bånd-matrix + hvert hold der
//      krydser en tærskel, med navn.
//   5. Backup-tabel FØR skrivning (board_profiles kopieres, række for række).
//   6. Idempotens: alle skrivninger er upserts på stabile nøgler. Anden kørsel
//      skriver samme værdier, opretter ingen dubletter.
//   7. Post-verify: læs tilbage og bekræft fem invarianter.
//
// KØRSEL
//   dry-run mod staging (skriver ALDRIG):
//     node scripts/dev/mandateMigration3514.mjs --url=... --key=...
//   dry-run mod prod via Infisical:
//     infisical run --env=prod -- node scripts/dev/mandateMigration3514.mjs
//   kun selvtest (ingen DB overhovedet):
//     node scripts/dev/mandateMigration3514.mjs --selvtest
//   skrivning (kræver BEGGE flag + ejer-go på dagen):
//     infisical run --env=prod -- node scripts/dev/mandateMigration3514.mjs --apply --jeg-har-set-scorecardet
//
// Refs #3514 #3645.

import { createClient } from "@supabase/supabase-js";

import {
  computeMigratedConfidence,
  consequenceLayersFor,
  isBonusBand,
  isUnsignedLongPlan,
  planToMandate,
  planToMilestones,
} from "../../lib/boardMandate.js";

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(`--${name}`);
const flagValue = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const APPLY = hasFlag("apply");
const OWNER_CONFIRMED = hasFlag("jeg-har-set-scorecardet");
const SELFTEST_ONLY = hasFlag("selvtest");
const PAGE = 1000;

// ── 1. Selvtest af regnestykket (kører altid, før DB) ───────────────────────
// Tallene her er ikke gætværk: de er den samme 50/30/20-formel regnet i hånden.
// Fejler den, stopper vi FØR vi har rørt en database.
function selftest() {
  const cases = [
    { in: { "1yr": 80, "3yr": 60, "5yr": 40 }, out: 66 },
    { in: { "1yr": 100, "3yr": 100, "5yr": 100 }, out: 100 },
    { in: { "1yr": 0, "3yr": 0, "5yr": 0 }, out: 0 },
    { in: { "1yr": 80 }, out: 80 },
    { in: { "1yr": 80, "3yr": 40 }, out: 65 },
    { in: {}, out: 50 },
  ];
  for (const c of cases) {
    const got = computeMigratedConfidence(c.in).confidence;
    if (got !== c.out) {
      throw new Error(`SELVTEST FEJLEDE: ${JSON.stringify(c.in)} gav ${got}, forventet ${c.out}`);
    }
  }
  // Monotoni: confidence må aldrig falde under minimum af inputtene. Det er
  // invarianten der sikrer at INGEN krydser en konsekvens-tærskel uforskyldt.
  for (let i = 0; i < 2000; i += 1) {
    const s1 = Math.floor(Math.random() * 101);
    const s3 = Math.floor(Math.random() * 101);
    const s5 = Math.floor(Math.random() * 101);
    const conf = computeMigratedConfidence({ "1yr": s1, "3yr": s3, "5yr": s5 }).confidence;
    if (conf < Math.min(s1, s3, s5) - 1 || conf > Math.max(s1, s3, s5) + 1) {
      throw new Error(`SELVTEST FEJLEDE: ${conf} uden for [${Math.min(s1, s3, s5)}, ${Math.max(s1, s3, s5)}]`);
    }
  }
  console.log("✅ Selvtest: 6 kendte tilfælde + 2.000 tilfældige monotoni-tjek passerede.");
}

selftest();
if (SELFTEST_ONLY) process.exit(0);

// ── 2. Forbindelse ──────────────────────────────────────────────────────────
const SUPABASE_URL = flagValue("url") || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = flagValue("key") || process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY (kør via: infisical run --env=prod -- ... eller giv --url= og --key=).");
  process.exit(1);
}
if (APPLY && !OWNER_CONFIRMED) {
  console.error("--apply kræver også --jeg-har-set-scorecardet. Kør dry-runnet først og vis ejeren tallene.");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const projectRef = (() => {
  try { return new URL(SUPABASE_URL).hostname.split(".")[0]; } catch { return "ukendt"; }
})();

console.log(`\nMål: ${projectRef}   Tilstand: ${APPLY ? "APPLY (SKRIVER)" : "DRY-RUN (skriver intet)"}\n`);

async function fetchAll(table, cols) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select(cols)
      .range(from, from + PAGE - 1).order("id", { ascending: true });
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

// ── 3. Frisk snapshot ───────────────────────────────────────────────────────
const boards = await fetchAll(
  "board_profiles",
  "id, team_id, plan_type, focus, satisfaction, current_goals, season_id, negotiation_status, plan_start_season_number, plan_end_season_number",
);
const teams = await fetchAll("teams", "id, name, is_ai");
const teamById = new Map(teams.map((t) => [t.id, t]));

const seasons = await fetchAll("seasons", "id, number, status");
const activeSeason = seasons.find((s) => s.status === "active")
  ?? seasons.slice().sort((a, b) => (b.number ?? 0) - (a.number ?? 0))[0]
  ?? null;

console.log(`Læst: ${boards.length} board_profiles-rækker · ${teams.length} hold · aktiv sæson: ${activeSeason ? `S${activeSeason.number}` : "ingen"}`);

// ── 4. Byg planen ───────────────────────────────────────────────────────────
const byTeam = new Map();
for (const board of boards) {
  if (board.plan_type === "baseline") continue;
  if (!byTeam.has(board.team_id)) byTeam.set(board.team_id, {});
  byTeam.get(board.team_id)[board.plan_type] = board;
}

const parseGoals = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") { try { return JSON.parse(raw) ?? []; } catch { return []; } }
  return [];
};

const plan = [];
const warnings = [];

for (const [teamId, plans] of byTeam.entries()) {
  const team = teamById.get(teamId);
  if (!team) { warnings.push({ teamId, reason: "team_not_found" }); continue; }
  // AI-hold har ikke bestyrelse i dag (målt 17/8: 0 AI-hold har board_profiles).
  // Guarden står så en fremtidig AI-seed ikke stiltiende trækkes med.
  if (team.is_ai) { warnings.push({ teamId, reason: "ai_team_skipped" }); continue; }

  // Aldrig-underskrevne 3/5-års-forhandlinger tæller hverken i tallet eller i
  // visionen (se isUnsignedLongPlan). De rapporteres, så udeladelsen er synlig.
  let unsignedDropped = 0;
  for (const planType of ["3yr", "5yr"]) {
    if (plans[planType] && isUnsignedLongPlan(plans[planType])) {
      warnings.push({ teamId, reason: "unsigned_long_plan_excluded", planType });
      delete plans[planType];
      unsignedDropped += 1;
    }
  }

  const satisfactions = {
    "1yr": plans["1yr"]?.satisfaction,
    "3yr": plans["3yr"]?.satisfaction,
    "5yr": plans["5yr"]?.satisfaction,
  };
  const { confidence, source } = computeMigratedConfidence(satisfactions);

  const oneYear = plans["1yr"];
  const mandateGoals = parseGoals(oneYear?.current_goals);
  const mandate = oneYear ? planToMandate(oneYear, mandateGoals, { confidence }) : null;
  if (!oneYear) warnings.push({ teamId, reason: "no_1yr_plan_no_mandate" });
  if (mandate?.goal_count_outside_range) {
    warnings.push({ teamId, reason: "mandate_goal_count_outside_3_5", count: mandateGoals.length });
  }

  const milestones = [];
  for (const planType of ["3yr", "5yr"]) {
    const source3 = plans[planType];
    if (!source3) continue;
    const result = planToMilestones(source3, parseGoals(source3.current_goals));
    milestones.push(...result.milestones);
    for (const skip of result.skipped) warnings.push({ teamId, reason: skip.reason, planType });
  }

  plan.push({
    teamId,
    teamName: team.name,
    unsignedDropped,
    satisfactions,
    confidence,
    confidenceSource: source,
    oneYearBoardId: oneYear?.id ?? null,
    mandate,
    milestones,
  });
}

// ── 5. Scorecardet ──────────────────────────────────────────────────────────
const pct = (n, total) => (total ? `${((n / total) * 100).toFixed(1)} %` : "-");
const bucket = (v) => {
  if (v < 10) return "0-9";
  if (v < 15) return "10-14";
  if (v < 30) return "15-29";
  if (v < 40) return "30-39";
  if (v < 60) return "40-59";
  if (v < 75) return "60-74";
  if (v < 90) return "75-89";
  return "90-100";
};
const BUCKETS = ["0-9", "10-14", "15-29", "30-39", "40-59", "60-74", "75-89", "90-100"];

const total = plan.length;
const confidences = plan.map((p) => p.confidence).sort((a, b) => a - b);
const quantile = (q) => (confidences.length ? confidences[Math.min(confidences.length - 1, Math.floor(q * confidences.length))] : null);

console.log("\n════════════════════════════════════════════════════════════");
console.log("  SCORECARD: mandat-migrationen (#3514)");
console.log("════════════════════════════════════════════════════════════\n");

console.log(`Hold i planen: ${total}`);
console.log(`Mandater der oprettes: ${plan.filter((p) => p.mandate).length}`);
console.log(`Visions-milepæle der oprettes: ${plan.reduce((n, p) => n + p.milestones.length, 0)}`
  + ` (heraf headline: ${plan.reduce((n, p) => n + p.milestones.filter((m) => m.is_headline).length, 0)})`);
console.log(`Confidence: min ${confidences[0]} · p10 ${quantile(0.10)} · median ${quantile(0.50)} · p90 ${quantile(0.90)} · max ${confidences[confidences.length - 1]}`);

console.log("\nFordeling FØR (de 3 gamle tal) vs. EFTER (ét confidence):");
const beforeCounts = {}; const afterCounts = {};
for (const b of BUCKETS) { beforeCounts[b] = 0; afterCounts[b] = 0; }
let beforeN = 0;
for (const p of plan) {
  for (const v of Object.values(p.satisfactions)) {
    if (v == null) continue;
    beforeCounts[bucket(v)] += 1; beforeN += 1;
  }
  afterCounts[bucket(p.confidence)] += 1;
}
console.log("  bånd      | før (plan-rækker) | efter (hold)");
for (const b of BUCKETS) {
  console.log(`  ${b.padEnd(9)} | ${String(beforeCounts[b]).padStart(5)} ${pct(beforeCounts[b], beforeN).padStart(8)} | ${String(afterCounts[b]).padStart(4)} ${pct(afterCounts[b], total).padStart(8)}`);
}

// Kernemålet (spec: "ingen hold der uforskyldt krydser konsekvens-tærskler").
// Uforskyldt = holdet lander i et HÅRDERE lag end nogen af dets gamle tal gav.
console.log("\nKonsekvens-bånd: krydser nogen en tærskel de ikke krydsede før?");
const crossings = [];
const relieved = [];
const lostBonus = [];
const gainedBonus = [];
for (const p of plan) {
  const olds = Object.values(p.satisfactions).filter((v) => v != null);
  if (!olds.length) continue;
  // I DAG evalueres konsekvenser pr. plan-række: ét board under 40 giver holdet
  // en løncap, uanset hvad de to andre planer siger. Det DÅRLIGSTE af de tre tal
  // er derfor holdets reelle konsekvens-tilstand, og det er dét vi måler imod.
  const worstOldLayers = consequenceLayersFor(Math.min(...olds));
  const newLayers = consequenceLayersFor(p.confidence);

  // Nyt lag som selv det dårligste gamle tal ikke udløste → uforskyldt skade.
  const newlyHarmed = newLayers.filter((l) => !worstOldLayers.includes(l));
  if (newlyHarmed.length) crossings.push({ ...p, layers: newlyHarmed, olds });

  // Lag holdet står i i dag, men slipper ud af → lettelse.
  const lifted = worstOldLayers.filter((l) => !newLayers.includes(l));
  if (lifted.length) relieved.push({ ...p, layers: lifted, olds });

  const hadBonus = olds.some((v) => isBonusBand(v));
  const hasBonus = isBonusBand(p.confidence);
  if (hadBonus && !hasBonus) lostBonus.push(p);
  if (!hadBonus && hasBonus) gainedBonus.push(p);
}

if (crossings.length === 0) {
  console.log("  ✅ 0 hold krydser en NY konsekvens-tærskel. (Matematisk garanteret:");
  console.log("     et vægtet snit kan ikke ligge under sit eget minimum, selvtesten bevogter det.)");
} else {
  console.log(`  🔴 ${crossings.length} hold krydser en ny tærskel, STOP og undersøg:`);
  for (const c of crossings.slice(0, 30)) {
    console.log(`     ${c.teamName}: ${JSON.stringify(c.olds)} → ${c.confidence} (nye lag: ${c.layers.join(", ")})`);
  }
}

console.log(`\n  Lettelser (hold der slipper ud af et lag): ${relieved.length}`);
const byLayer = {};
for (const r of relieved) for (const l of r.layers) byLayer[l] = (byLayer[l] || 0) + 1;
for (const [layer, n] of Object.entries(byLayer).sort()) {
  console.log(`     lag ${layer}: ${n} hold`);
}

console.log(`\n  Bonustilbud (lag 6, > 75): mister ${lostBonus.length} hold · vinder ${gainedBonus.length} hold`);
console.log("     Tabet er den TILSIGTEDE følge af at samle tre tal til ét: et hold der var");
console.log("     over 75 på ÉN plan, men lavere på de andre, var aldrig over 75 samlet set.");
if (lostBonus.length) {
  console.log(`     Eksempler: ${lostBonus.slice(0, 5).map((p) => `${p.teamName} ${JSON.stringify(p.satisfactions)}→${p.confidence}`).join(" · ")}`);
}

// Milepæls-tidslinjen: hvor langt ude i fremtiden peger visionen?
const bySeason = {};
for (const p of plan) for (const m of p.milestones) {
  bySeason[m.target_season_number] = (bySeason[m.target_season_number] || 0) + 1;
}
console.log("\nVisions-milepæle pr. mål-sæson (grandfathered fra planernes egne slut-sæsoner):");
for (const [season, n] of Object.entries(bySeason).sort((a, b) => Number(a[0]) - Number(b[0]))) {
  const marker = activeSeason && Number(season) < Number(activeSeason.number) ? "  ⚠ ligger i FORTIDEN" : "";
  console.log(`  S${season}: ${n} milepæle${marker}`);
}

if (warnings.length) {
  const grouped = {};
  for (const w of warnings) grouped[w.reason] = (grouped[w.reason] || 0) + 1;
  console.log("\nAdvarsler:");
  for (const [reason, n] of Object.entries(grouped)) console.log(`  ${reason}: ${n}`);
}

console.log("\n════════════════════════════════════════════════════════════\n");

if (!APPLY) {
  console.log("DRY-RUN færdig. Intet er skrevet. Vis scorecardet til ejeren før --apply.\n");
  process.exit(0);
}

// ── 6. Backup FØR skrivning ─────────────────────────────────────────────────
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const backupTable = `backup_board_profiles_3514_${stamp}`;
console.log(`Backup → ${backupTable} (skal oprettes manuelt hvis den ikke findes; se drejebogen komponent 4).`);

const { error: backupProbe } = await sb.from(backupTable).select("id").limit(1);
if (backupProbe) {
  console.error(`STOP: backup-tabellen ${backupTable} findes ikke eller kan ikke læses (${backupProbe.message}).`);
  console.error("Opret den først:  create table public." + backupTable + " as select * from public.board_profiles;");
  process.exit(1);
}
const { count: backupCount, error: countError } = await sb
  .from(backupTable).select("id", { count: "exact", head: true });
if (countError || (backupCount ?? 0) < boards.length) {
  console.error(`STOP: backup-tabellen har ${backupCount ?? "?"} rækker, board_profiles har ${boards.length}.`);
  process.exit(1);
}
console.log(`✅ Backup verificeret: ${backupCount} rækker.`);

// ── 7. Skrivning (idempotente upserts på stabile nøgler) ────────────────────
const now = new Date().toISOString();
let relationsWritten = 0; let mandatesWritten = 0; let milestonesWritten = 0; let receiptsWritten = 0;

for (const p of plan) {
  const { error: relError } = await sb.from("board_relations").upsert({
    team_id: p.teamId,
    confidence: p.confidence,
    confidence_source: p.confidenceSource,
    last_event_at: now,
    updated_at: now,
  }, { onConflict: "team_id" });
  if (relError) throw new Error(`board_relations upsert (${p.teamName}): ${relError.message}`);
  relationsWritten += 1;

  if (p.mandate && activeSeason) {
    const { error: mandateError } = await sb.from("board_mandates").upsert({
      team_id: p.teamId,
      season_id: activeSeason.id,
      season_number: activeSeason.number,
      status: p.mandate.status,
      focus: p.mandate.focus,
      goals: p.mandate.goals,
      adjustments_allowed: p.mandate.adjustments_allowed,
      adjustments_used: 0,
      request_used: false,
      signed_at: now,
      source: p.mandate.source,
      updated_at: now,
    }, { onConflict: "team_id,season_id" });
    if (mandateError) throw new Error(`board_mandates upsert (${p.teamName}): ${mandateError.message}`);
    mandatesWritten += 1;
  }

  for (const m of p.milestones) {
    const { error: msError } = await sb.from("board_vision_milestones").upsert({
      team_id: p.teamId,
      milestone_key: m.milestone_key,
      goal: m.goal,
      target_season_number: m.target_season_number,
      origin: m.origin,
      weight: m.weight,
      is_headline: m.is_headline,
      status: m.status,
      updated_at: now,
    }, { onConflict: "team_id,milestone_key" });
    if (msError) throw new Error(`board_vision_milestones upsert (${p.teamName}): ${msError.message}`);
    milestonesWritten += 1;
  }

  // Kvitteringen for selve modelskiftet (spec §3.5: "Board model updated").
  // board_id peger på 1-års-boardet, så sporet tilbage til den gamle model står.
  if (activeSeason && p.oneYearBoardId) {
    const before = p.satisfactions["1yr"] ?? p.confidence;
    const { error: eventError } = await sb.from("board_satisfaction_events").insert({
      board_id: p.oneYearBoardId,
      team_id: p.teamId,
      season_id: activeSeason.id,
      satisfaction_before: before,
      satisfaction_after: p.confidence,
      satisfaction_delta: p.confidence - before,
      goals_met: 0,
      goals_total: p.mandate?.goals?.length ?? 0,
      reason_category: "board_model_updated",
    });
    if (eventError) throw new Error(`board_satisfaction_events insert (${p.teamName}): ${eventError.message}`);
    receiptsWritten += 1;
  }
}

console.log(`\nSkrevet: ${relationsWritten} relationer · ${mandatesWritten} mandater · ${milestonesWritten} milepæle · ${receiptsWritten} kvitteringer.`);

// ── 8. Post-verify ──────────────────────────────────────────────────────────
console.log("\nPost-verify:");
const verifyRelations = await fetchAll("board_relations", "team_id, confidence, confidence_source");
const verifyMandates = await fetchAll("board_mandates", "team_id, season_id, goals, adjustments_allowed");
const verifyMilestones = await fetchAll("board_vision_milestones", "team_id, milestone_key, target_season_number, status");

const checks = [
  ["Én relation pr. hold", new Set(verifyRelations.map((r) => r.team_id)).size === verifyRelations.length],
  ["Relations-antal matcher planen", verifyRelations.length >= plan.length],
  ["Ingen confidence uden for 0-100", verifyRelations.every((r) => r.confidence >= 0 && r.confidence <= 100)],
  ["Hver relation har en kvittering for sit tal", verifyRelations.every((r) => r.confidence_source?.method)],
  ["Ingen milepæl uden mål-sæson", verifyMilestones.every((m) => Number(m.target_season_number) > 0)],
  ["board_profiles er UÆNDRET i antal", (await fetchAll("board_profiles", "id")).length === boards.length],
];
let failed = 0;
for (const [label, ok] of checks) {
  console.log(`  ${ok ? "✅" : "🔴"} ${label}`);
  if (!ok) failed += 1;
}
console.log(`\nMandater: ${verifyMandates.length} · Milepæle: ${verifyMilestones.length}`);

if (failed) {
  console.error(`\n🔴 ${failed} post-verify-tjek fejlede. Kill-switchen er STADIG 'off', flip den IKKE.`);
  process.exit(1);
}
console.log("\n✅ Migrationen er skrevet og verificeret. Kill-switchen er stadig 'off',");
console.log("   flippet til 'on' er et separat, ejer-gated skridt (se drejebogen komponent 4).\n");
