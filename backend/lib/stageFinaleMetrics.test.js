// backend/lib/stageFinaleMetrics.test.js — #4272 finale-bånd pr. terræntype + samlet.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeFinaleStats, mergeFinaleStats, detectFinaleViolations, finaleClass,
  TERRAIN_FINALE_BANDS, OVERALL_FINALE_BAND, BANDED_PROFILES, MIN_SAMPLE,
} from "./stageFinaleMetrics.js";
import { FINALE_TYPES, finaleFor } from "./raceStageProfileGenerator.js";
import { makeRng } from "./fictionalRiderGenerator.js";

// Byg n etaper af ét terræn med en given finale-fordeling (antal pr. finale_type).
const races = (profile, counts) => [{
  stages: Object.entries(counts).flatMap(([finale, n]) =>
    Array.from({ length: n }, () => ({ profile_type: profile, finale_type: finale }))),
}];

test("finaleClass dækker ALLE finale_types generatoren kan producere", () => {
  // Uden dette ville en ny finale_type tælle som "unknown" og gøre båndene misvisende.
  for (const t of FINALE_TYPES) {
    assert.ok(finaleClass(t), `finale_type "${t}" mangler en klasse i FINALE_CLASS_BY_TYPE`);
  }
});

test("computeFinaleStats tæller pr. terræn og samlet, med korrekte andele", () => {
  const stats = computeFinaleStats(races("mountain", { long_climb: 5, descent: 3, breakaway: 2 }));
  assert.equal(stats.total, 10);
  assert.equal(stats.byProfile.mountain.counts.up, 5);
  assert.equal(stats.byProfile.mountain.pct.up, 50);
  assert.equal(stats.byProfile.mountain.pct.down, 30);
  assert.equal(stats.overall.pct.break, 20);
});

test("en ukendt finale_type tælles som unknown og melder brud — ikke tavs nul", () => {
  const stats = computeFinaleStats([{ stages: [{ profile_type: "mountain", finale_type: "ukendt" }] }]);
  assert.equal(stats.overall.unknown, 1);
  const v = detectFinaleViolations({ stats, label: "t", strict: true });
  assert.ok(v.some((x) => x.includes("ukendt/manglende finale_type")), v.join(" · "));
});

test("0 etaper er fravær af evidens, ikke et opfyldt bånd (#2854)", () => {
  const v = detectFinaleViolations({ stats: computeFinaleStats([]), label: "tom" });
  assert.equal(v.length, 1);
  assert.ok(v[0].includes("0 etaper"), v[0]);
});

// ── Kernen i #4272: den gamle generator gjorde bjerget til en nedkørsels-etape ──
test("#4272 regressionen fanges: mountain der slutter nedad 70 % / opad 12 % er rødt", () => {
  // Præcis de MÅLTE andele fra D1 før #4272 (33 etaper: 70 % nedad, 12 % opad, 18 % udbrud).
  const stats = computeFinaleStats(races("mountain", { descent: 23, long_climb: 4, breakaway: 6 }));
  const strict = detectFinaleViolations({ stats, label: "d1", strict: true });
  assert.ok(strict.some((x) => x.includes("mountain slutter opad")), strict.join(" · "));
  assert.ok(strict.some((x) => x.includes("mountain slutter nedad")), strict.join(" · "));
  // Og den overlever HELLER IKKE stikprøve-tillægget — ellers ville gaten være pynt.
  const lenient = detectFinaleViolations({ stats, label: "d1", strict: false });
  assert.ok(lenient.some((x) => x.includes("mountain slutter opad")),
    `stikprøve-tillægget må ikke bære en 58 pp afvigelse: ${lenient.join(" · ")}`);
});

test("en fordeling midt i båndet er grøn i begge lag", () => {
  // mountain-båndet: opad 45-65 · nedad 20-35 · udbrud 10-25.
  const stats = computeFinaleStats(races("mountain", { long_climb: 55, descent: 27, breakaway: 18 }));
  assert.deepEqual(detectFinaleViolations({ stats, label: "m", strict: true })
    .filter((x) => x.includes("mountain")), []);
});

test("en klasse ejeren har markeret \"—\" gates mod 0 (bunch_sprint i højbjerget er et brud)", () => {
  const stats = computeFinaleStats(races("high_mountain", { long_climb: 16, bunch_sprint: 4 }));
  const v = detectFinaleViolations({ stats, label: "hm", strict: true });
  assert.ok(v.some((x) => x.includes("high_mountain slutter fladt")), v.join(" · "));
});

// ── Stikprøve-laget ──────────────────────────────────────────────────────────
test("under MIN_SAMPLE rapporteres terrænet, men gates ikke pr. division", () => {
  const lille = computeFinaleStats(races("mountain", { descent: MIN_SAMPLE - 1 }));
  assert.equal(lille.byProfile.mountain.total, MIN_SAMPLE - 1);
  assert.deepEqual(
    detectFinaleViolations({ stats: lille, label: "d4", strict: false }).filter((x) => x.includes("mountain")),
    [],
    "et terræn med n < MIN_SAMPLE må ikke fælde divisions-gaten på stikprøvestøj"
  );
  // Saeson-aggregatet bruger samme minimum; lille n er rapport, ikke en dom.
  assert.deepEqual(detectFinaleViolations({ stats: lille, label: "sæson", strict: true })
    .filter((x) => x.includes("mountain")), []);
});

test("#5405 strict terrain gates begin at MIN_SAMPLE, not one stage earlier", () => {
  const small = computeFinaleStats(races("gravel", { reduced_sprint: MIN_SAMPLE - 1 }));
  assert.deepEqual(detectFinaleViolations({ stats: small, strict: true }).filter(v => v.includes("gravel")), []);
  const assessable = computeFinaleStats(races("gravel", { reduced_sprint: MIN_SAMPLE }));
  assert.ok(detectFinaleViolations({ stats: assessable, strict: true }).some(v => v.includes("gravel")));
});

test("#5405 owner-approved cobbles band permits its upper flat boundary but rejects crossing it", () => {
  const atBoundary = computeFinaleStats(races("cobbles", { reduced_sprint: 55, breakaway: 45 }));
  assert.deepEqual(detectFinaleViolations({ stats: atBoundary, strict: true }).filter(v => v.includes("cobbles")), []);
  const overBoundary = computeFinaleStats(races("cobbles", { reduced_sprint: 56, breakaway: 44 }));
  assert.ok(detectFinaleViolations({ stats: overBoundary, strict: true }).some(v => v.includes("cobbles")));
});

test("#5405 hilly probabilities follow normalized band midpoints", () => {
  const bands = TERRAIN_FINALE_BANDS.hilly;
  const middle = Object.fromEntries(Object.entries(bands).map(([name, [lo, hi]]) => [name, (lo + hi) / 2]));
  const total = Object.values(middle).reduce((a, b) => a + b, 0);
  const counts = {};
  const samples = 4000;
  for (let i = 0; i < samples; i++) {
    const cls = finaleClass(finaleFor(() => (i + 0.5) / samples, "hilly"));
    counts[cls] = (counts[cls] || 0) + 1;
  }
  for (const [cls, weight] of Object.entries(middle)) {
    assert.ok(Math.abs((counts[cls] || 0) / samples - weight / total) < 1 / samples, cls);
  }
});

test("stikprøve-tillægget bærer et lille afvig, men ikke et stort", () => {
  // n=20, opad 35 % — 5 pp under båndets 40 %, inden for 2 standardfejl (~21 pp).
  const nær = computeFinaleStats(races("hilly", { punch: 7, reduced_sprint: 7, breakaway: 6 }));
  assert.deepEqual(detectFinaleViolations({ stats: nær, label: "d", strict: false })
    .filter((x) => x.includes("hilly slutter opad")), []);
  // n=20, opad 0 % — 40 pp under båndet, langt uden for tillægget.
  const langtFra = computeFinaleStats(races("hilly", { reduced_sprint: 10, breakaway: 10 }));
  assert.ok(detectFinaleViolations({ stats: langtFra, label: "d", strict: false })
    .some((x) => x.includes("hilly slutter opad")));
});

test("mergeFinaleStats lægger divisioner sammen uden at tabe terræn eller total", () => {
  const a = computeFinaleStats(races("mountain", { long_climb: 6, descent: 4 }));
  const b = computeFinaleStats(races("hilly", { punch: 5, breakaway: 5 }));
  const m = mergeFinaleStats([a, b]);
  assert.equal(m.total, 20);
  assert.equal(m.byProfile.mountain.total, 10);
  assert.equal(m.byProfile.hilly.total, 10);
  assert.equal(m.overall.counts.up, 11);
});

// ── Generator ↔ bånd: vægtene skal sigte mod båndet, ikke bare være "anderledes" ──
test("#4272 generatorens vægte rammer hvert bånd over et stort træk", () => {
  for (const profile of BANDED_PROFILES) {
    const counts = {};
    const N = 4000;
    for (let s = 1; s <= N; s++) {
      const f = finaleFor(makeRng(s), profile);
      counts[f] = (counts[f] ?? 0) + 1;
    }
    const stats = computeFinaleStats(races(profile, counts));
    const v = detectFinaleViolations({ stats, label: profile, strict: true })
      .filter((x) => x.includes(`${profile} slutter`));
    assert.deepEqual(v, [], `${profile}: vægtene rammer ikke sit eget bånd — ${v.join(" · ")}`);
  }
});

test("bånd-tabellen og det samlede bånd er interne konsistente (min ≤ max, 0-100)", () => {
  const alle = [
    ...Object.entries(TERRAIN_FINALE_BANDS).flatMap(([p, b]) => Object.entries(b).map(([c, band]) => [`${p}.${c}`, band])),
    ...Object.entries(OVERALL_FINALE_BAND).map(([c, band]) => [`SAMLET.${c}`, band]),
  ];
  for (const [navn, [lo, hi]] of alle) {
    assert.ok(lo >= 0 && hi <= 100 && lo <= hi, `${navn}: ugyldigt bånd ${lo}-${hi}`);
  }
});
