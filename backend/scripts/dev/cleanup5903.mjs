// #5903 · Engangs-oprydning: entries der står i en ANDEN trups kommende løb.
//
// Runtime-fixet (samme PR) rydder fremover rytterens entries i den gamle trups
// ikke-startede løb, når han skifter trup: moveRider() (#5843) og nu også
// graduerings-stierne (resolveGraduation promote, completeStuckPromotion). Dette
// script finder de rækker der ALLEREDE står forkert, fra før fixet.
//
// Hvorfor de skal væk: løbsmotoren sorterer dem fra ved start
// (riderEligibility.filterEligibleEntries), men indtil da binder de rytterens
// løbsdag på tværs af trupper (CYCLINGZONE-71, 28/9) og ligner en udtagelse på
// den gamle trups løbsside. Når de er slettet, fylder start-redningen
// (raceRunner.fillMissingTeamEntries) holdet op til gulvet fra truppens egne
// ryttere, så ingen hold stiller med for få.
//
// Regel = runtime-reglen, ingen kopi: løbets trup (raceSquadOf) og
// isEligibleRider fra riderEligibility.js. Kun ikke-startede løb i den aktive
// sæson (status 'scheduled', 0 kørte etaper), kun ryttere der stadig er på
// entry'ens hold og ikke pensioneret. Ghosts (solgt/fyret) er en anden sag og
// røres ikke; de tælles bare.
//
// Dry-run er default og skriver intet. --apply kræver eksplicit ejer-go.
//
// Brug (fra backend/):
//   infisical run --env=prod --silent -- node scripts/dev/cleanup5903.mjs
//       (dry-run, default)
//   ... node scripts/dev/cleanup5903.mjs --apply --owner-go=5903-production
//       (sletter; kun med ejer-go for netop denne kørsel)
//
// Output indeholder id'er og skal ikke ind i repoet eller på GitHub.

import { fileURLToPath } from "node:url";
import { fetchAllRows, fetchAllRowsChunkedIn } from "../../lib/supabasePagination.js";
import { ANY_SQUAD, isEligibleRider, raceSquadOf } from "../../lib/riderEligibility.js";
import { MIN_RACE_ENTRIES } from "../../lib/raceAutopick.js";

export const OWNER_GO_TOKEN = "5903-production";

/** Samme "ikke startet" som squadEntryCleanup.offSquadOpenRaceIds. */
export function isOpenRace(race) {
  return race?.status === "scheduled" && (race.stages_completed ?? 0) === 0;
}

/**
 * Ren kerne: hvilke entries står i en anden trups løb end rytterens?
 *
 * @param {{races: object[], entries: object[], riders: object[]}} args
 * @returns {{offSquad: Array<{race_id:string, team_id:string, rider_id:string,
 *   rider_squad:string, race_squad:string}>, ghosts:number,
 *   units: Array<{race_id:string, team_id:string, removed:number, remaining:number,
 *   belowFloor:boolean}>}}
 */
export function findOffSquadEntries({ races = [], entries = [], riders = [] }) {
  const raceById = new Map(races.filter(isOpenRace).map((r) => [r.id, r]));
  const riderById = new Map(riders.map((r) => [r.id, r]));
  const offSquad = [];
  let ghosts = 0;
  // (løb, hold) → { tilbage, fjernet }: til "hvem reddes ved start".
  const unitCounts = new Map();
  const unit = (raceId, teamId) => {
    const key = `${raceId}|${teamId}`;
    if (!unitCounts.has(key)) unitCounts.set(key, { race_id: raceId, team_id: teamId, removed: 0, remaining: 0 });
    return unitCounts.get(key);
  };

  for (const e of entries) {
    const race = raceById.get(e.race_id);
    if (!race) continue;
    const rider = riderById.get(e.rider_id);
    const raceSquad = raceSquadOf(race);
    // Ghost: ikke længere på holdet eller pensioneret. Ikke denne sags regel.
    if (!isEligibleRider(rider, { teamId: e.team_id, squad: ANY_SQUAD })) {
      ghosts += 1;
      continue;
    }
    if (isEligibleRider(rider, { teamId: e.team_id, squad: raceSquad })) {
      unit(e.race_id, e.team_id).remaining += 1;
      continue;
    }
    unit(e.race_id, e.team_id).removed += 1;
    offSquad.push({
      race_id: e.race_id, team_id: e.team_id, rider_id: e.rider_id,
      rider_squad: rider.squad ?? "senior", race_squad: raceSquad,
    });
  }

  const units = [...unitCounts.values()]
    .filter((u) => u.removed > 0)
    .map((u) => ({ ...u, belowFloor: u.remaining < MIN_RACE_ENTRIES }));
  return { offSquad, ghosts, units };
}

export async function fetchSnapshot(supabase) {
  const { data: season, error } = await supabase
    .from("seasons").select("id, number").eq("status", "active")
    .order("number", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`seasons: ${error.message}`);
  if (!season) return { season: null, races: [], entries: [], riders: [] };

  const races = await fetchAllRows(() => supabase.from("races")
    .select("id, squad, status, stages_completed")
    .eq("season_id", season.id).eq("status", "scheduled")
    .order("id"));
  const openIds = races.filter(isOpenRace).map((r) => r.id);
  const entries = await fetchAllRowsChunkedIn(openIds, (ids) => supabase.from("race_entries")
    .select("race_id, team_id, rider_id")
    .in("race_id", ids)
    .order("race_id").order("rider_id"));
  const riderIds = [...new Set(entries.map((e) => e.rider_id))];
  const riders = await fetchAllRowsChunkedIn(riderIds, (ids) => supabase.from("riders")
    .select("id, team_id, squad, is_academy, is_retired")
    .in("id", ids)
    .order("id"));
  return { season, races, entries, riders };
}

/**
 * Genlæs ÉN rytters tilstand lige før sletningen og beregn hans forkerte
 * entries igen. Snapshottet kan være minutter gammelt: er rytteren imens
 * flyttet til løbets trup, eller er løbet startet, må rækken ikke slettes.
 * Vinduet mellem genlæsning og delete er millisekunder; en fuldt atomisk
 * variant ville kræve en RPC, hvilket er for meget til en ejer-gated engangs-
 * kørsel. Motoren filtrerer alligevel forkert-trup-entries fra ved start.
 */
export async function recheckRider(supabase, { riderId, raceIds }) {
  const { data: rider, error: riderErr } = await supabase.from("riders")
    .select("id, team_id, squad, is_academy, is_retired").eq("id", riderId).maybeSingle();
  if (riderErr) throw new Error(`riders (recheck): ${riderErr.message}`);
  const { data: races, error: raceErr } = await supabase.from("races")
    .select("id, squad, status, stages_completed").in("id", raceIds);
  if (raceErr) throw new Error(`races (recheck): ${raceErr.message}`);
  // pagination-safe: én rytter har højst én tilmelding pr. løb, og raceIds er rytterens få fundne løb
  const { data: entries, error: entryErr } = await supabase.from("race_entries")
    .select("race_id, team_id, rider_id").eq("rider_id", riderId).in("race_id", raceIds);
  if (entryErr) throw new Error(`race_entries (recheck): ${entryErr.message}`);
  const { offSquad } = findOffSquadEntries({ races: races || [], entries: entries || [], riders: rider ? [rider] : [] });
  return [...new Set(offSquad.map((r) => r.race_id))];
}

/**
 * Slet de fundne rækker, grupperet pr. rytter, efter en frisk genberegning
 * (recheckRider). Idempotent: en række der allerede er væk, rammer 0 rækker.
 */
export async function deleteOffSquadEntries(supabase, offSquad, { recheck = recheckRider } = {}) {
  const byRider = new Map();
  for (const row of offSquad) {
    if (!byRider.has(row.rider_id)) byRider.set(row.rider_id, new Set());
    byRider.get(row.rider_id).add(row.race_id);
  }
  let deleted = 0;
  let skipped = 0;
  const failures = [];
  for (const [riderId, raceIdSet] of byRider) {
    const planned = [...raceIdSet];
    let ids;
    try {
      ids = await recheck(supabase, { riderId, raceIds: planned });
    } catch (err) {
      failures.push({ riderId, error: err instanceof Error ? err.message : String(err) });
      continue;
    }
    skipped += planned.length - ids.length;
    if (!ids.length) continue;
    const { error } = await supabase.from("race_entries").delete()
      .eq("rider_id", riderId).in("race_id", ids);
    if (error) failures.push({ riderId, error: error.message });
    else deleted += ids.length;
  }
  return { deleted, skipped, failures };
}

export function parseArgs(argv) {
  const apply = argv.includes("--apply");
  const goArg = argv.find((a) => a.startsWith("--owner-go="));
  const ownerGo = goArg ? goArg.slice("--owner-go=".length) : null;
  if (apply && ownerGo !== OWNER_GO_TOKEN) {
    return { error: `--apply kræver --owner-go=${OWNER_GO_TOKEN} (eksplicit ejer-go for netop denne kørsel).` };
  }
  return { apply };
}

function isMain() {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(args.error);
    process.exit(1);
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("Mangler SUPABASE_URL eller SUPABASE_SERVICE_KEY.");
    process.exit(1);
  }
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, key);

  const snap = await fetchSnapshot(supabase);
  if (!snap.season) {
    console.log("Ingen aktiv sæson. Intet at gøre.");
    return;
  }
  const { offSquad, ghosts, units } = findOffSquadEntries(snap);
  const byPair = new Map();
  for (const r of offSquad) {
    const k = `${r.rider_squad} -> ${r.race_squad}-løb`;
    byPair.set(k, (byPair.get(k) || 0) + 1);
  }
  console.log(`Aktiv sæson ${snap.season.number}: ${snap.races.length} ikke-startede løb, ${snap.entries.length} entries`);
  console.log(`Forkert trup: ${offSquad.length} rækker, ${new Set(offSquad.map((r) => r.team_id)).size} hold, ${units.length} (løb, hold)-enheder`);
  for (const [k, n] of byPair) console.log(`  ${k}: ${n}`);
  console.log(`Enheder under gulvet (${MIN_RACE_ENTRIES}) efter sletning, reddes ved start: ${units.filter((u) => u.belowFloor).length}`);
  console.log(`Ghosts (ikke på holdet/pensioneret, røres ikke): ${ghosts}`);
  console.log("");
  for (const r of offSquad) {
    console.log(`${args.apply ? "DELETE " : "DRY-RUN"} race=${r.race_id} team=${r.team_id} rider=${r.rider_id} (${r.rider_squad} i ${r.race_squad}-løb)`);
  }

  if (!args.apply) {
    console.log("\nDry-run: intet skrevet. Kør med --apply --owner-go=" + OWNER_GO_TOKEN + " efter ejer-go.");
    return;
  }
  const res = await deleteOffSquadEntries(supabase, offSquad);
  console.log(`\nSlettet: ${res.deleted}. Sprunget over (ændret siden snapshot): ${res.skipped}. Fejl: ${res.failures.length}`);
  for (const f of res.failures) console.error(`  FAIL rider=${f.riderId}: ${f.error}`);
  if (res.failures.length) process.exit(1);
}

if (isMain()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
