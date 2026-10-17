// Tests for format-guarden mod hardcodede tal/dato/valuta-formater, Refs #6785.
// Koer: node --test scripts/i18n-check-hardcoded-formats.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  scanSource,
  isExemptPath,
  stripComments,
  compareAgainstBaseline,
  countsOf,
  totalOf,
  scanFrontend,
  FORMATTER_FILES,
} from "./i18n-check-hardcoded-formats.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const rules = (src, rel = "frontend/src/pages/X.jsx") => scanSource(src, rel).map((f) => f.rule);

test("locale-literal: fast locale i toLocaleString/Intl fanges", () => {
  assert.deepEqual(rules('const a = n.toLocaleString("da-DK");'), ["locale-literal"]);
  assert.deepEqual(rules('const a = new Intl.NumberFormat("en-US").format(n);'), ["locale-literal"]);
  assert.deepEqual(rules('d.toLocaleDateString("en-GB", { day: "numeric" })'), ["locale-literal"]);
  assert.deepEqual(rules('new Intl.DateTimeFormat("de-DE", {}).format(d)'), ["locale-literal"]);
});

test("locale-literal: da/en-ternary og fallback fanges", () => {
  assert.deepEqual(rules('const l = isDa ? "da-DK" : "en-GB";'), ["locale-literal"]);
  assert.deepEqual(rules('return locale || i18n.language || "da-DK";'), ["locale-literal"]);
});

test("locale-literal: bar sprogkode i Intl-kald fanges", () => {
  assert.deepEqual(rules('n.toLocaleString("da")'), ["locale-literal"]);
  assert.deepEqual(rules('new Intl.NumberFormat("fr").format(n)'), ["locale-literal"]);
});

test("locale-literal: locale paa naeste linje i et flerlinjet kald fanges (en gang)", () => {
  const src = 'const f = new Intl.NumberFormat(\n  "da-DK",\n  { maximumFractionDigits: 1 },\n).format(n);';
  const found = scanSource(src, "frontend/src/pages/X.jsx");
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, "locale-literal");
  assert.equal(found[0].line, 1);
  assert.equal(scanSource('d.toLocaleDateString(\n  "en-GB",\n)', "frontend/src/pages/X.jsx").length, 1);
  assert.equal(scanSource('d.toLocaleString(\r\n  "da"\r\n)', "frontend/src/pages/X.jsx").length, 1);
  // ISO-trick og dynamisk locale paa naeste linje er stadig fint.
  assert.equal(scanSource('new Intl.DateTimeFormat(\n  "en-CA",\n  { timeZone },\n)', "frontend/src/pages/X.jsx").length, 0);
  assert.equal(scanSource("new Intl.NumberFormat(\n  locale,\n)", "frontend/src/pages/X.jsx").length, 0);
});

test("locale-literal: dynamisk locale er fint", () => {
  assert.deepEqual(rules("n.toLocaleString(locale)"), []);
  assert.deepEqual(rules("new Intl.DateTimeFormat(intlLocale(language), opts).format(d)"), []);
  assert.deepEqual(rules("const loc = intlLocale(lang, { en: 'en-US' });"), []);
});

test("locale-literal: sprogkode som konstant og prosa er ikke formatering", () => {
  assert.deepEqual(rules('export const PSEUDO_LANG = "en-XA";'), []);
  assert.deepEqual(rules('"body": "Pseudo-locale `en-XA` aktiveres"'), []);
});

test("locale-literal: en-CA og sv-SE er ISO-trick til tidszone-noegler", () => {
  assert.deepEqual(rules('new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric" })'), []);
  assert.deepEqual(rules('d.toLocaleString("sv-SE", { timeZone })'), []);
});

test("locale-default: toLocale*String() uden argument fanges", () => {
  assert.deepEqual(rules("d.toLocaleString()"), ["locale-default"]);
  assert.deepEqual(rules("d.toLocaleTimeString()"), ["locale-default"]);
  assert.deepEqual(rules("d.toLocaleDateString()"), ["locale-default"]);
});

test("thousands-regex: haandskrevet tusindtalsseparator fanges", () => {
  assert.deepEqual(rules('s.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ".")'), ["thousands-regex"]);
});

test("decimal-comma: toFixed(...).replace('.', ',') fanges", () => {
  assert.deepEqual(rules('return n.toFixed(digits).replace(".", ",");'), ["decimal-comma"]);
  assert.deepEqual(rules("return n.toFixed(1).replace('.', ',');"), ["decimal-comma"]);
});

test("percent-toFixed: toFixed lige foer % fanges i JSX, skabelon og concat", () => {
  assert.deepEqual(rules("<td>{(r * 100).toFixed(1)}%</td>"), ["percent-toFixed"]);
  assert.deepEqual(rules("return `${(r * 100).toFixed(0)}%`;"), ["percent-toFixed"]);
  assert.deepEqual(rules('return v.toFixed(2) + "%";'), ["percent-toFixed"]);
});

test("display-toFixed: tekstvisning fanges, SVG-geometri og afrunding gør ikke", () => {
  assert.deepEqual(rules("const label = (m / 1000).toFixed(1);"), ["display-toFixed"]);
  assert.deepEqual(rules("<p>×{modifier.toFixed(2)}</p>"), ["display-toFixed"]);
  // SVG
  assert.deepEqual(rules("<circle cx={xAt(i).toFixed(1)} cy={yAt(v).toFixed(1)} r=\"2\" />"), []);
  assert.deepEqual(rules("const pts = a.map((p) => `${x(p).toFixed(1)},${y(p).toFixed(1)}`).join(\" \");"), []);
  assert.deepEqual(rules("pts.push(`L100,${(30 - h).toFixed(2)}`);"), []);
  // afrunding til tal
  assert.deepEqual(rules("const kms = a.map((_, i) => Math.min(D, +(i * step).toFixed(3)));"), []);
});

test("en linje taeller kun een gang selv om flere regler rammer", () => {
  const found = scanSource('return `${n.toLocaleString("da-DK")} ${(r * 100).toFixed(1)}%`;', "frontend/src/pages/X.jsx");
  assert.equal(found.length, 1);
});

test("kommentarer taeller ikke", () => {
  assert.deepEqual(rules('// d.toLocaleString("da-DK")\nconst a = 1;'), []);
  assert.deepEqual(rules('/* new Intl.NumberFormat("da-DK") */\nconst a = 1;'), []);
  // Linjenumre bevares efter blok-kommentar.
  const found = scanSource('/* a\nb */\nd.toLocaleString("da-DK")', "frontend/src/pages/X.jsx");
  assert.equal(found[0].line, 3);
  assert.equal(stripComments("a // b").trim(), "a");
});

test("formatter-filerne er undtaget, resten af lib/ er ikke", () => {
  const src = 'new Intl.DateTimeFormat("en-GB", {}).format(d)';
  for (const f of FORMATTER_FILES) assert.deepEqual(scanSource(src, f), []);
  assert.equal(scanSource(src, "frontend/src/lib/other.js").length, 1);
});

test("isExemptPath: admin- og preview-flader er undtaget, spillerflader er ikke", () => {
  assert.equal(isExemptPath("frontend/src/pages/admin/AdminEconomyTab.jsx"), true);
  assert.equal(isExemptPath("frontend/src/components/admin/growth/GrowthNpsTab.jsx"), true);
  assert.equal(isExemptPath("frontend/src/pages/AdminFairplayPage.jsx"), true);
  assert.equal(isExemptPath("frontend/src/pages/adminValueTransitionShape.js"), true);
  assert.equal(isExemptPath("frontend/src/lib/roadmapAdminModel.ts"), true);
  assert.equal(isExemptPath("frontend/src/preview/installPreviewMock.js"), true);
  assert.equal(isExemptPath("frontend/src/pages/FinancePage.jsx"), false);
  assert.equal(isExemptPath("frontend/src/lib/intl.js"), false);
});

test("compareAgainstBaseline: vækst og nye filer fejler, fald er stale", () => {
  const baseline = { "a.js": 2, "b.js": 1 };
  assert.deepEqual(compareAgainstBaseline({ "a.js": 2, "b.js": 1 }, baseline), { grown: [], stale: [] });
  const grown = compareAgainstBaseline({ "a.js": 3, "b.js": 1 }, baseline);
  assert.deepEqual(grown.grown, [{ file: "a.js", count: 3, allowed: 2 }]);
  const fresh = compareAgainstBaseline({ "a.js": 2, "b.js": 1, "c.js": 1 }, baseline);
  assert.deepEqual(fresh.grown, [{ file: "c.js", count: 1, allowed: 0 }]);
  const shrunk = compareAgainstBaseline({ "a.js": 1 }, baseline);
  assert.deepEqual(shrunk.grown, []);
  assert.deepEqual(shrunk.stale, [
    { file: "a.js", current: 1, allowed: 2 },
    { file: "b.js", current: 0, allowed: 1 },
  ]);
});

test("countsOf og totalOf summerer fund pr. fil", () => {
  const counts = countsOf({ "b.js": [{}, {}], "a.js": [{}] });
  assert.deepEqual(Object.keys(counts), ["a.js", "b.js"]);
  assert.equal(totalOf(counts), 3);
});

test("repoet: ingen fil overskrider baselinen (samme tjek som CI)", () => {
  const baseline = JSON.parse(readFileSync(join(ROOT, "scripts", "i18n-hardcoded-formats-baseline.json"), "utf8"));
  const counts = countsOf(scanFrontend());
  const { grown } = compareAgainstBaseline(counts, baseline.files);
  assert.deepEqual(grown, []);
  assert.ok(totalOf(counts) <= baseline.total, "baseline.total maa kun skrumpe");
});

test("repoet: baselinen indeholder ingen undtagne eller manglende filer", () => {
  const baseline = JSON.parse(readFileSync(join(ROOT, "scripts", "i18n-hardcoded-formats-baseline.json"), "utf8"));
  for (const file of Object.keys(baseline.files)) {
    assert.equal(isExemptPath(file), false, `${file} er undtaget og skal ikke i baselinen`);
    assert.ok(readFileSync(join(ROOT, file), "utf8").length > 0, `${file} findes ikke`);
  }
});
