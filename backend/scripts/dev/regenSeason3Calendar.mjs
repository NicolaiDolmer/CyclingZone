#!/usr/bin/env node
// backend/scripts/dev/regenSeason3Calendar.mjs
// #3546 (S3-kalender-pakken) + #3467 (ejer-beslutning 18/8, KS3) — REGENERERING af S3's
// kalender EFTER wipeSeason3Calendar.mjs har ryddet den gamle.
//
// #3467: ÉN bufferdag efter cutoveren. 24/8 = hviledag (INGEN løb), FØRSTE S3-løbsdag =
// 25/8. Formål: 24 timers verifikationsmargin efter søndagens pakke (race-day-flip +
// D1-komprimering + mandat-backfill) FØR første rigtige løb. Den eksisterende (nu wipede)
// prod-kalender havde første etape mandag 24/8 kl. 11 — det var FØR beslutningen og er
// derfor forældet på præcis dette punkt.
//
// HVORFOR ET SEPARAT SCRIPT (ikke bare "kald materializeTierCalendars direkte"): hverken
// buildTierMaterializationPlan (den REN funktion #3546 rører) eller materializeTierCalendars
// (I/O-wrapperen) har noget indbygget "næste mandag"/bufferdags-DEFAULT — `from` er 100 %
// caller-leveret (default `new Date()` = NU, hvilket ville materialisere en kalender med
// dag-0 i FORTIDEN på en 'upcoming'-sæson). Bufferdagen er derfor IKKE en egenskab af
// selve kalender-kompositionen (GT-længde/Giro-spredning/dagsafgørelser/itt_hilly er
// AFKOBLET fra datoer) — den er en egenskab af HVILKEN dato der sendes ind som
// `firstRaceDate`. Dette script er det ene sted der ejer det tal.
//
// DRY-RUN (default) bruger buildTierMaterializationPlan DIREKTE (samme rene funktion +
// samme 100%-read-only-mønster som s3CalendarPackageScorecard.js — kun .select()-kald,
// ALDRIG skrivning) og printer den planlagte FØRSTE LØBSDAG eksplicit, så ejeren kan
// bekræfte bufferdagen holder FØR nogen skrivning sker.
//
// SIKKERHEDS-KÆDEN:
//   1. Ejer-gate i koden: dry-run er default; --apply kræver --jeg-har-set-dry-runnet.
//   2. Sæson-port: status SKAL være 'upcoming' (samme port som wipeSeason3Calendar.mjs).
//   3. --apply kræver 0 eksisterende races for sæsonen (kør wipeSeason3Calendar.mjs FØRST
//      — materialize-wrapperen er en no-op ellers, jf. #3546-issuets egen observation).
//   4. Første-løbsdag er HARDKODET til 2026-08-25 (#3467) — override findes KUN til test
//      (--first-day=), og printer en tydelig advarsel når brugt, fordi det afviger fra
//      ejer-beslutningen.
//   5. Post-verify (kun --apply): læser den faktisk skrevne race_stage_schedule tilbage
//      og bekræfter MIN(scheduled_at) falder på præcis --first-day (ingen løb tidligere).
//
// KØRSEL
//   dry-run (default, 100% read-only, kan køres når som helst — også FØR wipe):
//     cd backend && infisical run --env=prod -- node scripts/dev/regenSeason3Calendar.mjs
//   skrivning (KUN efter wipeSeason3Calendar.mjs --apply, KUN efter ejer-go):
//     cd backend && infisical run --env=prod -- node scripts/dev/regenSeason3Calendar.mjs --apply --jeg-har-set-dry-runnet
//
// Refs #3546 #3467.

import { createClient } from "@supabase/supabase-js";

import { buildTierMaterializationPlan, materializeTierCalendars, TIER_DENSITY } from "../../lib/tierCalendarMaterializer.js";
import { resolveCalendarFrom } from "../../lib/calendarStartDate.js";
import { copenhagenDateString } from "../../lib/copenhagenTime.js";
import { loadPoolsAndCatalog } from "../s3CalendarPackageScorecard.js";
import { fmtInt } from "../lib/cutover3645.js";

const SEASON_NUMBER = 3;
// #3467, ejer-beslutning 18/8 (KS3): 24/8 = hviledag, første S3-løbsdag = 25/8.
const OWNER_FIRST_RACE_DAY = "2026-08-25";

// #4131, ejer-direktiv 23/8: sæsonen skal SLUTTE på en søndag, ikke mandag. 25/8 (tir) + 27
// kalenderdage = 20/9 (søn) — se docs/snapshots/4131/dry-run-2026-08-23.md for udregningen.
// Kvoten (game-day/etape-antal pr. tier) sættes til DENSITET × 27 i stedet for den hidtidige
// hardkodede 140/112/84/56 (= densitet × 28): densiteten (5/4/3/2 løbsdage/dag, ejer-låst) skal
// IKKE ændres, så en dag mindre skal give en tilsvarende mindre kvote (samme mønster som
// #2276 rest-af-sæson-reparationen i reconcilePoolCalendarOnActivation).
//
// HVORFOR ikke bare realDays=27 med UÆNDRET kvote (140/112/84/56): det blev testet i
// dry-runnet og BRØD #4121's GT-dags-loft (målt en dag med 5 etaper af samme Grand Tour i
// træk, mod loftet på 4) — generatoren tvinges til at presse en GT's EGNE etaper sammen på
// samme kalenderdag når kvoten ikke går op i færre dage. Den skalerede kvote her respekterer
// loftet (målt maks 4 GT-etaper/dag i dry-runnet, 0 brud) og koster i stedet en mindre
// reduktion i sæsonens samlede løbsantal (471 → 446, kun endagsløb, se dry-run-rapporten).
const REAL_DAYS = 27;
const QUOTAS = Object.fromEntries(Object.entries(TIER_DENSITY).map(([tier, density]) => [Number(tier), density * REAL_DAYS]));

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const APPLY = process.argv.includes("--apply");
const CONFIRMED = process.argv.includes("--jeg-har-set-dry-runnet");
const FIRST_RACE_DAY = arg("--first-day", OWNER_FIRST_RACE_DAY);

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE-secrets (kør via: infisical run --env=prod -- ...)");
  process.exit(1);
}
if (APPLY && !CONFIRMED) {
  console.error("STOP — --apply kræver også --jeg-har-set-dry-runnet. Kør dry-runnet først.");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const projectRef = (SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\./) || [])[1] || "ukendt";

console.log("=== #3546/#3467 regenerering af S3-kalenderen ===");
console.log(APPLY ? "TILSTAND: APPLY (skriver til prod)" : "TILSTAND: DRY-RUN (100% read-only, skriver intet)");
console.log(`Database: ${projectRef}`);

if (FIRST_RACE_DAY !== OWNER_FIRST_RACE_DAY) {
  console.warn(`\n⚠ --first-day=${FIRST_RACE_DAY} AFVIGER fra ejer-beslutningen (#3467, 18/8): ${OWNER_FIRST_RACE_DAY}.`);
  console.warn(`  Kun til test — brug ALDRIG dette flag mod prod uden en ny eksplicit ejer-go.`);
}

// ── Sæson-port (samme som wipeSeason3Calendar.mjs) ──────────────────────────
const { data: seasons, error: sErr } = await supabase.from("seasons").select("id, number, status, start_date, race_days_total").eq("number", SEASON_NUMBER);
if (sErr) throw new Error(`seasons: ${sErr.message}`);
if (!seasons || seasons.length !== 1) {
  console.error(`STOP — forventede præcis 1 sæson med number = ${SEASON_NUMBER}, fandt ${seasons?.length ?? 0}.`);
  process.exit(1);
}
const season = seasons[0];
console.log(`\nSæson ${season.number}: id=${season.id} · status=${season.status} · start_date=${season.start_date}`);
if (season.status === "active") {
  console.error(`\nSTOP — sæson ${SEASON_NUMBER} er 'active'. Regenerér ALDRIG en live sæsons kalender.`);
  process.exit(1);
}
if (season.status !== "upcoming") {
  console.error(`\nSTOP — sæson ${SEASON_NUMBER} har status '${season.status}', ikke 'upcoming'. Afbrudt.`);
  process.exit(1);
}

const { count: existingRaces, error: exErr } = await supabase.from("races").select("id", { count: "exact", head: true }).eq("season_id", season.id);
if (exErr) throw new Error(`races (eksisterende): ${exErr.message}`);
console.log(`Eksisterende races for season_id=${season.id}: ${fmtInt(existingRaces)}`);

// ── Bufferdags-anker (#3467) ──────────────────────────────────────────────────
const from = resolveCalendarFrom({ firstRaceDate: FIRST_RACE_DAY });
console.log(`\n── #3467 bufferdag ──`);
console.log(`Bufferdag (ingen løb):        24/8-2026 (dagen umiddelbart efter cutoveren 23/8)`);
console.log(`FØRSTE S3-LØBSDAG:            ${FIRST_RACE_DAY}${FIRST_RACE_DAY === OWNER_FIRST_RACE_DAY ? " (ejer-beslutning #3467, 18/8)" : " (⚠ TEST-OVERRIDE)"}`);
console.log(`from-anker (real_day 0 base): ${from.toISOString()}`);

// ── Dry-run-plan: REN funktion, 100% read-only (samme mønster som scorecardet) ──
console.log(`\n── #4131 27-dages-vindue ──`);
console.log(`realDays=${REAL_DAYS} · quotas=${JSON.stringify(QUOTAS)} (densitet × ${REAL_DAYS}, mål: sidste løbsdag = søndag)`);

const { pools, catalog } = await loadPoolsAndCatalog(supabase);
const { tierPlans } = buildTierMaterializationPlan({ pools, catalog, from, baseSeed: 1, realDays: REAL_DAYS, quotas: QUOTAS });

let earliestScheduledAt = null;
let totalStageRows = 0;
for (const t of tierPlans) {
  for (const p of t.pools) {
    for (const s of p.stageRows) {
      totalStageRows++;
      if (earliestScheduledAt == null || s.scheduled_at < earliestScheduledAt) earliestScheduledAt = s.scheduled_at;
    }
  }
}
const earliestDay = earliestScheduledAt ? copenhagenDateString(new Date(earliestScheduledAt)) : null;

console.log(`\n── Planlagt kalender (${tierPlans.length} tiers, ${totalStageRows} etape-tider i alt) ──`);
for (const t of tierPlans) {
  const totalSelected = t.pools.reduce((a, p) => a + p.raceRows.length, 0) / (t.pools.length || 1);
  console.log(`   tier ${t.tier}: quota=${t.quota} · races/pulje≈${Math.round(totalSelected)} · puljer=${t.pools.length} · tomme dage=${t.emptyDays} · dage uden afgørelse=${t.daysWithoutDecisionCount}`);
}
console.log(`\nTidligste planlagte scheduled_at: ${earliestScheduledAt ?? "?"}`);
console.log(`→ Tidligste danske kalenderdag:    ${earliestDay ?? "?"}`);

if (earliestDay !== FIRST_RACE_DAY) {
  console.error(`\nSTOP — planen lægger det tidligste løb på ${earliestDay}, IKKE på den forventede første løbsdag ${FIRST_RACE_DAY}.`);
  console.error(`Bufferdagen (#3467) holder IKKE i denne plan. Undersøg buildScheduleRows/from-beregningen FØR apply.`);
  process.exit(1);
}
console.log(`\nBufferdags-gate: OK — intet løb planlagt før ${FIRST_RACE_DAY}, 24/8 er reelt løbsfri.`);

// #4131: sæsonens SIDSTE løbsdag skal være en søndag (ejer-direktiv 23/8). Beregnes fra den
// PLANLAGTE kalender (samme mønster som bufferdags-gaten ovenfor) — fanger en fejl i
// REAL_DAYS/from-beregningen FØR apply, ikke bagefter.
let latestScheduledAt = null;
for (const t of tierPlans) {
  for (const p of t.pools) {
    for (const s of p.stageRows) {
      if (latestScheduledAt == null || s.scheduled_at > latestScheduledAt) latestScheduledAt = s.scheduled_at;
    }
  }
}
const latestDay = latestScheduledAt ? copenhagenDateString(new Date(latestScheduledAt)) : null;
const latestWeekday = latestDay ? new Date(`${latestDay}T12:00:00Z`).getUTCDay() : null; // 0 = søndag
console.log(`\nSidste planlagte scheduled_at: ${latestScheduledAt ?? "?"}`);
console.log(`→ Sidste danske kalenderdag:     ${latestDay ?? "?"} (ugedag ${latestWeekday ?? "?"}, 0=søndag)`);
if (latestWeekday !== 0) {
  console.error(`\nSTOP — planens sidste løbsdag (${latestDay}) er IKKE en søndag (ugedag ${latestWeekday}). Ejer-direktiv 23/8 (#4131) kræver søndags-slut. Undersøg REAL_DAYS/quotas FØR apply.`);
  process.exit(1);
}
console.log(`Søndags-slut-gate (#4131): OK — sidste løbsdag ${latestDay} er en søndag.`);

if (!APPLY) {
  console.log(`\nDRY-RUN slut — intet skrevet. ${existingRaces > 0 ? `⚠ ${existingRaces} races findes stadig — kør wipeSeason3Calendar.mjs --apply FØRST.` : "0 eksisterende races — klar til apply når ejer-go foreligger."}`);
  console.log(`Kør med --apply --jeg-har-set-dry-runnet for at skrive (kun efter wipe + ejer-go).`);
  process.exit(0);
}

// ── APPLY ────────────────────────────────────────────────────────────────────
if (existingRaces > 0) {
  console.error(`\nSTOP — ${existingRaces} races findes stadig for season_id=${season.id}. Kør wipeSeason3Calendar.mjs --apply --jeg-har-set-dry-runnet FØRST (materialize er en no-op ellers).`);
  process.exit(1);
}

console.log(`\n--- APPLY ---`);
const summary = await materializeTierCalendars({
  supabase, seasonId: season.id, seasonStartDate: season.start_date, from, dryRun: false, log: (m) => console.log(m),
  realDays: REAL_DAYS, quotas: QUOTAS,
});
console.log(`\n=== APPLY SUMMARY ===`);
console.log(`races indsat: ${summary.racesInserted} · stage-profiler: ${summary.stageProfiles} · stage-schedule: ${summary.stageSchedules}`);
console.log(`race_days_completed efter recompute: ${summary.raceDaysCompletedAfterRecompute ?? "?"}`);
if (summary.raceDaysTotalError) console.warn(`⚠ race_days_total recompute fejlede (self-healende ved næste kørsel): ${summary.raceDaysTotalError}`);

// ── Post-verify: den FAKTISK skrevne tidligste dag matcher #3467 ────────────
// #4104-fund (23/8): den oprindelige version lagde ALLE sæsonens race-id'er i ÉN
// .in()-klausul. Med 471 løb sprænger det PostgREST-gatewayen og fejler med et
// intetsigende "TypeError: fetch failed" — EFTER at hele kalenderen er skrevet.
// Resultatet var en apply der lykkedes, men rapporterede rødt. Samme grænse som
// SUPABASE_IN_CHUNK_SIZE (#3030) allerede findes for; her chunkes der i stedet, og
// den globale tidligste dag er minimum af chunk-minima.
const IN_CHUNK = 100;
const { data: seasonRaceIds, error: idErr } = await supabase.from("races").select("id").eq("season_id", season.id);
if (idErr) throw new Error(`post-verify races: ${idErr.message}`);
const allIds = (seasonRaceIds ?? []).map((r) => r.id);
let earliestIso = null;
for (let i = 0; i < allIds.length; i += IN_CHUNK) {
  const { data: rows, error: pvErr } = await supabase
    .from("race_stage_schedule")
    .select("scheduled_at")
    .in("race_id", allIds.slice(i, i + IN_CHUNK))
    .order("scheduled_at", { ascending: true })
    .limit(1);
  if (pvErr) throw new Error(`post-verify race_stage_schedule (chunk ${i / IN_CHUNK + 1}): ${pvErr.message}`);
  const iso = rows?.[0]?.scheduled_at ?? null;
  if (iso && (earliestIso === null || iso < earliestIso)) earliestIso = iso;
}
const writtenEarliestDay = earliestIso ? copenhagenDateString(new Date(earliestIso)) : null;
console.log(`\nPost-verify: tidligste skrevne scheduled_at → dag ${writtenEarliestDay ?? "?"}`);
if (writtenEarliestDay !== FIRST_RACE_DAY) {
  console.error(`POST-VERIFY FEJLEDE — den skrevne kalender starter ${writtenEarliestDay}, ikke ${FIRST_RACE_DAY}. Undersøg FØR videre skridt.`);
  process.exit(1);
}
console.log(`Post-verify OK: S3's kalender starter på præcis ${FIRST_RACE_DAY} — bufferdagen (#3467) holder i det skrevne resultat.`);
