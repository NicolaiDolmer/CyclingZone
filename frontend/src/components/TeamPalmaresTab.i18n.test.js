import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #1997 holdside-slice — Palmarès-fanen på TeamProfilePage. i18n-garantier
// jf. #645-mønstret (samme kontrakt som RiderPalmaresTab.i18n.test.js).

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "TeamPalmaresTab.jsx"), "utf8");

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

test("TeamPalmaresTab bruger team-namespacet (+ halloffame for kategori-labels)", () => {
  assert.match(source, /useTranslation\("team"\)/);
  assert.match(source, /useTranslation\("halloffame"\)/);
});

test("TeamPalmaresTab har ingen hardcoded danske strenge", () => {
  assert.doesNotMatch(stripComments(source), /[æøåÆØÅ]/);
});

function flatKeys(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? flatKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

test("team.json har profile.palmares-nøgler i både en og da (key-parity)", () => {
  const localesDir = join(__dirname, "..", "..", "public", "locales");
  const load = (lng) => JSON.parse(readFileSync(join(localesDir, lng, "team.json"), "utf8"));
  const en = load("en")?.profile?.palmares;
  const da = load("da")?.profile?.palmares;
  assert.ok(en, "en/team.json mangler profile.palmares-sektionen");
  assert.ok(da, "da/team.json mangler profile.palmares-sektionen");
  assert.deepEqual(flatKeys(en).sort(), flatKeys(da).sort());

  for (const key of [
    "totalsTitle",
    "totals.seasons", "totals.wins", "totals.bestResult", "totals.honours", "totals.bestResultValue",
    "seasonHistoryTitle", "thSeason", "thDivision", "thRank", "thPoints", "thWins",
    "movementPromoted", "movementRelegated",
    "honoursTitle", "honoursEmpty",
    "emptyTitle", "emptyBody", "loadError",
  ]) {
    assert.ok(flatKeys(en).includes(key), `en profile.palmares mangler ${key}`);
  }

  for (const [lngName, tree] of [["en", en], ["da", da]]) {
    for (const key of flatKeys(tree)) {
      const value = key.split(".").reduce((o, k) => o?.[k], tree);
      assert.ok(!String(value).includes("—"), `${lngName} profile.palmares.${key} indeholder em-dash`);
    }
  }
});

test("team.json har profile.tabPalmares i både en og da", () => {
  const localesDir = join(__dirname, "..", "..", "public", "locales");
  const load = (lng) => JSON.parse(readFileSync(join(localesDir, lng, "team.json"), "utf8"));
  assert.ok(load("en")?.profile?.tabPalmares, "en/team.json mangler profile.tabPalmares");
  assert.ok(load("da")?.profile?.tabPalmares, "da/team.json mangler profile.tabPalmares");
});
