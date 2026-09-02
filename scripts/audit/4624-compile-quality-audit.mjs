// #4624 — samler dommer-filerne (fable + a + b), metrics og trafik til
// tabellen + moenster-optaellingen i docs/audits/design-quality-audit-2026-09.md.
// Read-only over input; skriver KUN <out>. Koer fra repo-roden:
//   node scripts/audit/4624-compile-quality-audit.mjs [outPath]
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const A = resolve(root, "docs/audits");
const read = (f) => JSON.parse(readFileSync(resolve(A, f), "utf8"));

const judgements = [
  ...read("quality-audit-2026-09-judgements-fable.json"),
  ...read("quality-audit-2026-09-judgements-a.json"),
  ...read("quality-audit-2026-09-judgements-b.json"),
];
const metrics = read("quality-audit-2026-09-metrics.json");
const traffic = read("quality-audit-2026-09-traffic.json").sessions;

const metricsByRoute = new Map();
for (const m of Array.isArray(metrics) ? metrics : metrics.pages ?? Object.values(metrics)) {
  if (m && m.route) metricsByRoute.set(m.route, m);
}

// Normaliseret score: "ikke relevant" taeller hverken for eller imod; q2/q7/q8/q13
// vejer dobbelt (TASTE §4). Skaleres til /21 saa sider kan sammenlignes. Tyndt
// grundlag (< 8 vaegtede spoergsmaal) markeres med *.
const DOUBLE = new Set(["q2", "q7", "q8", "q13"]);
function normalizedScore(j) {
  const c = j.checklist;
  if (!c || typeof c !== "object") return { score: typeof j.score === "number" ? j.score : null, thin: false };
  let ja = 0, applicable = 0;
  for (const [q, v] of Object.entries(c)) {
    const s = String(typeof v === "string" ? v : v?.svar ?? "").trim().toLowerCase();
    const w = DOUBLE.has(q) ? 2 : 1;
    if (s.startsWith("ja")) { ja += w; applicable += w; }
    else if (s.startsWith("nej")) { applicable += w; }
  }
  if (applicable === 0) return { score: null, thin: false };
  return { score: Math.round((21 * ja) / applicable), thin: applicable < 8 };
}

const rows = judgements.map((j) => {
  const m = metricsByRoute.get(j.route) ?? {};
  const sessions = traffic[j.route] ?? 0;
  const { score, thin } = normalizedScore(j);
  j.thin = thin;
  const missing = score === null ? 0 : 21 - score;
  return {
    route: j.route,
    template: j.template ?? m.template ?? "?",
    sessions,
    score,
    thin,
    band: score === null ? "ikke doemt" : score >= 20 ? "verdensklasse-kandidat" : score >= 16 ? "paa system, mangler smag" : "skal have en runde",
    severity: j.severity ?? 0,
    patternTag: score === null ? "ikke-doemt" : (j.patternTag ?? "andet"),
    mainFinding: (j.mainFinding ?? "").replace(/\|/g, "/"),
    chrome: m.chromeBeforeDataPx ?? m.chrome ?? null,
    rank: missing * Math.max(sessions, 50),
  };
});

rows.sort((x, y) => y.rank - x.rank || y.sessions - x.sessions);

const fmt = (n) => (n === null || n === undefined ? "–" : String(n));
const lines = [];
lines.push("| # | Side | Skabelon | Trafik (30 d) | Score /21 | Bånd | Alvor | Mønster | Hovedfund |");
lines.push("|---|---|---|---|---|---|---|---|---|");
rows.forEach((r, i) => {
  lines.push(
    `| ${i + 1} | \`${r.route}\` | ${r.template} | ${r.sessions || "<50"} | ${fmt(r.score)}${r.thin ? "*" : ""} | ${r.band} | ${r.severity || "–"} | ${r.patternTag} | ${r.mainFinding} |`
  );
});

const counts = new Map();
for (const r of rows) counts.set(r.patternTag, (counts.get(r.patternTag) ?? 0) + 1);
const countLines = [...counts.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([tag, n]) => `| ${tag} | ${n} |`);

const judged = rows.filter((r) => r.score !== null);
const avg = judged.length ? (judged.reduce((s, r) => s + r.score, 0) / judged.length).toFixed(1) : "–";
const bands = { wc: 0, sys: 0, runde: 0 };
for (const r of judged) {
  if (r.score >= 20) bands.wc++;
  else if (r.score >= 16) bands.sys++;
  else bands.runde++;
}

const out = [
  `<!-- GENERERET af scripts/audit/4624-compile-quality-audit.mjs ${new Date().toISOString().slice(0, 10)} -->`,
  "",
  `**Doemt:** ${judged.length} af ${rows.length} sider (resten: mock-begraensning). **Gennemsnit:** ${avg}/21. **Baand:** ${bands.wc} verdensklasse-kandidater · ${bands.sys} paa system, mangler smag · ${bands.runde} skal have en runde.`,
  "",
  "Rangering = (manglende point) × (sessioner pr. 30 dage, min. 50). Den mest sete side med det stoerste hul staar oeverst.",
  "",
  ...lines,
  "",
  "### Moenster-optaelling (hovedfund pr. side)",
  "",
  "| Moenster | Sider |",
  "|---|---|",
  ...countLines,
  "",
];

const outPath = resolve(root, process.argv[2] ?? "docs/audits/design-quality-audit-2026-09-table.md");
writeFileSync(outPath, out.join("\n"), "utf8");
console.log(`[4624] ${rows.length} raekker (${judged.length} doemt) -> ${outPath}`);
