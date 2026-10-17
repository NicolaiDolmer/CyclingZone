// Beta-sprog: registrering, synlighed, engelsk fallback og lazy-load — Refs #6802.
//
// Der er ingen beta-sprog registreret i dag (fr/es/nl kommer i opfoelgere).
// Testene beviser derfor kontrakten med syntetiske sprog, og at HVER fremtidig
// entry i LANGUAGES automatisk er daekket af de strukturelle vagter.

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
  HAS_BETA_LANGS,
  isBetaLang,
} from "./languages.js";
import { LAZY_BUNDLE_LANGS, bundleKey } from "./localeBundleBackend.js";
import { publicLanguageCandidates } from "./publicLanguageDetector.ts";
import {
  hasBetaLanguageAccess,
  selectableLanguages,
  languageToRevertTo,
} from "../lib/languageAccess.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(HERE, rel), "utf8");

const SYNTHETIC: { code: string; flag: string; beta: boolean }[] = [
  { code: "en", flag: "gb", beta: false },
  { code: "da", flag: "dk", beta: false },
  { code: "xx", flag: "un", beta: true },
];

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
  assert.equal(HAS_BETA_LANGS, LANGUAGES.some((l) => l.beta === true));
});

test("isBetaLang: basis-kode, case-insensitiv, ukendt og ikke-streng er aldrig beta", () => {
  assert.equal(isBetaLang("da-DK"), false);
  assert.equal(isBetaLang("zz"), false);
  assert.equal(isBetaLang(undefined), false);
  assert.equal(isBetaLang(null), false);
});

// ── adgang (ejer + beta-tester) ─────────────────────────────────────────────

test("beta-adgang er fail-closed: kun et aegte true giver adgang", () => {
  assert.equal(hasBetaLanguageAccess({ isBetaTester: true }), true);
  assert.equal(hasBetaLanguageAccess({ isOwner: true }), true);
  assert.equal(hasBetaLanguageAccess({ isBetaTester: false, isOwner: false }), false);
  assert.equal(hasBetaLanguageAccess({ isBetaTester: "true", isOwner: 1 }), false);
  assert.equal(hasBetaLanguageAccess({}), false);
  assert.equal(hasBetaLanguageAccess(), false);
});

test("sprogvaelgeren viser kun beta-sprog naar adgangen er bekraeftet", () => {
  assert.deepEqual(selectableLanguages(SYNTHETIC, true).map((l) => l.code), ["en", "da", "xx"]);
  assert.deepEqual(selectableLanguages(SYNTHETIC, false).map((l) => l.code), ["en", "da"]);
  assert.deepEqual(selectableLanguages(SYNTHETIC, null).map((l) => l.code), ["en", "da"]);
});

test("languageToRevertTo ruller kun tilbage naar mangel paa adgang er KENDT", () => {
  // Intet beta-sprog er registreret i dag, saa brug det statiske isBetaLang-svar:
  // et offentligt sprog rulles aldrig tilbage uanset adgang.
  assert.equal(languageToRevertTo("da", false), null);
  assert.equal(languageToRevertTo("en", null), null);
  assert.equal(languageToRevertTo("da", true), null);
  // null = ikke afgjort => aldrig tilbagerulning (ellers kastes testere til EN ved hver load).
  for (const l of LANGUAGES.filter((x) => x.beta)) {
    assert.equal(languageToRevertTo(l.code, null), null);
    assert.equal(languageToRevertTo(l.code, true), null);
    assert.equal(languageToRevertTo(l.code, false), DEFAULT_LANG);
  }
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
      /^\s*import\b[^\n]*messages\.[a-z-]+\.js/m,
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

// ── fr/es/nl som skjulte beta-sprog (#6836) ────────────────────────────────

const REGISTERED_BETA = ["fr", "es", "nl"];

test("fr/es/nl er registreret som beta og aldrig offentlige", () => {
  for (const code of REGISTERED_BETA) {
    const entry = LANGUAGES.find((l) => l.code === code);
    assert.ok(entry, `${code} mangler i LANGUAGES`);
    assert.equal(entry.beta, true, `${code} skal vaere beta: true`);
    assert.equal(isBetaLang(code), true);
    assert.equal(isBetaLang(`${code}-XX`), true);
    assert.ok(SUPPORTED_LANGS.includes(code));
    assert.ok(!PUBLIC_LANGS.includes(code), `${code} maa ikke vaere i PUBLIC_LANGS`);
  }
  assert.deepEqual(PUBLIC_LANGS, ["en", "da"]);
  assert.equal(HAS_BETA_LANGS, true);
});

test("browser-detektion vaelger aldrig fr/es/nl, selv med en fransk/spansk/hollandsk browser", () => {
  assert.deepEqual(publicLanguageCandidates(["fr-FR", "es-ES", "nl-NL", "da-DK"]), ["da-DK"]);
  assert.deepEqual(publicLanguageCandidates(["fr", "es", "nl"]), []);
});

test("sprogvaelgeren skjuler fr/es/nl for almindelige spillere og viser dem for testere", () => {
  assert.deepEqual(selectableLanguages(LANGUAGES, false).map((l) => l.code), ["en", "da"]);
  assert.deepEqual(selectableLanguages(LANGUAGES, null).map((l) => l.code), ["en", "da"]);
  assert.deepEqual(selectableLanguages(LANGUAGES, true).map((l) => l.code), ["en", "da", "fr", "es", "nl"]);
  for (const code of REGISTERED_BETA) assert.equal(languageToRevertTo(code, false), DEFAULT_LANG);
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
    const src = read(`messages.${code}.js`);
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
    assert.match(flagSrc, new RegExp(`[ {,]${entry.flag}: `), `${entry.flag} mangler i FLAGS`);
  }
});
