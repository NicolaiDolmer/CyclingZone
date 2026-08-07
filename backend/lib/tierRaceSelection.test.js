import test from "node:test";
import assert from "node:assert/strict";
import { selectTierRaceSet, PRESTIGE_RANK } from "./tierRaceSelection.js";

// Prod-lignende katalog: 3 Grand Tours, 5 monumenter, WorldTour-mix, ProSeries-bunke, Class 1/2.
function catalog() {
  const rows = [];
  rows.push({ id: "gt-tour", name: "Tour", race_class: "TourFrance", race_type: "stage_race", stages: 21 });
  rows.push({ id: "gt-giro", name: "Giro", race_class: "GiroVuelta", race_type: "stage_race", stages: 21 });
  rows.push({ id: "gt-vuelta", name: "Vuelta", race_class: "GiroVuelta", race_type: "stage_race", stages: 21 });
  for (let i = 0; i < 5; i++) rows.push({ id: `mon-${i}`, name: `Monument ${i}`, race_class: "Monuments", race_type: "single", stages: 1 });
  [8, 8, 7, 7, 6, 6, 6, 5].forEach((st, i) => rows.push({ id: `wta-sr-${i}`, race_class: "OtherWorldTourA", race_type: "stage_race", stages: st }));
  for (let i = 0; i < 6; i++) rows.push({ id: `wta-od-${i}`, race_class: "OtherWorldTourA", race_type: "single", stages: 1 });
  [7, 5].forEach((st, i) => rows.push({ id: `wtb-sr-${i}`, race_class: "OtherWorldTourB", race_type: "stage_race", stages: st }));
  for (let i = 0; i < 4; i++) rows.push({ id: `wtb-od-${i}`, race_class: "OtherWorldTourB", race_type: "single", stages: 1 });
  for (let i = 0; i < 20; i++) rows.push({ id: `ps-sr-${i}`, race_class: "ProSeries", race_type: "stage_race", stages: 5 });
  for (let i = 0; i < 35; i++) rows.push({ id: `ps-od-${i}`, race_class: "ProSeries", race_type: "single", stages: 1 });
  [5, 4, 4, 4, 3].forEach((st, i) => rows.push({ id: `c1-sr-${i}`, race_class: "Class1", race_type: "stage_race", stages: st }));
  for (let i = 0; i < 7; i++) rows.push({ id: `c1-od-${i}`, race_class: "Class1", race_type: "single", stages: 1 });
  for (let i = 0; i < 9; i++) rows.push({ id: `c2-od-${i}`, race_class: "Class2", race_type: "single", stages: 1 });
  return rows;
}

const gameDays = (sel) => [...sel.stageRaces, ...sel.oneDayRaces].reduce((s, r) => s + (Number(r.stages) || 1), 0);

test("selectTierRaceSet: rammer den præcise game-day-kvote", () => {
  for (const quota of [140, 112, 84]) {
    const sel = selectTierRaceSet({ catalog: catalog(), quota, seed: 1 });
    assert.equal(gameDays(sel), quota, `kvote ${quota}: fik ${gameDays(sel)} game-days`);
    assert.equal(sel.quotaHit, true);
    assert.equal(sel.shortfall, 0);
  }
});

test("selectTierRaceSet: prestige-rang — div 1 (140) tager alle 3 Grand Tours + alle 5 monumenter", () => {
  const sel = selectTierRaceSet({ catalog: catalog(), quota: 140, seed: 1 });
  const ids = new Set([...sel.stageRaces, ...sel.oneDayRaces].map((r) => r.id));
  assert.ok(["gt-tour", "gt-giro", "gt-vuelta"].every((id) => ids.has(id)), "alle Grand Tours i div 1");
  assert.ok([0, 1, 2, 3, 4].every((i) => ids.has(`mon-${i}`)), "alle monumenter i div 1");
});

test("selectTierRaceSet: vælger ikke lavere prestige før højere er opbrugt", () => {
  // 140-kvoten skal være fyldt af Grand Tour/Monument/WorldTour før ProSeries/Class røres.
  const sel = selectTierRaceSet({ catalog: catalog(), quota: 140, seed: 1 });
  const picked = [...sel.stageRaces, ...sel.oneDayRaces];
  const ranks = picked.map((r) => PRESTIGE_RANK[r.race_class] ?? 99);
  const worstPicked = Math.max(...ranks);
  // Intet uvalgt løb må have BEDRE (lavere) rang end det dårligste valgte (bortset fra ties vi måtte springe for at ramme præcist).
  const cat = catalog();
  const pickedIds = new Set(picked.map((r) => r.id));
  const betterUnpicked = cat.filter((r) => !pickedIds.has(r.id) && (PRESTIGE_RANK[r.race_class] ?? 99) < worstPicked);
  assert.equal(betterUnpicked.length, 0, `højere-prestige løb sprunget over: ${betterUnpicked.map((r) => r.id)}`);
});

test("#2251 selectTierRaceSet: allowGrandTours=false udelukker ≥15-etapers løb men rammer stadig kvoten", () => {
  const sel = selectTierRaceSet({ catalog: catalog(), quota: 56, seed: 1, allowGrandTours: false });
  const picked = [...sel.stageRaces, ...sel.oneDayRaces];
  assert.ok(picked.length > 0);
  assert.ok(picked.every((r) => (r.stages ?? 1) < 15), `GT sluppet igennem: ${picked.filter((r) => r.stages >= 15).map((r) => r.id)}`);
  assert.equal(gameDays(sel), 56, "kvoten skal stadig fyldes af ikke-GT-løb");
});

test("#2251 selectTierRaceSet: allowGrandTours default (true) er uændret adfærd", () => {
  const a = selectTierRaceSet({ catalog: catalog(), quota: 140, seed: 1 });
  const b = selectTierRaceSet({ catalog: catalog(), quota: 140, seed: 1, allowGrandTours: true });
  assert.deepEqual(a, b);
});

test("selectTierRaceSet: marker oneDayRaces vs stageRaces korrekt + bærer race_class", () => {
  const sel = selectTierRaceSet({ catalog: catalog(), quota: 84, seed: 1 });
  assert.ok(sel.stageRaces.every((r) => r.stages >= 2 && r.race_class), "stageRaces ≥2 etaper + klasse");
  assert.ok(sel.oneDayRaces.every((r) => (r.stages ?? 1) === 1 && r.race_class), "oneDayRaces = 1 etape + klasse");
});

test("selectTierRaceSet: intet løb vælges to gange", () => {
  const sel = selectTierRaceSet({ catalog: catalog(), quota: 140, seed: 1 });
  const ids = [...sel.stageRaces, ...sel.oneDayRaces].map((r) => r.id);
  assert.equal(ids.length, new Set(ids).size, "duplikat i udvalg");
});

test("selectTierRaceSet: deterministisk; seed varierer kun inden for samme prestige-rang", () => {
  assert.deepEqual(selectTierRaceSet({ catalog: catalog(), quota: 84, seed: 1 }), selectTierRaceSet({ catalog: catalog(), quota: 84, seed: 1 }));
  const a = selectTierRaceSet({ catalog: catalog(), quota: 84, seed: 1 });
  const b = selectTierRaceSet({ catalog: catalog(), quota: 84, seed: 999 });
  // Begge rammer kvoten; Grand Tours/top er ens, men ProSeries-udvalget (samme rang) kan variere.
  assert.equal(gameDays(a), 84);
  assert.equal(gameDays(b), 84);
});

test("selectTierRaceSet: rapporterer shortfall når kataloget ikke kan fylde kvoten", () => {
  const tiny = [{ id: "x1", race_class: "Class2", race_type: "single", stages: 1 }];
  const sel = selectTierRaceSet({ catalog: tiny, quota: 84, seed: 1 });
  assert.equal(sel.quotaHit, false);
  assert.equal(sel.shortfall, 83);
  assert.equal(gameDays(sel), 1);
});

// ── #3295: arketype-reservationer ────────────────────────────────────────────
// Rod-årsagen de løser: rangeringen er prestige → STØRRELSE → knap-arketype, så
// arketypen er tredje nøgle og slår kun til ved uafgjort på de to første. Målt på S3
// gav det Division 3 nul brosten-etapeløb uanset katalogets indhold.

// Katalog hvor den knappe arketype ALDRIG vinder på prestige+størrelse: mange store
// ProSeries-etapeløb uden arketype, og ét lille cobbled_tour af samme klasse.
function scarcityCatalog() {
  const rows = [];
  for (let i = 0; i < 20; i++) rows.push({ id: `ps-big-${i}`, name: `Stort ${i}`, race_class: "ProSeries", race_type: "stage_race", stages: 6, terrain_archetype: "mountain_tour" });
  for (let i = 0; i < 20; i++) rows.push({ id: `ps-od-${i}`, name: `Endags ${i}`, race_class: "ProSeries", race_type: "single", stages: 1, terrain_archetype: "hilly_classic" });
  rows.push({ id: "ps-cob", name: "Brostensløb", race_class: "ProSeries", race_type: "stage_race", stages: 3, terrain_archetype: "cobbled_tour" });
  rows.push({ id: "ps-itt", name: "Enkeltstart", race_class: "ProSeries", race_type: "single", stages: 1, terrain_archetype: "itt_classic" });
  return rows;
}

test("#3295 uden reservationer taber den knappe arketype — rod-årsagen", () => {
  const sel = selectTierRaceSet({ catalog: scarcityCatalog(), quota: 30, seed: 1, oneDayShareTarget: 0.5 });
  assert.ok(!sel.stageRaces.some((r) => r.id === "ps-cob"),
    "fixturen skal gengive problemet: cobbled_tour taber på størrelse (3 < 6 etaper)");
});

test("#3295 reservationer sikrer de knappe arketyper", () => {
  const sel = selectTierRaceSet({
    catalog: scarcityCatalog(), quota: 30, seed: 1, oneDayShareTarget: 0.5,
    archetypeReservations: { cobbled_tour: 1, itt_classic: 1 },
  });
  assert.ok(sel.stageRaces.some((r) => r.id === "ps-cob"), "cobbled_tour skal være reserveret");
  assert.ok(sel.oneDayRaces.some((r) => r.id === "ps-itt"), "itt_classic skal være reserveret");
  assert.equal(sel.reservedArchetypes, 2);
  assert.deepEqual(sel.unmetReservations, {});
});

test("#3295 reservationer sprænger ALDRIG kvoten", () => {
  for (const quota of [4, 10, 30, 84]) {
    const sel = selectTierRaceSet({
      catalog: scarcityCatalog(), quota, seed: 3, oneDayShareTarget: 0.5,
      archetypeReservations: { cobbled_tour: 2, itt_classic: 2, mountain_tour: 3 },
    });
    assert.ok(sel.totalGameDays <= quota, `kvote ${quota} overskredet: ${sel.totalGameDays}`);
  }
});

test("#3295 en reservation der ikke kan opfyldes rapporteres, forsvinder ikke tavst", () => {
  const sel = selectTierRaceSet({
    catalog: scarcityCatalog(), quota: 30, seed: 1, oneDayShareTarget: 0.5,
    archetypeReservations: { cobbled_tour: 5, summit_tour: 2 },
  });
  assert.equal(sel.unmetReservations.cobbled_tour, 4, "kataloget har kun 1 cobbled_tour");
  assert.equal(sel.unmetReservations.summit_tour, 2, "kataloget har ingen summit_tour");
});

test("#3295 reservationer er bagudkompatible: null giver PRÆCIS samme udvalg som før", () => {
  const args = { catalog: scarcityCatalog(), quota: 30, seed: 7, oneDayShareTarget: 0.5 };
  const before = selectTierRaceSet(args);
  const after = selectTierRaceSet({ ...args, archetypeReservations: null });
  assert.deepEqual(after.stageRaces, before.stageRaces);
  assert.deepEqual(after.oneDayRaces, before.oneDayRaces);
  assert.equal(after.totalGameDays, before.totalGameDays);
});

test("#3295 reservationer skævvrider ikke #3327's endagsløb/etapeløb-mix", () => {
  // En reserveret itt_classic er et ENDAGSLØB og skal tære på endagsløb-budgettet, ikke
  // på etapeløbenes — ellers ville reservationer stille og roligt æde etapeløbs-andelen.
  const args = { catalog: scarcityCatalog(), quota: 40, seed: 2, oneDayShareTarget: 0.5 };
  const base = selectTierRaceSet(args);
  const withRes = selectTierRaceSet({ ...args, archetypeReservations: { itt_classic: 1 } });
  const shareOf = (s) => s.oneDayRaces.length / (s.oneDayRaces.length + s.stageRaces.length);
  assert.ok(Math.abs(shareOf(withRes) - shareOf(base)) < 0.1,
    `endagsløb-andel flyttede sig for meget: ${shareOf(base).toFixed(2)} → ${shareOf(withRes).toFixed(2)}`);
});

test("#3295 reservationer er deterministiske", () => {
  const args = {
    catalog: scarcityCatalog(), quota: 30, seed: 5, oneDayShareTarget: 0.5,
    archetypeReservations: { cobbled_tour: 1, itt_classic: 1 },
  };
  assert.deepEqual(selectTierRaceSet(args), selectTierRaceSet(args));
});

// ── #3469 (ejer-fund 8/8): downstreamProtectedArchetypes — rod-årsagen til D4's sultede
// cobbled_tour-reservation (D2 tog 2: 1 via reservation, 1 via almindelig walk). ──────────
function twoScarceCobbledTourCatalog() {
  const rows = [];
  // Kun ÉT konkurrerende stort etapeløb (6 etaper) — rigeligt slæk i etapeløbs-budgettet
  // til at BEGGE 3-etapers cobbled_tour-kandidater ville blive taget af den almindelige
  // walk, hvis intet forhindrer det (efterligner det rigtige katalogs situation, hvor en
  // tier med plads i sit budget tager MERE end sin egen 1-reservation).
  rows.push({ id: "ps-big-0", name: "Stort løb", race_class: "ProSeries", race_type: "stage_race", stages: 6, terrain_archetype: "mountain_tour" });
  for (let i = 0; i < 20; i++) rows.push({ id: `ps-od-${i}`, name: `Endags ${i}`, race_class: "ProSeries", race_type: "single", stages: 1, terrain_archetype: "hilly_classic" });
  rows.push({ id: "ps-cob-1", name: "Brostensløb 1", race_class: "ProSeries", race_type: "stage_race", stages: 3, terrain_archetype: "cobbled_tour" });
  rows.push({ id: "ps-cob-2", name: "Brostensløb 2", race_class: "ProSeries", race_type: "stage_race", stages: 3, terrain_archetype: "cobbled_tour" });
  return rows;
}

test("#3469 uden downstreamProtectedArchetypes: en tier med rigeligt budget kan tage MERE end sin egen reservation (rod-årsagen)", () => {
  const sel = selectTierRaceSet({
    catalog: twoScarceCobbledTourCatalog(), quota: 40, seed: 2, oneDayShareTarget: 0.5,
    archetypeReservations: { cobbled_tour: 1 },
  });
  const cobbledTourTaken = sel.stageRaces.filter((r) => r.id === "ps-cob-1" || r.id === "ps-cob-2");
  assert.equal(cobbledTourTaken.length, 2, "fixturen skal gengive problemet: begge cobbled_tour tages, selvom kun 1 er reserveret");
});

test("#3469 downstreamProtectedArchetypes forhindrer denne tier i at tage arketypen ud over egen reservation", () => {
  const sel = selectTierRaceSet({
    catalog: twoScarceCobbledTourCatalog(), quota: 40, seed: 2, oneDayShareTarget: 0.5,
    archetypeReservations: { cobbled_tour: 1 }, downstreamProtectedArchetypes: ["cobbled_tour"],
  });
  const cobbledTourTaken = sel.stageRaces.filter((r) => r.id === "ps-cob-1" || r.id === "ps-cob-2");
  assert.equal(cobbledTourTaken.length, 1, "kun den reserverede cobbled_tour må tages — resten skal falde igennem til en senere tier");
});

test("#3469 downstreamProtectedArchetypes påvirker KUN de angivne arketyper", () => {
  const base = selectTierRaceSet({ catalog: twoScarceCobbledTourCatalog(), quota: 40, seed: 2, oneDayShareTarget: 0.5 });
  const withProtection = selectTierRaceSet({
    catalog: twoScarceCobbledTourCatalog(), quota: 40, seed: 2, oneDayShareTarget: 0.5,
    downstreamProtectedArchetypes: ["mountain_tour"], // ikke reserveret her — skal ikke ændre noget for cobbled_tour
  });
  const cobCount = (s) => s.stageRaces.filter((r) => r.id === "ps-cob-1" || r.id === "ps-cob-2").length;
  assert.equal(cobCount(withProtection), cobCount(base), "en arketype uden egen reservation må ikke pludselig blive begrænset af en urelateret downstream-beskyttelse");
});

test("#3469 downstreamProtectedArchetypes=null (default) er bagudkompatibel — ingen begrænsning", () => {
  const args = { catalog: twoScarceCobbledTourCatalog(), quota: 40, seed: 2, oneDayShareTarget: 0.5, archetypeReservations: { cobbled_tour: 1 } };
  assert.deepEqual(selectTierRaceSet(args), selectTierRaceSet({ ...args, downstreamProtectedArchetypes: null }));
});
