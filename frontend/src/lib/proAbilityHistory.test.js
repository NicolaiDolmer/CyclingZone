// #6286 · Pro-sæsonhistorik: huller, delta, akse-labels. Repoet kører node --test
// uden DOM-renderer, så komponentens logik bor i lib/proAbilityHistory.js og testes
// her; kildekode-guards nederst sikrer at komponenten faktisk bruger den.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  abilitySeries, abilityDelta, latestValue, seriesSegments, seasonAxisLabels, axisFraction,
} from "./proAbilityHistory.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const componentSource = readFileSync(
  join(__dirname, "..", "components", "rider", "profile", "RiderAbilityHistoryPro.jsx"), "utf8");

// Teamwork fandtes ikke i S1-S2: de sæsoner er huller, ikke 0.
const SEASONS = [
  { season_number: 1, abilities: { climbing: 40 } },
  { season_number: 2, abilities: { climbing: 44 } },
  { season_number: 3, abilities: { climbing: 47, teamwork: 30 } },
  { season_number: 4, abilities: { climbing: 50, teamwork: 33 }, live: true },
];

test("#6286 en manglende evne er et hul (null), aldrig 0", () => {
  const points = abilitySeries(SEASONS, "teamwork");
  assert.deepEqual(points.map((p) => p.v), [null, null, 30, 33]);
  assert.ok(points.every((p) => p.v !== 0));
});

test("#6286 delta regnes mellem rigtige værdier, ikke fra et hul", () => {
  assert.equal(abilityDelta(abilitySeries(SEASONS, "teamwork")), 3); // 30 → 33, ikke 0 → 33
  assert.equal(abilityDelta(abilitySeries(SEASONS, "climbing")), 10);
});

test("#6286 ét rigtigt punkt eller kun huller giver ingen delta", () => {
  assert.equal(abilityDelta(abilitySeries([{ season_number: 5, abilities: { climbing: 22 }, live: true }], "climbing")), null);
  assert.equal(abilityDelta(abilitySeries(SEASONS, "leadership")), null);
  assert.equal(latestValue(abilitySeries(SEASONS, "leadership")), null);
});

test("#6286 seneste værdi er sidste rigtige punkt (live-punktet)", () => {
  assert.equal(latestValue(abilitySeries(SEASONS, "climbing")), 50);
});

test("#6286 kurven brydes ved huller og bevarer punkternes plads på aksen", () => {
  const points = [{ v: 10 }, { v: null }, { v: 12 }, { v: 13 }, { v: null }];
  assert.deepEqual(seriesSegments(points), [
    [{ i: 0, v: 10 }],
    [{ i: 2, v: 12 }, { i: 3, v: 13 }],
  ]);
  assert.deepEqual(seriesSegments([{ v: null }]), []);
});

test("#6286 sæsonaksen har S-labels, og et live-punkt uden sæson hedder nowLabel", () => {
  assert.deepEqual(seasonAxisLabels(SEASONS).map((l) => l.label), ["S1", "S2", "S3", "S4"]);
  assert.deepEqual(
    seasonAxisLabels([{ season_number: null, live: true, abilities: {} }], { nowLabel: "Nu" }).map((l) => l.label),
    ["Nu"],
  );
});

test("#6286 mange sæsoner: tyndes ud, men første og sidste står altid", () => {
  const many = Array.from({ length: 13 }, (_, i) => ({ season_number: i + 1, abilities: {} }));
  const labels = seasonAxisLabels(many, { maxLabels: 6 }).map((l) => l.label);
  assert.equal(labels[0], "S1");
  assert.equal(labels.at(-1), "S13");
  assert.ok(labels.length <= 7);
});

test("#6286 ét punkt står midt på aksen", () => {
  assert.equal(axisFraction(0, 1), 0.5);
  assert.equal(axisFraction(3, 4), 1);
});

test("#6286 komponenten tegner ikke huller som 0 og bruger de delte helpers", () => {
  assert.doesNotMatch(componentSource, /abilities\?\.\[key\] \?\? 0/);
  assert.match(componentSource, /abilitySeries\(state\.seasons, key\)/);
  assert.match(componentSource, /seriesSegments\(points\)/);
  assert.match(componentSource, /abilityDelta\(points\)/);
  assert.match(componentSource, /<SeasonAxis /);
});

test("#6286 komponenten viser intet mens hold/abonnement indlæses, og ErrorState med retry ved fejl", () => {
  assert.match(componentSource, /if \(!myTeamId \|\| subLoading\) return null;/);
  assert.match(componentSource, /<ErrorState/);
  assert.match(componentSource, /onClick=\{retryHistory\}/);
  assert.match(componentSource, /<EmptyState/);
  assert.doesNotMatch(componentSource, /text-\[\d+(\.\d+)?px\]|py-\[\d+px\]|px-\[\d+px\]/, "ingen hårdkodede px-værdier");
});
