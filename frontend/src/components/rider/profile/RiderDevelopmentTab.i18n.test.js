import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #2000 stykke 5 — Udvikling-fanen (redesign, erstatter den gamle recharts-tab).
// Samme i18n-ærlighedsgarantier som forgængeren (#645-mønstret):
//   1) komponenten bruger useTranslation("rider") (samme namespace som shell'en)
//   2) ingen hardcoded danske strenge (æ/ø/å) i ikke-kommentar-kode
//   3) profile.development-nøglerne findes i BÅDE en og da (key-parity, #410)
//   4) ingen em-dash i nye keys (TONE_OF_VOICE.md)

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "RiderDevelopmentTab.jsx"), "utf8");

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

test("RiderDevelopmentTab bruger rider-namespacet", () => {
  assert.match(source, /useTranslation\("rider"\)/);
});

test("RiderDevelopmentTab har ingen hardcoded danske strenge", () => {
  assert.doesNotMatch(
    stripComments(source),
    /[æøåÆØÅ]/,
    "RiderDevelopmentTab indeholder danske tegn udenfor kommentarer — EN-mode lækker så dansk copy",
  );
});

// Fladt keys-udtræk ("a.b.c") af et nested objekt.
function flatKeys(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? flatKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

test("rider.json har profile.development-nøgler i både en og da (key-parity)", () => {
  const localesDir = join(__dirname, "..", "..", "..", "..", "public", "locales");
  const load = (lng) => JSON.parse(readFileSync(join(localesDir, lng, "rider.json"), "utf8"));
  const en = load("en")?.profile?.development;
  const da = load("da")?.profile?.development;
  assert.ok(en, "en/rider.json mangler profile.development-sektionen");
  assert.ok(da, "da/rider.json mangler profile.development-sektionen");
  assert.deepEqual(flatKeys(en).sort(), flatKeys(da).sort(), "en/da profile.development skal have identisk nøglestruktur");

  for (const key of [
    "empty", "loading", "chart.title", "chart.caption", "chart.season", "chart.seasonNow",
    "growth.title", "growth.typeRating", "growth.thisSeason", "growth.abilityPoints", "growth.trackedSince",
    "reading.title", "reading.own.rising", "reading.own.flat", "reading.scouting.rising", "reading.scouting.flat",
    "log.title", "log.hint", "log.seasonNow", "log.delta", "log.note", "log.noTraining", "log.scoutingHidden",
  ]) {
    assert.ok(flatKeys(en).includes(key), `en profile.development mangler ${key} — fanen viser så rå i18n-nøgle`);
  }

  for (const [lngName, tree] of [["en", en], ["da", da]]) {
    for (const key of flatKeys(tree)) {
      const value = key.split(".").reduce((o, k) => o?.[k], tree);
      assert.ok(
        !String(value).includes("—"),
        `${lngName} profile.development.${key} indeholder em-dash — forbudt i nye keys jf. TONE_OF_VOICE.md`,
      );
    }
  }
});
