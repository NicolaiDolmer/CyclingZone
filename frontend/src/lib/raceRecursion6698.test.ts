import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import i18next from "i18next";
import ICU from "i18next-icu";

// #6698 (Sentry CYCLINGZONE-9H + CYCLINGZONE-AD) — Firefox 158 kastede sporadisk
// "InternalError: too much recursion" fra i18next's looksLikeObjectPath
// (`r.test(key)`) midt i et t()-kald. JS-stakken var lav (~20 frames, rod =
// scheduler-task), så det er ikke app-rekursion: det er regex-motoren. Samme
// top-frame på to sider (løbsside, dashboard), to spillere, to sprog.
//
// Rettelsen: src/i18n/index.js sætter nsSeparator/keySeparator eksplicit, så
// i18next springer heuristikken (og dens regex) over. Testen simulerer fejlen
// ved at lade EXACT den regex kaste, og viser at (a) uden rettelsen dør t(),
// (b) med rettelsen gør den ikke.

const here = dirname(fileURLToPath(import.meta.url));
const localesRoot = join(here, "..", "..", "public", "locales");
const dashboardEn = JSON.parse(readFileSync(join(localesRoot, "en", "dashboard.json"), "utf8"));
const indexSource = readFileSync(join(here, "..", "i18n", "index.js"), "utf8");

const KEY = "dashboard:cards.maidenWin.headline.maidenWin";

async function makeInstance(extraOptions: Record<string, unknown>) {
  const inst = i18next.createInstance();
  await inst.use(ICU).init({
    lng: "en",
    fallbackLng: "en",
    ns: ["dashboard"],
    defaultNS: "common",
    resources: { en: { dashboard: dashboardEn } },
    interpolation: { escapeValue: false },
    ...extraOptions,
  });
  return inst;
}

// looksLikeObjectPath bygger sin regex som `( |,|\?|!|;)` (tegn-alternation).
// Kun den kaster; al anden regex-brug i i18next er uberørt.
function withBrokenObjectPathRegex<T>(fn: () => T): T {
  const original = RegExp.prototype.test;
  RegExp.prototype.test = function patchedTest(this: RegExp, ...args: [string]) {
    if (this.source.startsWith("( |")) {
      throw new RangeError("too much recursion (simuleret Firefox 158-regexfejl)");
    }
    return original.apply(this, args);
  };
  try {
    return fn();
  } finally {
    RegExp.prototype.test = original;
  }
}

test("#6698 kontrol: uden eksplicitte separatorer rammer t() den fejlende regex", async () => {
  const inst = await makeInstance({});
  assert.throws(() => withBrokenObjectPathRegex(() => inst.t(KEY)), /too much recursion/);
});

test("#6698 med eksplicitte separatorer rører t() aldrig den fejlende regex", async () => {
  const inst = await makeInstance({ nsSeparator: ":", keySeparator: "." });
  const out = withBrokenObjectPathRegex(() => inst.t(KEY));
  assert.equal(out, dashboardEn.cards.maidenWin.headline.maidenWin);
});

test("#6698 eksplicitte separatorer ændrer ikke opslag: ns:sti, interpolation, fallback-nøgle", async () => {
  const withSep = await makeInstance({ nsSeparator: ":", keySeparator: "." });
  const plain = await makeInstance({});
  const keys = [
    KEY,
    "dashboard:cards.maidenWin.body.maidenWin",
    "dashboard:cards.maidenWin.unknownRider",
    "dashboard:does.not.exist",
  ];
  for (const key of keys) {
    const opts = { race: "Løb", count: 3, team: "Hold A" };
    assert.equal(withSep.t(key, opts), plain.t(key, opts), `afvigelse for ${key}`);
  }
});

test("#6698 produktions-i18n sætter separatorerne eksplicit (ellers vender heuristikken tilbage)", () => {
  assert.match(indexSource, /nsSeparator:\s*":"/);
  assert.match(indexSource, /keySeparator:\s*"\."/);
});
