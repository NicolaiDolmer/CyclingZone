// Deterministisk bundle-size-gate til CI (perf/SEO-loop Del 2, omlagt i #6165).
//
// Maaler det en spiller faktisk henter, ikke summen af al JS i appen:
//   1. FOERSTE INDLAESNING (hard): entry + dens modulepreloads laest ud af den
//      byggede dist/index.html (buildets egne data), gzip, plus det stoerste
//      valgfri sprog-stykke (worst case; #7170). Loft: first_load_gzip_kb.
//   2. HVERT LAZY-STYKKE for sig (hard): alle andre JS-stykker uden for
//      foerste indlaesning. Loft: lazy_chunk_gzip_kb, med navngivne undtagelser
//      i lazy_chunk_overrides (stykke-navn uden hash -> KB). Admin-stykker kan
//      faa en undtagelse dér; de skjuler sig ikke i en total laengere.
//   3. TOTALEN er kun en TREND (total_gzip_kb er referencen): udskrives med
//      afvigelse, men fejler aldrig.
// Alle lofter faar margin_pct oveni. Lighthouse-scores er en separat ADVISORY;
// gzipped bytes er deterministiske og egner sig til en hard gate.
//
// Brug: `node scripts/check-bundle-budget.mjs` (kraever at `npm run build` er
// koert i frontend/ foerst). Exit-koder: 0 = inden for budget, 1 = overskredet,
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

// #7170: English is statically loaded as the shared fallback. A player also
// loads at most one optional language, so count the largest such chunk,
// regardless of its beta status. All non-language JS remains in the budget.
const optionalChunkLang = (file) => {
  const match = /^i18n-messages-([a-z]{2,3})-/.exec(file);
  return match && match[1] !== "en" ? match[1] : null;
};

const all = files
  .map((f) => ({ file: f, kb: gzipKB(readFileSync(join(assetsDir, f))) }))
  .sort((a, b) => b.kb - a.kb);
const optionalChunks = all.filter((x) => optionalChunkLang(x.file));
const largestLocale = optionalChunks[0];
const sizes = all.filter((x) => !optionalChunkLang(x.file) || x === largestLocale);

const budget = JSON.parse(readFileSync(budgetPath, "utf8"));
const marginPct = budget.margin_pct ?? 0;
const withMargin = (kb) => kb * (1 + marginPct / 100);

// Foerste indlaesning: det buildet selv skriver i index.html (entry-script +
// modulepreload). Ingen gaet paa kaede-opbygningen.
let indexHtml;
try {
  indexHtml = readFileSync(join(root, "frontend", "dist", "index.html"), "utf8");
} catch {
  console.error("❌ Kan ikke læse frontend/dist/index.html — kør `npm run build` i frontend/ først.");
  process.exit(2);
}
const firstLoadFiles = new Set();
for (const [tag] of indexHtml.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
  const isEntry = /\btype=["']module["']/i.test(tag);
  const isPreload = /\brel=["']modulepreload["']/i.test(tag);
  const url = /\b(?:src|href)=["']\/assets\/([^"']+\.js)["']/i.exec(tag);
  if (url && (isEntry || isPreload)) firstLoadFiles.add(url[1]);
}
if (firstLoadFiles.size === 0) {
  console.error("❌ Ingen entry/modulepreload-JS fundet i frontend/dist/index.html — kan ikke måle første indlæsning.");
  process.exit(2);
}

const byFile = new Map(all.map((x) => [x.file, x]));
const firstLoad = [...firstLoadFiles].map((f) => byFile.get(f)).filter(Boolean).sort((a, b) => b.kb - a.kb);
const firstLoadOptional = firstLoad.filter((x) => optionalChunkLang(x.file));
const firstLoadKB =
  firstLoad.filter((x) => !optionalChunkLang(x.file)).reduce((s, x) => s + x.kb, 0) +
  // Worst case: spilleren henter det stoerste valgfri sprog ovenpaa engelsk.
  (largestLocale ? largestLocale.kb : 0);
const firstLoadLimit = withMargin(budget.first_load_gzip_kb);

// Lazy-stykker: alt uden for foerste indlaesning og uden for sprog-stykkerne
// (de er allerede talt med i foerste indlaesning som worst case).
const chunkName = (file) => file.replace(/-[A-Za-z0-9_-]{8}\.js$/, "");
const lazy = all.filter((x) => !firstLoadFiles.has(x.file) && !optionalChunkLang(x.file));
const overrides = budget.lazy_chunk_overrides ?? {};
const lazyLimit = (file) => withMargin(overrides[chunkName(file)] ?? budget.lazy_chunk_gzip_kb);
const lazyOver = lazy.filter((x) => x.kb > lazyLimit(x.file));

console.log("Første indlæsning (entry + modulepreload, gzip):");
for (const { file, kb } of firstLoad.filter((x) => !optionalChunkLang(x.file)).slice(0, 5)) {
  console.log(`  ${kb.toFixed(1).padStart(7)} KB  ${file}`);
}
if (largestLocale) {
  console.log(`  ${largestLocale.kb.toFixed(1).padStart(7)} KB  ${largestLocale.file}  (største valgfri sprog: ${optionalChunkLang(largestLocale.file)}; worst case)`);
}
console.log(
  `  Første indlæsning: ${firstLoadKB.toFixed(1)} KB ` +
    `(budget ${budget.first_load_gzip_kb} KB + ${marginPct}% margin = ${firstLoadLimit.toFixed(1)} KB loft)`
);
console.log("\nStørste lazy-stykker (hver for sig):");
for (const { file, kb } of lazy.slice(0, 5)) {
  console.log(`  ${kb.toFixed(1).padStart(7)} KB  ${file}  (loft ${lazyLimit(file).toFixed(1)} KB)`);
}
const totalKB = sizes.reduce((s, x) => s + x.kb, 0);
const trendPct = budget.total_gzip_kb ? ((totalKB / budget.total_gzip_kb) - 1) * 100 : 0;
console.log(
  `\nTrend (ikke en port): total gzipped JS ${totalKB.toFixed(1)} KB, ${sizes.length} JS-chunks ` +
    `(reference ${budget.total_gzip_kb} KB, ${trendPct >= 0 ? "+" : ""}${trendPct.toFixed(1)}%)`
);

let failed = false;
if (firstLoadKB > firstLoadLimit) {
  failed = true;
  const top = firstLoad.filter((x) => !optionalChunkLang(x.file)).slice(0, 3).map((x) => `${x.file} ${x.kb.toFixed(1)} KB`).join(", ");
  console.error(
    `\n❌ Første indlæsning er ${firstLoadKB.toFixed(1)} KB, ${(firstLoadKB - firstLoadLimit).toFixed(1)} KB over loftet ` +
      `${firstLoadLimit.toFixed(1)} KB. Tungeste dele: ${top}.\n` +
      `   Flyt vægten ud af entry/modulepreload (lazy-load), ELLER hæv \`first_load_gzip_kb\` — kun med ejerens ja.`
  );
}
for (const { file, kb } of lazyOver) {
  failed = true;
  console.error(
    `\n❌ Stykket ${chunkName(file)} (${file}) er ${kb.toFixed(1)} KB, ${(kb - lazyLimit(file)).toFixed(1)} KB over loftet ` +
      `${lazyLimit(file).toFixed(1)} KB.\n` +
      `   Del stykket op, ELLER tilføj en begrundet undtagelse i \`lazy_chunk_overrides\` i frontend/bundle-budget.json.`
  );
}
if (failed) process.exit(1);

console.log("\n✅ Inden for budget.");
