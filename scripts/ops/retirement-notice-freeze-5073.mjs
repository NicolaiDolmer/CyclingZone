// scripts/ops/retirement-notice-freeze-5073.mjs
//
// #5073 · Pensionsvarslet skiftede midt i saeson 3. Dette script MAALER skaden og
// kan (kun med eksplicit ejer-go) fryse varslet som en lagret kendsgerning, saa det
// ikke laengere kan flytte sig fordi en seed-funktion aendres.
//
// ROD-AARSAG (dokumenteret i #5073-kommentaren 10/9):
//   Varslet er IKKE et lagret felt. GET /api/riders/:id/retirement-status regner det
//   on-the-fly via announcedRetirementAfterSeason(rider, activeSeason)
//   (backend/lib/riderProgression.js), som er ren funktion af
//   (rider.id, rider.birthdate, activeSeason) OG af hash-funktionen bag rullet.
//   PR #4990 (commit 742ba4d30, merged 2026-09-07 12:29 UTC) skiftede
//   retirementDecision() fra seededUnit() til seededUnitMixed(). Samme rytter,
//   samme sæson, NYT tal - og dermed nyt svar for alle i det seedede vindue
//   (saeson-alder 36-39). Uden for vinduet er svaret uaendret: <36 er altid nej,
//   >=40 er altid ja.
//
// SSOT der er i spil (hard rule 30):
//   docs/PROGRESSION_RULES.md §6, raekken "Dags-/saeson-seedet stoej ... SKAL bruge
//   seededUnitMixed()" (#4987). Den regel er rigtig for daglig stoej, men den
//   kolliderer med #2700/#2748's loefte om at et GIVET varsel staar fast. Konflikten
//   er skrevet ind i §9 (modsigelse nr. 9) i samme PR som dette script.
//
// DETTE SCRIPT AENDRER INGEN PENSIONSLOGIK. Det laeser prod, sammenligner det
// LEGACY-svar (foer 7/9) med det NUVAERENDE svar, og kan skrive frysningen som
// en app_config-raekke som en senere kode-PR kan laese i stedet for at rulle igen.
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
//   --source=legacy      frys det svar spillerne saa FOER 7/9 (default, genopretter loeftet)
//   --source=current     frys det svar prod giver I DAG (hvis ejeren vil beholde det nye rul)
//   --out=<sti>          skriv JSON-kvitteringen hertil (default: skriv til stdout-sti nedenfor)

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { ageForSeason } from "../../backend/lib/riderSeasonAge.js";
import {
  PROGRESSION_CONFIG,
  seededUnit,
  announcedRetirementAfterSeason,
} from "../../backend/lib/riderProgression.js";

// ── CLI ──────────────────────────────────────────────────────────────────────
const ARGV = process.argv.slice(2);
const EXECUTE = ARGV.includes("--execute");
const SOURCE = (ARGV.find((a) => a.startsWith("--source=")) || "--source=legacy").split("=")[1];
const OUT_PATH = (ARGV.find((a) => a.startsWith("--out=")) || "").split("=")[1] || null;

export const APP_CONFIG_KEY_PREFIX = "retirement_notice_freeze_s";
const RIDER_PAGE = 1000;

function fail(msg) {
  console.error(`FEJL: ${msg}`);
  process.exit(1);
}

// ── LEGACY-rullet (frossen kopi af koden FOER commit 742ba4d30) ───────────────
// Bevidst en kopi og ikke en import: den nuvaerende retirementDecision() tager
// ingen injicerbar hash, og pointen er netop at kunne reproducere det svar
// spillerne saa FOER 7/9. Kopien maa ALDRIG "vedligeholdes" - aendres den, holder
// den op med at vaere en historisk reference. Den bruges kun her, aldrig i motoren.
export function legacyAnnouncedRetirementAfterSeason(rider, activeSeason, cfg = PROGRESSION_CONFIG) {
  const age = ageForSeason(rider?.birthdate, activeSeason);
  if (age == null || rider?.id == null) return false;
  const { windowStartAge, guaranteedAge } = cfg.retirement;
  if (age < windowStartAge) return false;
  if (age >= guaranteedAge) return true;
  const p = (age - windowStartAge) / (guaranteedAge - windowStartAge);
  return seededUnit(`retire:${rider.id}:${activeSeason + 1}`) < p;
}

// ── Ren klassifikation (ingen DB) - det testbare hjerte ──────────────────────
/**
 * Klassificér én rytter: hvad sagde varslet FOER 7/9, hvad siger det I DAG, og
 * er det en divergens spilleren kan have handlet paa?
 *
 * @param {object} rider   { id, firstname, lastname, birthdate, team_id }
 * @param {number} activeSeason
 * @returns {{riderId:string, age:number|null, inSeededWindow:boolean, legacy:boolean, current:boolean, diverged:boolean, direction:"gained"|"lost"|null}}
 */
export function classifyRider(rider, activeSeason, cfg = PROGRESSION_CONFIG) {
  const age = ageForSeason(rider?.birthdate, activeSeason);
  const { windowStartAge, guaranteedAge } = cfg.retirement;
  const inSeededWindow = age != null && age >= windowStartAge && age < guaranteedAge;
  const legacy = legacyAnnouncedRetirementAfterSeason(rider, activeSeason, cfg);
  const current = announcedRetirementAfterSeason(rider, activeSeason, cfg);
  const diverged = legacy !== current;
  return {
    riderId: rider?.id ?? null,
    age,
    inSeededWindow,
    legacy,
    current,
    diverged,
    direction: diverged ? (current ? "gained" : "lost") : null,
  };
}

/**
 * Saml hele populationen til en rapport. Pure - tager raekker ind, giver tal ud,
 * saa den kan testes uden prod.
 *
 * @param {Array<object>} riders  ryttere med team-metadata paahaeftet (isHuman)
 * @param {number} activeSeason
 */
export function buildFreezeReport(riders, activeSeason, cfg = PROGRESSION_CONFIG) {
  const rows = [];
  const totals = {
    ridersScanned: riders.length,
    inSeededWindow: 0,
    legacyAnnounced: 0,
    currentAnnounced: 0,
    diverged: 0,
    gained: 0,
    lost: 0,
    humanInSeededWindow: 0,
    humanDiverged: 0,
    humanGained: 0,
    humanLost: 0,
  };

  for (const rider of riders) {
    const c = classifyRider(rider, activeSeason, cfg);
    if (c.inSeededWindow) {
      totals.inSeededWindow += 1;
      if (rider.isHuman) totals.humanInSeededWindow += 1;
    }
    if (c.legacy) totals.legacyAnnounced += 1;
    if (c.current) totals.currentAnnounced += 1;
    if (c.diverged) {
      totals.diverged += 1;
      totals[c.direction] += 1;
      if (rider.isHuman) {
        totals.humanDiverged += 1;
        totals[c.direction === "gained" ? "humanGained" : "humanLost"] += 1;
      }
      rows.push({
        riderId: c.riderId,
        name: `${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim(),
        age: c.age,
        teamId: rider.team_id ?? null,
        teamName: rider.teamName ?? null,
        isHuman: rider.isHuman === true,
        contractEndSeason: rider.contract_end_season ?? null,
        legacy: c.legacy,
        current: c.current,
        direction: c.direction,
      });
    }
  }

  rows.sort((a, b) => Number(b.isHuman) - Number(a.isHuman) || (b.age ?? 0) - (a.age ?? 0));
  return { activeSeason, totals, diverged: rows };
}

/**
 * Frysnings-kortet der skrives til app_config: rytter-id -> boolean varsel.
 * Kun ryttere i det seedede vindue er med - uden for vinduet er svaret en ren
 * alders-regel der ikke kan flytte sig, og en frysning ville bare skjule en
 * fremtidig aendring af windowStartAge/guaranteedAge.
 */
export function buildFreezeMap(riders, activeSeason, source, cfg = PROGRESSION_CONFIG) {
  if (source !== "legacy" && source !== "current") {
    throw new Error(`ukendt --source: ${source} (brug legacy eller current)`);
  }
  const map = {};
  for (const rider of riders) {
    const c = classifyRider(rider, activeSeason, cfg);
    if (!c.inSeededWindow || !c.riderId) continue;
    map[c.riderId] = source === "legacy" ? c.legacy : c.current;
  }
  return map;
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
    const { data, error } = await supabase
      .from("riders")
      .select("id, firstname, lastname, birthdate, team_id, contract_end_season, teams(name, is_ai, is_bank, is_frozen, is_test_account)")
      .eq("is_retired", false)
      .eq("is_academy", false)
      .not("team_id", "is", null)
      .order("id")
      .range(from, from + RIDER_PAGE - 1);
    if (error) fail(`kunne ikke hente ryttere: ${error.message}`);
    if (!data?.length) break;
    for (const r of data) {
      const t = r.teams || {};
      rows.push({
        ...r,
        teamName: t.name ?? null,
        isHuman: t.is_ai === false && t.is_bank === false && t.is_frozen === false && t.is_test_account === false,
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
  console.log(`Ryttere scannet ............ ${totals.ridersScanned}`);
  console.log(`I det seedede vindue ....... ${totals.inSeededWindow} (heraf paa menneskehold: ${totals.humanInSeededWindow})`);
  console.log(`Varslet FOER 7/9 ........... ${totals.legacyAnnounced}`);
  console.log(`Varslet I DAG .............. ${totals.currentAnnounced}`);
  console.log(`Divergerer ................. ${totals.diverged} (fik varsel: ${totals.gained}, mistede varsel: ${totals.lost})`);
  console.log(`  heraf paa menneskehold ... ${totals.humanDiverged} (fik: ${totals.humanGained}, mistede: ${totals.humanLost})`);
  console.log("");
  console.log("Divergerende ryttere (menneskehold foerst):");
  for (const r of report.diverged) {
    const tag = r.direction === "gained" ? "FIK VARSEL " : "MISTEDE    ";
    console.log(`  ${tag} ${r.isHuman ? "M" : "AI"}  ${String(r.age).padStart(2)}  ${r.name.padEnd(28)} ${r.teamName ?? "-"}  (${r.riderId})`);
  }
  console.log("");
  console.log(`Frysnings-kilde: --source=${source}`);
}

function writeReceipt(report, freezeMap, source) {
  const dir = OUT_PATH ? path.dirname(OUT_PATH) : path.join(process.cwd(), "docs", "audits");
  const file = OUT_PATH || path.join(dir, `retirement-notice-freeze-s${report.activeSeason}.json`);
  fs.mkdirSync(dir, { recursive: true });
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
    description: `#5073: frøs pensionsvarslet for saeson ${activeSeason} (kilde ${SOURCE}, ${Object.keys(freezeMap).length} ryttere)`,
    meta: { issue: 5073, season: activeSeason, source: SOURCE, riderCount: Object.keys(freezeMap).length, diverged: report.totals.diverged },
  });
  if (logErr) console.error(`ADVARSEL: admin_log-raekken fejlede: ${logErr.message}`);

  console.log("");
  console.log(`SKREVET: app_config.${key} (${Object.keys(freezeMap).length} ryttere frosset, kilde ${SOURCE}).`);
  console.log("Naeste skridt er en separat kode-PR der laeser noeglen i /retirement-status.");
}

// Kun main() ved direkte kald - importeret (test) skal ikke ramme prod.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
  main().catch((err) => fail(err?.message || String(err)));
}
