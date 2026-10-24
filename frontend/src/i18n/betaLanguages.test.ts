// Beta-sprog: registrering, synlighed, engelsk fallback og lazy-load — Refs #6802.
//
// fr/es/nl var beta-sprog og er live for alle fra 24/10 (#7087). Beta-mekanismen (flag, detektor,
// Beta-maerke) bevares til naeste sprog; de strukturelle vagter daekker HVER entry i LANGUAGES.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import i18next from "i18next";

import {
  LANGUAGES,
  SUPPORTED_LANGS,
  PUBLIC_LANGS,
  DEFAULT_LANG,
  isBetaLang,
} from "./languages.js";
import { LAZY_BUNDLE_LANGS, bundleKey } from "./localeBundleBackend.js";
import { publicLanguageCandidates } from "./publicLanguageDetector.ts";
const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(HERE, rel), "utf8");

// ── languages.js ────────────────────────────────────────────────────────────

test("hver sprog-entry har et eksplicit boolean beta-felt", () => {
  for (const l of LANGUAGES) {
    assert.equal(typeof l.beta, "boolean", `${l.code} mangler beta: true|false`);
  }
});

test("standardsproget og de to nuvaerende sprog er offentlige", () => {
  assert.equal(isBetaLang(DEFAULT_LANG), false);
  assert.deepEqual(PUBLIC_LANGS.filter((c) => c === "en" || c === "da"), ["en", "da"]);
});

test("SUPPORTED_LANGS rummer ogsaa beta-sprog (DB-constraint + i18n kender dem)", () => {
  for (const l of LANGUAGES) assert.ok(SUPPORTED_LANGS.includes(l.code));
});

test("isBetaLang: basis-kode, case-insensitiv, ukendt og ikke-streng er aldrig beta", () => {
  assert.equal(isBetaLang("da-DK"), false);
  assert.equal(isBetaLang("zz"), false);
  assert.equal(isBetaLang(undefined), false);
  assert.equal(isBetaLang(null), false);
});

// ── detektion ───────────────────────────────────────────────────────────────

test("publicLanguageCandidates bevarer offentlige koder og taaler ugyldigt input", () => {
  assert.deepEqual(publicLanguageCandidates(["da-DK", "en-US"]), ["da-DK", "en-US"]);
  assert.deepEqual(publicLanguageCandidates(["", null, 4, "en"]), ["en"]);
  assert.deepEqual(publicLanguageCandidates(undefined), []);
  for (const l of LANGUAGES.filter((x) => x.beta)) {
    assert.deepEqual(publicLanguageCandidates([`${l.code}-XX`, "en"]), ["en"]);
  }
});

test("i18n bruger den beta-filtrerende detektor, ikke den rene navigator", () => {
  const src = read("index.js");
  assert.match(src, /from "\.\/publicLanguageDetector.ts"/);
  assert.match(src, /order: \["localStorage", "navigatorPublic", "htmlTag"\]/);
  assert.doesNotMatch(src, /from "i18next-browser-languagedetector"/);
});

// ── lazy-load ───────────────────────────────────────────────────────────────

test("hvert registreret sprog undtagen engelsk har en lazy bundle", () => {
  for (const l of LANGUAGES) {
    if (l.code === DEFAULT_LANG) continue;
    assert.ok(LAZY_BUNDLE_LANGS.includes(l.code), `${l.code} mangler en entry i LAZY_BUNDLES`);
    assert.equal(bundleKey(l.code), l.code);
  }
});

test("engelsk er den eneste inline-bundle: ingen messages.<lng>-import i entry-grafen", () => {
  for (const file of ["index.js", "../main.jsx", "../AppProviders.jsx", "../lib/language.jsx"]) {
    const src = read(file);
    assert.doesNotMatch(
      src,
      /^\s*import\b[^\n]*messages\.[a-z-]+\.(js|ts)/m,
      `${file} importerer en sprog-bundle statisk`
    );
  }
  assert.match(read("index.js"), /resources: \{\s*en: \{/);
  assert.doesNotMatch(read("index.js"), /resources: \{[^}]*\bda:/);
});

// ── engelsk fallback pr. noegle ─────────────────────────────────────────────

async function makeInstance(resources: Record<string, Record<string, Record<string, unknown>>>) {
  const instance = i18next.createInstance();
  // Samme fallback-relevante options som index.js.
  await instance.init({
    lng: "xx",
    fallbackLng: "en",
    supportedLngs: ["en", "da", "xx"],
    nonExplicitSupportedLngs: true,
    load: "languageOnly",
    partialBundledLanguages: true,
    ns: ["common"],
    defaultNS: "common",
    interpolation: { escapeValue: false },
    resources,
  });
  return instance;
}

test("index.js har fallbackLng en (kilden til per-noegle-fallback)", () => {
  assert.match(read("index.js"), /fallbackLng: "en"/);
});

test("manglende noegle i et delvist sprog giver engelsk tekst, aldrig den raa noegle", async () => {
  const i = await makeInstance({
    en: { common: { greeting: "Hello", nested: { deep: "Deep EN" }, count_one: "{{count}} rider" } },
    xx: { common: { greeting: "Hej-xx" } },
  });
  assert.equal(i.t("greeting"), "Hej-xx");
  assert.equal(i.t("nested.deep"), "Deep EN");
  assert.notEqual(i.t("nested.deep"), "nested.deep");
  assert.equal(i.t("count", { count: 1 }), "1 rider");
});

test("et helt manglende namespace i beta-sproget falder tilbage til engelsk", async () => {
  const i = await makeInstance({
    en: { common: { a: "A EN" }, extra: { b: "B EN" } },
    xx: { common: { a: "A XX" } },
  });
  await i.loadNamespaces("extra");
  assert.equal(i.t(["extra", "b"].join(":")) /* dynamisk: testens lazy-namespace er ikke et UI-namespace (namespace-inline-guard) */, "B EN");
});

test("regionale koder falder tilbage via basis-sproget", async () => {
  const i = await makeInstance({
    en: { common: { only: "Only EN" } },
    xx: { common: {} },
  });
  await i.changeLanguage("xx-YY");
  assert.equal(i.t("only"), "Only EN");
});

// ── fr/es/nl live for alle (#6836, #7087) ────────────────────────────────

const REGISTERED_BETA = ["fr", "es", "nl"];

test("fr/es/nl er live (#7087): registreret, offentlige og uden beta-maerke", () => {
  for (const code of REGISTERED_BETA) {
    const entry = LANGUAGES.find((l) => l.code === code);
    assert.ok(entry, `${code} mangler i LANGUAGES`);
    assert.equal(entry.beta, false, `${code} skal vaere beta: false`);
    assert.equal(isBetaLang(code), false);
    assert.equal(isBetaLang(`${code}-XX`), false);
    assert.ok(SUPPORTED_LANGS.includes(code));
    assert.ok(PUBLIC_LANGS.includes(code), `${code} skal vaere i PUBLIC_LANGS`);
  }
  assert.deepEqual(PUBLIC_LANGS, ["en", "da", "fr", "es", "nl"]);
});

test("browser-detektion kan vaelge fr/es/nl for en fransk/spansk/hollandsk browser", () => {
  assert.deepEqual(publicLanguageCandidates(["fr-FR", "es-ES", "nl-NL", "da-DK"]), ["fr-FR", "es-ES", "nl-NL", "da-DK"]);
  assert.deepEqual(publicLanguageCandidates(["fr", "es", "nl"]), ["fr", "es", "nl"]);
});

test("sprogvaelgeren viser alle sprog for alle uden adgangsgate; Beta-maerket styres af beta-flaget (#7087)", () => {
  const src = readFileSync(join(HERE, "../components/LanguageSwitcher.jsx"), "utf8");
  assert.doesNotMatch(src, /languageAccess|useBetaLanguageAccess/, "ingen adgangsgate");
  assert.match(src, /toOptions\(LANGUAGES\)/);
  assert.match(src, /language.betaBadge/);
  assert.match(src, /language.betaNote/);
  const dir = join(HERE, "../../public/locales");
  for (const lng of ["en", "da", ...REGISTERED_BETA]) {
    const common = JSON.parse(readFileSync(join(dir, lng, "common.json"), "utf8"));
    for (const k of ["betaBadge", "betaNote"]) assert.equal(typeof common.language?.[k], "string", `${lng}/common.json mangler language.${k}`);
  }
});

test("sprognavne-noegler language.<kode> findes i alle fem sprog (switcherens fallback-noegle)", () => {
  const dir = join(HERE, "../../public/locales");
  for (const lng of ["en", "da", ...REGISTERED_BETA]) {
    const common = JSON.parse(readFileSync(join(dir, lng, "common.json"), "utf8"));
    for (const code of REGISTERED_BETA) {
      assert.equal(typeof common.language?.[code], "string", `${lng}/common.json mangler language.${code}`);
    }
  }
});

test("hver beta-bundle dækker praecis de samme namespaces som den danske", () => {
  const ns = (src: string) => [...src.matchAll(/^import (\w+) from "\.\.\/\.\.\/public\/locales\/([a-z]+)\//gm)];
  const da = ns(read("messages.da.js"));
  assert.ok(da.length > 0);
  for (const code of REGISTERED_BETA) {
    const src = read(`messages.${code}.ts`);
    const own = ns(src);
    assert.deepEqual(own.map((m) => m[1]), da.map((m) => m[1]), `${code}: namespace-liste afviger fra da`);
    assert.ok(own.every((m) => m[2] === code), `${code}: importerer et andet sprogs locale-filer`);
  }
});

test("vite splitter hver beta-bundle ud i sin egen chunk (EN/DA vokser aldrig)", () => {
  const vite = readFileSync(join(HERE, "../../vite.config.js"), "utf8");
  for (const code of REGISTERED_BETA) {
    assert.match(vite, new RegExp(`name: "i18n-messages-${code}"`), `${code} mangler codeSplitting-gruppe`);
  }
});

test("sprogvaelgerens flag kender fr/es/nl (ellers tekst-only valg)", () => {
  const flagSrc = readFileSync(join(HERE, "../components/LanguageSwitcherFlag.jsx"), "utf8");
  for (const code of REGISTERED_BETA) {
    const entry = LANGUAGES.find((l) => l.code === code);
    assert.match(flagSrc, new RegExp(`[ {,]${entry?.flag}: `), `${entry?.flag} mangler i FLAGS`);
  }
});
