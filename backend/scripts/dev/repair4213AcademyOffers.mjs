// #4213 — reparation af de akademitilbud som #4172's free-agent-fill brød.
//
// BAGGRUND
//   24/8 12:15-12:18 UTC fordelte #4172's free-agent-fill 2.532 frie ryttere paa
//   127 nye AI-hold. 1.543 af dem havde en levende academy_intake-raekke, fordi
//   akademikandidater FOEDES som frie agenter (academyGenerator.js:152 saetter
//   team_id null OG is_academy false) og samtidig er de billigste ryttere i
//   spillet. Resultatet: levende akademitilbud til menneskehold paa ryttere der
//   nu ejes af et AI-hold.
//
// EJER-BESLUTNING 29/8
//   Frigiv rytterne i stedet for at trakke tilbuddene tilbage. Det er den
//   loesning der paavirker spillerne mindst: manageren beholder sit tilbud i
//   stedet for at se kortet forsvinde uden forklaring. AI-holdene fyldes op igen,
//   saa de ikke mister trupdybde.
//
//   Alternativet — spillets INDBYGGEDE oprydning — goer det modsatte:
//   academyIntakeExpirySweep afstemmer forældede raekker til 'rejected' (lag 1,
//   postmortem 2026-07-18). Den koerer lige nu og tager et par stykker om dagen.
//   Dette script er altsaa et bevidst valg FRA den default.
//
// ⚠️ URET SKAL NULSTILLES (trin 3)
//   Alle tilbuddene er fra 22/8, og INTAKE_OFFER_EXPIRY_DAYS = 7. De er dermed
//   forbi udloebs-graensen. I dag beskyttes de mod udloeb af lag 1's
//   ejerskabs-tjek (rytteren er ejet → afstemmes i stedet for at udloebe). I det
//   OEJEBLIK trin 2 frigiver rytteren, falder den beskyttelse vaek: raekken er
//   'offered', rytteren er team-loes, og created_at er 7 dage gammel — altsaa
//   praecis udvaelgelses-kriteriet i runIntakeOfferExpirySweep. Uden trin 3 ville
//   sweepen udloebe dem og saette dem paa ungdomsauktion inden for et doegn, og
//   frigivelsen ville give det MODSATTE af hensigten.
//
// ⚠️ RAEKKEFOELGE: database/2026-08-29-4213-academy-offer-ownership-guard.sql SKAL
//   vaere applied FOERST. Ellers kan squadEnforcement's auto-koeb (minimum-6 gik
//   live 28/8) tage de nyligt frigivne ryttere igen — de er de billigste frie
//   agenter i spillet, altsaa foerst i koebslisten.
//
// Dry-run (default): rapportér alt, skriv intet.
//   infisical run --env=prod -- node backend/scripts/dev/repair4213AcademyOffers.mjs
// Live (ejer-go):
//   infisical run --env=prod -- node backend/scripts/dev/repair4213AcademyOffers.mjs --live

import { createClient } from "@supabase/supabase-js";
import { STARTER_TAIL_STAT_WINDOW, buildWeakStarterPool, deriveTeamSeed } from "../../lib/starterSquadAllocator.js";
import { deriveForRiderIds } from "../../lib/backfillCores.js";
import { fetchAllRows } from "../../lib/supabasePagination.js";
import { foldNameNordic } from "../../lib/pcmRiderMatcher.js";
import { LAUNCH_POPULATION } from "../../lib/fictionalLaunchPopulation.js";
import { seasonReferenceYear } from "../../lib/riderSeasonAge.js";
import { clearFutureRaceEntriesSafe } from "../../lib/raceEntryCleanup.js";

const LIVE = process.argv.includes("--live");
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE secrets (infisical run --env=prod)");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const INSERT_BATCH = 500;
const tag = LIVE ? "LIVE" : "DRY-RUN";

// ── Trin 0: find bruddene (samme definition som findStaleOfferedIntake) ───────
console.log(`${tag} — #4213 reparation af akademitilbud\n`);

const offered = await fetchAllRows(() =>
  sb.from("academy_intake").select("id, team_id, rider_id, created_at")
    .eq("status", "offered").order("id"));

const riderIds = [...new Set(offered.map((r) => r.rider_id))];
const riderRows = [];
for (let i = 0; i < riderIds.length; i += 100) {
  const { data, error } = await sb.from("riders")
    .select("id, team_id, pending_team_id, is_retired").in("id", riderIds.slice(i, i + 100));
  if (error) { console.error("riders:", error.message); process.exit(1); }
  riderRows.push(...(data || []));
}
const riderById = new Map(riderRows.map((r) => [r.id, r]));

const broken = [];
for (const row of offered) {
  const rider = riderById.get(row.rider_id);
  if (!rider?.team_id) continue;                 // fri rytter = lovligt aabent tilbud
  if (rider.team_id === row.team_id) continue;   // ejet af det tilbydende hold selv
  broken.push({ intakeId: row.id, riderId: row.rider_id, offeredTo: row.team_id, ownedBy: rider.team_id, pending: rider.pending_team_id });
}

console.log(`'offered'-raekker i alt:            ${offered.length}`);
console.log(`Heraf brudte (rytter ejet af andet hold): ${broken.length}`);

if (broken.length === 0) {
  console.log("\nIntet at reparere. Idempotent no-op.");
  process.exit(0);
}

// Parkerede skift (#1995) roeres ikke — de haandteres af flushDeferredTransfers.
const parked = broken.filter((b) => b.pending);
if (parked.length) {
  console.log(`⚠️  ${parked.length} har et parkeret holdskifte (pending_team_id) og springes over.`);
}
const work = broken.filter((b) => !b.pending);

// Nuvaerende trupstoerrelse for ALLE hold der ejer en brudt rytter
// (ikke-akademi, ikke-pensioneret). lossByTeam beregnes foerst EFTER
// udskydelses-opdelingen nedenfor, saa den kun taeller dem vi faktisk frigiver.
const affectedTeamIds = [...new Set(work.map((b) => b.ownedBy))];
const squadNow = new Map(affectedTeamIds.map((id) => [id, 0]));
const squadRows = await fetchAllRows(() =>
  sb.from("riders").select("team_id, is_academy, is_retired").in("team_id", affectedTeamIds).order("id"));
for (const r of squadRows) {
  if (r.is_academy) continue;
  if (r.is_retired) continue;
  squadNow.set(r.team_id, (squadNow.get(r.team_id) || 0) + 1);
}

// Fremtidige startlister der skal genopbygges.
//
// race_entries har INGEN id-kolonne (noeglen er race_id + rider_id). Vi bruger
// derfor samme udvaelgelse som clearFutureRaceEntries (raceEntryCleanup.js):
// races.status = 'scheduled' OG races.stages_completed = 0. Den anden betingelse
// er vigtig — et fleretape-loeb der ER gaaet i gang maa ikke faa strippet sine
// startlister midt i loebet, selvom loebs-raekken stadig staar 'scheduled'.
const allEntries = [];
const clearableEntries = [];
for (let i = 0; i < work.length; i += 100) {
  const chunk = work.slice(i, i + 100).map((b) => b.riderId);

  const { data: all, error: allErr } = await sb.from("race_entries")
    .select("race_id, rider_id").in("rider_id", chunk);
  if (allErr) { console.error("race_entries:", allErr.message); process.exit(1); }
  allEntries.push(...(all || []));

  const { data: clearable, error: clrErr } = await sb.from("race_entries")
    .select("race_id, rider_id, races!inner(status, stages_completed)")
    .in("rider_id", chunk)
    .eq("races.status", "scheduled")
    .eq("races.stages_completed", 0);
  if (clrErr) { console.error("race_entries (clearable):", clrErr.message); process.exit(1); }
  clearableEntries.push(...(clearable || []));
}
const nonScheduled = allEntries.length - clearableEntries.length;

// #1995-princippet: en rytter der ER i gang med et fleretape-loeb flyttes ikke
// midt i loebet. Frigav vi ham nu, ville hans entry blive et "ghost"
// (filterEligibleEntries kraydser entry'ens team_id mod rytterens NUVAERENDE
// hold), og AI-holdet ville koere en mand kort resten af loebet — i loeb hvor
// menneskehold konkurrerer imod. Vi udskyder dem i stedet til naeste koersel,
// naar deres loeb er afviklet. Tilbuddets ur nulstilles ogsaa for de udskudte,
// saa de ikke naar at udloebe imens.
const clearableKey = new Set(clearableEntries.map((e) => `${e.race_id}:${e.rider_id}`));
const lockedRiderIds = new Set(
  allEntries.filter((e) => !clearableKey.has(`${e.race_id}:${e.rider_id}`)).map((e) => e.rider_id));

const deferred = work.filter((b) => lockedRiderIds.has(b.riderId));
const releasable = work.filter((b) => !lockedRiderIds.has(b.riderId));
const scheduledEntries = clearableEntries.filter((e) => !lockedRiderIds.has(e.rider_id));

// Hvilke AI-hold mister hvad — kun de ryttere vi faktisk frigiver i denne koersel.
const lossByTeam = new Map();
for (const b of releasable) lossByTeam.set(b.ownedBy, (lossByTeam.get(b.ownedBy) || 0) + 1);

const afterSizes = affectedTeamIds.map((id) => (squadNow.get(id) || 0) - (lossByTeam.get(id) || 0));
const avg = (xs) => (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1);

console.log(`\n── Trin 2: frigiv ryttere ────────────────────────────────`);
console.log(`Brudte i alt:                      ${work.length}`);
console.log(`Ryttere der frigives NU:           ${releasable.length}`);
console.log(`UDSKUDT (i gang med etapeloeb):    ${deferred.length} — frigives naar loebet er afviklet`);
console.log(`AI-hold der mister nogen nu:       ${lossByTeam.size} (af ${affectedTeamIds.length} beroerte)`);
console.log(`Trupstoerrelse foer (gns/min):     ${avg([...squadNow.values()])} / ${Math.min(...squadNow.values())}`);
console.log(`Trupstoerrelse efter (gns/min):    ${avg(afterSizes)} / ${Math.min(...afterSizes)}`);
console.log(`Hold under 6 ryttere efter:        ${afterSizes.filter((n) => n < 6).length}`);

console.log(`\n── Trin 2b: startlister ──────────────────────────────────`);
console.log(`Entries der ryddes:                ${scheduledEntries.length} i ${new Set(scheduledEntries.map((e) => e.race_id)).size} loeb`);
console.log(`Entries der IKKE roeres:           ${nonScheduled} (igangvaerende etapeloeb — rytteren udskydes helt)`);

console.log(`\n── Trin 3: nulstil tilbuddenes ur ────────────────────────`);
const oldest = work.reduce((min, b) => {
  const row = offered.find((o) => o.id === b.intakeId);
  return !min || row.created_at < min ? row.created_at : min;
}, null);
console.log(`Intake-raekker der faar nyt ur:    ${work.length} (ogsaa de udskudte, saa de ikke udloeber imens)`);
console.log(`Aeldste tilbud i dag:              ${oldest}`);
console.log(`Nyt created_at:                    ${new Date().toISOString()} (7 friske dage)`);

console.log(`\n── Trin 4: fyld AI-holdene op ────────────────────────────`);
console.log(`Nye hale-ryttere der oprettes:     ${releasable.length} paa ${lossByTeam.size} hold`);
console.log(`Kvalitet:                          STARTER_TAIL_STAT_WINDOW (svage hale-domestiques)`);

if (!LIVE) {
  console.log(`\n(dry-run — intet skrevet. Koer med --live efter ejer-go.)`);
  process.exit(0);
}

// ── LIVE ─────────────────────────────────────────────────────────────────────
const nowIso = new Date().toISOString();

// Trin 2: ryd fremtidige entries FOERST, saa ingen startliste peger paa en
// rytter der lige er blevet team-loes.
// Noeglen er (race_id, rider_id) — ryd pr. rytter med den kanoniske helper, som
// selv genlaeser scheduled + stages_completed = 0 paa slettetidspunktet.
let clearedEntries = 0;
for (const b of releasable) {
  clearedEntries += await clearFutureRaceEntriesSafe({ supabase: sb, riderId: b.riderId, label: "#4213-frigivelse" });
}
console.log(`Ryddede ${clearedEntries} fremtidige race_entries.`);

// Trin 2: frigiv rytterne.
let freed = 0;
for (const b of releasable) {
  const { data, error } = await sb.from("riders")
    .update({ team_id: null, acquired_at: null })
    .eq("id", b.riderId)
    .eq("team_id", b.ownedBy)   // idempotent re-guard: kun hvis han stadig staar der
    .select("id");
  if (error) { console.error(`frigiv ${b.riderId}:`, error.message); process.exit(1); }
  freed += (data || []).length;
}
console.log(`Frigav ${freed} ryttere.`);

// Trin 3: nulstil uret paa tilbuddene.
let reset = 0;
for (const b of work) {
  const { data, error } = await sb.from("academy_intake")
    .update({ created_at: nowIso })
    .eq("id", b.intakeId)
    .eq("status", "offered")    // idempotent re-guard mod samtidig sign/reject
    .select("id");
  if (error) { console.error(`nulstil ur ${b.intakeId}:`, error.message); process.exit(1); }
  reset += (data || []).length;
}
console.log(`Nulstillede uret paa ${reset} tilbud.`);

// Trin 4: fyld AI-holdene op med samme antal hale-ryttere.
const { data: activeSeason, error: sErr } = await sb.from("seasons").select("number").eq("status", "active").maybeSingle();
if (sErr) { console.error("seasons:", sErr.message); process.exit(1); }
// Samme #4307-fund 28/8: generér mod den AKTIVE sæsons referenceaar, ellers kan
// base_value blive null og derive kaste.
const referenceYear = seasonReferenceYear(activeSeason?.number ?? 1) ?? LAUNCH_POPULATION.referenceYear;

const existing = await fetchAllRows(() => sb.from("riders").select("firstname, lastname").order("id"));
const existingFoldedNames = new Set(existing.map((r) => foldNameNordic(`${r.firstname} ${r.lastname}`)));

let added = 0;
for (const [teamId, need] of lossByTeam) {
  const tailSeed = deriveTeamSeed((LAUNCH_POPULATION.seed + 4213) >>> 0, teamId);
  const payload = buildWeakStarterPool({
    count: need, seed: tailSeed, referenceYear,
    existingFoldedNames, window: STARTER_TAIL_STAT_WINDOW,
  }).map((r) => ({ ...r, team_id: teamId }));

  const insertedIds = [];
  for (let i = 0; i < payload.length; i += INSERT_BATCH) {
    const batch = payload.slice(i, i + INSERT_BATCH);
    const { data, error } = await sb.from("riders").insert(batch).select("id");
    if (error) { console.error(`insert ${teamId}:`, error.message); process.exit(1); }
    insertedIds.push(...(data || []).map((r) => r.id));
  }
  await deriveForRiderIds(sb, insertedIds, { dryRun: false });
  added += insertedIds.length;
}
console.log(`Oprettede ${added} nye hale-ryttere paa ${lossByTeam.size} AI-hold.`);

console.log(`\nLIVE faerdig. raceEntryGeneratorSweep genopbygger startlisterne.`);
process.exit(0);
