import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #2000 sidste faner — Resultater (PCS-stil). i18n-garantier jf. #645-mønstret.
// Ekstra: terræn-labels skal dække ALLE endagsløbs-arketyper fra backend'ens
// ARCHETYPE_PROFILES (kind: "single") — ellers viser tabellen "-" for ægte løb.

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "RiderResultsTab.jsx"), "utf8");

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

test("RiderResultsTab bruger rider-namespacet", () => {
  assert.match(source, /useTranslation\("rider"\)/);
});

test("RiderResultsTab har ingen hardcoded danske strenge", () => {
  assert.doesNotMatch(stripComments(source), /[æøåÆØÅ]/);
});

function flatKeys(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? flatKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

test("rider.json har profile.results-nøgler i både en og da (key-parity)", () => {
  const localesDir = join(__dirname, "..", "..", "..", "..", "public", "locales");
  const load = (lng) => JSON.parse(readFileSync(join(localesDir, lng, "rider.json"), "utf8"));
  const en = load("en")?.profile?.results;
  const da = load("da")?.profile?.results;
  assert.ok(en, "en/rider.json mangler profile.results-sektionen");
  assert.ok(da, "da/rider.json mangler profile.results-sektionen");
  assert.deepEqual(flatKeys(en).sort(), flatKeys(da).sort());

  for (const key of [
    "totalsTitle", "filterLabel", "filterAll",
    "totals.wins", "totals.races", "totals.top5", "totals.jerseys", "totals.points", "totals.prize",
    "table.date", "table.race", "table.class", "table.terrain", "table.pos", "table.points", "table.prize",
    "stagesCount", "stageRow", "overallRow", "expandHint", "emptySeason", "seasonShort", "loadError",
  ]) {
    assert.ok(flatKeys(en).includes(key), `en profile.results mangler ${key}`);
  }

  // Endagsløbs-arketyperne fra backend/lib/raceStageProfileGenerator.js
  // (ARCHETYPE_PROFILES med kind: "single") — hold listen i sync ved nye arketyper.
  for (const archetype of ["flat_sprint", "cobbled_classic", "puncheur", "hilly_classic", "mountain_classic", "long_sprint_classic"]) {
    assert.ok(flatKeys(en).includes(`terrain.${archetype}`), `en profile.results.terrain mangler ${archetype}`);
  }

  for (const [lngName, tree] of [["en", en], ["da", da]]) {
    for (const key of flatKeys(tree)) {
      const value = key.split(".").reduce((o, k) => o?.[k], tree);
      assert.ok(!String(value).includes("—"), `${lngName} profile.results.${key} indeholder em-dash`);
    }
  }
});
