#!/usr/bin/env node
// #4103/#4104 — EFTERVERIFIKATION af den skrevne S3-kalender. Laeser prod, skriver intet.
//
// Hvorfor den findes: monument-baandet blev shippet 23/8 og virkede i unit-testen, men
// slog IKKE igennem i prod. Aarsagen var at races-insertets .select() ikke tog race_class
// med, saa skrive-stien faldt tavst tilbage til terraen-baandet. Unit-testen testede
// generatoren; ingen testede at materializeren faktisk sender feltet videre. Denne fil
// lukker det hul ved at assertere paa DET DER STAAR I DATABASEN.
//
// Exit 0 = alt holder. Exit 1 = mindst een invariant brudt (og hvilken).
//
//   infisical run --env=prod -- node scripts/dev/verifySeason3Calendar.mjs
//
// Refs #4103 #4104 #4123

import { createClient } from "@supabase/supabase-js";
import { fetchAllRowsChunkedIn } from "../../lib/supabasePagination.js";

const SEASON_ID = "00000000-0000-0000-0000-000000000003";
const MAX_GT_PR_DAG = 4;
const MAX_GT_SPAND_DAGE = 6;
const MIN_MONUMENT_KM = 250;
const GT_MIN_STAGES = 15;

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE-secrets (koer via: infisical run --env=prod -- ...)");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const fejl = [];
const ok = (t) => console.log(`  ok      ${t}`);
const brud = (t) => { console.log(`  BRUDT   ${t}`); fejl.push(t); };

console.log("=== Efterverifikation af S3-kalenderen ===\n");

// ── 1. Grundtal ──────────────────────────────────────────────────────────────
const { data: races, error: rErr } = await supabase
  .from("races").select("id, name, race_class, race_type, stages, league_division_id").eq("season_id", SEASON_ID);
if (rErr) throw new Error(`races: ${rErr.message}`);
const { data: divs, error: dErr } = await supabase.from("league_divisions").select("id, tier, pool_index");
if (dErr) throw new Error(`league_divisions: ${dErr.message}`);
const tierOf = new Map(divs.map((d) => [d.id, d.tier]));

console.log(`Loeb i alt: ${races.length}`);
races.length === 471 ? ok("471 loeb") : brud(`forventede 471 loeb, fandt ${races.length}`);

// ── 2. Monument-laengder (#4104) ─────────────────────────────────────────────
console.log("\n── Monument-laengder ──");
const monIds = races.filter((r) => r.race_class === "Monuments").map((r) => r.id);
const navnAf = new Map(races.map((r) => [r.id, r.name]));
// #4127: race_stage_profiles er deny-listet i pagination-guarden, fordi PostgREST
// tavst skaerer et svar ned til 1000 raekker. Monument-listen er kort i dag, men et
// verifikations-script der tavst kun tjekker de foerste 1000 raekker er vaerre end
// ingen verifikation — saa bindingen til "under 1000" maa ikke vaere tilfaeldig.
// fetchAllRowsChunkedIn pagineret + chunker ogsaa .in()-listen (#3030-gatewayen).
const monProfiler = await fetchAllRowsChunkedIn(monIds, (chunk) =>
  supabase.from("race_stage_profiles").select("race_id, distance_km").in("race_id", chunk).order("race_id"));
for (const p of monProfiler.sort((a, b) => b.distance_km - a.distance_km)) {
  const navn = navnAf.get(p.race_id);
  p.distance_km >= MIN_MONUMENT_KM
    ? ok(`${navn}: ${p.distance_km} km`)
    : brud(`${navn}: ${p.distance_km} km (kraever mindst ${MIN_MONUMENT_KM})`);
}

// ── 3. GT-dagsform (#4103) ───────────────────────────────────────────────────
console.log("\n── Grand Tour-dagsform (Division 1) ──");
const d1 = races.filter((r) => tierOf.get(r.league_division_id) === 1);
// #4127: samme aarsag som monument-opslaget ovenfor. D1 har 140 schedule-raekker i
// dag (maalt 23/8), men GT-etaper skaleres med divisionens stoerrelse, saa loftet er
// ikke langt vaek. fetchAllRowsChunkedIn kaster ved DB-fejl, saa den tidligere
// manuelle error-check er overfloedig.
const sched = await fetchAllRowsChunkedIn(d1.map((r) => r.id), (chunk) =>
  supabase.from("race_stage_schedule").select("race_id, scheduled_at").in("race_id", chunk).order("race_id"));

const gtIds = new Set(d1.filter((r) => r.race_type === "stage_race" && r.stages >= GT_MIN_STAGES).map((r) => r.id));
const perDag = new Map();
const gtDage = new Map();
for (const s of sched) {
  const dag = String(s.scheduled_at).slice(0, 10);
  if (!perDag.has(dag)) perDag.set(dag, new Set());
  if (!gtIds.has(s.race_id)) continue;
  perDag.get(dag).add(s.race_id);
  if (!gtDage.has(s.race_id)) gtDage.set(s.race_id, new Set());
  gtDage.get(s.race_id).add(dag);
}
const gtPerDag = new Map();
for (const s of sched) {
  if (!gtIds.has(s.race_id)) continue;
  const dag = String(s.scheduled_at).slice(0, 10);
  gtPerDag.set(dag, (gtPerDag.get(dag) ?? 0) + 1);
}
const over = [...gtPerDag.entries()].filter(([, n]) => n > MAX_GT_PR_DAG);
over.length === 0
  ? ok(`ingen dag over ${MAX_GT_PR_DAG} GT-etaper (maks maalt: ${Math.max(0, ...gtPerDag.values())})`)
  : brud(`dage over loftet: ${over.map(([d, n]) => `${d}=${n}`).join(", ")}`);

for (const [id, dage] of gtDage) {
  dage.size <= MAX_GT_SPAND_DAGE
    ? ok(`${navnAf.get(id)}: ${dage.size} dage`)
    : brud(`${navnAf.get(id)}: ${dage.size} dage (loft ${MAX_GT_SPAND_DAGE})`);
}

const delte = [...perDag.entries()].filter(([, s]) => s.size > 1);
delte.length === 0
  ? ok("ingen kalenderdag deles af to Grand Tours")
  : brud(`delte GT-dage: ${delte.map(([d]) => d).join(", ")}`);

// ── 4. Kalender-grundform ────────────────────────────────────────────────────
console.log("\n── Kalender-grundform ──");
const alleDage = new Set(sched.map((s) => String(s.scheduled_at).slice(0, 10)));
alleDage.size === 28 ? ok("28 loebsdage i Division 1") : brud(`forventede 28 dage, fandt ${alleDage.size}`);
const foerste = [...alleDage].sort()[0];
foerste === "2026-08-25" ? ok("foerste loebsdag 2026-08-25") : brud(`foerste loebsdag er ${foerste}, forventede 2026-08-25`);

// ── Dom ──────────────────────────────────────────────────────────────────────
console.log("\n" + "=".repeat(60));
if (fejl.length) {
  console.error(`NO-GO — ${fejl.length} invariant(er) brudt:`);
  for (const f of fejl) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("GO — alle invarianter holder.");
