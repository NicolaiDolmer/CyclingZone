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

// #2526: etapeløbs-resultater skal deep-linke til den rigtige etapeside
// (?stage=N), og løbsnavnet må IKKE længere være et <a>/<Link> inde i en
// <button> (invalid DOM-nesting → dødt link). Vi verificerer kilden statisk
// jf. resten af denne fils readFileSync-mønster.
test("RiderResultsTab deep-linker etape-resultater til ?stage=N (#2526)", () => {
  const code = stripComments(source);
  assert.match(code, /stage=\$\{|<RaceLink[\s\S]*?stage=/);
});

test("RiderResultsTab bruger RaceLink til lobsnavnet (#2526)", () => {
  const code = stripComments(source);
  assert.match(code, /<RaceLink\b/);
});

test("RiderResultsTab wrapper ikke lobsnavns-linket i en <button> (#2526)", () => {
  const code = stripComments(source);
  // Ingen <button> ... </button> må indeholde et <RaceLink>/<Link> (invalid
  // interaktiv nesting = dødt navn-link, kun toggle virkede for etapeløb).
  const buttonBlocks = code.match(/<button\b[\s\S]*?<\/button>/g) ?? [];
  for (const block of buttonBlocks) {
    assert.doesNotMatch(block, /<RaceLink\b|<Link\b/, "et navn-link ligger stadig inde i en <button>");
  }
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
