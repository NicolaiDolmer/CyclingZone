// backend/lib/raceRouteGenerator.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attachRoute,
  DISTANCE_BANDS,
  PROLOGUE_DISTANCE_BAND,
  clampSprintKm,
  sprintValleys,
  pickSprintValley,
} from "./raceRouteGenerator.js";

const race = { external_id: "abc123", season_id: "s1", name: "Vuelta Andaluza" };
const stage = (profile_type, finale_type, stage_number = 1) =>
  ({ stage_number, profile_type, finale_type, demand_vector: {} });

test("attachRoute er deterministisk (samme input → deep-equal)", () => {
  const a = attachRoute(stage("high_mountain", "long_climb"), race, true);
  const b = attachRoute(stage("high_mountain", "long_climb"), race, true);
  assert.deepEqual(a, b);
});

test("distance_km ligger i profilens bånd", () => {
  for (const [pt, [lo, hi]] of Object.entries(DISTANCE_BANDS)) {
    // Sub-3 (#2771): stage_number=2 (ikke 1) her — itt-etape 1 i et etapeløb
    // kan nu legitimt blive en 5-8 km prolog (se de dedikerede prolog-tests
    // nedenfor); denne test verificerer kun det NORMALE bånd, så vi undgår
    // stage-1-prolog-grenen for pt==="itt" ved at bruge en senere etape.
    const r = attachRoute(stage(pt, null, 2), race, true);
    assert.ok(r.distance_km >= lo && r.distance_km <= hi, `${pt}: ${r.distance_km} udenfor [${lo},${hi}]`);
  }
});

// ── Sub-3 (#2771) Task 6: prolog-arketype via rute-pass ───────────────────────
test("prolog: etape 1 i etapeløb (itt) rammer 5-8 km hos NOGLE race-identiteter, normalt bånd hos ANDRE (begge udfald over ~20 identiteter)", () => {
  let prologCount = 0;
  let normalCount = 0;
  for (let i = 0; i < 20; i++) {
    const r = attachRoute(stage("itt", null, 1), { external_id: `race-${i}`, name: "Grand Tour" }, true);
    if (r.distance_km >= PROLOGUE_DISTANCE_BAND[0] && r.distance_km <= PROLOGUE_DISTANCE_BAND[1]) prologCount++;
    else {
      normalCount++;
      assert.ok(r.distance_km >= DISTANCE_BANDS.itt[0] && r.distance_km <= DISTANCE_BANDS.itt[1]);
    }
  }
  assert.ok(prologCount > 0, "forventede mindst én prolog-udfald over 20 identiteter");
  assert.ok(normalCount > 0, "forventede mindst ét normal-bånd-udfald over 20 identiteter");
});

test("prolog: KUN etape 1 i et etapeløb kan give 5-8 km — senere itt-etaper og enkeltstående itt-løb bruger altid det normale [15,40]-bånd", () => {
  for (let i = 0; i < 15; i++) {
    const raceId = { external_id: `race-later-${i}`, name: "Grand Tour" };
    const laterStage = attachRoute(stage("itt", null, 5), raceId, true);
    assert.ok(laterStage.distance_km >= DISTANCE_BANDS.itt[0] && laterStage.distance_km <= DISTANCE_BANDS.itt[1]);
    assert.ok(laterStage.distance_km > PROLOGUE_DISTANCE_BAND[1]); // 15-40 er disjunkt fra 5-8

    const oneDayId = { external_id: `race-oneday-${i}`, name: "Klassiker" };
    const oneDay = attachRoute(stage("itt", null, 1), oneDayId, false); // isStageRace=false
    assert.ok(oneDay.distance_km >= DISTANCE_BANDS.itt[0] && oneDay.distance_km <= DISTANCE_BANDS.itt[1]);
  }
});

test("prolog: samme race-identitet → samme (etape-1-itt-)distance to gange (determinisme)", () => {
  const raceId = { external_id: "race-determinism", name: "Grand Tour" };
  const a = attachRoute(stage("itt", null, 1), raceId, true);
  const b = attachRoute(stage("itt", null, 1), raceId, true);
  assert.equal(a.distance_km, b.distance_km);
  assert.deepEqual(a, b);
});

test("summit-finale → sidste climb er summit_finish med crest = distance", () => {
  const r = attachRoute(stage("high_mountain", "long_climb"), race, true);
  assert.ok(r.climbs.length >= 1);
  const last = r.climbs[r.climbs.length - 1];
  assert.equal(last.summit_finish, true);
  assert.equal(last.crest_km, r.distance_km);
});

// ── HC-garanti på high_mountain (GT-bånd 3-8 HC) ─────────────────────────────
test("high_mountain: HVER etape har mindst én HC, og HC'en er klimakset (sidste stigning)", () => {
  for (let i = 0; i < 60; i++) {
    for (const finale of ["long_climb", "descent"]) {
      const r = attachRoute(stage("high_mountain", finale, 3), { external_id: `hm-${i}`, name: "Grand Tour" }, true);
      const hc = r.climbs.filter((c) => c.category === "HC");
      assert.ok(hc.length >= 1, `hm-${i}/${finale}: 0 HC på en high_mountain-etape`);
      // climbs er sorteret på crest_km → sidste er den afgørende stigning.
      assert.equal(r.climbs[r.climbs.length - 1].category, "HC", `hm-${i}/${finale}: klimakset var ikke HC`);
    }
  }
});

test("high_mountain: PRÆCIS én HC pr. etape → en GT's HC-total = antallet af high_mountain-etaper", () => {
  for (let i = 0; i < 60; i++) {
    for (const finale of ["long_climb", "descent"]) {
      const r = attachRoute(stage("high_mountain", finale, 3), { external_id: `hm-cap-${i}`, name: "Grand Tour" }, true);
      const hc = r.climbs.filter((c) => c.category === "HC").length;
      assert.equal(hc, 1, `hm-cap-${i}/${finale}: ${hc} HC, forventede præcis 1`);
    }
  }
});

test("HC forbliver eksklusiv for high_mountain — mountain/hilly/classic får aldrig HC", () => {
  for (const pt of ["mountain", "hilly", "classic", "rolling", "flat", "cobbles"]) {
    for (let i = 0; i < 40; i++) {
      const r = attachRoute(stage(pt, null, 3), { external_id: `nohc-${pt}-${i}`, name: "Grand Tour" }, true);
      assert.ok(r.climbs.every((c) => c.category !== "HC"), `${pt} fik en HC-stigning`);
    }
  }
});

test("descent-finale → ingen summit_finish", () => {
  const r = attachRoute(stage("mountain", "descent"), race, true);
  assert.ok(r.climbs.every((c) => c.summit_finish === false));
});

test("climbs er sorteret på crest_km stigende", () => {
  const r = attachRoute(stage("mountain", "descent"), race, true);
  for (let i = 1; i < r.climbs.length; i++) assert.ok(r.climbs[i].crest_km >= r.climbs[i - 1].crest_km);
});

test("cobbles-profil → 3–6 brosten-sektorer inden for distancen", () => {
  const r = attachRoute(stage("cobbles", "reduced_sprint"), race, true);
  assert.ok(r.sectors.length >= 3 && r.sectors.length <= 6);
  assert.ok(r.sectors.every((s) => s.kind === "cobbles" && s.start_km + s.length_km <= r.distance_km));
});

// ── #2789 fund 5 + ejer-beslutning 6/9: brostens-finaler skal kunne opstå ─────
test("#2789: cobbles/gravel får ALTID en sektor der slutter inden for 10 km af mål", () => {
  const n = 200;
  for (const [pt, finale] of [["cobbles", "reduced_sprint"], ["cobbles", "breakaway"], ["gravel", "punch"], ["gravel", "breakaway"]]) {
    for (let i = 0; i < n; i++) {
      const r = attachRoute(stage(pt, finale), { external_id: `fin-${pt}-${finale}-${i}` }, false);
      assert.ok(r.sectors.length > 0, `${pt}/${finale} seed ${i}: ingen sektorer`);
      const lastEnd = Math.max(...r.sectors.map((s) => s.start_km + s.length_km));
      const kmFromFinish = r.distance_km - lastEnd;
      assert.ok(
        kmFromFinish <= 10,
        `${pt}/${finale} seed ${i}: sidste sektor slutter ${kmFromFinish.toFixed(1)} km fra mål (skal være <= 10)`,
      );
      // Aldrig HELT på stregen: der skal være en indkørsel hvor forspringet skal holdes.
      assert.ok(kmFromFinish >= 2, `${pt}/${finale} seed ${i}: sektoren slutter ${kmFromFinish.toFixed(1)} km fra mål (skal være >= 2)`);
      // Ingen overlap mellem sektorerne (finale-sektoren må ikke lande oven i kroppen).
      const sorted = [...r.sectors].sort((a, b) => a.start_km - b.start_km);
      for (let k = 1; k < sorted.length; k++) {
        assert.ok(
          sorted[k].start_km >= sorted[k - 1].start_km + sorted[k - 1].length_km,
          `${pt}/${finale} seed ${i}: sektor ${k} overlapper den forrige`,
        );
      }
    }
  }
});

test("#2789: classic er UÆNDRET — ingen garanteret brostens-finale (ejer-gated balance-ændring)", () => {
  let near = 0;
  let withSectors = 0;
  for (let i = 0; i < 200; i++) {
    const r = attachRoute(stage("classic", "punch"), { external_id: `cl-${i}` }, false);
    if (r.sectors.length === 0) continue;
    withSectors += 1;
    const lastEnd = Math.max(...r.sectors.map((s) => s.start_km + s.length_km));
    if (r.distance_km - lastEnd <= 10) near += 1;
  }
  assert.ok(withSectors > 0, "testen målte ingen classic-etaper med sektorer");
  assert.equal(near, 0, "classic fik en brostens-finale — den er ejer-gated, ikke en oprydning");
});

test("etapeløbs-etape → mellemsprint + målspurt; endagsløb → kun målspurt", () => {
  const stageRace = attachRoute(stage("flat", "bunch_sprint"), race, true);
  assert.ok(stageRace.sprints.some((s) => s.kind === "intermediate"));
  assert.equal(stageRace.sprints[stageRace.sprints.length - 1].kind, "finish");
  const oneDay = attachRoute(stage("flat", "bunch_sprint"), race, false);
  assert.ok(oneDay.sprints.every((s) => s.kind === "finish"));
});

// ── #3546 E: uphill-finish andel for hilly/rolling ────────────────────────────
test("#3546 E: hilly rammer ~35% summit_finish over mange seeds (prod målte 0%)", () => {
  let summitCount = 0;
  const n = 400;
  for (let i = 0; i < n; i++) {
    const r = attachRoute(stage("hilly", "punch", 3), { external_id: `uh-${i}` }, true);
    const last = r.climbs[r.climbs.length - 1];
    if (last.summit_finish) {
      summitCount++;
      assert.equal(last.crest_km, r.distance_km, `${i}: summit_finish men crest (${last.crest_km}) != distance (${r.distance_km})`);
    }
  }
  const share = summitCount / n;
  assert.ok(share > 0.25 && share < 0.45, `forventede ~35% (målt ${(share * 100).toFixed(1)}%)`);
});

test("#3546 E: rolling rammer ~20% summit_finish over mange seeds (prod målte 0%)", () => {
  let summitCount = 0;
  const n = 400;
  for (let i = 0; i < n; i++) {
    const r = attachRoute(stage("rolling", "breakaway", 3), { external_id: `ur-${i}` }, true);
    if (r.climbs[r.climbs.length - 1].summit_finish) summitCount++;
  }
  const share = summitCount / n;
  assert.ok(share > 0.12 && share < 0.30, `forventede ~20% (målt ${(share * 100).toFixed(1)}%)`);
});

test("#3546 E: andre profiltyper (flad, cobbles, classic) er UPÅVIRKEDE (kun hilly/rolling får rollen)", () => {
  for (const pt of ["flat", "cobbles", "classic"]) {
    let summitCount = 0;
    for (let i = 0; i < 60; i++) {
      const r = attachRoute(stage(pt, null, 3), { external_id: `nu-${pt}-${i}` }, true);
      if (r.climbs.some((c) => c.summit_finish)) summitCount++;
    }
    assert.equal(summitCount, 0, `${pt}: fik uventet summit_finish (kun hilly/rolling skal have #3546 E-reglen)`);
  }
});

test("#3546 E: en EKSISTERENDE finale-drevet summit (long_climb) er stadig uændret (samme finale_type-sti)", () => {
  const r = attachRoute(stage("mountain", "long_climb", 3), race, true);
  assert.equal(r.climbs[r.climbs.length - 1].summit_finish, true);
});

// ── #3546 D: itt_hilly: kuperet enkeltstart-arketype ─────────────────────────
test("#3546 itt_hilly: 1-2 småstigninger, kun kat 3/4 (aldrig HC/1/2)", () => {
  for (let i = 1; i <= 30; i++) {
    const r = attachRoute(stage("itt_hilly", "solo_tt", 5), { external_id: `ih-${i}` }, true);
    assert.ok(r.climbs.length >= 1 && r.climbs.length <= 2, `${i}: ${r.climbs.length} climbs`);
    for (const c of r.climbs) assert.ok(["3", "4"].includes(c.category), `${i}: uventet kategori ${c.category}`);
  }
});

test("#3546 itt_hilly: distance IKKE afrundet til nærmeste 5 (samme tidskørsels-regel som itt/ttt)", () => {
  let sawUnrounded = false;
  for (let i = 1; i <= 40; i++) {
    const r = attachRoute(stage("itt_hilly", "solo_tt", 5), { external_id: `ihd-${i}` }, true);
    assert.ok(r.distance_km >= DISTANCE_BANDS.itt_hilly[0] && r.distance_km <= DISTANCE_BANDS.itt_hilly[1]);
    if (r.distance_km % 5 !== 0) sawUnrounded = true;
  }
  assert.ok(sawUnrounded, "forventede mindst ét ikke-5-afrundet tal over 40 forsøg (itt_hilly er en TT-profil)");
});

test("#3546 itt_hilly: ingen mellemsprint (samme regel som itt/ttt: kun målspurt)", () => {
  const r = attachRoute(stage("itt_hilly", "solo_tt", 5), race, true);
  assert.ok(r.sprints.every((s) => s.kind === "finish"), "itt_hilly-etaper må ikke have en mellemsprint");
});

test("#3546 itt_hilly: etape 1 trækker ALDRIG en prolog (kun literal 'itt' kan)", () => {
  for (let i = 1; i <= 20; i++) {
    const r = attachRoute(stage("itt_hilly", "solo_tt", 1), { external_id: `ihp-${i}` }, true);
    assert.ok(r.distance_km >= DISTANCE_BANDS.itt_hilly[0], `${i}: ${r.distance_km} under itt_hilly-båndet (uventet prolog-adfærd)`);
  }
});

// ── #2789 (bonus-fund): "itt" skalerer højdemeter med distance ───────────────
// Før rettelsen havde ALLE enkeltstarter (5-40 km, prolog såvel som normalt bånd)
// præcis 80 hm — spilleren så samme facit på en 5 km prolog og en 40 km enkeltstart.
test("#2789 itt: elevation_gain_m varierer med distance_km (ikke længere fast 80)", () => {
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    // stage_number 5: aldrig prolog-grenen, så vi tester det normale [15,40]-bånd isoleret.
    const r = attachRoute(stage("itt", null, 5), { external_id: `itt-elev-${i}` }, true);
    assert.equal(r.climbs.length, 0, "itt trækker ALDRIG climbs (CLIMB_SPEC.itt.count=[0,0])");
    seen.add(r.elevation_gain_m);
  }
  assert.ok(seen.size > 1, `forventede varierende elevation_gain_m over 30 forsøg, fik kun ${[...seen]}`);
});

test("#2789 itt: elevation_gain_m følger PRÆCIS den dokumenterede lineære distance-formel", () => {
  for (let i = 0; i < 30; i++) {
    const r = attachRoute(stage("itt", null, 5), { external_id: `itt-formula-${i}` }, true);
    const expected = Math.round(r.distance_km * (80 / 27.5));
    assert.equal(r.elevation_gain_m, expected, `distance_km=${r.distance_km}`);
  }
});

test("#2789 itt: en kort prolog (5-8 km) får MARKANT lavere elevation_gain_m end en lang enkeltstart (15-40 km)", () => {
  let prolog = null;
  for (let i = 0; i < 30 && !prolog; i++) {
    const r = attachRoute(stage("itt", null, 1), { external_id: `itt-prolog-elev-${i}`, name: "Grand Tour" }, true);
    if (r.distance_km <= PROLOGUE_DISTANCE_BAND[1]) prolog = r;
  }
  assert.ok(prolog, "forventede mindst én prolog-udfald over 30 forsøg");
  assert.ok(prolog.elevation_gain_m < 40, `prolog (${prolog.distance_km} km) fik ${prolog.elevation_gain_m} hm — forventede under 40`);
  const long = attachRoute(stage("itt", null, 5), { external_id: "itt-long-elev" }, true); // 15-40 km bånd
  assert.ok(long.elevation_gain_m > prolog.elevation_gain_m, "en længere enkeltstart bør have flere højdemeter end en prolog");
});

test("#2789 itt_hilly og ttt beholder deres EGEN elevation-logik (rører kun 'itt')", () => {
  // ttt: BASE_ELEVATION.ttt=120 er uændret fast (ttt trækker 0 climbs, samme som itt før).
  for (let i = 0; i < 15; i++) {
    const r = attachRoute(stage("ttt", null, 2), { external_id: `ttt-elev-${i}` }, true);
    assert.equal(r.climbs.length, 0);
    assert.equal(r.elevation_gain_m, 120, "ttt skal fortsat være fast 120 (kun 'itt' skalerer, jf. #2789-scope)");
  }
  // itt_hilly: climbs-baseret + egen BASE_ELEVATION (350) — ikke berørt af itt-formlen.
  for (let i = 0; i < 15; i++) {
    const r = attachRoute(stage("itt_hilly", "solo_tt", 5), { external_id: `ih-elev-${i}` }, true);
    const fromClimbs = r.climbs.reduce((s, c) => s + Math.round((c.length_km * 1000 * c.avg_gradient) / 100), 0);
    assert.equal(r.elevation_gain_m, fromClimbs + 350, "itt_hilly skal fortsat bruge fast BASE_ELEVATION.itt_hilly=350 + climbs");
  }
});

// #2789: rettelsen (itt-only, ingen ekstra rng-træk) må IKKE flytte nogen andre ruter.
// Golden fixtures nedenfor er attachRoute()-output for de samme (race-identitet,
// profile_type, stage_number)-kombinationer FØR og EFTER rettelsen — verificeret
// bit-identiske i 250/250 stikprøver (alle terræn-profiler + ttt + itt_hilly, 25
// identiteter hver) i forbindelse med denne PR. Fixtures her fanger en fremtidig
// regression, hvis nogen ved en fejl lader itt-ændringen røre den fælles rng-strøm.
test("#2789 regression: ikke-itt profiler er BIT-IDENTISKE med før rettelsen (samme seed)", () => {
  const golden = {
    flat: { distance_km: 175, elevation_gain_m: 261, climbs: [{ name: "Coll de Peña Blanca", category: "4", crest_km: 160, length_km: 1.5, avg_gradient: 4.1, summit_finish: false }], sprints: [{ name: "Intermediate Sprint", km: 96, kind: "intermediate" }, { name: "Finish", km: 175, kind: "finish" }], sectors: [] },
    hilly: { distance_km: 165, elevation_gain_m: 1793, climbs: [{ name: "Alto de Valdeón", category: "2", crest_km: 87, length_km: 5.7, avg_gradient: 6.9, summit_finish: false }, { name: "Alto de El Cordal", category: "2", crest_km: 165, length_km: 10, avg_gradient: 7, summit_finish: true }], sprints: [{ name: "Intermediate Sprint", km: 79, kind: "intermediate" }, { name: "Finish", km: 165, kind: "finish" }], sectors: [] },
    mountain: { distance_km: 165, elevation_gain_m: 2084, climbs: [{ name: "Puerto de Navacerrada", category: "3", crest_km: 72, length_km: 5.6, avg_gradient: 5.1, summit_finish: false }, { name: "Coll de El Cordal", category: "3", crest_km: 102, length_km: 6, avg_gradient: 4.7, summit_finish: false }, { name: "Coll de Ancares", category: "1", crest_km: 160, length_km: 8.8, avg_gradient: 7, summit_finish: false }], sprints: [{ name: "Intermediate Sprint", km: 79, kind: "intermediate" }, { name: "Finish", km: 165, kind: "finish" }], sectors: [] },
    cobbles: { distance_km: 170, elevation_gain_m: 400, climbs: [], sprints: [{ name: "Intermediate Sprint", km: 70, kind: "intermediate" }, { name: "Finish", km: 170, kind: "finish" }], sectors: [{ kind: "cobbles", start_km: 77, length_km: 2.6, name: "Tramo de Piedra 1" }, { kind: "cobbles", start_km: 88, length_km: 1.2, name: "Sector Adoquinado 2" }, { kind: "cobbles", start_km: 100, length_km: 1.1, name: "Sector Adoquinado 3" }, { kind: "cobbles", start_km: 112, length_km: 2.5, name: "Sector Adoquinado 4" }, { kind: "cobbles", start_km: 160, length_km: 2.1, name: "Tramo de Piedra 5" }] },
    classic: { distance_km: 230, elevation_gain_m: 3395, climbs: [{ name: "Alto de Valdeón", category: "3", crest_km: 83, length_km: 5, avg_gradient: 6.3, summit_finish: false }, { name: "Coll de Robledo", category: "2", crest_km: 108, length_km: 9.7, avg_gradient: 6.6, summit_finish: false }, { name: "Coll de Ancares", category: "2", crest_km: 133, length_km: 6.6, avg_gradient: 5.6, summit_finish: false }, { name: "Alto de Montaña", category: "2", crest_km: 159, length_km: 5, avg_gradient: 5.6, summit_finish: false }, { name: "Alto de Robledo", category: "1", crest_km: 211, length_km: 12.9, avg_gradient: 6.9, summit_finish: false }], sprints: [{ name: "Intermediate Sprint", km: 150, kind: "intermediate" }, { name: "Finish", km: 230, kind: "finish" }], sectors: [{ kind: "cobbles", start_km: 104, length_km: 2.8, name: "Tramo de Piedra 1" }, { kind: "cobbles", start_km: 111, length_km: 1.2, name: "Tramo de Piedra 2" }, { kind: "cobbles", start_km: 120, length_km: 1.8, name: "Tramo de Piedra 3" }] },
    ttt: { distance_km: 34, elevation_gain_m: 120, climbs: [], sprints: [{ name: "Finish", km: 34, kind: "finish" }], sectors: [] },
    itt_hilly: { distance_km: 17, elevation_gain_m: 663, climbs: [{ name: "Alto de Navacerrada", category: "3", crest_km: 8, length_km: 4.5, avg_gradient: 4.7, summit_finish: false }, { name: "Coll de Covadonga", category: "4", crest_km: 9, length_km: 2.1, avg_gradient: 4.8, summit_finish: false }], sprints: [{ name: "Finish", km: 17, kind: "finish" }], sectors: [] },
  };
  for (const [pt, expected] of Object.entries(golden)) {
    const finaleType = pt === "itt_hilly" ? "solo_tt" : null;
    const r = attachRoute(stage(pt, finaleType, 2), { external_id: `golden-${pt}`, season_id: "s1", name: "Vuelta Andaluza" }, true);
    assert.deepEqual(r, expected, `${pt}: rute flyttede sig — #2789-rettelsen skal kun røre 'itt'`);
  }
});

test("climb-navne er region-flavoured + ikke-tomme", () => {
  const es = attachRoute(stage("high_mountain", "long_climb"), { ...race, name: "Vuelta Burgalesa" }, true);
  assert.ok(es.climbs.every((c) => typeof c.name === "string" && c.name.length > 0));
});

// ── #3048: mellemsprint må aldrig lande inde i et klassificeret klatresegment ──
// Klatresegment = [crest_km - length_km, crest_km] (samme grænse som frontend
// stageRouteProfile.js's visuelle top-bump). KOM-passager SKAL fortsat ligge på
// stigninger — denne invariant gælder KUN "intermediate"-sprints, aldrig climbs.
test("invariant (#3048): mellemsprint ligger aldrig inden for et klatresegment", () => {
  const profiles = ["hilly", "mountain", "high_mountain", "classic", "cobbles", "rolling"];
  const finales = ["punch", "reduced_sprint", "breakaway", "descent", "long_climb", null];
  let checkedWithClimbs = 0;
  for (let i = 0; i < 300; i++) {
    const pt = profiles[i % profiles.length];
    const finale = finales[i % finales.length];
    const r = attachRoute(stage(pt, finale, 1), { external_id: `route-3048-${i}`, season_id: `s${i % 5}`, name: "Test Tour" }, true);
    const intermediates = r.sprints.filter((s) => s.kind === "intermediate");
    if (r.climbs.length) checkedWithClimbs++;
    for (const s of intermediates) {
      for (const c of r.climbs) {
        const foot = c.crest_km - c.length_km;
        assert.ok(
          !(s.km >= foot && s.km <= c.crest_km),
          `seed ${i} (${pt}/${finale}): mellemsprint km=${s.km} inde i klatresegment "${c.name}" [${foot},${c.crest_km}]`,
        );
      }
    }
  }
  // Sanity: testen skal faktisk have prøvet scenarier MED stigninger, ellers
  // beviser den ingenting.
  assert.ok(checkedWithClimbs > 50, `for få seeds havde climbs (${checkedWithClimbs}/300) — testen dækker ikke reelt`);
});

// ── #3048: kanonisk dalregel (ejer-godkendt 27/7, erstatter crest+1) ──────────
test("#3048 dalregel: clampSprintKm bruger dalens midtpunkt, ikke længere crest+1-nedkørslen", () => {
  const distanceKm = 200;
  const climbs = [{ crest_km: 100, length_km: 8 }]; // klatresegment [92,100]
  const km = clampSprintKm(97, climbs, distanceKm); // rå km midt i stigningen
  assert.notEqual(km, 101, "må ikke længere bruge den gamle crest+1-nedkørsel som førstevalg");
  const chosen = pickSprintValley(sprintValleys(climbs, distanceKm), distanceKm);
  assert.equal(km, Math.round((chosen[0] + chosen[1]) / 2), "skal matche dalreglens output direkte");
});

test("#3048 dalregel: 15-km-tærsklen respekteres — en tættere men lille dal springes over til fordel for en fjernere dal på >= 15 km", () => {
  const distanceKm = 200; // søgevindue [40,170], target = 0.55*200 = 110
  const climbs = [
    { crest_km: 100, length_km: 1 }, // besat [98,101]
    { crest_km: 110, length_km: 1 }, // besat [108,111] → lille dal [101,108] (7 km, midt 104.5, tæt på target)
    { crest_km: 160, length_km: 2 }, // besat [157,161]
  ];
  const valleys = sprintValleys(climbs, distanceKm);
  const chosen = pickSprintValley(valleys, distanceKm);
  const size = chosen[1] - chosen[0];
  assert.ok(size >= 15, `valgt dal er kun ${size} km — 15-km-tærsklen blev ikke respekteret`);
  assert.equal(Math.round((chosen[0] + chosen[1]) / 2), 134);
});

test("#3048 dalregel: midtpunkts-præferencen vælger dalen (blandt dale >= 15 km) der ligger tættest på 55% af distancen", () => {
  const distanceKm = 200; // target = 110
  const climbs = [
    { crest_km: 70, length_km: 2 }, // besat [67,71]
    { crest_km: 130, length_km: 2 }, // besat [127,131]
  ];
  // Tre dale, alle >= 15 km: [40,67] (mid 53.5), [71,127] (mid 99), [131,170] (mid 150.5).
  // Midterste dals midtpunkt (99) er tættest på target (110).
  const valleys = sprintValleys(climbs, distanceKm);
  const chosen = pickSprintValley(valleys, distanceKm);
  assert.equal(Math.round((chosen[0] + chosen[1]) / 2), 99);
});

test("#3048 dalregel: findes ingen fri strækning i søgevinduet, falder clampSprintKm tilbage til nedkørsel/tilgang-logikken", () => {
  const distanceKm = 100; // søgevindue [20,85]
  const climbs = [{ crest_km: 90, length_km: 100 }]; // dækker hele søgevinduet
  const valleys = sprintValleys(climbs, distanceKm);
  assert.equal(valleys.length, 0, "test-setup burde ikke efterlade nogen fri strækning");
  const km = clampSprintKm(50, climbs, distanceKm);
  assert.ok(Number.isFinite(km) && km > 0 && km < distanceKm, "fallback skal stadig returnere en gyldig km");
});

test("#3048: clampSprintKm muterer aldrig climbs-arrayet — KOM-passager forbliver urørt", () => {
  const climbs = [
    { name: "Col de Test", category: "1", crest_km: 100, length_km: 8, avg_gradient: 7, summit_finish: false },
  ];
  const before = JSON.parse(JSON.stringify(climbs));
  clampSprintKm(97, climbs, 200); // 97 ligger inde i klatresegmentet [92,100]
  assert.deepEqual(climbs, before, "climbs-arrayet må ikke ændres af sprint-placeringen");
});
