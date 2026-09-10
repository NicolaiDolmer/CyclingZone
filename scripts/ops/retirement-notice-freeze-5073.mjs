// scripts/ops/retirement-notice-freeze-5073.mjs
//
// #5073 · Pensionsvarslet skiftede midt i saeson 3. Dette script MAALER skaden og
// kan (kun med eksplicit ejer-go) fryse varslet som en lagret kendsgerning, saa det
// ikke laengere kan flytte sig fordi en seed-funktion aendres.
//
// Rod-aarsag, evidens og den rene klassifikationslogik ligger i
// retirement-notice-freeze-5073.lib.mjs (importeret nedenfor). Denne fil er KUN
// I/O: hent prod, print rapporten, skriv kvitteringen, og - med dobbelt gate -
// skriv frysningen. Delingen er ikke kosmetisk: CI's `static-guards`-job koerer
// uden `npm ci`, saa testen maa ikke kunne naa @supabase/supabase-js via en
// importkaede. Alt testbart bor derfor i .lib.mjs.
//
// DETTE SCRIPT AENDRER INGEN PENSIONSLOGIK. Det laeser prod, sammenligner det
// LEGACY-svar (foer 7/9) med det NUVAERENDE svar, og kan skrive frysningen som
// en app_config-raekke som en senere kode-PR kan laese i stedet for at rulle igen.
//
// FRYSNINGEN ALENE GENOPRETTER IKKE LOEFTET (vigtigt for ejer-beslutningen):
//   Varslet laeses af GET /api/riders/:id/retirement-status. Selve pensioneringen
//   afgoeres et ANDET sted: riderProgressionEngine.js kalder developRiderSeason(),
//   som i backend/lib/riderProgression.js (linjen med
//   `retirement: retirementDecision(age - 1, rider.id, season, cfg)`) ruller med
//   den NYE seededUnitMixed-hash ved saeson-cutover. Fryser man kun varslet til
//   legacy, viser banneret "gaar ikke paa pension" for 36 ryttere der alligevel
//   pensioneres naar saeson 3 slutter (og omvendt for de 22 der mistede varslet).
//   En reparation der genopretter loeftet SKAL derfor ogsaa faa cutover-stien til
//   at laese frysningen (eller bruge legacy-hashen for saeson 3). Det hoerer til
//   ejerens beslutning + en separat kode-PR; dette script goer det ikke.
//
// POPULATION: alle ikke-pensionerede, ikke-akademi-ryttere - OGSAA frie agenter
// (team_id IS NULL). Et tidligere udkast filtrerede team_id NOT NULL og sprang
// dermed netop de ryttere over der ligger paa transfermarked/auktion, altsaa dem
// koebere traeffer beslutninger om (praecis thelamba-casen i #5073). Tallene i
// PR/issue er maalt paa denne bredere population.
//
// Brug:
//   # 1) maaling (default, INGEN skrivning)
//   infisical run --env=prod -- node scripts/ops/retirement-notice-freeze-5073.mjs
//
//   # 2) skriv frysningen (kraever BEGGE dele)
//   OWNER_GO=1 infisical run --env=prod -- \
//     node scripts/ops/retirement-notice-freeze-5073.mjs --execute
//
// Flag:
//   --execute            skriv frysningen (naegter uden OWNER_GO=1)
//   --source=legacy      frys det svar spillerne saa FOER 7/9 (default, genopretter varslet)
//   --source=current     frys det svar prod giver I DAG (hvis ejeren vil beholde det nye rul)
//   --out=<sti>          skriv JSON-kvitteringen hertil (default: en fil i OS'ets
//                        temp-mappe - en maaling maa ikke efterlade navnelister
//                        som untracked filer i repoet)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { PROGRESSION_CONFIG } from "../../backend/lib/riderProgression.js";
import {
  APP_CONFIG_KEY_PREFIX,
  buildFreezeMap,
  buildFreezeReport,
} from "./retirement-notice-freeze-5073.lib.mjs";

// ── CLI ──────────────────────────────────────────────────────────────────────
const ARGV = process.argv.slice(2);
const EXECUTE = ARGV.includes("--execute");
const SOURCE = (ARGV.find((a) => a.startsWith("--source=")) || "--source=legacy").split("=")[1];
const OUT_PATH = (ARGV.find((a) => a.startsWith("--out=")) || "").split("=")[1] || null;

const RIDER_PAGE = 1000;

function fail(msg) {
  console.error(`FEJL: ${msg}`);
  process.exit(1);
}

// ── DB ───────────────────────────────────────────────────────────────────────
async function fetchActiveSeasonNumber(supabase) {
  const { data, error } = await supabase
    .from("seasons")
    .select("number")
    .eq("status", "active")
    .maybeSingle();
  if (error) fail(`kunne ikke hente aktiv saeson: ${error.message}`);
  if (!data?.number) fail("ingen aktiv saeson i prod - stopper.");
  return Number(data.number);
}

async function fetchRiders(supabase) {
  const rows = [];
  for (let from = 0; ; from += RIDER_PAGE) {
    // Bevidst INGEN team_id-filter: frie agenter paa transfermarked/auktion er
    // netop dem koebere traeffer beslutninger om (se POPULATION i headeren).
    const { data, error } = await supabase
      .from("riders")
      .select("id, firstname, lastname, birthdate, team_id, contract_end_season, teams(name, is_ai, is_bank, is_frozen, is_test_account)")
      .eq("is_retired", false)
      .eq("is_academy", false)
      .order("id")
      .range(from, from + RIDER_PAGE - 1);
    if (error) fail(`kunne ikke hente ryttere: ${error.message}`);
    if (!data?.length) break;
    for (const r of data) {
      const t = r.teams || null;
      rows.push({
        ...r,
        teamName: t?.name ?? null,
        // Fri agent (team_id IS NULL) er per definition ikke paa et menneskehold.
        isHuman: t != null && t.is_ai === false && t.is_bank === false && t.is_frozen === false && t.is_test_account === false,
      });
    }
    if (data.length < RIDER_PAGE) break;
  }
  return rows;
}

// ── Rapport ──────────────────────────────────────────────────────────────────
function printReport(report, source) {
  const { totals } = report;
  console.log(`Aktiv saeson: ${report.activeSeason} (referenceaar ${2026 + report.activeSeason - 1})`);
  console.log(`Pensionsvindue: ${PROGRESSION_CONFIG.retirement.windowStartAge}-${PROGRESSION_CONFIG.retirement.guaranteedAge - 1} (garanteret fra ${PROGRESSION_CONFIG.retirement.guaranteedAge})`);
  console.log("");
  console.log(`Ryttere scannet ............ ${totals.ridersScanned} (inkl. frie agenter)`);
  console.log(`I det seedede vindue ....... ${totals.inSeededWindow} (menneskehold: ${totals.humanInSeededWindow}, frie agenter: ${totals.freeAgentInSeededWindow})`);
  console.log(`Varslet FOER 7/9 ........... ${totals.legacyAnnounced}`);
  console.log(`Varslet I DAG .............. ${totals.currentAnnounced}`);
  console.log(`Divergerer ................. ${totals.diverged} (fik varsel: ${totals.gained}, mistede varsel: ${totals.lost})`);
  console.log(`  heraf paa menneskehold ... ${totals.humanDiverged} (fik: ${totals.humanGained}, mistede: ${totals.humanLost})`);
  console.log(`  heraf frie agenter ....... ${totals.freeAgentDiverged}`);
  console.log("");
  console.log("Divergerende ryttere (menneskehold foerst):");
  for (const r of report.diverged) {
    const tag = r.direction === "gained" ? "FIK VARSEL " : "MISTEDE    ";
    const holder = r.isHuman ? "M " : (r.isFreeAgent ? "FA" : "AI");
    console.log(`  ${tag} ${holder}  ${String(r.age).padStart(2)}  ${r.name.padEnd(28)} ${r.teamName ?? "fri agent"}  (${r.riderId})`);
  }
  console.log("");
  console.log(`Frysnings-kilde: --source=${source}`);
}

function writeReceipt(report, freezeMap, source) {
  // Default UDEN for repoet: kvitteringen indeholder navnelister paa alle
  // divergerende ryttere, og en ren maaling maa ikke efterlade untracked filer
  // i arbejdstraeet. Vil man gemme den, peger man selv med --out.
  const file = OUT_PATH || path.join(os.tmpdir(), `retirement-notice-freeze-s${report.activeSeason}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), source, ...report, freezeMap }, null, 2));
  console.log(`Kvittering skrevet: ${file}`);
  return file;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    fail("SUPABASE_URL/SUPABASE_SERVICE_KEY mangler - koer via `infisical run --env=prod --`.");
  }
  if (SOURCE !== "legacy" && SOURCE !== "current") {
    fail(`ukendt --source=${SOURCE} (brug legacy eller current)`);
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const activeSeason = await fetchActiveSeasonNumber(supabase);
  const riders = await fetchRiders(supabase);
  const report = buildFreezeReport(riders, activeSeason);
  const freezeMap = buildFreezeMap(riders, activeSeason, SOURCE);

  printReport(report, SOURCE);
  writeReceipt(report, freezeMap, SOURCE);

  if (!EXECUTE) {
    console.log("");
    console.log("DRY RUN - intet skrevet til databasen.");
    console.log("Skriv frysningen med:  OWNER_GO=1 <...> --execute");
    return;
  }

  if (process.env.OWNER_GO !== "1") {
    fail("--execute kraever OWNER_GO=1 i miljoeet. Ejeren skal have set tallene ovenfor FOERST (#5073).");
  }

  const key = `${APP_CONFIG_KEY_PREFIX}${activeSeason}`;
  const value = { source: SOURCE, season: activeSeason, frozenAt: new Date().toISOString(), notices: freezeMap };
  const { error: cfgErr } = await supabase
    .from("app_config")
    .upsert({ key, value, description: `#5073: frosset pensionsvarsel for saeson ${activeSeason} (kilde: ${SOURCE})` }, { onConflict: "key" });
  if (cfgErr) fail(`kunne ikke skrive app_config.${key}: ${cfgErr.message}`);

  const { error: logErr } = await supabase.from("admin_log").insert({
    action_type: "retirement_notice_freeze",
    description: `#5073: froes pensionsvarslet for saeson ${activeSeason} (kilde ${SOURCE}, ${Object.keys(freezeMap).length} ryttere)`,
    meta: { issue: 5073, season: activeSeason, source: SOURCE, riderCount: Object.keys(freezeMap).length, diverged: report.totals.diverged },
  });
  if (logErr) console.error(`ADVARSEL: admin_log-raekken fejlede: ${logErr.message}`);

  console.log("");
  console.log(`SKREVET: app_config.${key} (${Object.keys(freezeMap).length} ryttere frosset, kilde ${SOURCE}).`);
  console.log("Naeste skridt er en separat kode-PR der laeser noeglen BAADE i /retirement-status");
  console.log("OG paa cutover-stien (developRiderSeason -> retirementDecision) - ellers vises");
  console.log("et varsel der ikke holder ved saesonskiftet.");
}

// Kun main() ved direkte kald - importeret (test) skal ikke ramme prod.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
  main().catch((err) => fail(err?.message || String(err)));
}
