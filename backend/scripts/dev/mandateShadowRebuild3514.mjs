#!/usr/bin/env node
// backend/scripts/dev/mandateShadowRebuild3514.mjs
// ============================================================================
// #3514 fase 1-rest — SKYGGEDATA-GENOPBYGNING + MIDT-I-S3 RE-BASELINE.
// Addendum 1/9 (A2): "migreringen re-baselines til midt-i-S3 (23/8-backfillet
// var kalibreret til sæsonskifte; skyggedata genopbygges før flip)".
//
// HVORFOR DETTE IKKE BARE ER mandateMigration3514.mjs KØRT IGEN. Motoren har
// stået UWIRET siden 23/8 (BOARD_RULES.md §6/§7): `board_relations` er ikke
// rørt af nogen kodesti siden migrationen, mens `board_profiles` er kørt
// videre i seks+ uger. Et blindt genkør af den oprindelige migration ville:
//   1. Regne confidence af board_profiles' NUVÆRENDE tilstand (korrekt — det
//      gør den originale allerede, den læser altid friskt) — MEN
//   2. `upsert`e board_vision_milestones med `status: 'pending'` UBETINGET,
//      hvilket ville NULSTILLE enhver milepæl fase 1-rest-wiringen (denne PR)
//      allerede har lukket (achieved/missed) i mellemtiden, hvis wiringen når
//      at køre bag flaget før denne genopbygning køres igen. Samme risiko for
//      board_mandates hvis et årsmøde-API (fase 2, ikke bygget endnu) skulle
//      have flyttet adjustments_used/request_used.
// Dette script er derfor BYGGET TIL AT VÆRE GEN-KØRBART: det beskytter enhver
// skygge-række der bærer tegn på reel FREMDRIFT (se "BESKYTTEDE RÆKKER"
// nedenfor) i stedet for at overskrive den. Ved førstegangskørsel (nu, flaget
// er stadig 'off', ingen fremdrift findes) er resultatet identisk med et rent
// genkør af mandateMigration3514.mjs — men scriptet er sikkert at køre igen
// lige før selve flippet, som addendummets rækkefølge kræver.
//
// BESKYTTEDE RÆKKER (røres ALDRIG, uanset --apply):
//   - board_relations hvor confidence_source.method ≠ 'migration_v1' (en
//     rigtig weekend/sæson-slut-opdatering har allerede rørt tallet).
//   - board_mandates hvor status ≠ 'active' ELLER adjustments_used > 0 ELLER
//     request_used = true (et årsmøde har allerede rørt mandatet).
//   - board_vision_milestones hvor status ≠ 'pending' (allerede afgjort —
//     achieved/missed/achieved_early må ALDRIG resettes til pending, det ville
//     genskabe #2596-fejlklassen: en allerede-nået milepæl der pludselig ser
//     umødt ud).
// Beskyttede rækker TÆLLES og RAPPORTERES i scorecardet, aldrig stiltiende.
//
// SIKKERHEDS-KÆDEN (samme princip som mandateMigration3514.mjs):
//   1. Dry-run er DEFAULT. `--apply` kræver desuden `--jeg-har-set-scorecardet`
//      OG miljøvariablen CONFIRM_MANDATE_SHADOW_REBUILD=yes (ejer-gated,
//      opgaven her kører den ALDRIG selv).
//   2. Selvtest af regnestykket FØR nogen DB-forbindelse.
//   3. Frisk snapshot af BÅDE board_profiles (kilden) og de eksisterende
//      skyggetabeller (for beskyttelses-tjekket) hver gang scriptet køres.
//   4. Scorecard printes ALTID, uanset dry-run/apply.
//   5. Backup-porten genbruger samme backup-tabel-mønster som originalen.
//   6. Post-verify efter skrivning.
//
// KØRSEL
//   dry-run (default, skriver ALDRIG):
//     cd backend && infisical run --env=prod -- node scripts/dev/mandateShadowRebuild3514.mjs
//   kun selvtest (ingen DB overhovedet):
//     node scripts/dev/mandateShadowRebuild3514.mjs --selvtest
//   skrivning — EJER-GATED, kør ALDRIG som en del af implementeringen:
//     CONFIRM_MANDATE_SHADOW_REBUILD=yes infisical run --env=prod -- \
//       node scripts/dev/mandateShadowRebuild3514.mjs --apply --jeg-har-set-scorecardet
//
// Refs #3514.

import { createClient } from "@supabase/supabase-js";

import {
  computeMigratedConfidence,
  consequenceLayersFor,
  isBonusBand,
  isUnsignedLongPlan,
  mergeCategoryScoresForMigration,
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
const ENV_CONFIRMED = process.env.CONFIRM_MANDATE_SHADOW_REBUILD === "yes";
const SELFTEST_ONLY = hasFlag("selvtest");
const PAGE = 1000;

// ── 1. Selvtest (samme regnestykke som mandateMigration3514.mjs — delt kilde) ─
function selftest() {
  const cases = [
    { in: { "1yr": 80, "3yr": 60, "5yr": 40 }, out: 66 },
    { in: { "1yr": 100, "3yr": 100, "5yr": 100 }, out: 100 },
    { in: { "1yr": 0, "3yr": 0, "5yr": 0 }, out: 0 },
    { in: { "1yr": 80 }, out: 80 },
    { in: {}, out: 50 },
  ];
  for (const c of cases) {
    const got = computeMigratedConfidence(c.in).confidence;
    if (got !== c.out) throw new Error(`SELVTEST FEJLEDE: ${JSON.stringify(c.in)} gav ${got}, forventet ${c.out}`);
  }
  console.log("✅ Selvtest OK (delt regnestykke med mandateMigration3514.mjs).");
}
selftest();
if (SELFTEST_ONLY) process.exit(0);

// ── 2. Forbindelse ──────────────────────────────────────────────────────────
const SUPABASE_URL = flagValue("url") || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = flagValue("key") || process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY (kør via infisical run --env=prod -- ...).");
  process.exit(1);
}
if (APPLY && !(OWNER_CONFIRMED && ENV_CONFIRMED)) {
  console.error("STOP — --apply kræver BÅDE --jeg-har-set-scorecardet OG CONFIRM_MANDATE_SHADOW_REBUILD=yes.");
  console.error("Dette skridt er EJER-GATED (addendum 1/9, ejer ser scorecardet LIVE før apply). Kør dry-run først.");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const projectRef = (() => { try { return new URL(SUPABASE_URL).hostname.split(".")[0]; } catch { return "ukendt"; } })();
console.log(`\nMål: ${projectRef}   Tilstand: ${APPLY ? "APPLY (SKRIVER, beskyttede rækker undtaget)" : "DRY-RUN (skriver intet)"}\n`);

async function fetchAll(table, cols) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select(cols).range(from, from + PAGE - 1).order("id", { ascending: true });
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

// ── 3. Frisk snapshot: KILDEN (board_profiles) + NUVÆRENDE SKYGGE ───────────
const [boards, teams, seasons, existingRelations, existingMandates, existingMilestones] = await Promise.all([
  fetchAll("board_profiles", "id, team_id, plan_type, focus, satisfaction, current_goals, season_id, negotiation_status, plan_start_season_number, plan_end_season_number"),
  fetchAll("teams", "id, name, is_ai"),
  fetchAll("seasons", "id, number, status"),
  fetchAll("board_relations", "id, team_id, confidence, confidence_source"),
  fetchAll("board_mandates", "id, team_id, season_id, status, adjustments_used, request_used"),
  fetchAll("board_vision_milestones", "id, team_id, milestone_key, status"),
]);

const teamById = new Map(teams.map((t) => [t.id, t]));
const activeSeason = seasons.find((s) => s.status === "active")
  ?? seasons.slice().sort((a, b) => (b.number ?? 0) - (a.number ?? 0))[0] ?? null;

console.log(`Læst: ${boards.length} board_profiles-rækker · ${teams.length} hold · aktiv sæson: ${activeSeason ? `S${activeSeason.number}` : "ingen"}`);
console.log(`Eksisterende skygge: ${existingRelations.length} relationer · ${existingMandates.length} mandater · ${existingMilestones.length} milepæle\n`);

const relationByTeam = new Map(existingRelations.map((r) => [r.team_id, r]));
const mandateByTeamSeason = new Map(existingMandates.map((m) => [`${m.team_id}:${m.season_id}`, m]));
const milestoneByTeamKey = new Map(existingMilestones.map((m) => [`${m.team_id}:${m.milestone_key}`, m]));

// En relation "har fremdrift" hvis motoren (wiret bag flaget i denne PR) har
// skrevet et rigtigt tal til den — dvs. metoden ikke længere er migrations-snittet.
function relationHasProgressed(row) {
  return Boolean(row) && row.confidence_source?.method && row.confidence_source.method !== "migration_v1";
}
function mandateHasProgressed(row) {
  return Boolean(row) && (row.status !== "active" || Number(row.adjustments_used || 0) > 0 || row.request_used === true);
}
function milestoneHasProgressed(row) {
  return Boolean(row) && row.status !== "pending";
}

// ── 4. Byg planen (samme logik som mandateMigration3514.mjs) ────────────────
const parseGoals = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") { try { return JSON.parse(raw) ?? []; } catch { return []; } }
  return [];
};

const byTeam = new Map();
for (const board of boards) {
  if (board.plan_type === "baseline") continue;
  if (!byTeam.has(board.team_id)) byTeam.set(board.team_id, {});
  byTeam.get(board.team_id)[board.plan_type] = board;
}

const plan = [];
const warnings = [];
let protectedRelations = 0, protectedMandates = 0, protectedMilestones = 0;

for (const [teamId, plans] of byTeam.entries()) {
  const team = teamById.get(teamId);
  if (!team || team.is_ai) continue;

  for (const planType of ["3yr", "5yr"]) {
    if (plans[planType] && isUnsignedLongPlan(plans[planType])) {
      warnings.push({ teamId, reason: "unsigned_long_plan_excluded", planType });
      delete plans[planType];
    }
  }

  const satisfactions = { "1yr": plans["1yr"]?.satisfaction, "3yr": plans["3yr"]?.satisfaction, "5yr": plans["5yr"]?.satisfaction };
  const { confidence, source } = computeMigratedConfidence(satisfactions);

  const existingRelation = relationByTeam.get(teamId);
  const relationProtected = relationHasProgressed(existingRelation);
  if (relationProtected) protectedRelations += 1;

  const oneYear = plans["1yr"];
  const mandateGoals = parseGoals(oneYear?.current_goals);
  const mandate = oneYear ? planToMandate(oneYear, mandateGoals, { confidence }) : null;
  const existingMandate = activeSeason ? mandateByTeamSeason.get(`${teamId}:${activeSeason.id}`) : null;
  const mandateProtected = mandateHasProgressed(existingMandate);
  if (mandateProtected) protectedMandates += 1;

  const milestones = [];
  for (const planType of ["3yr", "5yr"]) {
    const source3 = plans[planType];
    if (!source3) continue;
    const result = planToMilestones(source3, parseGoals(source3.current_goals));
    for (const m of result.milestones) {
      const existing = milestoneByTeamKey.get(`${teamId}:${m.milestone_key}`);
      const protectedMilestone = milestoneHasProgressed(existing);
      if (protectedMilestone) protectedMilestones += 1;
      milestones.push({ ...m, protected: protectedMilestone, isNew: !existing });
    }
    for (const skip of result.skipped) warnings.push({ teamId, reason: skip.reason, planType });
  }

  plan.push({
    teamId, teamName: team.name, satisfactions, confidence, confidenceSource: source,
    oneYearBoardId: oneYear?.id ?? null, mandate, mandateProtected, relationProtected,
    relationIsNew: !existingRelation, milestones,
  });
}

// ── 5. Scorecard ─────────────────────────────────────────────────────────────
const BUCKETS = ["0-9", "10-14", "15-29", "30-39", "40-59", "60-74", "75-89", "90-100"];
const bucket = (v) => (v < 10 ? "0-9" : v < 15 ? "10-14" : v < 30 ? "15-29" : v < 40 ? "30-39"
  : v < 60 ? "40-59" : v < 75 ? "60-74" : v < 90 ? "75-89" : "90-100");
const pct = (n, total) => (total ? `${((n / total) * 100).toFixed(1)} %` : "-");

console.log("════════════════════════════════════════════════════════════");
console.log("  SKYGGEDATA-GENOPBYGNING + RE-BASELINE (#3514, midt-i-S3)");
console.log("════════════════════════════════════════════════════════════\n");

console.log(`Hold i planen: ${plan.length}`);
console.log(`Nye relationer (hold uden skygge-relation endnu): ${plan.filter((p) => p.relationIsNew).length}`);
console.log(`Beskyttede relationer (rigtig fremdrift, IKKE overskrevet ved apply): ${protectedRelations}`);
console.log(`Beskyttede mandater (årsmøde har rørt dem): ${protectedMandates}`);
console.log(`Beskyttede milepæle (allerede afgjort): ${protectedMilestones}`);

const afterCounts = {}; for (const b of BUCKETS) afterCounts[b] = 0;
for (const p of plan) afterCounts[bucket(p.confidence)] += 1;
console.log("\nConfidence-fordeling (re-baselinet til NU, ikke 23/8):");
for (const b of BUCKETS) console.log(`  ${b.padEnd(9)} ${String(afterCounts[b]).padStart(4)} ${pct(afterCounts[b], plan.length).padStart(8)}`);

// Drift mod EKSISTERENDE (frosne) skygge-relationer — viser hvor langt 23/8-
// snapshottet er drevet væk fra virkeligheden, som addendummet forudsagde.
const driftSamples = plan
  .filter((p) => !p.relationIsNew && !p.relationProtected)
  .map((p) => ({ ...p, old: relationByTeam.get(p.teamId).confidence, drift: p.confidence - relationByTeam.get(p.teamId).confidence }))
  .filter((p) => p.drift !== 0)
  .sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));
console.log(`\nHold hvor genopbygningen flytter tallet væk fra det frosne 23/8-snapshot: ${driftSamples.length}/${plan.length - protectedRelations}`);
for (const d of driftSamples.slice(0, 10)) {
  console.log(`   ${d.teamName.padEnd(26)} ${d.old} → ${d.confidence}  (${d.drift > 0 ? "+" : ""}${d.drift})`);
}

console.log("\nVisions-milepæle: nye/opdaterede vs. beskyttede (allerede afgjort):");
const newMilestones = plan.reduce((n, p) => n + p.milestones.filter((m) => m.isNew).length, 0);
const untouchedPendingMilestones = plan.reduce((n, p) => n + p.milestones.filter((m) => !m.isNew && !m.protected).length, 0);
console.log(`   nye: ${newMilestones} · gen-skrevet (stadig pending): ${untouchedPendingMilestones} · beskyttet (achieved/missed): ${protectedMilestones}`);

if (warnings.length) {
  const grouped = {};
  for (const w of warnings) grouped[w.reason] = (grouped[w.reason] || 0) + 1;
  console.log("\nAdvarsler:");
  for (const [reason, n] of Object.entries(grouped)) console.log(`  ${reason}: ${n}`);
}

console.log("\n════════════════════════════════════════════════════════════\n");

if (!APPLY) {
  console.log("DRY-RUN færdig. Intet er skrevet. --apply er EJER-GATED — kør den ikke som del af implementeringen.\n");
  process.exit(0);
}

// ── 6. Backup FØR skrivning ─────────────────────────────────────────────────
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const backupTable = `backup_board_profiles_3514_rebuild_${stamp}`;
const { error: backupProbe } = await sb.from(backupTable).select("id").limit(1);
if (backupProbe) {
  console.error(`STOP: backup-tabellen ${backupTable} findes ikke. Opret den først:`);
  console.error(`  create table public.${backupTable} as select * from public.board_profiles;`);
  process.exit(1);
}

// ── 7. Skrivning — beskyttede rækker springes ALTID over ────────────────────
const now = new Date().toISOString();
let relationsWritten = 0, relationsSkipped = 0, mandatesWritten = 0, mandatesSkipped = 0, milestonesWritten = 0, milestonesSkipped = 0;

for (const p of plan) {
  if (p.relationProtected) { relationsSkipped += 1; }
  else {
    const { error } = await sb.from("board_relations").upsert({
      team_id: p.teamId, confidence: p.confidence, confidence_source: p.confidenceSource,
      category_scores: mergeCategoryScoresForMigration({}), last_event_at: now, updated_at: now,
    }, { onConflict: "team_id" });
    if (error) throw new Error(`board_relations upsert (${p.teamName}): ${error.message}`);
    relationsWritten += 1;
  }

  if (p.mandate && activeSeason) {
    if (p.mandateProtected) { mandatesSkipped += 1; }
    else {
      const { error } = await sb.from("board_mandates").upsert({
        team_id: p.teamId, season_id: activeSeason.id, season_number: activeSeason.number,
        status: p.mandate.status, focus: p.mandate.focus, goals: p.mandate.goals,
        adjustments_allowed: p.mandate.adjustments_allowed, source: p.mandate.source, updated_at: now,
      }, { onConflict: "team_id,season_id" });
      if (error) throw new Error(`board_mandates upsert (${p.teamName}): ${error.message}`);
      mandatesWritten += 1;
    }
  }

  for (const m of p.milestones) {
    if (m.protected) { milestonesSkipped += 1; continue; }
    const { error } = await sb.from("board_vision_milestones").upsert({
      team_id: p.teamId, milestone_key: m.milestone_key, goal: m.goal,
      target_season_number: m.target_season_number, origin: m.origin, weight: m.weight,
      is_headline: m.is_headline, status: "pending", updated_at: now,
    }, { onConflict: "team_id,milestone_key" });
    if (error) throw new Error(`board_vision_milestones upsert (${p.teamName}): ${error.message}`);
    milestonesWritten += 1;
  }
}

console.log(`\nSkrevet: ${relationsWritten} relationer (${relationsSkipped} beskyttet) · ${mandatesWritten} mandater (${mandatesSkipped} beskyttet) · ${milestonesWritten} milepæle (${milestonesSkipped} beskyttet).`);
console.log("\n✅ Genopbygningen er skrevet. Kill-switchen er urørt af dette script — flip er et separat, ejer-gated skridt.\n");
