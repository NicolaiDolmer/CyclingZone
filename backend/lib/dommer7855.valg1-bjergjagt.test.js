// DOMMER #7855, ejerens valg 1 (13/11): BJERGJAGT KUN SAMMEN MED UDBRUD.
//   Ejer 13/11: "Kun sammen med udbrud". Bjergjagt ("Hent bjergpoint") kan kun vaelges, naar
//   rytteren ogsaa sendes i udbrud. "Hent point" i spurterne fra feltet bliver, som det er.
//   Ejer 12/11 (valg 1): udbrud og bjergjagt sammen.
//   Ejer 7/11: kaptajner aldrig; slukket findes opgaverne ikke.
//
// Regler (se dommerens regler.md): R2 (bjergjagt alene kan ikke vaelges), R3 (udbrud + bjergjagt
// kan vaelges), R4 (Hent point bliver, som det er), R5 (fladens kopi siger det samme).
//
// DOMMERENS FORSIGTIGE LAESNING (meldt til ejeren som spoergsmaal): "sammen med udbrud" er
// valget "Gaa i udbrud + Hent bjergpoint" paa udbrudsleddet. Et selvstaendigt led "Hent bjergpoint"
// kan ikke vaelges, heller ikke som andet led efter "Gaa i udbrud" (kommer han ikke med, ville det
// led vaere bjergjagt fra feltet).
//
// Skrevet FOER koden. Maa ikke rettes til af byggebanen.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { motor, kraev, koerEtape, etape, jagede, betalte, HJAELPERE } from "./dommer7855.fixtures.mjs";
import { RAA_BJERG, RAA_FLAD, ROLLER, allePlaner, harBjergjagtAlene, valideringstabel } from "./dommer7855.facit-scenarier.mjs";

const M = await motor();
const backend = M.sp;
const frontend = await kraev("../../frontend/src/components/race/StagePlanModel.ts", "validateStagePlanLegs", "taskOptions", "planHasJerseyHunt", "planWithoutJerseyHunt", "stagePlanRouteFromRaw", "withJerseyHunt7855");
const FACIT = JSON.parse(readFileSync(new URL("./__fixtures__/dommer7855Facit.json", import.meta.url), "utf8"));

// To ruter: bjergetape med to toppe og en spurt mellem dem, og en flad etape med en spurt.
const rute = (raa, taendt) => backend.withJerseyHunt7855(backend.stagePlanRouteFromRaw(raa), taendt);
const BJERG = rute(RAA_BJERG, true);
const BJERG_SLUKKET = rute(RAA_BJERG, false);
const MAA_JAGE_BJERG = ["helper", "hunter", "free_role"]; // ejer 7/11
const PLANER = allePlaner(backend.STAGE_PLAN_TASKS);

test("R2 valg 1: 'Hent bjergpoint' alene kan ikke vaelges, uanset rolle, plads i planen og rutepunkt", () => {
  let afvist = 0;
  for (const raa of [RAA_BJERG, RAA_FLAD]) {
    for (const rolle of ROLLER) {
      for (const legs of PLANER.filter(harBjergjagtAlene)) {
        const svar = backend.validateStagePlanLegs(legs, rolle, rute(raa, true));
        assert.equal(typeof svar, "string", `bjergjagt uden udbrud blev godkendt: ${rolle} ${JSON.stringify(legs)}`);
        afvist++;
      }
    }
  }
  assert.ok(afvist > 1000, "proeven skal daekke mange planer");
  // De tre former, ejeren fik vist: fra start, efter en top, og efter udbrud.
  for (const rolle of MAA_JAGE_BJERG) {
    assert.notEqual(backend.validateStagePlanLegs([{ task: "hunt_kom" }], rolle, BJERG), null, `${rolle}: bjergjagt fra start`);
    assert.notEqual(backend.validateStagePlanLegs([{ task: "stay_sheltered" }, { task: "hunt_kom", from: { at: "kom", kom_index: 0 } }], rolle, BJERG), null, `${rolle}: bjergjagt efter en top`);
    assert.notEqual(backend.validateStagePlanLegs([{ task: "breakaway" }, { task: "hunt_kom", from: { at: "kom", kom_index: 0 } }], rolle, BJERG), null, `${rolle}: bjergjagt som eget led efter udbrud (dommerens forsigtige laesning)`);
  }
});

test("R3 valg 1: 'Gaa i udbrud + Hent bjergpoint' kan vaelges af hjaelper, jaeger og fri rolle; aldrig af kaptajnerne; slukket findes den ikke", () => {
  for (const rolle of MAA_JAGE_BJERG) {
    assert.equal(backend.validateStagePlanLegs([{ task: "breakaway", hunt: "hunt_kom" }], rolle, BJERG), null, rolle);
    assert.equal(backend.validateStagePlanLegs([{ task: "breakaway", hunt: "hunt_kom" }, { task: "ride_in", from: { at: "dropped" } }], rolle, BJERG), null, `${rolle} med sat-led`);
  }
  for (const rolle of ["captain", "co_captain", "sprint_captain"]) {
    assert.equal(typeof backend.validateStagePlanLegs([{ task: "breakaway", hunt: "hunt_kom" }], rolle, BJERG), "string", rolle);
  }
  for (const rolle of ROLLER) {
    assert.equal(backend.validateStagePlanLegs([{ task: "breakaway", hunt: "hunt_kom" }], rolle, BJERG_SLUKKET), "stage_plan_unknown_task", `slukket ${rolle}`);
  }
  // En rute uden en top foer maal har ingen bjergjagt.
  assert.equal(typeof backend.validateStagePlanLegs([{ task: "breakaway", hunt: "hunt_kom" }], "helper", rute(RAA_FLAD, true)), "string");
});

test("R4 valg 1: 'Hent point' og alt andet i planen validerer praecis som foer (frosset paa main)", async () => {
  // Hele svartabellen for alle planer UDEN et selvstaendigt 'Hent bjergpoint'-led, taendt og slukket.
  const tabel = await valideringstabel();
  assert.equal(tabel.antal, FACIT.validering.antal, "samme antal planer som da facit blev frosset");
  assert.equal(tabel.hash, FACIT.validering.hash, "valideringen af planer uden bjergjagt-led har flyttet sig");
  // Synlige eksempler (de samme svar ligger i tabellen ovenfor).
  for (const rolle of ["sprint_captain", "helper", "hunter", "free_role"]) {
    assert.equal(backend.validateStagePlanLegs([{ task: "hunt_points" }], rolle, BJERG), null, `${rolle}: Hent point fra feltet`);
  }
  assert.equal(backend.validateStagePlanLegs([{ task: "breakaway", hunt: "hunt_points" }], "helper", BJERG), null, "Gaa i udbrud + Hent point");
  assert.equal(backend.validateStagePlanLegs([{ task: "hunt_points" }], "captain", BJERG), "stage_plan_task_not_for_role");
});

test("R2 valg 1 i motoren: en gemt 'Hent bjergpoint' alene bliver aldrig til bjergjagt fra feltet", async () => {
  // Raekken er gemt, som API'et gemte den foer valget (med planen uden jagt ved siden af).
  const raekke = (id) => ({ rider_id: id, effort: "protect", try_break: false, leadout: false, plan: [{ task: "hunt_kom" }], plan_no_hunt: [{ task: "stay_sheltered" }] });
  let koert = 0;
  for (const [nr, froe] of [[13, "v1-a"], [13, "v1-b"], [5, "v1-a"], [17, "v1-b"]]) {
    const id = HJAELPERE[koert % HJAELPERE.length];
    const k = await koerEtape(etape(nr), froe, { raekker: { [id]: raekke(id) } });
    assert.equal(jagede(k, id, "kom"), 0, `etape ${nr} ${froe}: ${id} koerte efter bjergpoint fra feltet`);
    assert.equal(betalte(k, id, "kom"), 0, `etape ${nr} ${froe}: ${id} betalte for bjergjagt fra feltet`);
    koert++;
  }
  assert.equal(koert, 4);
});

test("R3 valg 1 i motoren: med 'Gaa i udbrud + Hent bjergpoint' koerer han efter bjergpointene fra start", async () => {
  let jaget = 0;
  for (const froe of ["v1-a", "v1-b", "v1-c"]) {
    const id = "t1r2";
    const k = await koerEtape(etape(13), froe, { planer: { [id]: [{ task: "breakaway", hunt: "hunt_kom" }] } });
    if (jagede(k, id, "kom") > 0) jaget++;
  }
  assert.equal(jaget, 3, "jagten paa udbrudsleddet skal gaelde i alle tre koersler");
});

test("R5 valg 1: fladens kopi af kontrakten giver samme svar som serveren, ogsaa for jagt paa udbrudsleddet", () => {
  let sammenlignet = 0;
  for (const raa of [RAA_BJERG, RAA_FLAD]) {
    for (const taendt of [true, false]) {
      const b = rute(raa, taendt);
      const f = frontend.withJerseyHunt7855(frontend.stagePlanRouteFromRaw(raa), taendt);
      assert.deepEqual(f, b, "samme rute");
      for (const rolle of ROLLER) {
        for (const legs of PLANER) {
          assert.equal(frontend.validateStagePlanLegs(legs, rolle, f), backend.validateStagePlanLegs(legs, rolle, b), `${rolle} taendt=${taendt} ${JSON.stringify(legs)}`);
          sammenlignet++;
        }
      }
    }
  }
  assert.ok(sammenlignet > 10000);
  for (const legs of PLANER) {
    assert.equal(frontend.planHasJerseyHunt(legs), backend.planHasJerseyHunt(legs), `har jagt: ${JSON.stringify(legs)}`);
    assert.deepEqual(frontend.planWithoutJerseyHunt(legs), backend.planWithoutJerseyHunt(legs), `uden jagt: ${JSON.stringify(legs)}`);
  }
});

test("R5 valg 1: fladen tilbyder aldrig 'Hent bjergpoint' som selvstaendig opgave", () => {
  const f = frontend.withJerseyHunt7855(frontend.stagePlanRouteFromRaw(RAA_BJERG), true);
  const kaeder = [
    [[{ task: "stay_sheltered" }], 0],
    [[{ task: "breakaway" }], 0],
    [[{ task: "stay_sheltered" }, { task: "tempo", from: { at: "kom", kom_index: 0 } }], 1],
    [[{ task: "breakaway" }, { task: "ride_in", from: { at: "kom", kom_index: 0 } }], 1],
  ];
  for (const rolle of ROLLER) {
    for (const [legs, i] of kaeder) {
      const valg = frontend.taskOptions(legs, i, rolle, f);
      assert.ok(!valg.includes("hunt_kom"), `${rolle}: 'Hent bjergpoint' tilbydes alene paa led ${i + 1} i ${JSON.stringify(legs)}`);
    }
  }
  // 'Hent point' tilbydes stadig fra feltet (bliver, som det er).
  assert.ok(frontend.taskOptions([{ task: "stay_sheltered" }], 0, "helper", f).includes("hunt_points"));
});
