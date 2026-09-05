// Tests for i18n terrain-coverage guard — Refs #2896.
// Kør: node --test scripts/i18n-check-terrain-coverage.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { findMissingTerrainKeys, singleRaceArchetypes, findMissingIconCoverage } from "./i18n-check-terrain-coverage.mjs";

test("findMissingTerrainKeys: intet mangler når alle værdier har nøgler i alle sprog", () => {
  const missing = findMissingTerrainKeys(
    ["sprint", "hilly"],
    { en: { terrain: { sprint: "Sprint", hilly: "Hilly" } }, da: { terrain: { sprint: "Sprint", hilly: "Kuperet" } } },
    "terrain"
  );
  assert.deepEqual(missing, []);
});

test("findMissingTerrainKeys: fanger en nøgle der mangler i BEGGE sprog (#2896-mønstret)", () => {
  // Dette er nøjagtigt #2896-bugget: "sprint" mangler symmetrisk i en+da, så en
  // en-vs-da-diff (i18n-check-keys.mjs) ville have været grøn her.
  const missing = findMissingTerrainKeys(
    ["sprint", "cobbles"],
    { en: { terrain: { cobbles: "Cobbles" } }, da: { terrain: { cobbles: "Brosten" } } },
    "terrain"
  );
  assert.equal(missing.length, 1);
  assert.equal(missing[0].value, "sprint");
  assert.deepEqual(missing[0].missingIn.sort(), ["da", "en"]);
});

test("findMissingTerrainKeys: fanger en nøgle der kun mangler i ÉT sprog", () => {
  const missing = findMissingTerrainKeys(
    ["itt_classic"],
    { en: { profile: { results: { terrain: { itt_classic: "Time trial" } } } }, da: { profile: { results: { terrain: {} } } } },
    "profile.results.terrain"
  );
  assert.equal(missing.length, 1);
  assert.deepEqual(missing[0].missingIn, ["da"]);
});

test("findMissingTerrainKeys: tolererer manglende namespace-objekt (rapporterer manglende, styrter ikke)", () => {
  const missing = findMissingTerrainKeys(["sprint"], { en: {}, da: { terrain: { sprint: "Sprint" } } }, "terrain");
  assert.equal(missing.length, 1);
  assert.deepEqual(missing[0].missingIn, ["en"]);
});

test("singleRaceArchetypes: filtrerer kind:\"stage\" fra (tour/week-arketyper vises aldrig via profile.results.terrain)", () => {
  const values = singleRaceArchetypes({
    flat_sprint: { kind: "single", weights: [] },
    itt_classic: { kind: "single", weights: [] },
    grand_tour: { kind: "stage", guarantees: [], filler: [] },
  });
  assert.deepEqual(values.sort(), ["flat_sprint", "itt_classic"]);
});

test("findMissingIconCoverage: fanger en profile_type uden glyf-navn", () => {
  const missing = findMissingIconCoverage(["flat", "rolling", "gravel"], { flat: "RoadIcon", rolling: "RollingIcon" });
  assert.deepEqual(missing, ["gravel"]);
});

test("findMissingIconCoverage: tom liste naar alt har et glyf-navn", () => {
  const missing = findMissingIconCoverage(["flat", "rolling"], { flat: "RoadIcon", rolling: "RollingIcon" });
  assert.deepEqual(missing, []);
});

// Integrationstjek: importér de ÆGTE generator-konstanter + de ÆGTE locale-filer
// og kør samme sammenligning som CLI-scriptet. Dette er selve forward-guarden —
// den fejler hvis nogen tilføjer en ny CALENDAR_TERRAIN_BUCKETS-bucket, en ny
// kind:"single"-arketype eller en ny PROFILE_TYPE_KEYS-værdi (#4748/#4487) uden
// at tilføje de tilsvarende en+da-locale-nøgler / glyf-navn.
test("integration: alle CALENDAR_TERRAIN_BUCKETS + kind:single-arketyper + PROFILE_TYPE_KEYS har en+da-dækning i de ægte locale-filer", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { CALENDAR_TERRAIN_BUCKETS } = await import("../backend/lib/raceCalendar.js");
  const { ARCHETYPE_PROFILES } = await import("../backend/lib/raceStageProfileGenerator.js");
  const { PROFILE_TYPE_KEYS } = await import("../frontend/src/lib/stageProfileConfig.js");
  const { TERRAIN_TYPE_ICON_NAME } = await import("../frontend/src/lib/terrainTypeIcons.ts");

  const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const LOCALES_DIR = join(ROOT, "frontend", "public", "locales");
  const loadJSON = (lng, ns) => JSON.parse(readFileSync(join(LOCALES_DIR, lng, `${ns}.json`), "utf8"));

  const plannerByLng = { en: loadJSON("en", "planner"), da: loadJSON("da", "planner") };
  const riderByLng = { en: loadJSON("en", "rider"), da: loadJSON("da", "rider") };
  const racesByLng = { en: loadJSON("en", "races"), da: loadJSON("da", "races") };

  const calendarMissing = findMissingTerrainKeys(CALENDAR_TERRAIN_BUCKETS, plannerByLng, "terrain");
  assert.deepEqual(calendarMissing, [], `planner.json terrain mangler: ${JSON.stringify(calendarMissing)}`);

  const archetypeValues = singleRaceArchetypes(ARCHETYPE_PROFILES);
  const archetypeMissing = findMissingTerrainKeys(archetypeValues, riderByLng, "profile.results.terrain");
  assert.deepEqual(archetypeMissing, [], `rider.json profile.results.terrain mangler: ${JSON.stringify(archetypeMissing)}`);

  const profileLabelMissing = findMissingTerrainKeys(PROFILE_TYPE_KEYS, racesByLng, "detail.profileType");
  assert.deepEqual(profileLabelMissing, [], `races.json detail.profileType mangler: ${JSON.stringify(profileLabelMissing)}`);

  const iconMissing = findMissingIconCoverage(PROFILE_TYPE_KEYS, TERRAIN_TYPE_ICON_NAME);
  assert.deepEqual(iconMissing, [], `terrainTypeIcons.ts TERRAIN_TYPE_ICON_NAME mangler: ${JSON.stringify(iconMissing)}`);
});
