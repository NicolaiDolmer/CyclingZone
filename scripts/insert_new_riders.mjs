// Insert-only import of NEW world-db riders into CZ (pcm_id not already in DB).
// Touches NOTHING existing. team_id left NULL. Value from UCI sheet else floor=1.
// Field mapping mirrors scripts/import_riders.py. Run with --apply to write; default = dry-run.
import { readFileSync } from "fs";

const APPLY = process.argv.includes("--apply");
const WORLDDB_URL = "https://docs.google.com/spreadsheets/d/1ZwhFqtoXk_4wcImvC9yWvTk3zGlqr4ofT83xzxgsCz8/export?format=csv&gid=0";
const UCI_URL     = "https://docs.google.com/spreadsheets/d/1dE6v2zdmflzToGUHf3pA5mEk5Kn7YI2Wq8WsXbUX0Ic/export?format=csv&gid=0";
const PY = "C:\\Dev\\CyclingZone\\scripts\\import_riders.py";

function loadEnv(p) {
  const o = {};
  for (const l of readFileSync(p, "utf8").split("\n")) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) o[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return o;
}
const env = loadEnv("C:\\Dev\\CyclingZone\\backend\\.env");
const SUPABASE_URL = env.SUPABASE_URL, KEY = env.SUPABASE_SERVICE_KEY;

// REGION_TO_ISO ported live from import_riders.py (single source of truth)
function loadRegionMap() {
  const t = readFileSync(PY, "utf8");
  const s = t.indexOf("REGION_TO_ISO");
  const b = t.indexOf("{", s);
  let d = 0, e = -1;
  for (let i = b; i < t.length; i++) { if (t[i] === "{") d++; else if (t[i] === "}") { d--; if (d === 0) { e = i; break; } } }
  const body = t.slice(b, e + 1).replace(/#[^\n]*/g, "");
  return new Function("return " + body)();
}
const REGION = loadRegionMap();

const STAT_MAP = {
  charac_i_plain: "stat_fl", charac_i_mountain: "stat_bj", charac_i_medium_mountain: "stat_kb",
  charac_i_hill: "stat_bk", charac_i_timetrial: "stat_tt", charac_i_prologue: "stat_prl",
  charac_i_cobble: "stat_bro", charac_i_sprint: "stat_sp", charac_i_acceleration: "stat_acc",
  charac_i_downhilling: "stat_ned", charac_i_endurance: "stat_udh", charac_i_resistance: "stat_mod",
  charac_i_recuperation: "stat_res", charac_i_baroudeur: "stat_ftr",
};

function parseLine(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === "," && !q) { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur); return out;
}
function parseCsv(text) {
  const rows = []; let cur = "", q = false;
  for (const c of text) { if (c === '"') q = !q; if (c === "\n" && !q) { rows.push(cur); cur = ""; } else cur += c; }
  if (cur.trim()) rows.push(cur);
  return rows.filter(r => r.trim()).map(parseLine);
}
function norm(s) {
  return (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .replace(/Ł/g, "L").replace(/Ø/g, "O").replace(/Æ/g, "AE").replace(/ß/g, "SS").replace(/Đ/g, "D")
    .replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
}
async function fetchCsv(u) { const r = await fetch(u, { redirect: "follow" }); if (!r.ok) throw new Error(u + " -> " + r.status); return parseCsv(await r.text()); }

const CUTOFF = 2026 - 25; // born after this year => U25

// ---- load sheets ----
const wdb = await fetchCsv(WORLDDB_URL);
const h = wdb[0];
const ix = n => h.indexOf(n);
const cId = ix("IDcyclist"), cLast = ix("gene_sz_lastname"), cFirst = ix("gene_sz_firstname"),
  cBirth = ix("gene_i_birthdate"), cReg = ix("fkIDregion"), cPop = ix("gene_f_popularity"),
  cSize = ix("gene_i_size"), cWeight = ix("gene_i_weight");
const statIx = Object.fromEntries(Object.entries(STAT_MAP).map(([pc, db]) => [db, ix(pc)]));

const uci = await fetchCsv(UCI_URL);
const uName = uci[0].indexOf("Name"), uPts = uci[0].findIndex(x => /point/i.test(x));
const uciByName = new Map();
for (const r of uci.slice(1)) {
  const n = norm(r[uName]); const p = parseInt((r[uPts] || "").replace(/[^0-9]/g, ""));
  if (n && Number.isFinite(p)) { const k = n.split(" ").sort().join(" "); if (!uciByName.has(k) || uciByName.get(k) < p) uciByName.set(k, p); }
}
const uciFor = (f, l) => uciByName.get(norm(l + " " + f).split(" ").sort().join(" "));

// ---- existing pcm_ids ----
const dbPcm = new Set();
let from = 0; const PAGE = 1000;
while (true) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/riders?select=pcm_id`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Range: `${from}-${from + PAGE - 1}` } });
  const d = await res.json(); if (!Array.isArray(d) || !d.length) break;
  for (const r of d) if (r.pcm_id != null) dbPcm.add(r.pcm_id);
  if (d.length < PAGE) break; from += PAGE;
}

// ---- build records for new riders ----
const toInt = v => { const n = parseInt(v); return Number.isFinite(n) ? n : null; };
const records = [];
for (const r of wdb.slice(1)) {
  const pcm = toInt(r[cId]); if (pcm == null || dbPcm.has(pcm)) continue;
  const first = (r[cFirst] || "").trim(), last = (r[cLast] || "").trim();
  if (!first && !last) continue;
  const bRaw = (r[cBirth] || "").trim();
  let birthdate = null, byear = null;
  if (/^\d{8}$/.test(bRaw)) { birthdate = `${bRaw.slice(0, 4)}-${bRaw.slice(4, 6)}-${bRaw.slice(6, 8)}`; byear = +bRaw.slice(0, 4); }
  const rec = {
    pcm_id: pcm, firstname: first, lastname: last, birthdate,
    nationality_code: REGION[toInt(r[cReg])] ?? null,
    height: toInt(r[cSize]), weight: toInt(r[cWeight]), popularity: toInt(r[cPop]) ?? 0,
    uci_points: uciFor(first, last) ?? 1,
    is_u25: byear != null ? byear > CUTOFF : false,
  };
  for (const [db, idx] of Object.entries(statIx)) { const v = toInt(r[idx]); rec[db] = v && v > 0 ? v : null; }
  records.push(rec);
}

console.log(`Built ${records.length} new-rider records. valued-from-sheet=${records.filter(r => r.uci_points > 1).length} floor=${records.filter(r => r.uci_points === 1).length}`);
console.log("\nSample A:", JSON.stringify(records.find(r => r.uci_points > 1), null, 1));
console.log("\nSample B:", JSON.stringify(records.find(r => r.uci_points === 1), null, 1));

if (!APPLY) { console.log("\n[DRY RUN] no write. Re-run with --apply to insert."); process.exit(0); }

// ---- insert (plain insert; conflicts would error = safety net) ----
let ok = 0;
const B = 200;
for (let i = 0; i < records.length; i += B) {
  const batch = records.slice(i, i + B);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/riders`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(batch),
  });
  if (res.ok) { ok += batch.length; console.log(`batch ${i / B + 1}: inserted ${batch.length}`); }
  else { console.log(`batch ${i / B + 1} FAILED ${res.status}: ${(await res.text()).slice(0, 300)}`); }
}
console.log(`\nDONE inserted=${ok}/${records.length}`);
