import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #1997 S1 — Palmarès-fanen. i18n-garantier jf. #645-mønstret (samme kontrakt
// som RiderResultsTab.i18n.test.js).

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "RiderPalmaresTab.jsx"), "utf8");

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

test("RiderPalmaresTab bruger rider-namespacet", () => {
  assert.match(source, /useTranslation\("rider"\)/);
});

test("RiderPalmaresTab har ingen hardcoded danske strenge", () => {
  assert.doesNotMatch(stripComments(source), /[æøåÆØÅ]/);
});

function flatKeys(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? flatKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

test("rider.json har profile.palmares-nøgler i både en og da (key-parity)", () => {
  const localesDir = join(__dirname, "..", "..", "..", "..", "public", "locales");
  const load = (lng) => JSON.parse(readFileSync(join(localesDir, lng, "rider.json"), "utf8"));
  const en = load("en")?.profile?.palmares;
  const da = load("da")?.profile?.palmares;
  assert.ok(en, "en/rider.json mangler profile.palmares-sektionen");
  assert.ok(da, "da/rider.json mangler profile.palmares-sektionen");
  assert.deepEqual(flatKeys(en).sort(), flatKeys(da).sort());

  for (const key of [
    "trophyTitle",
    "trophy.gcWins", "trophy.oneDayWins", "trophy.stageWins", "trophy.jerseyWins", "trophy.jerseyDays", "trophy.podiums",
    "jerseyDayType.leader", "jerseyDayType.points_day", "jerseyDayType.mountain_day", "jerseyDayType.young_day",
    "totalsTitle", "totals.races", "totals.winRate", "totals.points", "totals.prize",
    "seasonHonoursTitle", "teamFallback",
    "achievement.gcWin", "achievement.raceWin", "achievement.podium2", "achievement.podium3", "achievement.stageWin",
    "achievement.jersey.points", "achievement.jersey.mountain", "achievement.jersey.young",
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

test("rider.json har profile.tabs.palmares i både en og da", () => {
  const localesDir = join(__dirname, "..", "..", "..", "..", "public", "locales");
  const load = (lng) => JSON.parse(readFileSync(join(localesDir, lng, "rider.json"), "utf8"));
  assert.ok(load("en")?.profile?.tabs?.palmares, "en/rider.json mangler profile.tabs.palmares");
  assert.ok(load("da")?.profile?.tabs?.palmares, "da/rider.json mangler profile.tabs.palmares");
});
