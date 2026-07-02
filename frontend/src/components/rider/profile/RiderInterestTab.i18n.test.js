import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #2000 sidste faner — Interesse. i18n-garantier jf. #645-mønstret.

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "RiderInterestTab.jsx"), "utf8");

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

test("RiderInterestTab bruger rider-namespacet", () => {
  assert.match(source, /useTranslation\("rider"\)/);
});

test("RiderInterestTab har ingen hardcoded danske strenge", () => {
  assert.doesNotMatch(stripComments(source), /[æøåÆØÅ]/);
});

function flatKeys(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? flatKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

test("rider.json har profile.interest-nøgler i både en og da (key-parity)", () => {
  const localesDir = join(__dirname, "..", "..", "..", "..", "public", "locales");
  const load = (lng) => JSON.parse(readFileSync(join(localesDir, lng, "rider.json"), "utf8"));
  const en = load("en")?.profile?.interest;
  const da = load("da")?.profile?.interest;
  assert.ok(en, "en/rider.json mangler profile.interest-sektionen");
  assert.ok(da, "da/rider.json mangler profile.interest-sektionen");
  assert.deepEqual(flatKeys(en).sort(), flatKeys(da).sort());

  for (const key of [
    "loading", "loadError", "trendNew", "trendFlat", "seasonShort",
    "stats.followers", "stats.views7d", "stats.scoutedBy",
    "followersSub", "scoutedBySub",
    "summary.own", "summary.ownQuiet", "summary.scouting", "summary.scoutingQuiet",
    "whoScouts.title", "whoScouts.body", "whoScouts.empty", "whoScouts.level",
    "feed.title", "feed.scout", "feed.scoutAnon", "feed.watch", "feed.viewsTrend", "feed.viewsTrendMeta", "feed.empty",
  ]) {
    assert.ok(flatKeys(en).includes(key), `en profile.interest mangler ${key}`);
  }

  for (const [lngName, tree] of [["en", en], ["da", da]]) {
    for (const key of flatKeys(tree)) {
      const value = key.split(".").reduce((o, k) => o?.[k], tree);
      assert.ok(!String(value).includes("—"), `${lngName} profile.interest.${key} indeholder em-dash`);
    }
  }
});
