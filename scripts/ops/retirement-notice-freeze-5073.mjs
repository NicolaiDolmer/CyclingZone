// scripts/ops/retirement-notice-freeze-5073.mjs
//
// #5073 · Pensionsvarslet skiftede midt i saeson 3. Dette script MAALER skaden og
// skriver (kun med eksplicit ejer-go) varslet ned i rytterens egne kolonner, saa
// det ikke laengere kan flytte sig fordi en seed-funktion aendres.
//
// Rod-aarsag, evidens og den rene klassifikationslogik ligger i
// retirement-notice-freeze-5073.lib.mjs (importeret nedenfor). Denne fil er KUN
// I/O: hent prod, print rapporten, skriv kvitteringen, og - med dobbelt gate -
// skriv frysningen. Delingen er ikke kosmetisk: CI's `static-guards`-job koerer
// uden `npm ci`, saa testen maa ikke kunne naa @supabase/supabase-js via en
// importkaede. Alt testbart bor derfor i .lib.mjs.
//
// HVAD DER SKRIVES (ejer-beslutning 10/9 kl. 16:05: "A: genopret loeftet + gem
// varslet"): de tre kolonner fra migration
// database/2026-09-10-5073-retirement-notice-column.sql -
//   retirement_notice_season        saesonen svaret er afgjort for
//   retirement_notice_after_season  saesonen rytteren stopper EFTER (NULL = intet varsel)
//   retirement_notice_given_at      hvornaar varslet blev givet (kun ved ja)
//
//   · Ryttere i det seedede vindue (36-39 i saeson 3) faar det GAMLE rul
//     (seededUnit, som foer #4990) - altsaa praecis det svar spillerne planlagde
//     efter, foer hash-skiftet 7/9 flyttede det.
//   · Alle andre ryttere faar det gaeldende svar. Udenfor vinduet er det pr.
//     konstruktion samme svar (under 36 = altid nej, 40+ = altid ja); der er
//     intet rul at genoprette, kun en alders-regel at skrive ned.
//
// BAADE banneret OG cutover laeser kolonnen efter denne koersel
// (backend/routes/api.js -> resolveRetirementNotice, riderProgressionEngine ->
// resolveSeasonRetirement). Det var forbeholdet i den foerste udgave af dette
// script: en frysning der kun blev laest af /retirement-status ville vise
// "gaar ikke paa pension" for 36 ryttere der alligevel blev pensioneret ved
// cutover. Det hul er lukket i koden i samme PR.
//
// POPULATION: alle ikke-pensionerede, ikke-akademi-ryttere - OGSAA frie agenter
// (team_id IS NULL). Et tidligere udkast filtrerede team_id NOT NULL og sprang
// dermed netop de ryttere over der ligger paa transfermarked/auktion, altsaa dem
// koebere traeffer beslutninger om (praecis thelamba-casen i #5073).
//
// IDEMPOTENS: skriver kun raekker hvor retirement_notice_season er NULL. En
// rytter der allerede har faaet sit varsel (lazy freeze ved en visning, eller en
// tidligere koersel) roeres ikke - et givet loefte overskrives aldrig. `--force`
// slaar den beskyttelse fra og er kun til en bevidst omkoersel.
//
// Brug:
//   # 1) maaling (default, INGEN skrivning)
//   infisical run --env=prod -- node scripts/ops/retirement-notice-freeze-5073.mjs --dry-run
//
//   # 2) skriv frysningen (kraever BEGGE dele)
//   OWNER_GO=1 infisical run --env=prod -- \
//     node scripts/ops/retirement-notice-freeze-5073.mjs --execute
//
// Flag:
//   --dry-run            eksplicit maaling (default-adfaerd; kan ikke kombineres med --execute)
//   --execute            skriv frysningen (naegter uden OWNER_GO=1)
//   --force              skriv ogsaa oven i ryttere der allerede har et frosset varsel
//   --source=legacy      frys det svar spillerne saa FOER 7/9 (default, genopretter varslet)
//   --source=current     frys det svar prod giver I DAG (hvis ejeren vil beholde det nye rul)
//   --out=<sti>          skriv JSON-kvitteringen hertil (default: en fil i OS'ets
//                        temp-mappe - en maaling maa ikke efterlade navnelister
//                        som untracked filer i repoet)
//   --input=<sti>        laes rytter-raekkerne fra en JSON-fil i stedet for prod
//                        (read-only maaling uden DB-credentials; kun med --dry-run)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { PROGRESSION_CONFIG } from "../../backend/lib/riderProgression.js";
import { RETIREMENT_NOTICE_COLUMNS } from "../../backend/lib/retirementNotice.js";
import {
  buildFreezeReport,
  buildFreezeRows,
} from "./retirement-notice-freeze-5073.lib.mjs";

// ── CLI ──────────────────────────────────────────────────────────────────────
const ARGV = process.argv.slice(2);
const EXECUTE = ARGV.includes("--execute");
const DRY_RUN = ARGV.includes("--dry-run");
const FORCE = ARGV.includes("--force");
const SOURCE = (ARGV.find((a) => a.startsWith("--source=")) || "--source=legacy").split("=")[1];
const OUT_PATH = (ARGV.find((a) => a.startsWith("--out=")) || "").split("=")[1] || null;
const INPUT_PATH = (ARGV.find((a) => a.startsWith("--input=")) || "").split("=")[1] || null;

const RIDER_PAGE = 1000;
const WRITE_CHUNK = 200;

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

function decorate(rows) {
  return rows.map((r) => {
    const t = r.teams || null;
    return {
      ...r,
      teamName: t?.name ?? r.teamName ?? null,
      // Fri agent (team_id IS NULL) er per definition ikke paa et menneskehold.
      isHuman: t != null && t.is_ai === false && t.is_bank === false && t.is_frozen === false && t.is_test_account === false,
    };
  });
}

async function fetchRiders(supabase) {
  const rows = [];
  for (let from = 0; ; from += RIDER_PAGE) {
    // Bevidst INGEN team_id-filter: frie agenter paa transfermarked/auktion er
    // netop dem koebere traeffer beslutninger om (se POPULATION i headeren).
    const { data, error } = await supabase
      .from("riders")
      .select(`id, firstname, lastname, birthdate, team_id, contract_end_season, ${RETIREMENT_NOTICE_COLUMNS}, teams(name, is_ai, is_bank, is_frozen, is_test_account)`)
      .eq("is_retired", false)
      .eq("is_academy", false)
      .order("id")
      .range(from, from + RIDER_PAGE - 1);
    if (error) fail(`kunne ikke hente ryttere: ${error.message}`);
    if (!data?.length) break;
    rows.push(...decorate(data));
    if (data.length < RIDER_PAGE) break;
  }
  return rows;
}

// ── Rapport ──────────────────────────────────────────────────────────────────
function printReport(report, freezeRows, riders, source) {
  const { totals } = report;
  // Id-baseret, ikke indeks-baseret: buildFreezeRows springer raekker uden id
  // over, saa positionerne i de to lister er ikke garanteret de samme.
  const frozenIds = new Set(riders.filter((r) => r.retirement_notice_season != null).map((r) => r.id));
  const alreadyFrozen = frozenIds.size;
  const willWrite = FORCE ? freezeRows.length : freezeRows.filter((r) => !frozenIds.has(r.riderId)).length;
  const announcedAfter = freezeRows.filter((r) => r.announced).length;

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
  console.log(`Allerede frosset i DB ...... ${alreadyFrozen} (roeres ikke uden --force)`);
  console.log(`Skrives af denne koersel ... ${willWrite} raekker, kilde --source=${source}`);
  console.log(`  heraf MED varsel ........ ${announcedAfter} (rytteren stopper efter saeson ${report.activeSeason})`);
  console.log("");
  console.log("Divergerende ryttere paa MENNESKEHOLD (navneliste):");
  const humans = report.diverged.filter((r) => r.isHuman);
  for (const r of humans) {
    const tag = r.direction === "gained" ? "FIK VARSEL " : "MISTEDE    ";
    console.log(`  ${tag} ${String(r.age).padStart(2)}  ${r.name.padEnd(28)} ${r.teamName ?? "-"}  (${r.riderId})`);
  }
  console.log("");
  console.log("Oevrige divergerende (frie agenter + AI-hold):");
  for (const r of report.diverged.filter((x) => !x.isHuman)) {
    const tag = r.direction === "gained" ? "FIK VARSEL " : "MISTEDE    ";
    const holder = r.isFreeAgent ? "FA" : "AI";
    console.log(`  ${tag} ${holder}  ${String(r.age).padStart(2)}  ${r.name.padEnd(28)} ${r.teamName ?? "fri agent"}  (${r.riderId})`);
  }
}

function writeReceipt(report, freezeRows, source) {
  // Default UDEN for repoet: kvitteringen indeholder navnelister paa alle
  // divergerende ryttere, og en ren maaling maa ikke efterlade untracked filer
  // i arbejdstraeet. Vil man gemme den, peger man selv med --out.
  const file = OUT_PATH || path.join(os.tmpdir(), `retirement-notice-freeze-s${report.activeSeason}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    generatedAt: new Date().toISOString(),
    source,
    ...report,
    freeze: freezeRows.map(({ riderId, announced, inSeededWindow }) => ({ riderId, announced, inSeededWindow })),
  }, null, 2));
  console.log("");
  console.log(`Kvittering skrevet: ${file}`);
  return file;
}

// ── Skrivning ────────────────────────────────────────────────────────────────
// Grupperet, ikke pr. rytter: patchen har praecis to former (varsel / intet
// varsel), saa hele populationen kan skrives med to `.in(id, chunk)`-updates pr.
// chunk i stedet for 2.000 enkeltkald.
async function writeFreeze(supabase, freezeRows) {
  const groups = [
    { announced: true, rows: freezeRows.filter((r) => r.announced) },
    { announced: false, rows: freezeRows.filter((r) => !r.announced) },
  ];
  let written = 0;
  for (const group of groups) {
    if (!group.rows.length) continue;
    const patch = group.rows[0].patch;
    for (let i = 0; i < group.rows.length; i += WRITE_CHUNK) {
      const ids = group.rows.slice(i, i + WRITE_CHUNK).map((r) => r.riderId);
      let q = supabase.from("riders").update(patch).in("id", ids);
      // Idempotens: et allerede givet loefte overskrives aldrig utilsigtet.
      if (!FORCE) q = q.is("retirement_notice_season", null);
      const { data, error } = await q.select("id");
      if (error) fail(`kunne ikke skrive frysningen: ${error.message}`);
      written += data?.length ?? 0;
    }
  }
  return written;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (EXECUTE && DRY_RUN) fail("--dry-run og --execute kan ikke kombineres.");
  if (SOURCE !== "legacy" && SOURCE !== "current") {
    fail(`ukendt --source=${SOURCE} (brug legacy eller current)`);
  }
  if (INPUT_PATH && EXECUTE) fail("--input er kun til maaling; koer --execute mod prod.");

  let supabase = null;
  let activeSeason;
  let riders;

  if (INPUT_PATH) {
    // Read-only maaling paa et udtraek (fx SELECT'et via Supabase MCP), saa
    // tallene kan reproduceres uden service-role-credentials i miljoeet.
    const payload = JSON.parse(fs.readFileSync(INPUT_PATH, "utf8"));
    activeSeason = Number(payload.activeSeason);
    if (!Number.isFinite(activeSeason)) fail(`--input mangler activeSeason: ${INPUT_PATH}`);
    riders = decorate(payload.riders || []);
  } else {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      fail("SUPABASE_URL/SUPABASE_SERVICE_KEY mangler - koer via `infisical run --env=prod --`.");
    }
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    activeSeason = await fetchActiveSeasonNumber(supabase);
    riders = await fetchRiders(supabase);
  }

  const report = buildFreezeReport(riders, activeSeason);
  const freezeRows = buildFreezeRows(riders, activeSeason, SOURCE);

  printReport(report, freezeRows, riders, SOURCE);
  writeReceipt(report, freezeRows, SOURCE);

  if (!EXECUTE) {
    console.log("");
    console.log("DRY RUN - intet skrevet til databasen.");
    console.log("Skriv frysningen med:  OWNER_GO=1 <...> --execute");
    return;
  }

  if (process.env.OWNER_GO !== "1") {
    fail("--execute kraever OWNER_GO=1 i miljoeet. Ejeren skal have set tallene ovenfor FOERST (#5073).");
  }

  const written = await writeFreeze(supabase, freezeRows);

  const { error: logErr } = await supabase.from("admin_log").insert({
    action_type: "retirement_notice_freeze",
    description: `#5073: froes pensionsvarslet for saeson ${activeSeason} (kilde ${SOURCE}, ${written} raekker skrevet${FORCE ? ", --force" : ""})`,
    meta: {
      issue: 5073,
      season: activeSeason,
      source: SOURCE,
      force: FORCE,
      written,
      candidates: freezeRows.length,
      diverged: report.totals.diverged,
      humanDiverged: report.totals.humanDiverged,
    },
  });
  if (logErr) console.error(`ADVARSEL: admin_log-raekken fejlede: ${logErr.message}`);

  console.log("");
  console.log(`SKREVET: ${written} ryttere har nu et frosset varsel for saeson ${activeSeason} (kilde ${SOURCE}).`);
  console.log("Baade /retirement-status og cutover (developRiderSeason) laeser kolonnen,");
  console.log("saa banneret og den faktiske pensionering kan ikke laengere sige to ting.");
}

// Kun main() ved direkte kald - importeret (test) skal ikke ramme prod.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
  main().catch((err) => fail(err?.message || String(err)));
}
