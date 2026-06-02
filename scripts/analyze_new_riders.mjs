// One-off analysis: which world-db riders are NOT in CZ (the "not found" from Trin 1)?
// Categorizes not-found into: genuinely new vs potential duplicate (same name, different pcm_id).
// Looks up UCI value from sheet 2 (all rows). Prints ONLY a summary — never secrets.
import { readFileSync } from "fs";

const WORLDDB_URL = "https://docs.google.com/spreadsheets/d/1ZwhFqtoXk_4wcImvC9yWvTk3zGlqr4ofT83xzxgsCz8/export?format=csv&gid=0";
const UCI_URL     = "https://docs.google.com/spreadsheets/d/1dE6v2zdmflzToGUHf3pA5mEk5Kn7YI2Wq8WsXbUX0Ic/export?format=csv&gid=0";

// ---- load creds from main backend/.env (values never logged) ----
function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}
const env = loadEnv("C:\\Dev\\CyclingZone\\backend\\.env");
const SUPABASE_URL = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_KEY;

// ---- minimal CSV line parser (handles double-quote quoting) ----
function parseLine(line) {
  const out = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === "," && !q) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
function parseCsv(text) {
  // split on newlines but respect quoted newlines
  const rows = []; let cur = ""; let q = false;
  for (const c of text) {
    if (c === '"') q = !q;
    if (c === "\n" && !q) { rows.push(cur); cur = ""; }
    else cur += c;
  }
  if (cur.trim()) rows.push(cur);
  return rows.filter(r => r.trim()).map(parseLine);
}
function norm(s) {
  return (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/Ł/g, "L").replace(/Ø/g, "O").replace(/Æ/g, "AE")
    .replace(/ß/g, "SS").replace(/Đ/g, "D").replace(/[^A-Z ]/g, " ")
    .replace(/\s+/g, " ").trim();
}

async function fetchCsv(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return parseCsv(await res.text());
}

// ---- 1. world-db ----
const wdb = await fetchCsv(WORLDDB_URL);
const wh = wdb[0];
const cId = wh.indexOf("IDcyclist");
const cLast = wh.indexOf("gene_sz_lastname");
const cFirst = wh.indexOf("gene_sz_firstname");
const cBirth = wh.indexOf("gene_i_birthdate");
const sheetRiders = wdb.slice(1).map(r => ({
  pcm_id: parseInt(r[cId]),
  first: (r[cFirst] || "").trim(),
  last: (r[cLast] || "").trim(),
  birth: (r[cBirth] || "").trim(),
})).filter(r => Number.isInteger(r.pcm_id));

// ---- 2. UCI value sheet (all rows) ----
const uci = await fetchCsv(UCI_URL);
const uh = uci[0];
const uName = uh.indexOf("Name");
const uPts = uh.findIndex(h => /point/i.test(h));
const uciByName = new Map();
for (const r of uci.slice(1)) {
  const n = norm(r[uName]);
  const p = parseInt((r[uPts] || "").replace(/[^0-9]/g, ""));
  if (n && Number.isFinite(p)) {
    const tok = n.split(" ").sort().join(" ");
    if (!uciByName.has(tok) || uciByName.get(tok) < p) uciByName.set(tok, p);
  }
}
function uciFor(first, last) {
  const tok = norm(last + " " + first).split(" ").sort().join(" ");
  return uciByName.get(tok);
}

// ---- 3. DB riders (REST, paginated) ----
const dbByPcm = new Set();
const dbByName = new Map(); // normName -> [pcm_id...]
let from = 0; const PAGE = 1000;
while (true) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/riders?select=pcm_id,firstname,lastname`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Range: `${from}-${from + PAGE - 1}` },
  });
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) break;
  for (const r of data) {
    if (r.pcm_id != null) dbByPcm.add(r.pcm_id);
    const n = norm((r.lastname || "") + " " + (r.firstname || ""));
    const tok = n.split(" ").sort().join(" ");
    if (!dbByName.has(tok)) dbByName.set(tok, []);
    dbByName.get(tok).push(r.pcm_id);
  }
  if (data.length < PAGE) break;
  from += PAGE;
}

// ---- 4. diff + categorize ----
const notFound = sheetRiders.filter(r => !dbByPcm.has(r.pcm_id));
const blankName = notFound.filter(r => !r.first && !r.last);
const named = notFound.filter(r => r.first || r.last);
const potentialDup = [], genuinelyNew = [];
for (const r of named) {
  const tok = norm(r.last + " " + r.first).split(" ").sort().join(" ");
  if (dbByName.has(tok)) potentialDup.push({ ...r, existingPcm: dbByName.get(tok) });
  else genuinelyNew.push(r);
}
const newWithValue = genuinelyNew.filter(r => uciFor(r.first, r.last) != null);
const newNoValue = genuinelyNew.filter(r => uciFor(r.first, r.last) == null);

console.log("===== SUMMARY =====");
console.log("world-db rows:", sheetRiders.length);
console.log("DB riders w/ pcm_id:", dbByPcm.size);
console.log("UCI sheet rows:", uci.length - 1);
console.log("NOT FOUND (in sheet, not in DB):", notFound.length);
console.log("  - blank-name rows:", blankName.length);
console.log("  - named:", named.length);
console.log("    * potential duplicate (same name exists, diff pcm_id):", potentialDup.length);
console.log("    * genuinely new:", genuinelyNew.length);
console.log("        with UCI value:", newWithValue.length, " | no UCI value (would be floor):", newNoValue.length);

console.log("\n--- potential duplicates (up to 30) ---");
for (const r of potentialDup.slice(0, 30))
  console.log(`pcm ${r.pcm_id}  ${r.first} ${r.last}  (DB has same name as pcm_id ${r.existingPcm.join(",")})`);

console.log("\n--- genuinely new WITH value (top 40 by value) ---");
newWithValue.map(r => ({ ...r, v: uciFor(r.first, r.last) })).sort((a, b) => b.v - a.v).slice(0, 40)
  .forEach(r => console.log(`pcm ${r.pcm_id}  ${r.first} ${r.last}  UCI=${r.v}`));

console.log("\n--- genuinely new WITHOUT value (up to 30) ---");
for (const r of newNoValue.slice(0, 30))
  console.log(`pcm ${r.pcm_id}  ${r.first} ${r.last}  birth=${r.birth}`);
