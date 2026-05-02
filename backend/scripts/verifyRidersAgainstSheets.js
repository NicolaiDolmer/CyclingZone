#!/usr/bin/env node
/**
 * verifyRidersAgainstSheets.js — Read-only Gate #5 spot-check.
 *
 * Tjekker at riders.uci_points + salary + dyn_cyclist stats matcher
 * de live Google Sheets på 10 udvalgte ranger (top-3, ~250, ~750, ~1500,
 * ~2500, ~2999, ~5000 off-list, ~8000 deep off).
 *
 * Kør fra projektrod:
 *   node backend/scripts/verifyRidersAgainstSheets.js
 *
 * UCI-kilde:    scripts/uci_top1000.csv (lokal snapshot, opdateres ugentligt af GH Actions)
 * dyn-kilde:    live gviz-fetch (samme path som dynCyclistSync.js)
 * dyn-override: DYN_SHEET_ID=<id> node backend/scripts/verifyRidersAgainstSheets.js
 */

import { createClient } from "@supabase/supabase-js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "../.env") });

const DEFAULT_DYN_SHEET_ID = "1Fm56gvH7IZ4Tks9I_tJfP7xP_7PgUjPxBbZgWJGCIf4";
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ── Load UCI Sheet snapshot ─────────────────────────────────────────────────────
const UCI_CSV_PATH = join(__dirname, "../../scripts/uci_top1000.csv");
const uciByName = new Map();
try {
  const lines = readFileSync(UCI_CSV_PATH, "utf8").split(/\r?\n/).filter(l => l.length > 0);
  for (const line of lines.slice(1)) {
    const [rank, name, , nat, points] = line.split(",");
    if (name && points) uciByName.set(normalizeName(name), { rank: parseInt(rank), points: parseInt(points), nat });
  }
  console.log(`UCI Sheet snapshot loaded: ${uciByName.size} ryttere (scripts/uci_top1000.csv)`);
} catch (e) {
  console.error("⚠️  Kunne ikke læse scripts/uci_top1000.csv — UCI cross-check skippes");
}

// ── Fetch dyn_cyclist Sheet live via gviz ───────────────────────────────────────
const dynSheetId = process.env.DYN_SHEET_ID || DEFAULT_DYN_SHEET_ID;
const dynUrl = `https://docs.google.com/spreadsheets/d/${dynSheetId}/gviz/tq?tqx=out:csv`;
const dynRes = await fetch(dynUrl);
if (!dynRes.ok) {
  console.error(`❌ dyn-Sheet fetch failed: ${dynRes.status}`);
  process.exit(1);
}
const dynLines = (await dynRes.text()).split(/\r?\n/).filter(l => l.length > 0);
const dynHeader = parseCsvLine(dynLines[0]);
const idx = (col) => dynHeader.indexOf(col);
const COL = {
  pcmId: idx("IDcyclist"), sp: idx("charac_i_sprint"), bj: idx("charac_i_mountain"),
  kb: idx("charac_i_medium_mountain"), tt: idx("charac_i_timetrial"),
  height: idx("gene_i_size"), weight: idx("gene_i_weight"), potential: idx("value_f_potentiel"),
};
const dynByPcmId = new Map();
for (const line of dynLines.slice(1)) {
  const cols = parseCsvLine(line);
  const pcmId = cols[COL.pcmId];
  if (!pcmId) continue;
  dynByPcmId.set(parseInt(pcmId), {
    sp: Math.round(parseFloat(cols[COL.sp])), bj: Math.round(parseFloat(cols[COL.bj])),
    kb: Math.round(parseFloat(cols[COL.kb])), tt: Math.round(parseFloat(cols[COL.tt])),
    height: Math.round(parseFloat(cols[COL.height])), weight: Math.round(parseFloat(cols[COL.weight])),
    potential: parseFloat(String(cols[COL.potential]).replace(",", ".")),
  });
}
console.log(`dyn_cyclist Sheet loaded live: ${dynByPcmId.size} ryttere (id=${dynSheetId})\n`);

// ── Sample 10 riders by rank ────────────────────────────────────────────────────
const RIDER_COLS = "id, firstname, lastname, nationality_code, uci_points, salary, height, weight, potentiale, stat_sp, stat_bj, stat_tt, stat_kb, pcm_id";
const picks = [
  { tag: "TOP_1", rank: 1 }, { tag: "TOP_2", rank: 2 }, { tag: "TOP_3", rank: 3 },
  { tag: "RANK_~250", rank: 250 }, { tag: "RANK_~750", rank: 750 },
  { tag: "RANK_~1500", rank: 1500 }, { tag: "RANK_~2500", rank: 2500 },
  { tag: "RANK_~2999", rank: 2999 }, { tag: "OFF_UCI_LIST", rank: 5000 },
  { tag: "DEEP_OFF", rank: 8000 },
];
const { count: totalRiders } = await supabase.from("riders").select("id", { count: "exact", head: true });
console.log(`DB total riders: ${totalRiders}\n=== verifyRidersAgainstSheets (10 ryttere) ===\n`);

let uciFails = 0, dynFails = 0, salaryFails = 0;
for (const p of picks) {
  const { data: rows, error } = await supabase.from("riders").select(RIDER_COLS)
    .order("uci_points", { ascending: false }).order("id", { ascending: true })
    .range(p.rank - 1, p.rank - 1);
  if (error) { console.error(`[${p.tag}] DB error: ${error.message}`); continue; }
  if (!rows?.length) { console.log(`[${p.tag}] DB-rank #${p.rank} → INGEN RYTTER\n`); continue; }
  const r = rows[0];
  const fullName = `${r.firstname} ${r.lastname}`.trim();

  const sheetUci = uciByName.get(normalizeName(`${r.lastname} ${r.firstname}`)) ||
                   uciByName.get(normalizeName(`${r.firstname} ${r.lastname}`));
  let uciStatus;
  if (r.uci_points === 5) {
    uciStatus = sheetUci ? `⚠️  DB=5 men Sheet=${sheetUci.points}` : "✅ DB=5, off-list (forventet)";
  } else if (sheetUci) {
    uciStatus = sheetUci.points === r.uci_points
      ? `✅ Sheet=${sheetUci.points} (rank ${sheetUci.rank})`
      : `❌ DB=${r.uci_points} != Sheet=${sheetUci.points}`;
    if (sheetUci.points !== r.uci_points) uciFails++;
  } else {
    uciStatus = `⚠️  DB=${r.uci_points} ikke fundet i Sheet (navn-mismatch?)`;
  }

  const baseSalary = r.uci_points * 400;
  const prizeBonus = r.salary - baseSalary;
  const salaryStatus = r.salary >= baseSalary
    ? `✅ ${r.salary} (base=${baseSalary}, +bonus=${prizeBonus})`
    : `❌ ${r.salary} < base ${baseSalary}`;
  if (r.salary < baseSalary) salaryFails++;

  const sheetDyn = dynByPcmId.get(r.pcm_id);
  let dynStatus;
  if (!sheetDyn) {
    dynStatus = `⚠️  pcm_id=${r.pcm_id} ikke i dyn-Sheet`;
  } else {
    const diffs = [];
    if (sheetDyn.sp !== r.stat_sp) diffs.push(`sp:DB=${r.stat_sp}/Sheet=${sheetDyn.sp}`);
    if (sheetDyn.bj !== r.stat_bj) diffs.push(`bj:DB=${r.stat_bj}/Sheet=${sheetDyn.bj}`);
    if (sheetDyn.kb !== r.stat_kb) diffs.push(`kb:DB=${r.stat_kb}/Sheet=${sheetDyn.kb}`);
    if (sheetDyn.tt !== r.stat_tt) diffs.push(`tt:DB=${r.stat_tt}/Sheet=${sheetDyn.tt}`);
    if (sheetDyn.height !== r.height) diffs.push(`h:DB=${r.height}/Sheet=${sheetDyn.height}`);
    if (sheetDyn.weight !== r.weight) diffs.push(`w:DB=${r.weight}/Sheet=${sheetDyn.weight}`);
    if (Math.abs((sheetDyn.potential ?? 0) - (r.potentiale ?? 0)) > 0.01) {
      diffs.push(`pot:DB=${r.potentiale}/Sheet=${sheetDyn.potential}`);
    }
    dynStatus = diffs.length === 0 ? `✅ alle 7 felter` : `❌ ${diffs.join("; ")}`;
    if (diffs.length > 0) dynFails++;
  }

  console.log(
    `[${p.tag}] #${p.rank} ${fullName} (${r.nationality_code}, pcm=${r.pcm_id})\n` +
    `   UCI:    ${uciStatus}\n   Salary: ${salaryStatus}\n   dyn:    ${dynStatus}\n`
  );
}

console.log("=== SUMMARY ===");
console.log(`  UCI mismatches:    ${uciFails}/10`);
console.log(`  Salary mismatches: ${salaryFails}/10`);
console.log(`  dyn mismatches:    ${dynFails}/10`);
console.log(uciFails + salaryFails + dynFails === 0 ? "  🟢 GRØNT — DB matcher Sheet" : "  🔴 Diagnoser afvigelser");

function normalizeName(name) {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().trim().replace(/\s+/g, " ");
}
function parseCsvLine(line) {
  const r = []; let c = "", q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) { r.push(c.trim()); c = ""; }
    else c += ch;
  }
  r.push(c.trim()); return r;
}
