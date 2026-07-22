# Sub-4 (#2448) etapeprofil-graf — implementeringsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vise hver etapes rute som en deterministisk SVG-profil tegnet 1:1 fra `race_stage_profiles`, på etapesiden, ved holdudtagelsen, i etape-striben og (gated) på løbskortene.

**Architecture:** Én ren logik-fil (`stageRouteProfile.js`, ingen React, testbar med `node --test`) leverer geometri + motor-aflæsning. Tre præsentations-komponenter forbruger den: en SVG-renderer med tre tætheds-tiers, et waypoint-readout og et kort der samler dem. Silhuetten syntetiseres fra `climbs[]` + `distance_km` og amplitude-bisekteres, så kurvens samlede stigning rammer `elevation_gain_m` eksakt.

**Tech Stack:** React 18 + Vite, `react-i18next` (namespace `races`), ren SVG uden nye dependencies, `node --test` til unit-tests, Playwright til visuel smoke.

**Spec:** `docs/superpowers/specs/2026-07-22-sub4-stage-profile-graph-design.md` — læs §3 (sandhedsprincippet), §4 (syntesen), §7 (drift-guard) før Task 1.

**Hard rules for enhver task:**
- Ingen `Math.random`, ingen `Date` i geometri-koden. Determinisme er et test-krav.
- Alle farver fra eksisterende CSS-tokens (`--jersey-mountain`, `--jersey-points`, `--accent`, `--cz-*`). Ingen rå hex i komponenter.
- Ingen `rounded-2xl`, ingen glød, ingen gradient-blobs. `rounded-cz` (5 px) er maks.
- EN-tekst først i `en/races.json`, DA i `da/races.json`. Begge filer i samme commit.
- `cd frontend && npm run lint` skal være grøn før enhver push.

---

## Filstruktur

| Fil | Ansvar |
|---|---|
| `frontend/src/lib/stageRouteProfile.js` | **NY.** Ren geometri + motor-aflæsning. Ingen React, ingen DOM. |
| `frontend/src/lib/stageRouteProfile.test.js` | **NY.** Invariant, determinisme, race-read, drift-guard mod backend. |
| `frontend/src/components/race/StageProfileGraph.jsx` | **NY.** SVG-renderer. `tier`: `"full"` / `"compact"` / `"mini"`. |
| `frontend/src/components/race/StageWaypointReadout.jsx` | **NY.** "AT STAKE" / "RESULT"-blokken under grafen. |
| `frontend/src/components/race/StageProfileCard.jsx` | **NY.** Header (stat-linje + race-read) + graf + readout. |
| `frontend/src/pages/RaceDetailPage.jsx` | **MOD.** Udvidet select; erstatter inline `StageProfileCard`/`StageProfileSilhouette`; kompakt graf over udtagelses-panelet. |
| `frontend/src/components/race/StageStripe.jsx` | **MOD.** Mini-profiler med fælles y-skala når rutedata findes. |
| `frontend/src/components/race/StageDetailPanel.jsx` | **MOD.** Graf i stedet for piktogram-silhuet når rutedata findes. |
| `frontend/src/lib/raceStagePassages.js` | **MOD.** Opslag waypoint → passage-resultat. |
| `frontend/public/locales/en/races.json` + `da/races.json` | **MOD.** `detail.route.*`. |
| `frontend/src/preview/seedData.js` | **MOD.** Rutefelter + passage-rækker, så preview kan klikkes igennem. |
| `frontend/src/pages/PatchNotesPage.jsx` + `frontend/public/locales/{en,da}/help.json` | **MOD.** Spillervendt dokumentation. |

---

## Task 1: Geometri-kernen — `buildProfileSeries` + `hasRouteData`

**Files:**
- Create: `frontend/src/lib/stageRouteProfile.js`
- Test: `frontend/src/lib/stageRouteProfile.test.js`

- [ ] **Step 1: Skriv den fejlende test**

Opret `frontend/src/lib/stageRouteProfile.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { hasRouteData, buildProfileSeries, sharedYMax } from "./stageRouteProfile.js";

// Ægte S2-rækker (hentet fra prod 2026-07-22). Ændr dem ikke — de er
// regressions-ankeret for at syntesen holder på virkelige data.
const PICOS_S4 = {
  race_id: "picos", stage_number: 4, profile_type: "high_mountain", finale_type: "descent",
  distance_km: 160, elevation_gain_m: 5283,
  climbs: [
    { name: "Alto de Peña Blanca", category: "1", crest_km: 62, length_km: 12.2, avg_gradient: 7.5, summit_finish: false },
    { name: "Alto de Ancares", category: "1", crest_km: 84, length_km: 15.4, avg_gradient: 7.2, summit_finish: false },
    { name: "Puerto de Montaña", category: "1", crest_km: 106, length_km: 13.1, avg_gradient: 7.8, summit_finish: false },
    { name: "Alto de El Cordal", category: "HC", crest_km: 140, length_km: 13.7, avg_gradient: 8.3, summit_finish: false },
  ],
  sprints: [{ name: "Intermediate Sprint", km: 70, kind: "intermediate" }, { name: "Finish", km: 160, kind: "finish" }],
  sectors: [],
};
const IBERICA_S20 = {
  race_id: "iberica", stage_number: 20, profile_type: "high_mountain", finale_type: "long_climb",
  distance_km: 170, elevation_gain_m: 5286,
  climbs: [
    { name: "Coll de Ancares", category: "1", crest_km: 66, length_km: 14.2, avg_gradient: 6.6, summit_finish: false },
    { name: "Coll de Navacerrada", category: "1", crest_km: 89, length_km: 12.2, avg_gradient: 7.1, summit_finish: false },
    { name: "Puerto de Ancares", category: "1", crest_km: 113, length_km: 13.7, avg_gradient: 8.2, summit_finish: false },
    { name: "Alto de El Cordal", category: "HC", crest_km: 170, length_km: 14, avg_gradient: 9, summit_finish: true },
  ],
  sprints: [{ name: "Finish", km: 170, kind: "finish" }], sectors: [],
};
const VLAAMSE_S1 = {
  race_id: "vlaamse", stage_number: 1, profile_type: "cobbles", finale_type: "reduced_sprint",
  distance_km: 155, elevation_gain_m: 400, climbs: [],
  sprints: [{ name: "Finish", km: 155, kind: "finish" }],
  sectors: [
    { kind: "cobbles", name: "Pavé Stretch 1", start_km: 70, length_km: 1.7 },
    { kind: "cobbles", name: "Cobbled Sector 2", start_km: 78, length_km: 2.3 },
    { kind: "cobbles", name: "Pavé Stretch 3", start_km: 89, length_km: 2.1 },
    { kind: "cobbles", name: "Cobbled Sector 4", start_km: 102, length_km: 2.7 },
    { kind: "cobbles", name: "Cobbled Sector 5", start_km: 113, length_km: 2.7 },
  ],
};
const PROLOG = {
  race_id: "penisola", stage_number: 1, profile_type: "itt", finale_type: "solo_tt",
  distance_km: 6, elevation_gain_m: 80, climbs: [],
  sprints: [{ name: "Finish", km: 6, kind: "finish" }], sectors: [],
};
const CANTABRICO = {
  race_id: "cantabrico", stage_number: 1, profile_type: "classic", finale_type: "long_climb",
  distance_km: 235, elevation_gain_m: 2795,
  climbs: [
    { name: "Alto de Robledo", category: "3", crest_km: 85, length_km: 4.5, avg_gradient: 5.1, summit_finish: false },
    { name: "Alto de Peña Blanca", category: "3", crest_km: 110, length_km: 4.3, avg_gradient: 5.8, summit_finish: false },
    { name: "Alto de Valdeón", category: "3", crest_km: 136, length_km: 3.8, avg_gradient: 5, summit_finish: false },
    { name: "Puerto de Peña Blanca", category: "2", crest_km: 162, length_km: 7.4, avg_gradient: 6.4, summit_finish: false },
    { name: "Alto de Navacerrada", category: "1", crest_km: 235, length_km: 10.9, avg_gradient: 6.9, summit_finish: true },
  ],
  sprints: [{ name: "Finish", km: 235, kind: "finish" }], sectors: [],
};
export const FIXTURES = { PICOS_S4, IBERICA_S20, VLAAMSE_S1, PROLOG, CANTABRICO };

function totalAscent(ys) {
  let a = 0;
  for (let i = 1; i < ys.length; i++) if (ys[i] > ys[i - 1]) a += ys[i] - ys[i - 1];
  return a;
}

test("hasRouteData: kræver distance_km — alt andet er valgfrit", () => {
  assert.equal(hasRouteData(PICOS_S4), true);
  assert.equal(hasRouteData(PROLOG), true, "flad ITT uden climbs har stadig en rute");
  assert.equal(hasRouteData({ profile_type: "flat", distance_km: null }), false);
  assert.equal(hasRouteData({ profile_type: "flat" }), false);
  assert.equal(hasRouteData(null), false);
  assert.equal(hasRouteData(undefined), false);
});

test("INVARIANT: kurvens samlede stigning == elevation_gain_m (±0,5 m) på alle 5 ægte etapetyper", () => {
  for (const [name, st] of Object.entries(FIXTURES)) {
    const { ys } = buildProfileSeries(st);
    const diff = Math.abs(totalAscent(ys) - st.elevation_gain_m);
    assert.ok(diff <= 0.5, `${name}: afvigelse ${diff.toFixed(3)} m > 0,5 m`);
  }
});

test("determinisme: samme række → bit-identisk serie", () => {
  const a = buildProfileSeries(PICOS_S4);
  const b = buildProfileSeries({ ...PICOS_S4, climbs: PICOS_S4.climbs.map((c) => ({ ...c })) });
  assert.deepEqual(a.ys, b.ys);
  assert.deepEqual(a.xs, b.xs);
});

test("hver stigning rejser sig præcis sin egen højdemeter fra fod til top", () => {
  const { xs, ys, spans } = buildProfileSeries(PICOS_S4);
  assert.equal(spans.length, 4, "én span pr. stigning");
  const nearest = (km) => xs.reduce((best, x, i) => (Math.abs(x - km) < Math.abs(xs[best] - km) ? i : best), 0);
  PICOS_S4.climbs.forEach((c, i) => {
    const [foot, crest] = spans[i];
    const gain = Math.round((c.length_km * 1000 * c.avg_gradient) / 100);
    const measured = ys[nearest(crest)] - ys[nearest(foot)];
    // Bølgen er maskeret på rampen, så fod→top ER stigningens egen højdemeter.
    // Tolerancen dækker kun at samplingen ikke rammer fod/top præcist.
    assert.ok(Math.abs(measured - gain) < 25, `${c.name}: målte ${measured.toFixed(0)} m, forventede ${gain} m`);
  });
});

test("højeste punkt ligger PÅ en stigningstop, ikke i bølgeterrænet", () => {
  for (const st of [PICOS_S4, IBERICA_S20, CANTABRICO]) {
    const { xs, ys, spans } = buildProfileSeries(st);
    const peakKm = xs[ys.reduce((b, y, i) => (y > ys[b] ? i : b), 0)];
    const onACrest = spans.some(([, crest]) => Math.abs(peakKm - crest) < 2);
    assert.ok(onACrest, `${st.race_id}: toppunkt ved km ${peakKm.toFixed(0)} er ikke en stigningstop`);
  }
});

// Bølgeamplituden er kalibreringens kanariefugl. Bliver nedkørsels-loftet fjernet
// eller bølgelængderne for lange, må bisektionen skrue amplituden op i flere
// hundrede meter for at nå elevation_gain_m — og profilen får falske bjerge
// højere end etapens HC-stigning. Målt på de fem fixtures: 8-68 m.
test("bølgeamplituden holder sig i realistisk, ikke-kategoriseret terræn (<120 m)", () => {
  for (const [name, st] of Object.entries(FIXTURES)) {
    const { waveAmplitude } = buildProfileSeries(st);
    assert.ok(waveAmplitude < 120, `${name}: amplitude ${waveAmplitude.toFixed(0)} m — kalibreringen er brudt`);
  }
});

test("prolog: 6 km / 80 hm giver ikke en bjergvæg (maks 120 m over dalen)", () => {
  const { ys } = buildProfileSeries(PROLOG);
  assert.ok(Math.max(...ys) - 180 <= 120, `prolog toppede i ${Math.max(...ys)} m`);
});

test("nedkørslen er begrænset — ruten falder aldrig stejlere end ~65 m/km", () => {
  const { xs, ys, spans } = buildProfileSeries(PICOS_S4);
  const inClimb = (x) => spans.some(([a, b]) => x >= a && x <= b);
  for (let i = 1; i < xs.length; i++) {
    if (inClimb(xs[i]) || inClimb(xs[i - 1])) continue;
    const slope = (ys[i] - ys[i - 1]) / (xs[i] - xs[i - 1]);
    // Bølgen lægger sin egen hældning oveni; 65 m/km base + bølgens bidrag.
    assert.ok(slope > -260, `fald på ${slope.toFixed(0)} m/km ved km ${xs[i].toFixed(1)}`);
  }
});

test("summit finish: seriens sidste punkt ER toppen", () => {
  const { ys } = buildProfileSeries(IBERICA_S20);
  assert.equal(ys[ys.length - 1], Math.max(...ys));
});

test("dal-finish: sidste punkt ligger i dal-højde, ikke på toppen", () => {
  const { ys } = buildProfileSeries(PICOS_S4);
  assert.ok(ys[ys.length - 1] < Math.max(...ys) * 0.5);
});

test("yMax-override: fælles skala ændrer ikke geometrien, kun det rapporterede loft", () => {
  const solo = buildProfileSeries(VLAAMSE_S1);
  const shared = buildProfileSeries(VLAAMSE_S1, { yMax: 2000 });
  assert.deepEqual(solo.ys, shared.ys, "kurven må ikke ændre sig");
  assert.equal(shared.maxY, 2000);
});

test("uden rutedata kastes ikke — der returneres null", () => {
  assert.equal(buildProfileSeries({ profile_type: "flat" }), null);
  assert.equal(buildProfileSeries(null), null);
});

// sharedYMax bruges af etape-striben (Task 7), men hører hjemme her sammen med
// resten af geometrien — den er ren afledning af buildProfileSeries.
test("sharedYMax: loftet er den højeste etapes top, ikke hver etapes egen", () => {
  const y = sharedYMax([VLAAMSE_S1, PICOS_S4, PROLOG]);
  assert.equal(y, buildProfileSeries(PICOS_S4).maxY, "bjergetapen sætter loftet");
  assert.ok(y > buildProfileSeries(VLAAMSE_S1).maxY * 3, "brosten-etapen skal blive lav");
});

test("sharedYMax: etaper uden rutedata ignoreres; ingen rutedata → null", () => {
  assert.equal(sharedYMax([{ profile_type: "flat" }]), null);
  assert.equal(sharedYMax([]), null);
  assert.equal(sharedYMax([{ profile_type: "flat" }, PROLOG]), buildProfileSeries(PROLOG).maxY);
});
```

- [ ] **Step 2: Kør testen og bekræft at den fejler**

Run: `cd frontend && node --test src/lib/stageRouteProfile.test.js`
Expected: FAIL — `Cannot find module './stageRouteProfile.js'`

- [ ] **Step 3: Implementér `stageRouteProfile.js` (geometri-delen)**

Opret `frontend/src/lib/stageRouteProfile.js`. Denne kode er prototypet og verificeret mod prod-data 2026-07-22 (0,000 m afvigelse på alle fem fixtures) — port den som den er:

```js
// Sub-4 (#2448): etapeprofil-geometri + motor-aflæsning. Ren .js uden React/DOM,
// så `node --test` kan loade modulet direkte (samme mønster som stageProfileConfig.js).
//
// SANDHEDSPRINCIP (ejer 2026-07-22): alt på grafen kommer 1:1 fra race_stage_profiles,
// og alt motoren konsumerer skal kunne aflæses på grafen. Der findes INGEN punkt-for-
// punkt-højdedata; silhuetten SYNTETISERES herunder — men bundet af en invariant:
// kurvens samlede positive stigning er nøjagtig elevation_gain_m. En stignings
// placering, længde, stejlhed og højde er derfor sande; kun bølgeterrænet mellem
// stigningerne er fri form, og selv dens samlede stigning er bundet.

/** Dal-reference i meter. Rent visuelt nulpunkt — ikke en påstand om havhøjde. */
export const VALLEY_M = 180;
/**
 * Loft på hvor stejlt ruten falder fra en top (m/km ≈ 6,5 %). Ligger næste stigning
 * tæt, når ruten ALDRIG ned i dalen — den næste starter fra den højde nedkørslen
 * nåede, sådan som et bjergmassiv faktisk ser ud. Uden loftet bliver faldene absurde
 * (Picos etape 4: 915 hm på 6,6 km = 14 % nedad i seks kilometer), og bølgen kan
 * kun bidrage positivt hvis dens amplitude er flere hundrede meter.
 */
export const DESCENT_M_PER_KM = 65;
/** Blødt bånd (km) hvor bølgen fades ud mod en stignings-rampe, så ramperne er rene. */
const FADE_KM = 3;
/** Antal samplede punkter på kurven. Fast → determinisme. */
const SAMPLES = 420;
const TAU = 6.283185307179586;

/** Højdemeter for én stigning — SAMME formel som backend raceRouteGenerator.elevationGain(). */
export function climbGainM(climb) {
  return Math.round((Number(climb.length_km) * 1000 * Number(climb.avg_gradient)) / 100);
}

/** FNV-1a 32-bit — lokal kopi af backendens stableSeed (ingen cross-import i browser-kode). */
export function stableSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/**
 * Gaten for hele Sub-4-fladen. distance_km er det ENESTE påkrævede felt:
 * en flad ITT uden climbs har stadig en ægte rute, mens et S1/PCM-løb uden
 * rutedata skal falde tilbage til #1484-piktogrammet (ingen syntetisk kurve).
 */
export function hasRouteData(profile) {
  return Number.isFinite(Number(profile?.distance_km)) && Number(profile.distance_km) > 0;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/**
 * Syntetisér etapens højdekurve.
 * @param {object} profile  race_stage_profiles-række
 * @param {{yMax?:number}} [opts]  yMax = fælles y-loft (etape-striben); ændrer IKKE kurven
 * @returns {{xs:number[], ys:number[], spans:[number,number][], climbs:object[], maxY:number, ascent:number}|null}
 */
export function buildProfileSeries(profile, opts = {}) {
  if (!hasRouteData(profile)) return null;
  const D = Number(profile.distance_km);
  const climbs = (Array.isArray(profile.climbs) ? profile.climbs : [])
    .slice()
    .sort((a, b) => Number(a.crest_km) - Number(b.crest_km));

  // 1) Knuder: fod → top → begrænset nedkørsel → fod …
  const knots = [[0, VALLEY_M]];
  const spans = [];
  let prevKm = 0, prevAlt = VALLEY_M;
  for (const c of climbs) {
    const crest = Number(c.crest_km);
    const foot = Math.max(prevKm + 0.5, Math.min(crest - Number(c.length_km), crest - 0.5));
    const footAlt = Math.max(VALLEY_M, prevAlt - DESCENT_M_PER_KM * (foot - prevKm));
    if (foot > knots[knots.length - 1][0]) knots.push([foot, footAlt]);
    const crestAlt = footAlt + climbGainM(c);
    knots.push([crest, crestAlt]);
    spans.push([foot, crest]);
    prevKm = crest; prevAlt = crestAlt;
  }
  if (prevKm < D) {
    knots.push([D, Math.max(VALLEY_M, prevAlt - DESCENT_M_PER_KM * (D - prevKm))]);
  }

  const at = (x) => {
    for (let i = 1; i < knots.length; i++) {
      if (x <= knots[i][0]) {
        const [x0, y0] = knots[i - 1];
        const [x1, y1] = knots[i];
        return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      }
    }
    return knots[knots.length - 1][1];
  };
  const mask = (x) => {
    let m = 1;
    for (const [a, b] of spans) {
      if (x >= a && x <= b) return 0;
      const d = x < a ? a - x : x - b;
      if (d < FADE_KM) m = Math.min(m, d / FADE_KM);
    }
    return m;
  };

  // 2) Bølgeterræn. Faser fra en stabil hash (aldrig Math.random/Date).
  // Bølgelængderne er KORTE med vilje: bølgen repræsenterer ikke-kategoriseret
  // terræn (BASE_ELEVATION), altså mange små bump. Med lange bølger skal de få
  // perioder bære hele restbeløbet, og amplituden ryger op i flere hundrede meter.
  // NB: perioden er bølgelængden — derfor TAU*x/L, ikke x/L (den fejl gav
  // 25 km-bølger hvor der skulle være 4 km, og amplituder på ±800 m).
  const seed = stableSeed(`${profile.race_id ?? ""}#${profile.stage_number ?? 1}#${D}`);
  const p1 = ((seed % 1000) / 1000) * TAU;
  const p2 = (((seed >>> 10) % 1000) / 1000) * TAU;
  const L1 = clamp(D / 40, 0.8, 5.0), L2 = clamp(D / 15, 2.0, 14.0), L3 = clamp(D / 80, 0.4, 2.5);

  // Samplepunkter = jævn opløsning UNION alle knude-positioner. Uden knuderne
  // rammer rasteret sjældent en top præcist, og en HC-spids kan blive skåret
  // 30 m af (målt) — både geometrisk forkert og visuelt afrundet.
  const xs = [];
  for (let i = 0; i <= SAMPLES; i++) xs.push((D * i) / SAMPLES);
  for (const [kx] of knots) xs.push(kx);
  xs.sort((a, b) => a - b);
  for (let i = xs.length - 1; i > 0; i--) if (xs[i] - xs[i - 1] < 1e-9) xs.splice(i, 1);
  const N = xs.length - 1;

  const base = [], wav = [];
  for (let i = 0; i <= N; i++) {
    const x = xs[i];
    base.push(at(x));
    wav.push(mask(x) * (
      Math.sin((TAU * x) / L1 + p1)
      + 0.55 * Math.sin((TAU * x) / L2 + p2)
      + 0.3 * Math.sin((TAU * x) / L3 + p1 * 2)
    ));
  }
  // Nulstil bølgen ved start (rent konstant offset → invarianten er uændret),
  // så ruten altid begynder i dal-højde i stedet for på en tilfældig bølgetop.
  const w0 = wav[0];
  for (let i = 0; i <= N; i++) wav[i] -= w0;

  const ascentAt = (s) => {
    let a = 0;
    for (let i = 1; i <= N; i++) {
      const d = base[i] + s * wav[i] - (base[i - 1] + s * wav[i - 1]);
      if (d > 0) a += d;
    }
    return a;
  };

  // 3) INVARIANTEN: bisektér bølgens amplitude, så samlet stigning == elevation_gain_m.
  // Stignings-ramperne bidrager allerede med deres egen sum; bølgen absorberer
  // præcis det generatoren lagde oveni som BASE_ELEVATION[profile_type].
  const target = Number(profile.elevation_gain_m);
  let s = 0;
  if (Number.isFinite(target) && target > ascentAt(0)) {
    let lo = 0, hi = 8;
    while (ascentAt(hi) < target && hi < 4096) hi *= 2;
    for (let k = 0; k < 55; k++) {
      const mid = (lo + hi) / 2;
      if (ascentAt(mid) < target) lo = mid; else hi = mid;
    }
    s = (lo + hi) / 2;
  }
  const ys = xs.map((x, i) => Math.max(20, base[i] + s * wav[i]));
  const peak = Math.max(...ys);
  return {
    xs, ys, spans, climbs,
    maxY: Number.isFinite(opts.yMax) ? opts.yMax : peak,
    ascent: ascentAt(s),
    // Bølgens top-til-bund-udsving. Kalibreringens kanariefugl — se testen.
    waveAmplitude: s * 1.85,
  };
}

/**
 * Fælles y-loft for et løbs etaper. Uden det ville hver mini-profil skalere til
 * sin egen top, og en flad etape ville se lige så bjergrig ud som en HC-dag.
 * @returns {number|null} null hvis ingen af etaperne har rutedata
 */
export function sharedYMax(profiles) {
  let max = null;
  for (const p of profiles || []) {
    const s = buildProfileSeries(p);
    if (s && (max === null || s.maxY > max)) max = s.maxY;
  }
  return max;
}
```

**Denne kode er kørt og verificeret 2026-07-22:** 14/14 tests grønne, invarianten eksakt (≤0,5 m) på alle fem fixtures, bølgeamplituder 8/9/27/60/70 m. Port den ordret — ændrer du kalibreringen (nedkørsels-loft eller bølgelængder), fejler amplitude-testen.

- [ ] **Step 4: Kør testen og bekræft at den passer**

Run: `cd frontend && node --test src/lib/stageRouteProfile.test.js`
Expected: PASS — 9 tests, 0 fail. Fejler invariant-testen, er bisektionen brudt; fejler prolog-testen, er bølgelængde-skaleringen brudt.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/stageRouteProfile.js frontend/src/lib/stageRouteProfile.test.js
git commit -m "feat(race): #2448 etapeprofil-geometri m. eksakt hoejdemeter-invariant"
```

---

## Task 2: Motor-aflæsning + drift-guard

**Files:**
- Modify: `frontend/src/lib/stageRouteProfile.js`
- Modify: `frontend/src/lib/stageRouteProfile.test.js`

- [ ] **Step 1: Skriv de fejlende tests**

Tilføj nederst i `frontend/src/lib/stageRouteProfile.test.js`:

```js
import { routeReadKeys, komPointsForClimb, waypointsFor,
  KOM_SCALES, GREEN_FINISH_SCALES, INTERMEDIATE_SPRINT_SCALE,
  FINISH_BONUS_SECONDS, INTERMEDIATE_BONUS_SECONDS,
  TECHNICAL_DESCENT_WINDOW_KM, VALLEY_MIN_DESCENT_KM, DISTANCE_BAND_MIDPOINTS } from "./stageRouteProfile.js";

test("routeReadKeys: dal-finish + teknisk finale på Picos etape 4", () => {
  const keys = routeReadKeys(FIXTURES.PICOS_S4);
  const byKey = Object.fromEntries(keys.map((k) => [k.key, k.params]));
  assert.ok("valley" in byKey, "20 km nedkørsel skal give valley-chip");
  assert.equal(byKey.valley.km, 20);
  assert.ok("technical" in byKey, "finale_type=descent er teknisk finale");
  assert.ok(!("summit" in byKey));
});

test("routeReadKeys: summit finish udelukker valley", () => {
  const keys = routeReadKeys(FIXTURES.IBERICA_S20).map((k) => k.key);
  assert.ok(keys.includes("summit"));
  assert.ok(!keys.includes("valley"));
});

test("routeReadKeys: brosten-sektor i de sidste 10 km giver teknisk finale", () => {
  const st = { ...FIXTURES.VLAAMSE_S1, distance_km: 120 }; // sidste sektor slutter km 115,7 ≥ 110
  assert.ok(routeReadKeys(st).some((k) => k.key === "technical"));
});

test("routeReadKeys: brosten-chip bærer antallet", () => {
  const cob = routeReadKeys(FIXTURES.VLAAMSE_S1).find((k) => k.key === "cobbles");
  assert.equal(cob.params.count, 5);
});

test("routeReadKeys: lang/kort dag mod profilens bånd-midtpunkt", () => {
  const long = routeReadKeys({ profile_type: "flat", distance_km: 200, elevation_gain_m: 200, climbs: [], sectors: [] });
  assert.ok(long.some((k) => k.key === "long"), "200/175 = 1,14 → lang dag");
  const short = routeReadKeys({ profile_type: "flat", distance_km: 150, elevation_gain_m: 200, climbs: [], sectors: [] });
  assert.ok(short.some((k) => k.key === "short"), "150/175 = 0,86 → kort dag");
  const neutral = routeReadKeys({ profile_type: "flat", distance_km: 175, elevation_gain_m: 200, climbs: [], sectors: [] });
  assert.ok(!neutral.some((k) => k.key === "long" || k.key === "short"));
});

test("komPointsForClimb: Sub-2-skala, dobbelt ved summit HC/1", () => {
  assert.equal(komPointsForClimb({ category: "HC", summit_finish: false }), 20);
  assert.equal(komPointsForClimb({ category: "HC", summit_finish: true }), 40);
  assert.equal(komPointsForClimb({ category: "1", summit_finish: true }), 20);
  assert.equal(komPointsForClimb({ category: "2", summit_finish: true }), 5, "kun HC/1 fordobles");
  assert.equal(komPointsForClimb({ category: "4", summit_finish: false }), 1);
});

test("waypointsFor: stigninger + mellemsprints + mål, sorteret på km", () => {
  const wps = waypointsFor(FIXTURES.PICOS_S4);
  assert.deepEqual(wps.map((w) => w.kind), ["sprint", "kom", "kom", "kom", "kom", "finish"]);
  assert.deepEqual(wps.map((w) => w.km), [70, 62, 84, 106, 140, 160].sort((a, b) => a - b));
  assert.equal(wps.find((w) => w.kind === "finish").km, 160);
  const hc = wps.find((w) => w.category === "HC");
  assert.equal(hc.index, 3, "index = position i climbs[], matcher race_stage_passages.waypoint_index");
  assert.equal(hc.points, 20);
});

test("waypointsFor: uden rutedata → tom liste (ingen kast)", () => {
  assert.deepEqual(waypointsFor({ profile_type: "flat" }), []);
});

// ── DRIFT-GUARD: frontendens tærskler MOD motorens ────────────────────────────
// Frontend duplikerer konstanterne (backend-kode må ikke bundles ind i browseren),
// men de må ALDRIG drive fra hinanden. Ændrer nogen en motor-konstant uden at
// rette grafen, bliver denne test rød. Begge backend-moduler har kun relative
// imports, så de kan loades herfra uden backendens node_modules.
test("drift-guard: passage-skalaerne matcher backend/lib/racePassages.js", async () => {
  const be = await import("../../../backend/lib/racePassages.js");
  assert.deepEqual(KOM_SCALES, be.KOM_SCALES);
  assert.deepEqual(GREEN_FINISH_SCALES, be.GREEN_FINISH_SCALES);
  assert.deepEqual(INTERMEDIATE_SPRINT_SCALE, be.INTERMEDIATE_SPRINT_SCALE);
  assert.deepEqual(FINISH_BONUS_SECONDS, be.FINISH_BONUS_SECONDS);
  assert.deepEqual(INTERMEDIATE_BONUS_SECONDS, be.INTERMEDIATE_BONUS_SECONDS);
});

test("drift-guard: finale-tærsklerne matcher backend/lib/raceSimulator.js", async () => {
  const be = await import("../../../backend/lib/raceSimulator.js");
  assert.deepEqual(TECHNICAL_DESCENT_WINDOW_KM, be.TECHNICAL_DESCENT_WINDOW_KM);
  assert.equal(VALLEY_MIN_DESCENT_KM, be.VALLEY_MIN_DESCENT_KM);
  assert.deepEqual(DISTANCE_BAND_MIDPOINTS, be.DISTANCE_BAND_MIDPOINTS);
});
```

- [ ] **Step 2: Kør testene og bekræft at de fejler**

Run: `cd frontend && node --test src/lib/stageRouteProfile.test.js`
Expected: FAIL — `routeReadKeys is not a function` (og øvrige manglende eksporter).

- [ ] **Step 3: Implementér motor-aflæsningen**

Tilføj i `frontend/src/lib/stageRouteProfile.js`:

```js
// ── Motor-konstanter (duplikeret fra backend; drift-guard-test holder dem i sync) ──
// Kilde: backend/lib/racePassages.js
export const KOM_SCALES = Object.freeze({
  HC: [20, 15, 12, 10, 8, 6, 4, 2],
  "1": [10, 8, 6, 4, 2, 1],
  "2": [5, 3, 2, 1],
  "3": [2, 1],
  "4": [1],
});
export const GREEN_FINISH_SCALES = Object.freeze({
  flat: [50, 30, 20, 18, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2],
  cobbles: [50, 30, 20, 18, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2],
  rolling: [30, 25, 22, 19, 17, 15, 13, 11, 9, 7, 6, 5, 4, 3, 2],
  hilly: [30, 25, 22, 19, 17, 15, 13, 11, 9, 7, 6, 5, 4, 3, 2],
  mountain: [20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
  high_mountain: [20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
  itt: [20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
  ttt: [20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
  classic: [30, 25, 22, 19, 17, 15, 13, 11, 9, 7, 6, 5, 4, 3, 2],
});
export const INTERMEDIATE_SPRINT_SCALE = Object.freeze([20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
export const FINISH_BONUS_SECONDS = Object.freeze([10, 6, 4]);
export const INTERMEDIATE_BONUS_SECONDS = Object.freeze([3, 2, 1]);
// Kilde: backend/lib/raceSimulator.js
export const TECHNICAL_DESCENT_WINDOW_KM = Object.freeze([3, 12]);
export const VALLEY_MIN_DESCENT_KM = 10;
export const DISTANCE_BAND_MIDPOINTS = Object.freeze({
  flat: 175, rolling: 170, hilly: 185, mountain: 170, high_mountain: 160,
  cobbles: 160, classic: 230, itt: 27.5, ttt: 35,
});
// Sub-4's EGNE præsentations-tærskler for lang/kort dag. Motoren har ingen
// diskret grænse (distanceFactor clampes blødt til [0,85, 1,20]) — de her
// findes kun for at afgøre hvornår chippen er værd at vise.
export const LONG_DAY_RATIO = 1.06;
export const SHORT_DAY_RATIO = 0.94;

/** KOM-point for førstepladsen på en stigning. Tour-reglen: summit-finish på HC/1 = dobbelt. */
export function komPointsForClimb(climb) {
  const scale = KOM_SCALES[climb?.category];
  if (!scale) return 0;
  const doubled = climb.summit_finish && (climb.category === "HC" || climb.category === "1");
  return scale[0] * (doubled ? 2 : 1);
}

function sortedClimbs(profile) {
  return (Array.isArray(profile?.climbs) ? profile.climbs : [])
    .slice().sort((a, b) => Number(a.crest_km) - Number(b.crest_km));
}

/**
 * Hvad ruten GØR ved løbet — betingelserne er identiske med motorens
 * (stageGapModel + isTechnicalFinale + distanceFactor i backend/lib/raceSimulator.js),
 * men kalibrerings-tallene offentliggøres IKKE (ejer-valg 2026-07-22: kvalitativ).
 * @returns {{key:string, params:object}[]} i18n-nøgle-fragmenter til detail.route.read.*
 */
export function routeReadKeys(profile) {
  if (!hasRouteData(profile)) return [];
  const out = [];
  const climbs = sortedClimbs(profile);
  const last = climbs.length ? climbs[climbs.length - 1] : null;
  const D = Number(profile.distance_km);
  const sectors = Array.isArray(profile.sectors) ? profile.sectors : [];

  if (last?.summit_finish) {
    out.push({ key: "summit", params: {} });
  } else if (last && D - Number(last.crest_km) >= VALLEY_MIN_DESCENT_KM) {
    out.push({ key: "valley", params: { km: Math.round(D - Number(last.crest_km)) } });
  }

  const gap = last ? D - Number(last.crest_km) : null;
  const technical = profile.finale_type === "descent"
    || (gap != null && gap >= TECHNICAL_DESCENT_WINDOW_KM[0] && gap <= TECHNICAL_DESCENT_WINDOW_KM[1])
    || sectors.some((s) => Number(s.start_km) + Number(s.length_km) >= D - 10);
  if (technical) out.push({ key: "technical", params: {} });

  const mid = DISTANCE_BAND_MIDPOINTS[profile.profile_type];
  if (mid) {
    const ratio = D / mid;
    if (ratio >= LONG_DAY_RATIO) out.push({ key: "long", params: {} });
    else if (ratio <= SHORT_DAY_RATIO) out.push({ key: "short", params: {} });
  }
  if (sectors.length) out.push({ key: "cobbles", params: { count: sectors.length } });
  return out;
}

/**
 * Waypoints i køre-rækkefølge. `index` matcher race_stage_passages.waypoint_index
 * (positionen i climbs[] hhv. i mellemsprint-listen), så et klik på grafen kan slå
 * Sub-2's passage-resultat op uden ekstra opslag.
 */
export function waypointsFor(profile) {
  if (!hasRouteData(profile)) return [];
  const D = Number(profile.distance_km);
  const out = [];
  sortedClimbs(profile).forEach((c, i) => {
    out.push({
      kind: "kom", index: i, name: c.name, km: Number(c.crest_km),
      category: c.category, length_km: Number(c.length_km),
      avg_gradient: Number(c.avg_gradient), summit_finish: !!c.summit_finish,
      points: komPointsForClimb(c), bonus: 0,
    });
  });
  const sprints = Array.isArray(profile.sprints) ? profile.sprints : [];
  sprints.filter((s) => s.kind === "intermediate").forEach((s, i) => {
    out.push({
      kind: "sprint", index: i, name: s.name, km: Number(s.km),
      points: INTERMEDIATE_SPRINT_SCALE[0], bonus: INTERMEDIATE_BONUS_SECONDS[0],
    });
  });
  const green = GREEN_FINISH_SCALES[profile.profile_type] || GREEN_FINISH_SCALES.flat;
  const soloStart = profile.profile_type === "itt" || profile.profile_type === "ttt";
  out.push({
    kind: "finish", index: 0, name: null, km: D,
    points: green[0], bonus: soloStart ? 0 : FINISH_BONUS_SECONDS[0],
  });
  return out.sort((a, b) => a.km - b.km);
}
```

**Bemærk til den udførende:** `GREEN_FINISH_SCALES` skal matche backendens eksport nøjagtigt. Åbn `backend/lib/racePassages.js` og kopiér den faktiske form (nøgler og værdier) — hvis backendens objekt har en anden struktur end skitsen ovenfor (fx bånd-nøgler i stedet for profil-nøgler), så ret frontend-konstanten til at spejle backend og tilpas drift-guard-testen tilsvarende. Testen er sandheden; skitsen er ikke.

- [ ] **Step 4: Kør testene**

Run: `cd frontend && node --test src/lib/stageRouteProfile.test.js`
Expected: PASS — alle tests inkl. begge drift-guards.

Fejler en drift-guard: **ret frontend-konstanten**, ikke backendens. Backend er motoren og er frossen i denne slice.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/stageRouteProfile.js frontend/src/lib/stageRouteProfile.test.js
git commit -m "feat(race): #2448 motor-aflaesning (race-read, KOM-point, waypoints) + drift-guard"
```

---

## Task 3: i18n-nøgler (en + da)

**Files:**
- Modify: `frontend/public/locales/en/races.json`
- Modify: `frontend/public/locales/da/races.json`

- [ ] **Step 1: Tilføj `detail.route` i `en/races.json`**

Indsæt objektet `route` inde i `detail`:

```json
"route": {
  "stats": { "km": "KM", "elevation": "M", "climbs": "CLIMBS" },
  "read": {
    "summit": { "label": "Summit finish", "note": "the climb is the line — no bunch finish" },
    "valley": { "label": "{{km}} km descent to the line", "note": "chasers can come back" },
    "technical": { "label": "Technical finale", "note": "descending & positioning decide it" },
    "long": { "label": "Long day", "note": "endurance & fatigue amplified" },
    "short": { "label": "Short day", "note": "fatigue damped" },
    "cobbles": { "label": "{{count}} cobbled sectors", "note": "positioning & power over pavé" }
  },
  "waypoint": {
    "climb": "Category {{cat}} climb",
    "sprint": "Intermediate sprint",
    "finish": "Finish",
    "kmMark": "km {{km}}",
    "gradient": "{{length}} km @ {{gradient}}%",
    "afterCrest": "{{km}} km after the last crest"
  },
  "atStake": "AT STAKE",
  "result": "RESULT",
  "komPoints": "{{count}} KOM pts",
  "greenPoints": "{{count}} green pts",
  "bonusSeconds": "+{{count}}s",
  "sprintMarker": "SPRINT · {{points}}p · +{{bonus}}s",
  "finishNote": "FINISH {{first}} / {{second}} / {{third}} s",
  "a11y": { "graph": "Elevation profile for stage {{number}}: {{distance}} km, {{elevation}} m of climbing, {{climbs}} categorised climbs" }
}
```

- [ ] **Step 2: Tilføj samme struktur i `da/races.json`**

```json
"route": {
  "stats": { "km": "KM", "elevation": "M", "climbs": "STIGNINGER" },
  "read": {
    "summit": { "label": "Målgang på toppen", "note": "stigningen er målstregen — ingen massespurt" },
    "valley": { "label": "{{km}} km nedkørsel til mål", "note": "forfølgerne kan nå tilbage" },
    "technical": { "label": "Teknisk finale", "note": "nedkørsel og positionering afgør det" },
    "long": { "label": "Lang dag", "note": "udholdenhed og træthed forstærkes" },
    "short": { "label": "Kort dag", "note": "træthed dæmpes" },
    "cobbles": { "label": "{{count}} brostenssektorer", "note": "positionering og styrke over brostenene" }
  },
  "waypoint": {
    "climb": "Kategori {{cat}}-stigning",
    "sprint": "Mellemsprint",
    "finish": "Mål",
    "kmMark": "km {{km}}",
    "gradient": "{{length}} km @ {{gradient}} %",
    "afterCrest": "{{km}} km efter sidste top"
  },
  "atStake": "PÅ SPIL",
  "result": "RESULTAT",
  "komPoints": "{{count}} bjergpoint",
  "greenPoints": "{{count}} pointtrøje-point",
  "bonusSeconds": "+{{count}} s",
  "sprintMarker": "SPRINT · {{points}}p · +{{bonus}}s",
  "finishNote": "MÅL {{first}} / {{second}} / {{third}} s",
  "a11y": { "graph": "Højdeprofil for etape {{number}}: {{distance}} km, {{elevation}} højdemeter, {{climbs}} kategoriserede stigninger" }
}
```

- [ ] **Step 3: Verificér nøgle-paritet**

Run:
```bash
cd frontend && node -e "const en=require('./public/locales/en/races.json').detail.route, da=require('./public/locales/da/races.json').detail.route; const walk=(o,p='')=>Object.entries(o).flatMap(([k,v])=>typeof v==='object'?walk(v,p+k+'.'):[p+k]); const a=walk(en).sort(), b=walk(da).sort(); console.log(JSON.stringify(a)===JSON.stringify(b)?'PARITET OK ('+a.length+' noegler)':'MISMATCH\nEN-only: '+a.filter(k=>!b.includes(k))+'\nDA-only: '+b.filter(k=>!a.includes(k)));"
```
Expected: `PARITET OK (26 noegler)`

- [ ] **Step 4: Kør i18n-gaten hvis repoet har en**

Run: `cd frontend && npm run lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/public/locales/en/races.json frontend/public/locales/da/races.json
git commit -m "i18n(race): #2448 detail.route noegler (en+da)"
```

---

## Task 4: SVG-rendereren `StageProfileGraph.jsx`

**Files:**
- Create: `frontend/src/components/race/StageProfileGraph.jsx`

**Reference-implementering:** den godkendte mockup-renderer. Port strukturen 1:1; den er allerede afprøvet på alle fem etapetyper. Tre tiers:

| tier | Bruges på | Indhold |
|---|---|---|
| `full` | Etapesiden | Højdeakse m. gridlines, stignings-bånd, to-niveau-labels (chip + KOM-point + navn + `km @ %`), km-akse m. ticks, waypoint-markører, sprint-linje, målflag |
| `compact` | Holdudtagelse, mobil | Bånd, kategori-chips uden navne, km-akse, markører, målflag. Ingen højdeakse, ingen labels. |
| `mini` | Etape-stribe, kalenderkort | Kun silhuet + farvede ramper + brosten-skravering. Ingen tekst, `preserveAspectRatio="none"`, `aria-hidden`. |

- [ ] **Step 1: Opret komponenten**

```jsx
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { buildProfileSeries, waypointsFor, VALLEY_M } from "../../lib/stageRouteProfile.js";

// Sub-4 (#2448): etapeprofil som SVG. Geometrien kommer fra stageRouteProfile.js;
// her bor KUN tegningen. Alle farver fra cz-tokens (#671 anti-drift): KOM-rød =
// --jersey-mountain, sprint-grøn = --jersey-points, mål/aktiv = --accent.

// Stejlhed → intensitet på rampen. Ét hue, tre trin — ikke en regnbue.
function gradientAlpha(g) { return g >= 8 ? 1 : g >= 6 ? 0.62 : 0.38; }
// Kategori-mætning: HC massiv, cat 4 svag.
const CAT_ALPHA = { HC: 1, "1": 0.8, "2": 0.55, "3": 0.34, "4": 0.2 };
const catFill = (c) => `rgb(var(--jersey-mountain-bg) / ${CAT_ALPHA[c] ?? 0.2})`;
const catText = (c) => (c === "HC" || c === "1" ? "rgb(var(--jersey-mountain-fg))" : "var(--cz-text-1)");

const PAD = {
  full:    { l: 40, r: 16, t: 74, b: 66 },
  compact: { l: 12, r: 16, t: 26, b: 34 },
  mini:    { l: 0,  r: 0,  t: 2,  b: 2 },
};

export default function StageProfileGraph({
  profile, tier = "full", width = 900, height = 340, yMax,
  activeWaypoint = null, onWaypointSelect = null, uid = "sp",
}) {
  const { t } = useTranslation("races");
  const series = useMemo(() => buildProfileSeries(profile, yMax ? { yMax } : {}), [profile, yMax]);
  const waypoints = useMemo(() => waypointsFor(profile), [profile]);
  if (!series) return null;

  const mini = tier === "mini";
  const full = tier === "full";
  const p = PAD[tier] ?? PAD.compact;
  const plotW = width - p.l - p.r;
  const plotH = height - p.t - p.b;
  const D = Number(profile.distance_km);
  const top = series.maxY * 1.12;
  const X = (km) => p.l + (km / D) * plotW;
  const Y = (m) => p.t + plotH - (m / top) * plotH;
  const baseY = p.t + plotH;

  const points = series.xs.map((x, i) => `${X(x).toFixed(1)},${Y(series.ys[i]).toFixed(1)}`).join(" ");
  const sectors = Array.isArray(profile.sectors) ? profile.sectors : [];
  const kmStep = D > 200 ? 40 : D > 60 ? 20 : D > 20 ? 5 : 1;
  const gridStep = top > 3000 ? 1000 : top > 1200 ? 500 : top > 400 ? 200 : 100;
  const gridLines = [];
  for (let m = gridStep; m <= top; m += gridStep) gridLines.push(m);
  const kmTicks = [];
  for (let k = 0; k <= D; k += kmStep) kmTicks.push(k);

  const lastClimb = series.climbs.length ? series.climbs[series.climbs.length - 1] : null;
  const finishY = lastClimb?.summit_finish ? Y(series.ys[series.ys.length - 1]) - 6 : baseY - 28;
  const axisY = baseY + (full ? 16 : 12);
  const isActive = (w) => activeWaypoint && activeWaypoint.kind === w.kind && activeWaypoint.index === w.index;
  const pick = (w) => (onWaypointSelect ? () => onWaypointSelect(w) : undefined);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="block w-full h-auto overflow-visible"
      preserveAspectRatio={mini ? "none" : undefined}
      role={mini ? undefined : "img"}
      aria-hidden={mini ? "true" : undefined}
      aria-label={mini ? undefined : t("detail.route.a11y.graph", {
        number: profile.stage_number ?? 1, distance: D,
        elevation: profile.elevation_gain_m ?? 0, climbs: series.climbs.length,
      })}
    >
      <defs>
        <pattern id={`${uid}-pave`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="5" stroke="var(--cz-text-2)" strokeOpacity="0.5" strokeWidth="1.8" />
        </pattern>
        <pattern id={`${uid}-chk`} width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="6" height="6" fill="var(--cz-text-1)" />
          <rect width="3" height="3" fill="var(--cz-bg-card)" />
          <rect x="3" y="3" width="3" height="3" fill="var(--cz-bg-card)" />
        </pattern>
      </defs>

      {full && gridLines.map((m) => (
        <g key={`g${m}`}>
          <line x1={p.l} y1={Y(m)} x2={width - p.r} y2={Y(m)} stroke="var(--cz-text-3)" strokeOpacity="0.2" strokeWidth="0.5" />
          <text x={p.l - 6} y={Y(m) + 3} textAnchor="end" className="fill-cz-3 font-mono" fontSize="9">{m}</text>
        </g>
      ))}

      {sectors.map((s, i) => (
        <rect key={`sec${i}`} x={X(s.start_km)} y={p.t} width={Math.max(1.4, (s.length_km / D) * plotW)}
          height={plotH} fill={`url(#${uid}-pave)`} opacity="0.5" />
      ))}

      {!mini && series.spans.map(([a, b], i) => (
        <rect key={`band${i}`} x={X(a)} y={p.t} width={X(b) - X(a)} height={plotH}
          fill="rgb(var(--jersey-mountain-bg))"
          fillOpacity={activeWaypoint?.kind === "kom" && activeWaypoint.index === i ? 0.15 : 0.045}
          stroke="rgb(var(--jersey-mountain-bg))" strokeOpacity="0.15" strokeWidth="0.5" />
      ))}

      <polygon points={`${points} ${X(D)},${baseY} ${X(0)},${baseY}`} fill="var(--cz-text-1)" fillOpacity="0.09" />
      <polyline points={points} fill="none" stroke="var(--cz-text-1)" strokeWidth={mini ? 1 : 1.2}
        strokeLinejoin="round" strokeLinecap="round" />

      {series.climbs.map((c, i) => {
        const [a, b] = series.spans[i];
        const seg = series.xs.reduce((acc, x, k) => (x >= a - 0.4 && x <= b + 0.4
          ? acc + `${X(x).toFixed(1)},${Y(series.ys[k]).toFixed(1)} ` : acc), "");
        return (
          <polyline key={`ramp${i}`} points={seg.trim()} fill="none"
            stroke={`rgb(var(--jersey-mountain-bg) / ${gradientAlpha(c.avg_gradient)})`}
            strokeWidth={mini ? 1.6 : 2.4} strokeLinecap="round" strokeLinejoin="round" />
        );
      })}

      {!mini && series.climbs.map((c, i) => {
        const cx = X(c.crest_km);
        const crestIdx = Math.round((c.crest_km / D) * (series.xs.length - 1));
        const cy = Y(series.ys[crestIdx]);
        const labelY = (full ? 10 : 4) + (full ? i % 2 : 0) * 30;
        const w = c.category === "HC" ? 20 : 13;
        return (
          <g key={`lbl${i}`}>
            <line x1={cx} y1={cy} x2={cx} y2={labelY + (full ? 30 : 14)}
              stroke="var(--cz-text-3)" strokeOpacity="0.55" strokeWidth="0.6" strokeDasharray="2 2" />
            <rect x={cx - w / 2} y={labelY} width={w} height={12} rx="1" fill={catFill(c.category)} />
            <text x={cx} y={labelY + 8.8} textAnchor="middle" fontSize="8" fontWeight="700" fill={catText(c.category)}>
              {c.category}
            </text>
            {full && (
              <>
                <text x={cx + w / 2 + 4} y={labelY + 9} fontSize="7.5" className="font-mono"
                  fill="rgb(var(--jersey-mountain-bg))">
                  {waypoints.find((wp) => wp.kind === "kom" && wp.index === i)?.points}p
                </text>
                <text x={cx} y={labelY + 22} textAnchor="middle" fontSize="8.5" fontWeight="600"
                  className="fill-cz-1" style={{ letterSpacing: "0.05em" }}>
                  {(c.name || "").toUpperCase()}
                </text>
                <text x={cx} y={labelY + 31} textAnchor="middle" fontSize="8" className="fill-cz-2 font-mono">
                  {t("detail.route.waypoint.gradient", {
                    length: c.length_km.toFixed(1), gradient: c.avg_gradient.toFixed(1),
                  })}
                </text>
              </>
            )}
          </g>
        );
      })}

      {!mini && (
        <>
          <line x1={p.l} y1={axisY} x2={width - p.r} y2={axisY} stroke="var(--cz-text-3)" strokeOpacity="0.5" strokeWidth="0.7" />
          {kmTicks.map((k) => (
            <g key={`km${k}`}>
              <line x1={X(k)} y1={axisY} x2={X(k)} y2={axisY + 4} stroke="var(--cz-text-3)" strokeOpacity="0.5" strokeWidth="0.7" />
              <text x={X(k)} y={axisY + 15} textAnchor="middle" fontSize="9" className="fill-cz-3 font-mono">{k}</text>
            </g>
          ))}
          {waypoints.map((w) => {
            if (w.kind === "kom") {
              const x = X(w.km);
              return (
                <path key={`mk-kom-${w.index}`} d={`M${x - 5} ${axisY - 1} L${x} ${axisY - 10} L${x + 5} ${axisY - 1} Z`}
                  fill={catFill(w.category)} stroke={isActive(w) ? "var(--cz-text-1)" : "none"} strokeWidth="1.2"
                  className={onWaypointSelect ? "cursor-pointer" : undefined}
                  onClick={pick(w)} onMouseEnter={pick(w)} />
              );
            }
            if (w.kind === "sprint") {
              return (
                <g key={`mk-spr-${w.index}`}>
                  <line x1={X(w.km)} y1={p.t} x2={X(w.km)} y2={axisY}
                    stroke="rgb(var(--jersey-points-bg))" strokeOpacity="0.4" strokeWidth="0.7" strokeDasharray="3 3" />
                  <circle cx={X(w.km)} cy={axisY - 5} r="4.5" fill="rgb(var(--jersey-points-bg))"
                    stroke={isActive(w) ? "var(--cz-text-1)" : "none"} strokeWidth="1.2"
                    className={onWaypointSelect ? "cursor-pointer" : undefined}
                    onClick={pick(w)} onMouseEnter={pick(w)} />
                  {full && (
                    <text x={X(w.km) + 8} y={axisY - 8} fontSize="8" className="font-mono"
                      fill="rgb(var(--jersey-points-bg))">
                      {t("detail.route.sprintMarker", { points: w.points, bonus: w.bonus })}
                    </text>
                  )}
                </g>
              );
            }
            return null;
          })}
          <line x1={X(D)} y1={finishY} x2={X(D)} y2={baseY} stroke="var(--cz-text-1)" strokeWidth="1" />
          <rect x={X(D) - 13} y={finishY - 10} width="13" height="9" fill={`url(#${uid}-chk)`}
            stroke={activeWaypoint?.kind === "finish" ? "var(--cz-text-1)" : "none"} strokeWidth="1.2"
            className={onWaypointSelect ? "cursor-pointer" : undefined}
            onClick={pick(waypoints[waypoints.length - 1])} onMouseEnter={pick(waypoints[waypoints.length - 1])} />
        </>
      )}
    </svg>
  );
}
```

- [ ] **Step 2: Verificér at token-navnene findes**

De brugte CSS-variabler skal eksistere. Kør:
```bash
cd frontend && grep -n "cz-text-1\|cz-bg-card\|jersey-mountain-bg\|jersey-points-bg" src/index.css tailwind.config.js | head -20
```
Bruger projektet andre navne (fx `--text-1` uden `cz-`-præfiks, eksponeret via Tailwind som `text-cz-1`), så **ret variabelnavnene i komponenten til dem der faktisk findes** — `RaceDetailPage.jsx:60-64` viser det etablerede mønster (`rgb(var(--jersey-leader-bg))`). Ingen rå hex.

- [ ] **Step 3: Lint + build**

Run: `cd frontend && npm run lint && npx vite build`
Expected: begge grønne. `npm run lint` fanger `react-hooks`-brud (hooks skal kaldes før `if (!series) return null`).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/race/StageProfileGraph.jsx
git commit -m "feat(race): #2448 StageProfileGraph — SVG-renderer m. tre tiers"
```

---

## Task 5: Readout + kort-wrapper

**Files:**
- Create: `frontend/src/components/race/StageWaypointReadout.jsx`
- Create: `frontend/src/components/race/StageProfileCard.jsx`
- Modify: `frontend/src/lib/raceStagePassages.js`

- [ ] **Step 1: Tilføj waypoint-opslag i `raceStagePassages.js`**

Læs den eksisterende `groupPassagesForStage` først og følg dens stil. Tilføj:

```js
/**
 * Sub-4 (#2448): slå ét waypoints passage-resultat op, så et klik på grafen kan
 * vise hvem der tog point/bonussekunder der. Nøglen (kind, index) er den samme
 * som race_stage_passages.(waypoint_kind, waypoint_index) — se waypointsFor().
 * Ingen rækker (etape ikke kørt / tabel ikke migreret) → tom liste, aldrig et kast.
 */
export function passageResultsForWaypoint(passages, stageNumber, kind, index) {
  return (passages || [])
    .filter((p) => (p.stage_number ?? 1) === stageNumber
      && p.waypoint_kind === kind
      && (p.waypoint_index ?? 0) === index)
    .sort((a, b) => (a.passage_rank ?? 99) - (b.passage_rank ?? 99));
}
```

Tilføj en test i `frontend/src/lib/raceStagePassages.test.js` (opret hvis den ikke findes):

```js
import test from "node:test";
import assert from "node:assert/strict";
import { passageResultsForWaypoint } from "./raceStagePassages.js";

const ROWS = [
  { stage_number: 4, waypoint_kind: "kom", waypoint_index: 3, passage_rank: 2, rider_name: "B", points: 15 },
  { stage_number: 4, waypoint_kind: "kom", waypoint_index: 3, passage_rank: 1, rider_name: "A", points: 20 },
  { stage_number: 4, waypoint_kind: "sprint", waypoint_index: 0, passage_rank: 1, rider_name: "C", points: 20 },
  { stage_number: 5, waypoint_kind: "kom", waypoint_index: 3, passage_rank: 1, rider_name: "D", points: 20 },
];

test("passageResultsForWaypoint: filtrerer paa etape+waypoint og sorterer paa rang", () => {
  const r = passageResultsForWaypoint(ROWS, 4, "kom", 3);
  assert.deepEqual(r.map((x) => x.rider_name), ["A", "B"]);
});

test("passageResultsForWaypoint: ukendt waypoint / tom input → tom liste", () => {
  assert.deepEqual(passageResultsForWaypoint(ROWS, 4, "kom", 9), []);
  assert.deepEqual(passageResultsForWaypoint([], 4, "kom", 3), []);
  assert.deepEqual(passageResultsForWaypoint(null, 4, "kom", 3), []);
});
```

Run: `cd frontend && node --test src/lib/raceStagePassages.test.js` → PASS.

- [ ] **Step 2: Opret `StageWaypointReadout.jsx`**

```jsx
import { useTranslation } from "react-i18next";
import RiderLink from "../RiderLink";
import { passageResultsForWaypoint } from "../../lib/raceStagePassages.js";

// Sub-4 (#2448): detaljen for det valgte waypoint. To tilstande, ikke to
// komponenter: "AT STAKE" før etapen er kørt, "RESULT" når Sub-2 har skrevet
// passage-rækker. Manglende rækker er den NORMALE tilstand før løbet — aldrig
// en fejl-flade (samme ærlig-degraderings-regel som DnfSection/WhyPanel).
const TOP_N = 3;

export default function StageWaypointReadout({ waypoint, profile, passages, stageNumber }) {
  const { t } = useTranslation("races");
  if (!waypoint) return null;

  const results = passageResultsForWaypoint(passages, stageNumber, waypoint.kind, waypoint.index).slice(0, TOP_N);

  const title = waypoint.kind === "kom"
    ? waypoint.name || t("detail.route.waypoint.climb", { cat: waypoint.category })
    : waypoint.kind === "sprint"
      ? t("detail.route.waypoint.sprint")
      : t("detail.route.waypoint.finish");

  const meta = waypoint.kind === "kom"
    ? `${t("detail.route.waypoint.climb", { cat: waypoint.category })} · ${t("detail.route.waypoint.kmMark", { km: waypoint.km })} · ${t("detail.route.waypoint.gradient", { length: waypoint.length_km.toFixed(1), gradient: waypoint.avg_gradient.toFixed(1) })}`
    : t("detail.route.waypoint.kmMark", { km: waypoint.km });

  return (
    <div className="border-t border-cz-border mt-2 pt-2 flex justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        <p className="text-cz-1 text-sm font-semibold truncate">{title}</p>
        <p className="text-cz-2 text-[11px] font-mono">{meta}</p>
      </div>
      <div className="text-end min-w-[9rem]">
        <p className="text-cz-3 text-[9px] uppercase tracking-wider font-semibold mb-0.5">
          {results.length ? t("detail.route.result") : t("detail.route.atStake")}
        </p>
        {results.length ? (
          <ul>
            {results.map((r) => (
              <li key={`${r.rider_id}-${r.passage_rank}`} className="text-cz-1 text-[11px] leading-relaxed">
                {r.passage_rank}.{" "}
                <RiderLink id={r.rider_id} className="hover:text-cz-accent-t transition-colors">
                  {r.rider_name || "—"}
                </RiderLink>{" "}
                <span className="text-cz-2 font-mono">
                  {r.points > 0 && `${r.points}p`}
                  {r.points > 0 && r.bonus_seconds > 0 && " · "}
                  {r.bonus_seconds > 0 && t("detail.route.bonusSeconds", { count: r.bonus_seconds })}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-cz-2 text-[11px] font-mono">
            {waypoint.kind === "kom"
              ? t("detail.route.komPoints", { count: waypoint.points })
              : t("detail.route.greenPoints", { count: waypoint.points })}
            {waypoint.bonus > 0 && ` · ${t("detail.route.bonusSeconds", { count: waypoint.bonus })}`}
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Opret `StageProfileCard.jsx`**

```jsx
import { useMemo, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import StageProfileGraph from "./StageProfileGraph.jsx";
import StageWaypointReadout from "./StageWaypointReadout.jsx";
import { hasRouteData, routeReadKeys, waypointsFor } from "../../lib/stageRouteProfile.js";
import { formatNumber } from "../../lib/intl";

// Sub-4 (#2448): kortet der samler stat-linje + race-read + graf + readout.
// GATEN: uden rutedata renderer den INTET — kaldstedet falder tilbage til
// #1484-piktogrammet. Ingen syntetisk profil, ingen opfundne stigninger.
const READ_TONE = {
  summit: "border-cz-mountain/45 text-cz-mountain",
  valley: "border-cz-mountain/45 text-cz-mountain",
  technical: "border-cz-accent/50 text-cz-accent-t",
};

export default function StageProfileCard({ profile, stageLabel, passages = [], tier = "full" }) {
  const { t } = useTranslation("races");
  const waypoints = useMemo(() => waypointsFor(profile), [profile]);
  const reads = useMemo(() => routeReadKeys(profile), [profile]);
  const defaultWp = waypoints.length ? waypoints[waypoints.length - 1] : null;
  const [selected, setSelected] = useState(defaultWp);
  // Skift af etape skal nulstille valget — ellers hænger forrige etapes waypoint.
  useEffect(() => { setSelected(defaultWp); }, [defaultWp]);

  if (!hasRouteData(profile)) return null;
  const stageNumber = profile.stage_number ?? 1;

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz p-4">
      <div className="flex justify-between items-end gap-4 border-b border-cz-border pb-2 flex-wrap">
        <p className="text-cz-3 text-[10px] uppercase tracking-wider font-semibold">
          {stageLabel || t("detail.stageProfile.label")}
        </p>
        <div className="flex gap-4">
          <div className="text-end">
            <b className="block font-display text-xl text-cz-1 leading-none">{formatNumber(profile.distance_km)}</b>
            <span className="text-cz-3 text-[8px] tracking-widest">{t("detail.route.stats.km")}</span>
          </div>
          {profile.elevation_gain_m > 0 && (
            <div className="text-end">
              <b className="block font-display text-xl text-cz-1 leading-none">{formatNumber(profile.elevation_gain_m)}</b>
              <span className="text-cz-3 text-[8px] tracking-widest">{t("detail.route.stats.elevation")}</span>
            </div>
          )}
          {waypoints.some((w) => w.kind === "kom") && (
            <div className="text-end">
              <b className="block font-display text-xl text-cz-1 leading-none">
                {waypoints.filter((w) => w.kind === "kom").length}
              </b>
              <span className="text-cz-3 text-[8px] tracking-widest">{t("detail.route.stats.climbs")}</span>
            </div>
          )}
        </div>
      </div>

      {reads.length > 0 && (
        <div className="flex gap-1.5 flex-wrap mt-2">
          {reads.map((r) => (
            <span key={r.key}
              className={`inline-flex flex-col gap-px px-2 py-1 border bg-cz-subtle rounded-cz text-[8.5px] font-semibold uppercase tracking-wider
                ${READ_TONE[r.key] || "border-cz-border text-cz-2"}`}>
              {t(`detail.route.read.${r.key}.label`, r.params)}
              <em className="not-italic font-mono text-[8px] normal-case tracking-normal text-cz-3">
                {t(`detail.route.read.${r.key}.note`, r.params)}
              </em>
            </span>
          ))}
        </div>
      )}

      <StageProfileGraph
        profile={profile}
        tier={tier}
        width={tier === "full" ? 900 : 430}
        height={tier === "full" ? 340 : 200}
        uid={`sp-${stageNumber}`}
        activeWaypoint={selected}
        onWaypointSelect={setSelected}
      />

      <StageWaypointReadout waypoint={selected} profile={profile} passages={passages} stageNumber={stageNumber} />
    </div>
  );
}
```

**Bemærk:** `font-display` og `text-cz-mountain` findes måske ikke i Tailwind-konfigurationen. Kør `grep -n "display\|mountain" frontend/tailwind.config.js` og brug de faktiske utility-navne; findes der ingen `font-display`, tilføj Bebas-familien til konfigurationen (fonten er allerede self-hostet i `index.css`) frem for at sætte `style={{fontFamily}}` inline.

- [ ] **Step 4: Lint + build + test**

Run: `cd frontend && npm run lint && node --test && npx vite build`
Expected: alle grønne.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/race/StageWaypointReadout.jsx frontend/src/components/race/StageProfileCard.jsx frontend/src/lib/raceStagePassages.js frontend/src/lib/raceStagePassages.test.js
git commit -m "feat(race): #2448 waypoint-readout (at stake / result) + profil-kort"
```

---

## Task 6: Integrér på etapesiden

**Files:**
- Modify: `frontend/src/pages/RaceDetailPage.jsx`

- [ ] **Step 1: Udvid select'et**

I `loadAll` (`RaceDetailPage.jsx:200-204`), skift:

```js
    const profilesPromise = supabase
      .from("race_stage_profiles")
      .select("stage_number, profile_type, finale_type, demand_vector")
      .eq("race_id", raceId)
      .order("stage_number");
```

til:

```js
    // Sub-4 (#2448): rute-felterne (Sub-1) hentes med, så etapeprofil-grafen kan
    // tegnes 1:1 fra rækken. race_id følger med, fordi silhuet-syntesens seed
    // bruger den (deterministisk pr. løb+etape). Løb uden rutedata får null/[]
    // og falder tilbage til #1484-piktogrammet — degraderer som før.
    const profilesPromise = supabase
      .from("race_stage_profiles")
      .select("race_id, stage_number, profile_type, finale_type, demand_vector, distance_km, elevation_gain_m, climbs, sprints, sectors")
      .eq("race_id", raceId)
      .order("stage_number");
```

- [ ] **Step 2: Erstat den inline `StageProfileCard`**

Slet funktionerne `StageProfileCard` og `StageProfileSilhouette` nederst i filen (`RaceDetailPage.jsx:897-946`) og importér den nye komponent i toppen:

```js
import StageProfileCard from "../components/race/StageProfileCard.jsx";
import LegacyStageProfileCard from "../components/race/LegacyStageProfileCard.jsx";
```

Flyt den slettede kode til `frontend/src/components/race/LegacyStageProfileCard.jsx` **uændret** (kun `export default function LegacyStageProfileCard`), så degraderings-stien for S1/PCM-løb overlever ordret. Den importerer `profileShape`, `profileLabelKey`, `finaleLabelKey` fra `../../lib/stageProfileConfig.js`.

- [ ] **Step 3: Indfør gaten på begge kaldsteder**

Opret en lille lokal hjælper øverst i `RaceDetailPage.jsx` (efter `JERSEYS`):

```js
// Sub-4 (#2448): ét sted der afgør om en etape får den ægte rute-graf eller
// #1484-piktogrammet. Ingen rutedata → ingen syntetisk kurve (ejer-princip).
function StageProfileSlot({ profile, stageLabel, passages, tier }) {
  if (hasRouteData(profile)) {
    return <StageProfileCard profile={profile} stageLabel={stageLabel} passages={passages} tier={tier} />;
  }
  return <LegacyStageProfileCard profile={profile} stageLabel={stageLabel} />;
}
```

med `import { hasRouteData } from "../lib/stageRouteProfile.js";` i toppen.

Erstat i `StageTab` (`RaceDetailPage.jsx:807`):
```jsx
      <StageProfileCard profile={profile} />
```
med:
```jsx
      <StageProfileSlot profile={profile} passages={passages} tier="full" />
```

Erstat i enkeltdagsløbs-grenen (`RaceDetailPage.jsx:579`):
```jsx
          <StageProfileCard profile={profileByStage[1]} />
```
med:
```jsx
          <StageProfileSlot profile={profileByStage[1]} passages={passages} tier="full" />
```

- [ ] **Step 4: Kompakt graf over udtagelses-panelet**

I `race.status === "scheduled"`-blokken (`RaceDetailPage.jsx:512-522`), lige inde i `<div id="race-selection-anchor">` og FØR `<RaceSelectionPanel …>`:

```jsx
          {/* Sub-4 (#2448): ruten SKAL være synlig mens man udtager — man udtager
              til et parcours, ikke til et navn. Kompakt tier: bånd, kategori-chips,
              km-akse og race-read, men ingen højdeakse eller navne (pladsen bruges
              på selve udtagelsen). Ingen rutedata → intet kort, panelet står som før. */}
          {hasRouteData(profileByStage[scheduledStage]) && (
            <div className="mb-3">
              <StageProfileCard
                profile={profileByStage[scheduledStage]}
                stageLabel={scheduledStageNums.length > 1 ? t("detail.tabStage", { number: scheduledStage }) : undefined}
                tier="compact"
              />
            </div>
          )}
```

- [ ] **Step 5: Verificér**

Run: `cd frontend && npm run lint && node --test && npx vite build`
Expected: alle grønne.

Start preview-serveren og klik fladen igennem (`race-up-1` = kommende, `race-done-2` = kørt) — grafen kan først vises efter Task 9 giver seed-data rutefelter, så på dette tidspunkt forventes stadig #1484-piktogrammet i preview. Det er den korrekte degradering, ikke en fejl.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/RaceDetailPage.jsx frontend/src/components/race/LegacyStageProfileCard.jsx
git commit -m "feat(race): #2448 etapeprofil-graf paa etapesiden + ved holdudtagelse"
```

---

## Task 7: Etape-striben med fælles y-skala

**Files:**
- Modify: `frontend/src/components/race/StageStripe.jsx`
- Test: `frontend/src/lib/stageRouteProfile.test.js` (udvid)

**Hvorfor fælles skala:** hver mini-profil ville ellers skalere til sin egen højeste top, så en flad 200 m-etape fylder lodret præcis lige så meget som en 5.283 m-bjergetape. I en stribe hvis eneste formål er at sammenligne etaper er det direkte misvisende.

`sharedYMax` er allerede implementeret og testet i Task 1 — denne task bruger den kun.

- [ ] **Step 1: Brug den i `StageStripe.jsx`**

Erstat `MiniSilhouette` og tilføj gaten:

```jsx
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { profileShape, profileLabelKey } from "../../lib/stageProfileConfig.js";
import { hasRouteData, sharedYMax } from "../../lib/stageRouteProfile.js";
import StageProfileGraph from "./StageProfileGraph.jsx";

// #1484-piktogrammet — bevares for etaper UDEN rutedata (S1/PCM).
function LegacyMiniSilhouette({ profileType }) {
  const { points } = profileShape(profileType);
  return (
    <svg viewBox="0 0 100 24" className="w-full h-4 block" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
```

og inde i `StageStripe`, før `return`:

```jsx
  // Sub-4 (#2448): ægte mini-profiler når rutedata findes. FÆLLES y-loft over
  // hele løbet — ellers ville en flad etape fylde lodret præcis lige så meget
  // som en HC-dag, og striben ville lyve om løbets form.
  const yMax = useMemo(() => sharedYMax(stages), [stages]);
```

og i etape-knappen, erstat `<MiniSilhouette profileType={s.profile_type} />` med:

```jsx
              {hasRouteData(s) && yMax
                ? <StageProfileGraph profile={s} tier="mini" width={100} height={26} yMax={yMax} uid={`ms-${n}`} />
                : <LegacyMiniSilhouette profileType={s.profile_type} />}
```

**Vigtigt:** `RaceDetailPage.jsx:550` bygger striben for kørte løb med `profileByStage[n] || { stage_number: n, profile_type: "flat" }` — fallback-objektet har ingen `distance_km`, så `hasRouteData` returnerer korrekt `false` og piktogrammet vises. Ingen ændring nødvendig der.

- [ ] **Step 2: Kør tests + lint + build**

Run: `cd frontend && node --test && npm run lint && npx vite build`
Expected: alle grønne.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/stageRouteProfile.js frontend/src/lib/stageRouteProfile.test.js frontend/src/components/race/StageStripe.jsx
git commit -m "feat(race): #2448 mini-profiler i etape-striben m. faelles y-skala"
```

---

## Task 8: Kommende-fladens detaljepanel

**Files:**
- Modify: `frontend/src/components/race/StageDetailPanel.jsx`

- [ ] **Step 1: Byt silhuetten ud, behold terrain-DNA**

`StageDetailPanel` viser i dag piktogram-silhuet + finale-markør + terrain-DNA-bar. Rutedata skal erstatte de to første; DNA-baren bliver (den viser hvilke evner etapen kræver — et andet, komplementært udsagn).

```jsx
import { useTranslation } from "react-i18next";
import { profileShape, profileLabelKey, finaleLabelKey } from "../../lib/stageProfileConfig.js";
import { hasRouteData } from "../../lib/stageRouteProfile.js";
import StageProfileGraph from "./StageProfileGraph.jsx";
import TerrainDNABar from "./TerrainDNABar.jsx";
```

Erstat `<svg …>`-blokken + finale-markøren (`StageDetailPanel.jsx:16-32`) med:

```jsx
      {hasRouteData(profile) ? (
        // Sub-4 (#2448): ægte rute i stedet for kategori-piktogrammet.
        <StageProfileGraph profile={profile} tier="compact" width={430} height={150} uid={`sdp-${profile.stage_number ?? 1}`} />
      ) : (
        <div className="relative">
          {/* uændret #1484-fallback — behold den eksisterende markup her ordret */}
        </div>
      )}
```

Behold `profileShape`-importen og den eksisterende SVG-markup inde i `else`-grenen ordret. Behold også `labelKey`-gaten øverst (`if (!labelKey) return null`) — den er stadig den rigtige gate for ukendt terræn.

- [ ] **Step 2: Verificér**

Run: `cd frontend && npm run lint && npx vite build`
Expected: grøn.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/race/StageDetailPanel.jsx
git commit -m "feat(race): #2448 rute-graf paa kommende-fladens etapepanel"
```

---

## Task 9: Preview-seed så fladen kan testes

**Files:**
- Modify: `frontend/src/preview/seedData.js`

**Hvorfor obligatorisk:** ejeren skal kunne klikke fladen igennem på en Vercel-preview FØR merge. Uden rutefelter i seed-data viser preview kun degraderings-stien, og fladen kan ikke godkendes (#1834-erfaringen: "for ringe").

- [ ] **Step 1: Tilføj rutefelter til `SEED_STAGE_PROFILES`**

Hver række skal have `race_id` (findes allerede), `distance_km`, `elevation_gain_m`, `climbs`, `sprints`, `sectors`. Dæk mindst: summit-finish, dal-finish, brosten og en flad spurtetape. Tallene skal være internt konsistente — `elevation_gain_m` ≥ summen af `round(length_km*1000*avg_gradient/100)` for etapens stigninger, ellers står bisektionen på 0 og bølgeterrænet forsvinder.

```js
  { race_id: "race-up-1", stage_number: 1, profile_type: "flat", finale_type: "bunch_sprint",
    distance_km: 190, elevation_gain_m: 268,
    climbs: [{ name: "Côte de Beauregard", category: "4", crest_km: 172, length_km: 1.5, avg_gradient: 4.5, summit_finish: false }],
    sprints: [{ name: "Intermediate Sprint", km: 108, kind: "intermediate" }, { name: "Finish", km: 190, kind: "finish" }],
    sectors: [], demand_vector: { sprint: 0.61, acceleration: 0.15, positioning: 0.08, flat: 0.06, endurance: 0.02, randomness: 0.08 } },
  { race_id: "race-up-1", stage_number: 2, profile_type: "mountain", finale_type: "descent",
    distance_km: 180, elevation_gain_m: 2621,
    climbs: [
      { name: "Col de El Cordal", category: "3", crest_km: 78, length_km: 5, avg_gradient: 4.9, summit_finish: false },
      { name: "Côte de Covadonga", category: "3", crest_km: 111, length_km: 5.9, avg_gradient: 6.1, summit_finish: false },
      { name: "Col de Portet", category: "1", crest_km: 162, length_km: 15.5, avg_gradient: 7.2, summit_finish: false }],
    sprints: [{ name: "Intermediate Sprint", km: 77, kind: "intermediate" }, { name: "Finish", km: 180, kind: "finish" }],
    sectors: [], demand_vector: { climbing: 0.5, endurance: 0.2, tempo: 0.15, recovery: 0.1, randomness: 0.05 } },
  { race_id: "race-up-1", stage_number: 3, profile_type: "high_mountain", finale_type: "long_climb",
    distance_km: 170, elevation_gain_m: 5286,
    climbs: [
      { name: "Col de la Colombière", category: "1", crest_km: 66, length_km: 14.2, avg_gradient: 6.6, summit_finish: false },
      { name: "Col du Granier", category: "1", crest_km: 89, length_km: 12.2, avg_gradient: 7.1, summit_finish: false },
      { name: "Côte de Saint-Roch", category: "1", crest_km: 113, length_km: 13.7, avg_gradient: 8.2, summit_finish: false },
      { name: "Mont Aubisque", category: "HC", crest_km: 170, length_km: 14, avg_gradient: 9, summit_finish: true }],
    sprints: [{ name: "Finish", km: 170, kind: "finish" }],
    sectors: [], demand_vector: { punch: 0.45, climbing: 0.25, endurance: 0.15, positioning: 0.1, randomness: 0.05 } },
```

Giv `race-done-1` (cobbles) sektorer og `race-done-2` etaper med rutedata efter samme mønster — `race-done-2` etape 2 skal have `summit_finish: true` så resultat-tilstanden kan ses.

- [ ] **Step 2: Tilføj passage-rækker**

Opret `SEED_STAGE_PASSAGES` i samme fil og eksportér den. Rækkerne skal matche formen i `race_stage_passages` (`race_id, stage_number, waypoint_kind, waypoint_index, waypoint_name, waypoint_km, climb_category, rider_id, rider_name, team_id, passage_rank, points, bonus_seconds`) og bruge de rytter-id'er/navne der allerede findes i `SEED_RACE_RESULTS`, så readout'et linker til ægte preview-ryttere. Mindst: alle KOM-waypoints + mellemsprint + mål på `race-done-2` etape 2.

Wire den ind i `frontend/src/preview/mockHandlers.js` under `case "race_stage_passages":` efter samme mønster som `race_stage_profiles` (`mockHandlers.js:84`).

- [ ] **Step 3: Verificér i preview**

```bash
cd frontend && npm run dev
```
Åbn preview-fladen, gå til `race-up-1` (kommende — profil over udtagelses-panelet + i etape-striben) og `race-done-2` etape 2 (kørt — klik et KOM-mærke og se "RESULT"). Bekræft: (a) grafen vises, (b) striben viser høje bjergetaper og lave flade etaper, (c) klik på waypoint skifter readout, (d) `race-done-1`/etaper uden rutedata viser stadig #1484.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/preview/seedData.js frontend/src/preview/mockHandlers.js
git commit -m "feat(preview): #2448 rutedata + passage-raekker i seed saa profilen kan testes"
```

---

## Task 10: Playwright + fuld lokal verifikation

**Files:**
- Modify: `frontend/tests/*` (snapshots efter behov)

- [ ] **Step 1: Kør hele den lokale kæde**

```bash
cd /c/Dev/CyclingZone && pwsh -File scripts/verify-local.ps1
```
Expected: backend-tests + frontend-tests + frontend-build alle grønne.

- [ ] **Step 2: Kør eslint separat**

```bash
cd frontend && npm run lint
```
Expected: 0 errors. `verify-local` kører **ikke** eslint, og CI's `frontend-build`-job gør (`react-hooks/purity` + refs + warning-budget).

- [ ] **Step 3: Kør Playwright på alle tre projekter**

```bash
cd frontend && npx playwright test core-smoke.spec.js
```
**Uden** `--project`-flag — det kører desktop-chromium + mobile-chromium + mobile-webkit. Fejler kun mobil, er det typisk label-overløb i `compact`-tier'en; ret paddingen, opdatér ikke snapshottet blindt.

- [ ] **Step 4: Opdatér snapshots hvis den visuelle ændring er tilsigtet**

```bash
cd frontend && npx playwright test --update-snapshots
```
Kør derefter `npx playwright test core-smoke.spec.js` igen og bekræft grøn på alle tre.

- [ ] **Step 5: Commit**

```bash
git add frontend/tests
git commit -m "test(race): #2448 playwright-snapshots for etapeprofil-grafen"
```

---

## Task 11: Patch notes + hjælp

**Files:**
- Modify: `frontend/src/pages/PatchNotesPage.jsx`
- Modify: `frontend/public/locales/en/help.json` + `da/help.json`

- [ ] **Step 1: Tilføj patch note**

Læs den nyeste version øverst i `PatchNotesPage.jsx` og tilføj den næste (7.44 hvis 7.43 er nyeste — CI version-checker mod `frontend/package.json`, så bump også `version` der hvis det er konventionen i repoet; kontrollér hvordan 7.43 blev tilføjet i `git log -p --follow frontend/src/pages/PatchNotesPage.jsx | head -80`).

Indhold (EN først, DA under), spiller-sprog uden em-dash:

> **Stage profiles.** Every stage now shows its real route: the climbs with their length and gradient, the categorised summits and what they are worth in the mountains classification, the intermediate sprint, cobbled sectors, and whether the finish comes at the top of a climb or after a descent. Tap any marker to see what is at stake there, or who took it once the stage has been ridden.

- [ ] **Step 2: Tilføj hjælpe-emne**

I `help.json` (en + da), under det afsnit der dækker løb: forklar at profilen er den samme rute motoren afvikler, at kategorien afgør bjergpointene, og at en målgang på toppen giver større tidsforskelle end en målgang efter en nedkørsel. Hold nøgle-paritet mellem en og da (samme verifikations-kommando som Task 3, Step 3, med `help.json` i stedet).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/PatchNotesPage.jsx frontend/public/locales/en/help.json frontend/public/locales/da/help.json
git commit -m "docs: #2448 patch note + hjaelp for etapeprofil-grafen"
```

---

## Task 12 (GATED): Kalenderkort-thumbnail

**Files:**
- Modify: `frontend/src/pages/RacesPage.jsx`

**Gate:** denne task bygges KUN hvis målingen i Step 1 holder sig inden for budgettet. Gør den ikke, **droppes fladen** og boardet beholder sin nuværende visning. Rapportér målingen ærligt i PR-beskrivelsen uanset udfald.

- [ ] **Step 1: Mål omkostningen FØR du bygger**

Kør mod prod (læs-only) og noter tid + svar-størrelse for et realistisk board-udsnit (~40 synlige løb):

```sql
SELECT stage_number, profile_type, distance_km, elevation_gain_m, climbs, sectors
FROM race_stage_profiles
WHERE race_id IN (SELECT id FROM races WHERE season_id = (SELECT id FROM seasons WHERE number = 2) LIMIT 40);
```

Budget: **≤150 ms og ≤250 KB**. Overskrides det, spring Task 12 over, noter det i PR'en og luk fladen som "målt for dyr" i issue-tråden.

- [ ] **Step 2: Hent profiler for de synlige løb**

Tilføj en query der kun henter for de løb der faktisk renderes (`.in("race_id", visibleRaceIds)`), efter at listen er filtreret — ikke for hele kataloget. Fejl må aldrig vælte boardet: `.catch()` → tom liste, samme mønster som `passagesPromise` i `RaceDetailPage.jsx:239-249`.

- [ ] **Step 3: Render thumbnail**

- Endagsløb: én `StageProfileGraph tier="mini"` (bredde 120, højde 34).
- Etapeløb: komprimeret mini-stribe — alle etaper med **fælles** `sharedYMax`, så løbets form er sand. Én enkelt etape ville give et falsk indtryk af hele løbet.
- Løb uden rutedata: ingen thumbnail (ikke et piktogram — kortet er lille nok til at tomhed er bedre end en form der lover noget den ikke har).

- [ ] **Step 4: Verificér**

Run: `cd frontend && npm run lint && npx vite build && npx playwright test core-smoke.spec.js`
Expected: grøn på alle tre projekter. Bundle-perf-gaten i CI må ikke brydes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/RacesPage.jsx
git commit -m "feat(race): #2448 profil-thumbnail paa loebskortene"
```

---

## Afslutning

- [ ] `pwsh -File scripts/verify-local.ps1` grøn
- [ ] `cd frontend && npm run lint` grøn
- [ ] `cd frontend && npx playwright test core-smoke.spec.js` grøn på alle 3 projekter
- [ ] Preview-deploy klikket igennem med rutedata — **ejer-godkendelse før merge**
- [ ] PR oprettet med `PULL_REQUEST_TEMPLATE`, inkl. **Brugerverifikation**-sektion og skærmbilleder af den ægte flade (ikke mock-screenshots)
- [ ] `Refs #2448 #2768` i PR-beskrivelsen
- [ ] Task 12's måling rapporteret uanset udfald
