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
  isIsoKeyUse,
  canonicalLocaleTag,
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
  assert.deepEqual(rules('new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })'), []);
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

test("#6785 (Codex): ISO-undtagelsen gælder kun numeriske dato-nøgler", async () => {
  const { isIsoKeyUse, scanSource } = await import("./i18n-check-hardcoded-formats.mjs");
  assert.equal(isIsoKeyUse('const key = d.toLocaleDateString("en-CA");'), true);
  assert.equal(isIsoKeyUse('new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" })'), true);
  assert.equal(isIsoKeyUse('d.toLocaleDateString("en-CA", { month: "long" })'), false);
  assert.equal(isIsoKeyUse('new Intl.NumberFormat("en-CA")'), false);
  assert.ok(scanSource('const s = d.toLocaleDateString("en-CA", { month: "long" });', "x.jsx").length > 0);
  assert.equal(scanSource('const key = d.toLocaleDateString("en-CA");', "x.jsx").length, 0);
});

test("#6785 (Codex): ratchet på fingeraftryk fanger et ombyttet fund i samme fil", async () => {
  const { compareFingerprints, fingerprintOf } = await import("./i18n-check-hardcoded-formats.mjs");
  const old = { rule: "display-toFixed", text: "a.toFixed(1)" };
  const swapped = { rule: "display-toFixed", text: "b.toFixed(2)" };
  const base = { "f.jsx": [fingerprintOf(old)] };
  assert.deepEqual(compareFingerprints({ "f.jsx": [old] }, base), { grown: [], stale: [] });
  const r = compareFingerprints({ "f.jsx": [swapped] }, base);
  assert.equal(r.grown.length, 1, "samme antal, men et nyt fund");
  assert.deepEqual(r.grown[0].fresh, [fingerprintOf(swapped)]);
  assert.equal(compareFingerprints({}, base).stale.length, 1);
  // gammelt talformat i baseline virker stadig
  assert.equal(compareFingerprints({ "g.jsx": [old, old] }, { "g.jsx": 1 }).grown.length, 1);
});

test("#6785: sv-SE + timeZone i toLocaleString er stadig et ISO-trick; tal er ikke", async () => {
  const { isIsoKeyUse } = await import("./i18n-check-hardcoded-formats.mjs");
  assert.equal(isIsoKeyUse('d.toLocaleString("sv-SE", { timeZone: GAME_TIMEZONE })'), true);
  assert.equal(isIsoKeyUse('n.toLocaleString("en-CA")'), false);
});

const FULL_KEY = 'year: "numeric", month: "2-digit", day: "2-digit"';

test("#6797: rene tidsformatere med ISO-locale er visning og fanges", () => {
  assert.deepEqual(rules('new Intl.DateTimeFormat("en-CA", { timeStyle: "short" }).format(d)'), ["locale-literal"]);
  assert.deepEqual(rules('new Intl.DateTimeFormat("en-CA", { timeZone, hour: "2-digit", minute: "2-digit" }).format(d)'), ["locale-literal"]);
  assert.deepEqual(rules('d.toLocaleString("sv-SE", { hour: "2-digit", minute: "2-digit" })'), ["locale-literal"]);
  assert.deepEqual(rules('d.toLocaleDateString("en-CA", { timeStyle: "short" })'), ["locale-literal"]);
  // timeStyle fanges ogsaa sammen med en kort dateStyle
  assert.deepEqual(rules('new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "short" })'), ["locale-literal"]);
  // dato + klokkeslaet i en fuld numerisk noegle (formatToParts) er stadig tricket
  assert.deepEqual(rules(`new Intl.DateTimeFormat("en-CA", { timeZone, ${FULL_KEY}, hour: "2-digit", minute: "2-digit" })`), []);
});

test("#6797: ISO-undtagelsen kraever fuld numerisk dato-noegle", () => {
  assert.equal(isIsoKeyUse(`new Intl.DateTimeFormat("en-CA", { timeZone, ${FULL_KEY} })`), true);
  // standardformen (ingen dato-felter) er allerede den fulde numeriske dato
  assert.equal(isIsoKeyUse('d.toLocaleDateString("en-CA")'), true);
  assert.equal(isIsoKeyUse('new Intl.DateTimeFormat("sv-SE", { timeZone })'), true);
  // delvise datoer er ikke en noegle
  assert.equal(isIsoKeyUse('new Intl.DateTimeFormat("en-CA", { year: "numeric" })'), false);
  assert.equal(isIsoKeyUse('new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit" })'), false);
  assert.equal(isIsoKeyUse('new Intl.DateTimeFormat("en-CA", { day: "numeric" })'), false);
  // tids-only
  assert.equal(isIsoKeyUse('new Intl.DateTimeFormat("en-CA", { hour: "2-digit" })'), false);
  assert.equal(isIsoKeyUse('new Intl.DateTimeFormat("en-CA", { timeStyle: "medium" })'), false);
  assert.equal(isIsoKeyUse('d.toLocaleString("sv-SE", { hour: "2-digit" })'), false);
  // tekstuel maaned i en ellers fuld noegle
  assert.equal(isIsoKeyUse('new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "long", day: "numeric" })'), false);
});

test("#6797: options paa efterfoelgende linjer ses (flerlinjet kald)", () => {
  const file = "frontend/src/pages/X.jsx";
  const full = `new Intl.DateTimeFormat("en-CA", {\n  timeZone,\n  ${FULL_KEY},\n}).format(d)`;
  assert.equal(scanSource(full, file).length, 0);
  const timeOnly = 'new Intl.DateTimeFormat("en-CA", {\n  timeZone,\n  hour: "2-digit",\n  minute: "2-digit",\n}).format(d)';
  const found = scanSource(timeOnly, file);
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 1);
  const partial = 'new Intl.DateTimeFormat("en-CA", {\n  timeZone,\n  year: "numeric",\n}).format(d)';
  assert.equal(scanSource(partial, file).length, 1);
  // locale paa naeste linje og options laengere nede
  const nextLine = 'new Intl.DateTimeFormat(\n  "en-CA",\n  { timeStyle: "short" },\n).format(d)';
  assert.equal(scanSource(nextLine, file).length, 1);
  const nextLineOk = `new Intl.DateTimeFormat(\n  "en-CA",\n  { timeZone, ${FULL_KEY} },\n).format(d)`;
  assert.equal(scanSource(nextLineOk, file).length, 0);
  // et senere, urelateret kald paa en anden linje gør ikke en fuld noegle til fund
  const later = `const k = d.toLocaleDateString("en-CA");\nconst t = d.toLocaleTimeString(locale, { hour: "2-digit" });`;
  assert.equal(scanSource(later, file).length, 0);
});

test("#6797: det rigtige Intl-kald paa en linje afgoer ISO-tjekket", () => {
  const file = "frontend/src/pages/X.jsx";
  // tal-formatering foer dato-noeglen paa samme linje goer ikke noeglen til visning
  assert.equal(scanSource('const s = `${new Intl.NumberFormat(locale).format(n)} ${d.toLocaleDateString("en-CA")}`;', file).length, 0);
  // omvendt: en tids-formatering efter en gyldig noegle fanges stadig
  assert.equal(scanSource('const s = `${d.toLocaleDateString("en-CA")} ${d.toLocaleString("sv-SE", { hour: "2-digit" })}`;', file).length, 1);
});

test("#6797: locale-tags matches case-ufoelsomt", () => {
  assert.deepEqual(rules('d.toLocaleDateString("en-gb", { day: "numeric" })'), ["locale-literal"]);
  assert.deepEqual(rules('n.toLocaleString("DA-dk")'), ["locale-literal"]);
  assert.deepEqual(rules('new Intl.NumberFormat("en-us").format(n)'), ["locale-literal"]);
  assert.deepEqual(rules('const l = isDa ? "da-dk" : "en-gb";'), ["locale-literal"]);
  assert.deepEqual(rules('return locale || i18n.language || "de-de";'), ["locale-literal"]);
  assert.equal(scanSource('d.toLocaleDateString(\n  "en-gb",\n)', "frontend/src/pages/X.jsx").length, 1);
  // dynamisk locale og prosa uden Intl-kald er stadig fint
  assert.deepEqual(rules("n.toLocaleString(locale)"), []);
  assert.deepEqual(rules('export const PSEUDO_LANG = "en-xa";'), []);
});

test("#6797: ISO-tricket normaliseres foer tjekket, saa en-ca/SV-se er det samme som en-CA/sv-SE", () => {
  assert.equal(canonicalLocaleTag("en-gb"), "en-GB");
  assert.equal(canonicalLocaleTag("SV-se"), "sv-SE");
  assert.equal(canonicalLocaleTag("da"), "da");
  assert.deepEqual(rules('d.toLocaleDateString("en-ca")'), []);
  assert.deepEqual(rules(`new Intl.DateTimeFormat("SV-SE", { timeZone, ${FULL_KEY} })`), []);
  // normaliseringen aabner ikke for andre locales eller for visning
  assert.deepEqual(rules('d.toLocaleDateString("en-ca", { month: "long" })'), ["locale-literal"]);
  assert.deepEqual(rules('new Intl.DateTimeFormat("en-ca", { timeStyle: "short" })'), ["locale-literal"]);
  assert.deepEqual(rules('d.toLocaleDateString("en-us")'), ["locale-literal"]);
  assert.deepEqual(rules('n.toLocaleString("sv-se")'), ["locale-literal"]);
});
