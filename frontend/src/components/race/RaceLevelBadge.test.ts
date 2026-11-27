// #8853 · RaceLevelBadge er .tsx og kan ikke loades af node --test (se
// BetaBadge.test.ts). Kilde-assertions mod komponenten + kontrol af, at hvert
// sted ejeren nævnte faktisk bruger det ENE fælles mærke.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { squadBadgeKey } from "../../lib/squadBadge.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(srcRoot, rel), "utf8");
const src = read("components/race/RaceLevelBadge.tsx");
const localesRoot = join(srcRoot, "..", "public", "locales");
const locale = (lang: string) => JSON.parse(readFileSync(join(localesRoot, lang, "races.json"), "utf8"));

test("niveauet afgøres af races.squad: kun u23 og junior giver et mærke", () => {
  assert.equal(squadBadgeKey("u23"), "u23");
  assert.equal(squadBadgeKey("junior"), "junior");
  assert.equal(squadBadgeKey("senior"), null);
  assert.equal(squadBadgeKey(null), null);
  assert.equal(squadBadgeKey(undefined), null);
  assert.match(src, /squadBadgeKey\(squad\)/);
  assert.match(src, /if \(!level\) return null/);
});

test("mærket følger TASTE: hairline, 5px radius, ingen skygge, ikke guld, ingen emoji", () => {
  assert.match(src, /rounded-cz\b/);
  assert.match(src, /\bborder\b/);
  assert.doesNotMatch(src, /rounded-(2xl|xl|lg|md|full|\[)/);
  assert.doesNotMatch(src, /shadow-/);
  assert.doesNotMatch(src, /cz-accent/);
  assert.doesNotMatch(src, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
});

test("teksten kommer fra i18n, fuld tekst på EN og DA", () => {
  assert.match(src, /t\(`raceLevel\.\$\{level\}`\)/);
  for (const lang of ["en", "da"]) {
    const rl = locale(lang).raceLevel;
    assert.ok(rl, `${lang}: raceLevel mangler`);
    for (const k of ["u23", "junior", "u23Title", "juniorTitle"]) {
      assert.equal(typeof rl[k], "string", `${lang}: raceLevel.${k}`);
      assert.ok(rl[k].length > 0);
    }
    assert.equal(rl.junior, "Junior", `${lang}: ingen forkortelse som JR`);
  }
});

test("alle flader fra ejerens direktiv bruger det fælles mærke", () => {
  const surfaces = [
    "pages/NotificationsPage.jsx",
    "pages/RaceDetailPage.jsx",
    "pages/RaceHistoryPage.jsx",
    "components/rider/profile/RiderPalmaresTab.jsx",
    "components/rider/profile/RiderResultsTab.jsx",
    "components/TeamResultsTab.jsx",
    "components/CareerFirstMomentRow.jsx",
  ];
  for (const rel of surfaces) {
    assert.match(read(rel), /<RaceLevelBadge\b/, `${rel} skal vise RaceLevelBadge`);
  }
});

test("palmarès/resultater får niveauet med fra datalaget", () => {
  assert.match(read("lib/riderResultsTab.js"), /squad: race\.squad \?\? null/);
});
