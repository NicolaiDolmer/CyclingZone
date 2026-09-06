// CYCLINGZONE-51 · READ-ONLY diagnose af ryttere modellen ikke kan værdisætte.
//
// HVORFOR DEN IKKE HAR ET --apply-FLAG: der findes ikke ét rigtigt svar på hvad
// en uvurderbar rytter SKAL have. De tre mulige udfald — giv ham en gulv-værdi,
// pensionér ham, eller lad ham stå — er alle spil-beslutninger med konsekvenser
// for et menneskehold (rytteren i prod 6/9 sidder på en spillers trup). Scriptet
// leverer derfor beslutningsgrundlaget og skriver ALDRIG. En eventuel reparation
// får sit eget script med ejer-GO, når ejeren har valgt udfaldet.
//
// HVAD DEN VISER, og hvorfor netop det:
//   • Aktive (ikke-pensionerede) ryttere med base_value IS NULL — sweep'ens egen
//     strandings-definition (riderDeriveHealSweep.js::findStrandedRiderIds).
//   • Om rytteren har en rider_derived_abilities-række. HAR han én, er derive'en
//     lykkedes og det er VÆRDISÆTNINGEN der fejler; mangler den, er det et ægte
//     partielt derive (den klasse deriveForRiderIds stadig kaster på).
//   • Sæson-alderen mod den AKTIVE sæson. predictBaseValueV4 (riderCareerNpv.js::
//     simulateCareer) afbryder karriere-løkken med det samme når `age_s > 40`, så
//     NPV'en bliver 0 og base_value null. Alderen er derfor selve forklaringen,
//     ikke en tilfældig kolonne.
//   • Hvem der ejer rytteren (hold/AI-hold/fri agent) — afgør om et udfald rammer
//     en spiller.
//
// Brug (læser prod via service-nøglen i backend/.env — ingen skrivning):
//   node backend/scripts/unvaluableRidersDryRun.js

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { fetchAllRows } from "../lib/supabasePagination.js";
import { ageForSeason } from "../lib/riderSeasonAge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** NPV-motorens hårde alders-horisont (riderCareerNpv.js::simulateCareer). */
export const NPV_MAX_AGE = 40;

/**
 * REN klassifikation af én strandet rytter. Holdt ren så rapporten kan testes
 * uden DB — og så "hvorfor" står ét sted i stedet for spredt i print-loopet.
 *
 * @param {{id:string, birthdate?:string|null}} rider
 * @param {boolean} hasAbilities
 * @param {number|null} seasonNumber
 * @returns {{riderId:string, seasonAge:number|null, hasAbilities:boolean, reason:string}}
 */
export function classifyUnvaluableRider(rider, hasAbilities, seasonNumber) {
  const seasonAge = Number.isFinite(Number(seasonNumber))
    ? ageForSeason(rider?.birthdate, Number(seasonNumber))
    : null;
  let reason;
  if (!hasAbilities) {
    reason = "partial_derive_missing_abilities";
  } else if (Number.isFinite(seasonAge) && seasonAge > NPV_MAX_AGE) {
    reason = "age_over_npv_horizon";
  } else {
    reason = "model_returned_null";
  }
  return { riderId: rider.id, seasonAge, hasAbilities, reason };
}

/**
 * I/O: læs tilstanden. Ingen writes, ingen mutation — kun selects.
 *
 * @param {{supabase: object}} args
 */
export async function collectUnvaluableRiders({ supabase } = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  const { data: season } = await supabase
    .from("seasons").select("number").eq("status", "active").maybeSingle();
  const seasonNumber = season?.number ?? null;

  const riders = await fetchAllRows(() =>
    supabase
      .from("riders")
      .select("id, firstname, lastname, birthdate, team_id, ai_team_id, is_academy, market_value, salary, contract_end_season")
      .eq("is_retired", false)
      .is("base_value", null)
      .order("id"));

  if (riders.length === 0) return { seasonNumber, rows: [] };

  const derived = await fetchAllRows(() =>
    supabase
      .from("rider_derived_abilities")
      .select("rider_id")
      .in("rider_id", riders.map((r) => r.id))
      .order("rider_id"));
  const haveAbilities = new Set(derived.map((d) => d.rider_id));

  const rows = riders.map((r) => ({
    ...classifyUnvaluableRider(r, haveAbilities.has(r.id), seasonNumber),
    name: `${r.firstname ?? "?"} ${r.lastname ?? "?"}`.trim(),
    birthdate: r.birthdate ?? null,
    owner: r.team_id ? `team:${r.team_id}` : r.ai_team_id ? `ai_team:${r.ai_team_id}` : "free_agent",
    marketValue: r.market_value ?? null,
    salary: r.salary ?? null,
    contractEndSeason: r.contract_end_season ?? null,
  }));

  return { seasonNumber, rows };
}

function isMain() {
  if (!import.meta || !import.meta.url) return false;
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
}

async function main() {
  config({ path: path.join(__dirname, "..", ".env") });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const { seasonNumber, rows } = await collectUnvaluableRiders({ supabase });

  console.log(`DRY-RUN (read-only) · aktiv sæson: ${seasonNumber ?? "ukendt"} · NPV-horisont: alder <= ${NPV_MAX_AGE}`);
  console.log(`Aktive ryttere uden base_value: ${rows.length}`);
  console.log("");
  for (const r of rows) {
    console.log(
      `${r.riderId}  ${r.name} · født ${r.birthdate ?? "?"} · sæson-alder ${r.seasonAge ?? "?"} · ` +
      `abilities: ${r.hasAbilities ? "ja" : "NEJ"} · ejer: ${r.owner} · ` +
      `market_value ${r.marketValue ?? "null"} · salary ${r.salary ?? "null"} · årsag: ${r.reason}`
    );
  }
  console.log("");
  const byReason = {};
  for (const r of rows) byReason[r.reason] = (byReason[r.reason] || 0) + 1;
  console.log(JSON.stringify({ total: rows.length, byReason }, null, 2));
  console.log("");
  console.log("INGEN skrivning udført. Udfaldet (gulv-værdi / pensionering / lad stå) er en ejer-beslutning.");
}

if (isMain()) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
