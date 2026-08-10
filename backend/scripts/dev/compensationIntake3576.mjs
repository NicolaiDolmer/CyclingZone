// #3576/#3577 — KOMPENSATIONS-KULD efter akademi-hændelsen 9/8 (#3561).
//
// Baggrund: søndags-drippet 9/8 claimede alle 192 aktive menneskehold i
// academy_intake_ticks, men kandidaterne var blandt de 374 defekte der blev
// slettet i #3561-oprydningen. Claim-rækken står tilbage, så drip-cronen giver
// ALDRIG de hold deres 9/8-kuld igen (og den er søndags-gated oveni). Dette
// script er den ene vej til at levere kuldet + ejerens undskyldnings-bonus.
//
// DRY-RUN ER DEFAULT. Uden --apply røres databasen ikke med en eneste write.
//
//   Dry-run:  infisical run --env=prod -- node scripts/dev/compensationIntake3576.mjs
//   Apply:    infisical run --env=prod -- node scripts/dev/compensationIntake3576.mjs --apply
//
// Determinisme: seed pr. hold = COMP_SEED_BASE XOR hash(`${teamId}:${tickDate}`),
// samme mønster som sundayIntakeTick. Dry-run og apply med SAMME --date giver
// derfor bit-identiske kandidater — scorecardet du godkender ER det der skrives.
// Holdene behandles i id-rækkefølge, fordi navne-dedup (existingNames) muteres
// undervejs og dermed er rækkefølge-følsom.
//
// Dry-run-kæden spejler backfillCores.deriveForRiderIds trin for trin
// (physiology → abilities → caps fra TRUKKET anlæg → resolveRiderTypes →
// base_value). Den ene forskel fra apply er at intet skrives.
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

import { generateAcademyCandidates } from "../../lib/academyGenerator.js";
import { seedAcademyCohortForTeam, fetchActiveSeason, fetchExistingFoldedRiderNames, hashStringToSeed } from "../../lib/academyIntake.js";
import { makeRng } from "../../lib/fictionalRiderGenerator.js";
import { seedPhysiologyFromLegacy } from "../../lib/physiologySeeding.js";
import { deriveAbilities, VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";
import { buildCapsForRider, buildYouthCaps } from "../../lib/riderProgression.js";
import { resolveRiderTypes, computeRiderTypes, RIDER_TYPE_KEYS } from "../../lib/riderTypes.js";
import { selectTypesBaseline } from "../../lib/riderTypesBaselineSelect.js";
import { predictBaseValue } from "../../lib/riderValuation.js";
import { calculateRiderMarketValue } from "../../lib/marketUtils.js";
import { ageForSeason } from "../../lib/riderSeasonAge.js";
import { ACADEMY } from "../../lib/academyFlag.js";
import { deriveForRiderIds } from "../../lib/backfillCores.js";
import { notifyTeamOwner } from "../../lib/notificationService.js";
import { DEFAULT_DISTRIBUTION } from "../../lib/archetypeDistribution.js";

const LIB = path.join(import.meta.dirname, "../../lib");
const typesBaseline = JSON.parse(fs.readFileSync(path.join(LIB, "riderTypesBaseline.json"), "utf8"));
const youthTypesBaseline = JSON.parse(fs.readFileSync(path.join(LIB, "riderTypesBaselineYouth.json"), "utf8"));
const valuationModel = JSON.parse(fs.readFileSync(path.join(LIB, "riderValuationModelV4.json"), "utf8"));

// Seed-basen er BEVIDST forskellig fra sundayIntackTick's 2064: samme hold på
// samme dato må ikke kunne genskabe et drip-kuld der allerede er leveret.
const COMP_SEED_BASE = 3576;

// Hændelsesdatoen. Hold med intake-rækker fra denne dag fik faktisk et (sundt,
// post-fix) kuld og skal derfor kun have bonussen, ikke erstatningen.
const INCIDENT_DATE = "2026-08-09";

// Ungdomsbåndets G6-invariant måles på de FYSISKE evner alene — identisk liste med
// archetypeGenerationGates.test.js's PHYSICAL_ABILITIES. `tactics`, `positioning`,
// `aggression` m.fl. har alders-drevne gulve i abilityDerivation og ligger derfor
// legitimt over båndet for de ældste kandidater; måler man dem med, rapporterer
// scorecardet et brud der ikke findes (verificeret 10/8: alle "brud" var tactics).
const PHYSICAL_ABILITIES = Object.freeze([
  "climbing", "time_trial", "flat", "tempo", "sprint",
  "acceleration", "punch", "endurance", "recovery", "durability",
]);

// ── Args ─────────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const APPLY = args.apply === true;
const BASE_COUNT = Number(args.base ?? 2);   // erstatning for det mistede søndagskuld
const BONUS_COUNT = Number(args.bonus ?? 2); // ejerens undskyldning for de sidste dages problemer
const TICK_DATE = String(args.date ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen" }).format(new Date()));

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE secrets (kør via: infisical run --env=prod -- node ...)");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Hjælpere ─────────────────────────────────────────────────────────────────
const pct = (n, total) => (total ? Math.round((1000 * n) / total) / 10 : 0);
const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i];
};
const kr = (n) => (n == null ? "—" : Math.round(n).toLocaleString("da-DK"));

function tally(values) {
  const m = new Map();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

// Spejler backfillCores.deriveForRiderIds for ÉN kandidat — uden DB.
function deriveCandidateInMemory(candidate, seasonNumber) {
  const riderRow = { ...candidate.rider, archetype_draw: candidate.archetypeDraw };
  const physiology = seedPhysiologyFromLegacy(riderRow);
  const abilities = deriveAbilities(physiology, riderRow);

  const baseline = {};
  for (const k of VISIBLE_ABILITIES) if (abilities[k] != null) baseline[k] = Number(abilities[k]);

  const age = ageForSeason(riderRow.birthdate, seasonNumber);
  const draw = candidate.archetypeDraw;

  // Trin 3: caps formes af det TRUKNE anlæg (#3570 fase 2 — akademi-stien
  // persisterer archetype_draw, så produktionen tager netop denne gren).
  const caps = buildCapsForRider(baseline, { potentiale: riderRow.potentiale, age }, draw.primary, draw.secondary || null);

  // Trin 4: et persisteret anlæg VINDER over klassifikatoren (#3588).
  const rowModel = selectTypesBaseline(age, typesBaseline, youthTypesBaseline);
  const { primary, secondary } = resolveRiderTypes(draw, caps, rowModel);

  // Diagnostik: hvad ville klassifikatoren have gættet uden anlægget (G1)?
  const blind = computeRiderTypes(caps, rowModel);

  // Trin 5: base_value + markedsværdi → signing fee (25 % af markedsværdien).
  const valueRider = { ...riderRow, primary_type: primary.key, age };
  const baseValue = predictBaseValue(valueRider, abilities, valuationModel);
  const marketValue = calculateRiderMarketValue({ ...valueRider, base_value: baseValue });
  const fee = marketValue == null ? null : Math.round(marketValue * ACADEMY.SIGNING_FEE_RATE);

  const bestAbility = Math.max(...PHYSICAL_ABILITIES.map((a) => Number(abilities[a]) || 0));
  const maxCap = Math.max(...VISIBLE_ABILITIES.map((a) => Number(caps[a]) || 0));
  const youthCaps = buildYouthCaps(riderRow.potentiale, draw.primary, draw.secondary || null);
  const maxYouthCap = Math.max(...VISIBLE_ABILITIES.map((a) => Number(youthCaps[a]) || 0));

  return {
    age,
    potentiale: riderRow.potentiale,
    drawPrimary: draw.primary,
    drawSecondary: draw.secondary || null,
    isHybrid: !!draw.isHybrid,
    shownType: primary.key,
    shownSecondary: secondary.key,
    blindType: blind.primary.key,
    bestAbility,
    maxCap,
    maxYouthCap,
    baseValue,
    marketValue,
    fee,
    isSerious: candidate.is_serious,
  };
}

// ── Hoved ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n═══ Kompensations-kuld (#3576) — ${APPLY ? "APPLY" : "DRY-RUN"} ═══`);
  console.log(`tick_date: ${TICK_DATE}   erstatning: ${BASE_COUNT}   bonus: ${BONUS_COUNT}\n`);

  const season = await fetchActiveSeason(sb);
  if (!season) throw new Error("ingen aktiv sæson");
  const referenceYear = parseInt(String(season.start_date).slice(0, 4), 10) || 2026;
  console.log(`Aktiv sæson: S${season.number} (start ${season.start_date}, referenceår ${referenceYear})`);

  // Aktive menneskehold — SAMME filter som sundayIntakeTick.
  const { data: teams, error: teamsErr } = await sb
    .from("teams")
    .select("id, name, season_1_identity_basis")
    .eq("is_ai", false).eq("is_bank", false).eq("is_frozen", false).eq("is_test_account", false)
    .order("id", { ascending: true });
  if (teamsErr) throw new Error(`teams lookup: ${teamsErr.message}`);

  // Hvem fik faktisk et kuld på hændelsesdagen? (De 3 post-fix-hold.)
  const { data: gotRows, error: gotErr } = await sb
    .from("academy_intake")
    .select("team_id")
    .gte("created_at", `${INCIDENT_DATE}T00:00:00Z`)
    .lt("created_at", `${INCIDENT_DATE}T23:59:59Z`);
  if (gotErr) throw new Error(`incident-day intake lookup: ${gotErr.message}`);
  const gotCohort = new Set((gotRows || []).map((r) => r.team_id));

  // Idempotens: hold der allerede har fået kompensationen (apply kørt før).
  const { data: claimedRows, error: claimErr } = await sb
    .from("academy_intake_ticks").select("team_id").eq("tick_date", TICK_DATE);
  if (claimErr) throw new Error(`tick claim lookup: ${claimErr.message}`);
  const alreadyClaimed = new Set((claimedRows || []).map((r) => r.team_id));

  const plan = teams.map((t) => ({
    team: t,
    count: (gotCohort.has(t.id) ? 0 : BASE_COUNT) + BONUS_COUNT,
    alreadyGotCohort: gotCohort.has(t.id),
    skip: alreadyClaimed.has(t.id),
  })).filter((p) => p.count > 0);

  const todo = plan.filter((p) => !p.skip);
  const skipped = plan.filter((p) => p.skip);

  console.log(`Hold i alt: ${teams.length}`);
  console.log(`  · mistede 9/8-kuldet → ${BASE_COUNT}+${BONUS_COUNT} = ${BASE_COUNT + BONUS_COUNT} kandidater: ${todo.filter((p) => !p.alreadyGotCohort).length} hold`);
  console.log(`  · fik 9/8-kuldet     → kun bonus ${BONUS_COUNT}: ${todo.filter((p) => p.alreadyGotCohort).length} hold`);
  if (skipped.length) console.log(`  · allerede kompenseret på ${TICK_DATE} (springes over): ${skipped.length} hold`);
  console.log(`Kandidater i alt: ${todo.reduce((s, p) => s + p.count, 0)}\n`);

  const existingNames = await fetchExistingFoldedRiderNames(sb);
  console.log(`Navne-dedup: ${existingNames.size} eksisterende rytternavne indlæst\n`);

  if (!APPLY) {
    // ── DRY-RUN: generér + derivér in-memory, byg scorecard ──────────────────
    const rows = [];
    for (const p of todo) {
      const rng = makeRng(((COMP_SEED_BASE ^ hashStringToSeed(`${p.team.id}:${TICK_DATE}`)) >>> 0));
      const candidates = generateAcademyCandidates({
        rng,
        referenceYear,
        existingNames,
        identityBasis: p.team.season_1_identity_basis || null,
        countOverride: p.count,
      });
      for (const c of candidates) rows.push({ teamId: p.team.id, ...deriveCandidateInMemory(c, season.number) });
    }
    printScorecard(rows, todo.length);
    if (args.json) {
      fs.writeFileSync(String(args.json), JSON.stringify({ tickDate: TICK_DATE, base: BASE_COUNT, bonus: BONUS_COUNT, rows }, null, 2));
      console.log(`\nRå rækker skrevet til ${args.json}`);
    }
    console.log("\nDRY-RUN — ingen writes. Kør igen med --apply for at levere kuldene.\n");
    return;
  }

  // ── APPLY ────────────────────────────────────────────────────────────────
  let seededTeams = 0;
  const allNewIds = [];
  const errors = [];

  for (const p of todo) {
    // Claim FØRST (samme mønster som sundayIntakeTick): PK-kollision = allerede kørt.
    const { data: claim, error: cErr } = await sb
      .from("academy_intake_ticks")
      .upsert({ team_id: p.team.id, tick_date: TICK_DATE }, { onConflict: "team_id,tick_date", ignoreDuplicates: true })
      .select("team_id");
    if (cErr) { errors.push(`claim ${p.team.id}: ${cErr.message}`); continue; }
    if (!claim?.length) continue; // en samtidig kørsel vandt racen

    try {
      const rng = makeRng(((COMP_SEED_BASE ^ hashStringToSeed(`${p.team.id}:${TICK_DATE}`)) >>> 0));
      const newIds = await seedAcademyCohortForTeam(sb, {
        teamId: p.team.id,
        season,
        referenceYear,
        existingNames,
        rng,
        identityBasis: p.team.season_1_identity_basis || null,
        countOverride: p.count,
      });
      seededTeams += 1;
      allNewIds.push(...newIds);

      await notifyTeamOwner({
        supabase: sb,
        teamId: p.team.id,
        type: "academy_drip",
        title: "New academy talent has arrived",
        message: "New candidates are waiting in your academy - sign or reject them.",
        relatedId: null,
        metadata: { titleCode: "notif.academyDrip.title", messageCode: "notif.academyDrip.message" },
      });
    } catch (e) {
      errors.push(`${p.team.id}: ${e?.message ?? e}`);
    }
  }

  // Afled-pipeline i ÉT kald (#1478) — uden den mangler kandidaterne physiology,
  // evner, type og base_value, og springes i træningen.
  if (allNewIds.length) {
    console.log(`\nAfleder ${allNewIds.length} nye ryttere...`);
    await deriveForRiderIds(sb, allNewIds, { dryRun: false });
  }

  console.log(`\n✅ ${allNewIds.length} kandidater leveret til ${seededTeams} hold (tick_date ${TICK_DATE})`);
  if (errors.length) {
    console.error(`\n❌ ${errors.length} fejl:`);
    for (const e of errors.slice(0, 20)) console.error(`   ${e}`);
    process.exitCode = 1;
  }
}

// ── Scorecard ────────────────────────────────────────────────────────────────
function printScorecard(rows, teamCount) {
  const n = rows.length;
  console.log(`─── SCORECARD: ${n} kandidater til ${teamCount} hold ───\n`);

  // 1) Anlægsfordeling — DETTE er identiteten nu (#3588: draw vinder over
  //    klassifikatoren), så det er den fordeling der betyder noget for spilleren.
  console.log("ANLÆG (= den viste ryttertype) mod mål-fordelingen:");
  const drawCounts = new Map(RIDER_TYPE_KEYS.map((k) => [k, 0]));
  for (const r of rows) drawCounts.set(r.drawPrimary, (drawCounts.get(r.drawPrimary) ?? 0) + 1);
  let worstDelta = 0;
  for (const key of RIDER_TYPE_KEYS) {
    const got = drawCounts.get(key) ?? 0;
    const target = DEFAULT_DISTRIBUTION[key] ?? 0;
    const gotPct = pct(got, n);
    const delta = Math.round((gotPct - target) * 10) / 10;
    worstDelta = Math.max(worstDelta, Math.abs(delta));
    const bar = "█".repeat(Math.round(gotPct / 2));
    console.log(`  ${key.padEnd(16)} ${String(got).padStart(4)}  ${String(gotPct).padStart(5)} %  (mål ${String(target).padStart(5)} %, afvig ${delta > 0 ? "+" : ""}${delta})  ${bar}`);
  }
  console.log(`  → største afvigelse fra mål: ${Math.round(worstDelta * 10) / 10} pct-point`);
  console.log(`  → hybrider: ${rows.filter((r) => r.isHybrid).length} (${pct(rows.filter((r) => r.isHybrid).length, n)} %, forventet ~15 %)\n`);

  // 2) Ungdomsbånd — G6-invarianten der manglede da #3561 slap igennem.
  const best = rows.map((r) => r.bestAbility).sort((a, b) => a - b);
  const overBand = rows.filter((r) => r.bestAbility > 15);
  console.log("UNGDOMSBÅND (bedste fysiske evne ved fødslen):");
  console.log(`  median ${quantile(best, 0.5)}   p90 ${quantile(best, 0.9)}   max ${best[best.length - 1]}`);
  console.log(`  over båndet (>15): ${overBand.length}  ${overBand.length === 0 ? "✅ G6 holder" : "❌ G6 BRUDT"}\n`);

  // 3) G5 — current må aldrig løfte caps over potentiale-loftet (rod-årsagen til #3561).
  const g5Breaks = rows.filter((r) => r.maxCap > r.maxYouthCap + 0.001);
  console.log("POTENTIALE-LOFT (G5 — rod-årsagen til 9/8-hændelsen):");
  console.log(`  caps over potentiale-loftet: ${g5Breaks.length} af ${n}  ${g5Breaks.length === 0 ? "✅ G5 holder 100 %" : "❌ G5 BRUDT"}\n`);

  // 4) Værdi + signing fee — #3550's klage var netop fee'en.
  const mv = rows.map((r) => r.marketValue).filter(Number.isFinite).sort((a, b) => a - b);
  const fees = rows.map((r) => r.fee).filter(Number.isFinite).sort((a, b) => a - b);
  console.log("MARKEDSVÆRDI OG SIGNING FEE:");
  console.log(`  værdi:  median ${kr(quantile(mv, 0.5))}   p90 ${kr(quantile(mv, 0.9))}   max ${kr(mv[mv.length - 1])}`);
  console.log(`  fee:    median ${kr(quantile(fees, 0.5))}   p90 ${kr(quantile(fees, 0.9))}   max ${kr(fees[fees.length - 1])}`);
  console.log(`  (til sammenligning: de defekte 9/8-ryttere havde værdi op til 42,5 mio.)\n`);

  // 5) Potentiale — den geometriske fordeling (#2064, ejer-valgt 19/7).
  console.log("POTENTIALE (geometrisk træk, decay 0,55):");
  for (const [p, c] of tally(rows.map((r) => r.potentiale)).sort((a, b) => a[0] - b[0])) {
    console.log(`  ${String(p).padStart(4)}  ${String(c).padStart(4)}  ${String(pct(c, n)).padStart(5)} %  ${"█".repeat(Math.round(pct(c, n) / 2))}`);
  }
  const serious = rows.filter((r) => r.isSerious).length;
  console.log(`  → "seriøse" (pot ≥ 4,5): ${serious} (${pct(serious, n)} %)\n`);

  // 6) Alder — i SÆSON-alder (ageForSeason), som er den produktionen klassificerer
  //    og værdisætter efter. Generatoren clamper mod sæsonens START-ÅR, ikke mod
  //    sæson-referenceåret, så kuldet ligger systematisk forskudt (se advarslen).
  console.log("SÆSON-ALDER (ageForSeason — den produktionen bruger):");
  for (const [a, c] of tally(rows.map((r) => r.age)).sort((x, y) => x[0] - y[0])) {
    const outside = a < ACADEMY.MIN_AGE || a > ACADEMY.MAX_AGE;
    console.log(`  ${String(a).padStart(4)}  ${String(c).padStart(4)}  ${String(pct(c, n)).padStart(5)} %${outside ? "   ⚠ uden for akademi-alderen (16-21)" : ""}`);
  }
  const outsideBand = rows.filter((r) => r.age < ACADEMY.MIN_AGE || r.age > ACADEMY.MAX_AGE);
  if (outsideBand.length) {
    console.log(`  ⚠ ${outsideBand.length} af ${n} (${pct(outsideBand.length, n)} %) fødes uden for akademi-alderen.`);
    console.log(`    De klassificeres mod VOKSEN-baselinen og får ingen ungdoms-multiplikator.`);
  }

  // 7) Diagnostik: ville klassifikatoren selv have fundet anlægget? (G1)
  // Ikke længere en gate — anlægget ER identiteten — men et mål for hvor
  // "aflæselig" rytterens profil er for spilleren.
  const g1 = rows.filter((r) => r.blindType === r.drawPrimary).length;
  console.log(`\nDIAGNOSTIK — profilens aflæselighed (G1): ${pct(g1, n)} % af kandidaterne ville`);
  console.log(`klassificeres til deres eget anlæg hvis anlægget ikke var gemt. Påvirker ikke den`);
  console.log(`viste type (den kommer fra anlægget), kun hvor tydeligt profilen matcher etiketten.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
