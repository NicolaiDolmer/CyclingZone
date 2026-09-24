// backend/lib/stageFinaleMetrics.test.js — #4272 finale-bånd pr. terræntype + samlet.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeFinaleStats, mergeFinaleStats, detectFinaleViolations, finaleClass,
  TERRAIN_FINALE_BANDS, OVERALL_FINALE_BAND, BANDED_PROFILES, MIN_SAMPLE,
} from "./stageFinaleMetrics.js";
import { FINALE_TYPES, finaleFor, generateRaceStageProfiles, balanceFinaleQuotas } from "./raceStageProfileGenerator.js";
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

// ── #5405: kvote-fordelingen af finaler i ÉN divisions løbssæt ────────────────
// Et frit træk pr. etape er en binomial stikprøve omkring vægten. På brosten (få etaper
// pr. sæson) er båndet ikke bredere end én standardfejl, så en korrekt generator lå uden
// for båndet i en stor del af sæsonerne. balanceFinaleQuotas fjerner stikprøvestøjen.
const endagsløb = (archetype, n, seasonId, prefix = archetype) => Array.from({ length: n }, (_, i) => ({
  id: `${prefix}-${i}`, external_id: `ext-${prefix}-${i}`, name: `${prefix} ${i}`,
  race_type: "single", stages: 1, terrain_archetype: archetype, season_id: seasonId,
}));
const genererAlle = (seedRaces) => seedRaces.map((r) => generateRaceStageProfiles(r));
const fordeling = (stagesByRace) => computeFinaleStats(stagesByRace.map((stages) => ({ stages })));
const terrænBrud = (stats, profile) => detectFinaleViolations({ stats, label: "t", strict: true })
  .filter((x) => x.includes(`${profile} slutter`));

// Vægtandelen pr. finale, målt gennem generatorens egen afbildning (ingen kopi af vægtene).
function vægtandele(profile) {
  const N = 100000;
  const counts = {};
  for (let i = 0; i < N; i++) {
    const f = finaleFor(() => (i + 0.5) / N, profile);
    counts[f] = (counts[f] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).map(([f, c]) => [f, c / N]));
}

test("#5405 brosten med få etaper lander i båndet i HVER sæson — det frie træk gør ikke", () => {
  let frieBrud = 0;
  for (let s = 0; s < 30; s++) {
    const løb = endagsløb("cobbled_classic", 23, `s-5405-${s}`);
    const fri = genererAlle(løb);
    if (terrænBrud(fordeling(fri), "cobbles").length) frieBrud++;
    const kvote = balanceFinaleQuotas(fri);
    assert.deepEqual(terrænBrud(fordeling(kvote), "cobbles"), [], `sæson ${s}: kvoten skal ligge i brostens-båndet`);
  }
  // Uden dette ville testen være grøn uanset om kvoten virkede: stikprøvestøjen skal
  // reelt findes i det frie træk.
  assert.ok(frieBrud > 0, "det frie træk forventes at falde uden for båndet i mindst én sæson");
});

test("#5405 hver finale ligger højst én etape fra n × vægtandel", () => {
  for (const [archetype, profile, n] of [["puncheur", "hilly", 41], ["cobbled_classic", "cobbles", 23], ["long_sprint_classic", "rolling", 17]]) {
    const andel = vægtandele(profile);
    const kvote = balanceFinaleQuotas(genererAlle(endagsløb(archetype, n, "s-5405-kvote")));
    const counts = {};
    for (const [stage] of kvote) counts[stage.finale_type] = (counts[stage.finale_type] ?? 0) + 1;
    for (const [finale, p] of Object.entries(andel)) {
      assert.ok(Math.abs((counts[finale] ?? 0) - n * p) < 1, `${profile}/${finale}: ${counts[finale] ?? 0} mod ${(n * p).toFixed(2)}`);
    }
  }
});

test("#5405 kvoten er uafhængig af rækkefølgen, muterer intet og genbruger uændrede etaper", () => {
  const løb = [...endagsløb("puncheur", 20, "s-5405-orden"), ...endagsløb("cobbled_classic", 9, "s-5405-orden")];
  const fri = genererAlle(løb);
  const førFinaler = fri.map((stages) => stages.map((s) => s.finale_type));
  const frem = balanceFinaleQuotas(fri);
  const bagud = balanceFinaleQuotas([...fri].reverse()).reverse();
  assert.deepEqual(JSON.parse(JSON.stringify(frem)), JSON.parse(JSON.stringify(bagud)), "samme løbssæt i anden rækkefølge skal give samme finaler og ruter");
  assert.deepEqual(fri.map((stages) => stages.map((s) => s.finale_type)), førFinaler, "inputtet må ikke muteres");
  let skiftet = 0;
  frem.forEach((stages, i) => stages.forEach((stage, j) => {
    const original = fri[i][j];
    if (stage.finale_type === original.finale_type) {
      assert.equal(stage, original, "en etape der beholder sin finale, skal være samme objekt");
    } else {
      skiftet++;
      // Samme etape, ny finale: terræn, nummer og distance ligger fast (ruten genbygges kun
      // for det der afhænger af finalen).
      assert.equal(stage.profile_type, original.profile_type);
      assert.equal(stage.stage_number, original.stage_number);
      assert.equal(stage.distance_km, original.distance_km);
      assert.ok(Array.isArray(stage.climbs) && Array.isArray(stage.segments), "den genbyggede etape skal have en fuld rute");
    }
  }));
  // Et frit træk på 29 etaper rammer sjældent kvoten præcist; uden et skift tester vi intet.
  assert.ok(skiftet > 0, "fixturen skal få mindst én etape til at skifte finale");
});

test("#5405 etaper der ikke kommer fra generatoren røres ikke", () => {
  const fremmede = [[{ profile_type: "hilly", finale_type: "breakaway" }], [{ profile_type: "cobbles", finale_type: "breakaway" }]];
  const ud = balanceFinaleQuotas(fremmede);
  assert.equal(ud[0][0], fremmede[0][0]);
  assert.equal(ud[1][0], fremmede[1][0]);
});

test("#5405 afrundingen bytter aldrig et terræn-bånd væk for det samlede bånd", () => {
  // Kun kuperede endagsløb: "opad" er langt over det samlede bånd uanset afrunding, og
  // "fladt" langt under. Kvoten må alligevel ALDRIG flytte et terræn mere end én etape fra
  // sin vægt for at jagte det samlede bånd — terræn-båndet er ejerens første regel.
  const løb = endagsløb("puncheur", 30, "s-5405-samlet");
  const kvote = balanceFinaleQuotas(genererAlle(løb));
  assert.deepEqual(terrænBrud(fordeling(kvote), "hilly"), [], "terræn-båndet skal holde, også når det samlede bånd ikke kan");
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
