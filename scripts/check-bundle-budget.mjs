#!/usr/bin/env node
// Deterministisk bundle-size-gate til CI (perf/SEO-loop Del 2).
//
// Læser frontend/dist/assets/*.js, måler GZIPPED størrelse, summerer, og
// sammenligner total mod frontend/bundle-budget.json (+ margin). Hard fail
// (exit 1) hvis total overstiger loftet — fanger "denne PR gjorde frontend
// tungere" FØR merge. Lighthouse-scores er bevidst en separat ADVISORY (de
// svinger på CI-hardware); gzipped bytes er deterministiske og egner sig til
// en hard gate, jf. world-class-performance-architecture-spec §5.
//
// Brug: `node scripts/check-bundle-budget.mjs` (kræver at `npm run build` er
// kørt i frontend/ først). Exit-koder: 0 = inden for budget, 1 = overskredet,
// 2 = build-output mangler.
import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = join(root, "frontend", "dist", "assets");
const budgetPath = join(root, "frontend", "bundle-budget.json");

const gzipKB = (buf) => gzipSync(buf, { level: 9 }).length / 1024;

let files;
try {
  files = readdirSync(assetsDir).filter((f) => f.endsWith(".js"));
} catch {
  console.error(`❌ Kan ikke læse ${assetsDir} — kør \`npm run build\` i frontend/ først.`);
  process.exit(2);
}

const sizes = files
  .map((f) => ({ file: f, kb: gzipKB(readFileSync(join(assetsDir, f))) }))
  .sort((a, b) => b.kb - a.kb);

const totalKB = sizes.reduce((s, x) => s + x.kb, 0);

const budget = JSON.parse(readFileSync(budgetPath, "utf8"));
const marginPct = budget.margin_pct ?? 0;
const limitKB = budget.total_gzip_kb * (1 + marginPct / 100);

console.log("Bundle gzipped JS (top 8 chunks):");
for (const { file, kb } of sizes.slice(0, 8)) {
  console.log(`  ${kb.toFixed(1).padStart(7)} KB  ${file}`);
}
console.log(`  (… ${sizes.length} JS-chunks i alt)`);
console.log(
  `\nTotal gzipped JS: ${totalKB.toFixed(1)} KB  ` +
    `(budget ${budget.total_gzip_kb} KB + ${marginPct}% margin = ${limitKB.toFixed(1)} KB loft)`
);

if (totalKB > limitKB) {
  console.error(
    `\n❌ Bundle-budget overskredet med ${(totalKB - limitKB).toFixed(1)} KB.\n` +
      `   Trim/lazy-load den nye vægt, ELLER hæv \`total_gzip_kb\` i\n` +
      `   frontend/bundle-budget.json bevidst (med begrundelse i PR-body).`
  );
  process.exit(1);
}

console.log("\n✅ Inden for budget.");
