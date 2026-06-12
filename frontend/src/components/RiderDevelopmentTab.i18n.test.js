import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #645 — RiderDevelopmentTab (lazy-loaded child af RiderStatsPage) blev oversat
// til EN/DA som Fase 3.6 follow-up til #485. Testene her holder os ærlige:
//   1) komponenten skal bruge useTranslation("rider") (samme namespace som forælder)
//   2) ingen hardcoded danske strenge (æ/ø/å) i ikke-kommentar-kode
//   3) development-nøglerne skal findes i BÅDE en og da (key-parity, jf. #410-guarden)

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "RiderDevelopmentTab.jsx"), "utf8");

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

test("RiderDevelopmentTab bruger rider-namespacet (#645)", () => {
  assert.match(
    source,
    /useTranslation\("rider"\)/,
    "RiderDevelopmentTab skal bruge useTranslation(\"rider\") — samme namespace som RiderStatsPage (#485-mønstret)",
  );
});

test("RiderDevelopmentTab har ingen hardcoded danske strenge (#645)", () => {
  const code = stripComments(source);
  assert.doesNotMatch(
    code,
    /[æøåÆØÅ]/,
    "RiderDevelopmentTab indeholder danske tegn udenfor kommentarer — EN-mode lækker så dansk copy (#645)",
  );
});

test("rider.json har development-nøgler i både en og da (#645)", () => {
  const localesDir = join(__dirname, "..", "..", "public", "locales");
  for (const lng of ["en", "da"]) {
    const riderJson = JSON.parse(readFileSync(join(localesDir, lng, "rider.json"), "utf8"));
    const dev = riderJson?.development;
    assert.ok(dev, `${lng}/rider.json mangler development-sektionen`);
    for (const key of ["empty", "statsTitle", "statsSubtitle", "recentTitle", "fallbackDash"]) {
      assert.equal(
        typeof dev[key],
        "string",
        `${lng}/rider.json mangler development.${key} — Udvikling-tabben viser så rå i18n-nøgler`,
      );
    }
    assert.equal(
      typeof dev?.table?.date,
      "string",
      `${lng}/rider.json mangler development.table.date — datokolonnen viser så rå i18n-nøgle`,
    );
    for (const [key, value] of Object.entries({ ...dev, ...dev.table })) {
      if (typeof value !== "string") continue;
      assert.ok(
        !value.includes("—"),
        `${lng}/rider.json development.${key} indeholder em-dash — forbudt i nye keys jf. TONE_OF_VOICE.md`,
      );
    }
  }
});
