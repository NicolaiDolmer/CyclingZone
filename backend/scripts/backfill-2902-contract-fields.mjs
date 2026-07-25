#!/usr/bin/env node
// #2894/#2902 — engangs-backfill af salary/contract_length/contract_end_season på de
// 1.326 ryttere (138 menneske-hold, verificeret 25/7, 100% co-occurrence med
// starter_squad_allocated_at != null) der blev tildelt af starterSquadAllocator FØR
// #2894/#2902-fixet landede. Allokeringen skrev historisk KUN team_id — kontrakt-
// felterne forblev NULL for evigt (~1 nyt hold/dag lagde til gabet). Salary for de
// EKSISTERENDE rækker blev allerede backfillet separat af #2746; dette script lukker
// det RESTERENDE hul (contract_length + contract_end_season), og gen-beregner salary
// med samme formel for konsistens (se computeFrozenSalary — idempotent hvis
// current_production_value ikke har ændret sig siden #2746's kørsel).
//
// Genbruger SAMME formel/PRNG-konventioner som contractSeed.js' "andre ejede hold:
// blandet 1-3"-gren (runContractSeed's non-founder-sti, samme sti som fixet i
// starterSquadAllocator.js bruger fremadrettet): pickContractLength (seeded rng,
// ~1/3 hver af 1,2,3) + computeFrozenSalary (current_production_value × per-division-
// sats) + computeContractEndSeason (startSeason + length - 1). Duplikerer ALDRIG
// formlen — importerer de eksporterede pure helpers direkte.
//
// IDEMPOTENS (kan køres flere gange / genkøres trygt):
//   1) SELECTen er selv filtreret til contract_end_season IS NULL — en allerede
//      healet rytter kommer aldrig med i patch-listen.
//   2) Hver UPDATE bærer DESUDEN et .is("contract_end_season", null)-guard — hvis en
//      anden proces (fx et erhvervelses-kald via #2902's nu-healende
//      contractOnAcquirePatch, eller en anden kørsel af dette script) satte feltet
//      MELLEM select og update, bliver 0 rækker ramt af den specifikke update i
//      stedet for at overskrive et allerede-sat kontrakt-par.
//
// Aktiv sæson læses LIVE (seasons.status='active') — HARDCOD ALDRIG et sæson-number
// her: scriptet kan køre FØR eller EFTER S1→S2-cutover-vinduet.
//
// Default = dry-run (ingen writes). Tilføj --execute for rigtig kørsel.
//   railway run --service CyclingZone -- node scripts/backfill-2902-contract-fields.mjs [--execute] [--seed=2902]
//
// IKKE kørt af Claude under denne PR (#2642-mandat: migrationer/backfills applies af
// Claude EFTER merge, aldrig under implementeringen af PR'en selv) — orkestratoren
// kører den efter søndagens S1→S2-cutover, med ejer-synlig dry-run-output først.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { computeFrozenSalary, pickContractLength, computeContractEndSeason } from "../lib/contractSeed.js";
import { makeRng } from "../lib/fictionalRiderGenerator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  if (process.argv.includes(`--${n}`)) return true;
  return d;
};

const EXECUTE = !!arg("execute", false);
const SEED = Number(arg("seed", 2902)); // #2902 — fast default, reproducerbar på tværs af kørsler

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_KEY mangler. Kør via `railway run`.");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const fmt = (n) => (n == null ? "—" : Math.round(n).toLocaleString("da-DK"));
const WRITE_CONCURRENCY = 25;

async function main() {
  console.log(`\n${"═".repeat(72)}`);
  console.log(`#2894/#2902 KONTRAKT-BACKFILL ${EXECUTE ? "🔴 EXECUTE (skriver til prod)" : "🟢 DRY-RUN (read-only)"}`);
  console.log(`${"═".repeat(72)}`);

  // Aktiv sæson LIVE — anker for contract_end_season. Aldrig hardcodet (scriptet kan
  // køre både før og efter S1→S2-cutover-vinduet).
  const { data: season, error: seasonError } = await supabase
    .from("seasons").select("number").eq("status", "active").maybeSingle();
  if (seasonError) throw new Error(`aktiv sæson-opslag: ${seasonError.message}`);
  const startSeason = season?.number ?? 1;
  console.log(`Aktiv sæson: #${startSeason}`);

  // Idempotens-SELECT: kun ejede ryttere der reelt mangler contract_end_season.
  // Filteret er BEVIDST bredere end "starter_squad_allocated_at IS NOT NULL" (selvom
  // 25/7-auditen viste 100% co-occurrence for de kendte 1.326) — det healer også
  // enhver ANDEN fremtidig kilde til samme NULL-mønster, ikke kun starter-squad-stien.
  const owned = await fetchAllRows(() =>
    supabase.from("riders")
      .select("id, team_id, current_production_value")
      .not("team_id", "is", null)
      .is("contract_end_season", null)
      .order("id"));
  console.log(`Ejede ryttere med contract_end_season IS NULL: ${owned.length}`);

  if (owned.length === 0) {
    console.log("\nIngen ryttere at heale — allerede idempotent no-op.");
    return;
  }

  const teamIds = [...new Set(owned.map((r) => r.team_id))];
  const teams = await fetchAllRows(() =>
    supabase.from("teams").select("id, division").in("id", teamIds).order("id"));
  const divisionByTeam = new Map(teams.map((t) => [t.id, t.division]));

  const rng = makeRng(SEED);
  const patches = owned.map((r) => {
    const length = pickContractLength(rng);
    return {
      id: r.id,
      patch: {
        salary: computeFrozenSalary({ current_production_value: r.current_production_value, division: divisionByTeam.get(r.team_id) }),
        contract_length: length,
        contract_end_season: computeContractEndSeason(startSeason, length),
      },
    };
  });

  const lengthDist = { 1: 0, 2: 0, 3: 0 };
  let salarySum = 0;
  for (const { patch } of patches) {
    lengthDist[patch.contract_length] = (lengthDist[patch.contract_length] || 0) + 1;
    salarySum += patch.salary;
  }
  console.log(`\nHold berørt: ${teamIds.length}`);
  console.log(`Kontrakt-længde-fordeling: 1=${lengthDist[1]}  2=${lengthDist[2]}  3=${lengthDist[3]}`);
  console.log(`Samlet ny lønbyrde (sum af salary): ${fmt(salarySum)} CZ$`);
  console.log(`\nStikprøve (10 første):`);
  for (const { id, patch } of patches.slice(0, 10)) {
    console.log(`  ${id}  salary=${fmt(patch.salary).padStart(9)}  length=${patch.contract_length}  end=${patch.contract_end_season}`);
  }

  if (!EXECUTE) {
    console.log(`\n(DRY-RUN) Skriver intet. Tilføj --execute for at skrive ${patches.length} kontrakter.`);
    console.log(`${"═".repeat(72)}\n`);
    return;
  }

  let written = 0;
  let skippedRace = 0;
  for (let i = 0; i < patches.length; i += WRITE_CONCURRENCY) {
    const batch = patches.slice(i, i + WRITE_CONCURRENCY);
    await Promise.all(batch.map(({ id, patch }) =>
      supabase.from("riders").update(patch).eq("id", id).is("contract_end_season", null)
        .select("id")
        .then(({ data, error }) => {
          if (error) throw new Error(`update ${id} fejlede: ${error.message}`);
          if (data && data.length > 0) written++;
          else skippedRace++; // guard blokerede: en anden proces satte feltet siden SELECT
        })));
  }
  console.log(`\n✅ Skrev ${written} kontrakter${skippedRace ? ` (${skippedRace} sprunget over af idempotens-guarden — allerede sat af en anden proces siden SELECT)` : ""}.`);
  console.log(`${"═".repeat(72)}\n`);
}

main().catch((err) => {
  console.error("❌", err.message);
  process.exit(1);
});
