import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { recomputeRiderValue, selectChangedValueUpdates } from "./riderValueRefresh.js";
import { predictBaseValue } from "./riderValuation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseline = JSON.parse(readFileSync(join(__dirname, "riderTypesBaseline.json"), "utf8"));
const model = JSON.parse(readFileSync(join(__dirname, "riderValuationModel.json"), "utf8"));
// #4872: den LIVE v4-model (ikke test-fixturen ovenfor, som har alpha=0.5 og
// derfor blander speciale-output med det generelle evne-snit — v4 har alpha=1,
// se riderValuationModelV4.json's fit-blok, PRÆCIS ren speciale-score, ingen
// blend). #4872-testerne skal reproducere den faktiske prod-mekanik, ikke
// v3-fixturens anderledes blend-adfærd.
const modelV4 = JSON.parse(readFileSync(join(__dirname, "riderValuationModelV4.json"), "utf8"));
const youthBaselineV4 = JSON.parse(readFileSync(join(__dirname, "riderTypesBaselineYouth.json"), "utf8"));

const ABIL = { climbing: 60, time_trial: 55, prolog: 50, flat: 58, tempo: 57, sprint: 40, acceleration: 45, punch: 48, endurance: 62, recovery: 58, durability: 55, descending: 52, cobblestone: 41, positioning: 50, aggression: 50, tactics: 50 };

test("recomputeRiderValue: returnerer type + afrundet base_value, deterministisk", () => {
  const a = recomputeRiderValue({ id: "r1" }, ABIL, baseline, model);
  assert.ok(typeof a.primary_type === "string" && a.primary_type.length > 0);
  assert.ok(typeof a.secondary_type === "string");
  assert.equal(a.base_value, Math.round(a.base_value), "base_value er afrundet (INTEGER-kolonne)");
  assert.ok(a.base_value > 0);
  const b = recomputeRiderValue({ id: "r1" }, ABIL, baseline, model);
  assert.deepEqual(a, b);
});

test("#3345: recomputeRiderValue bruger riderRow.valuation_type (frossen) til base_value, ikke den friske primary_type", () => {
  const fresh = recomputeRiderValue({ id: "r1" }, ABIL, baseline, model);
  const otherType = Object.keys(model.offset || {}).find((k) => k !== fresh.primary_type);
  assert.ok(otherType, "modellen skal have mindst 2 typer i offset-tabellen til denne test");

  const frozen = recomputeRiderValue({ id: "r1", valuation_type: otherType }, ABIL, baseline, model);
  // primary_type reklassificeres UAFHÆNGIGT af valuation_type (frit, jf. #3325/#3343).
  assert.equal(frozen.primary_type, fresh.primary_type);
  // ...men base_value følger den FROSNE valuation_type, ikke den friske primary_type —
  // matcher direkte hvad predictBaseValue giver for `otherType` på samme abilities/model.
  const expected = predictBaseValue({ primary_type: otherType }, ABIL, model);
  assert.equal(frozen.base_value, Math.round(expected));
  assert.notEqual(frozen.base_value, fresh.base_value, "de to typer skal give forskellig værdi (ellers beviser testen intet)");
});

test("selectChangedValueUpdates: skriver KUN ryttere hvor værdi/type ændrede sig", () => {
  const fresh = recomputeRiderValue({ id: "r1" }, ABIL, baseline, model);
  const riders = [
    { id: "r1", primary_type: fresh.primary_type, secondary_type: fresh.secondary_type, base_value: fresh.base_value },
    { id: "r2", primary_type: fresh.primary_type, secondary_type: fresh.secondary_type, base_value: fresh.base_value + 50_000 },
    { id: "r3", primary_type: "gc", secondary_type: "rouleur", base_value: 100 },
  ];
  const abilityByRider = new Map([["r1", ABIL], ["r2", ABIL]]);
  const updates = selectChangedValueUpdates(riders, abilityByRider, baseline, model);
  const ids = updates.map((u) => u.id);
  assert.ok(!ids.includes("r1"), "uændret rytter skrives ikke");
  assert.ok(ids.includes("r2"), "ændret rytter skrives");
  assert.ok(!ids.includes("r3"), "rytter uden abilities springes over");
  const u2 = updates.find((u) => u.id === "r2");
  // #2594: recomputeRiderValue returnerer nu også current_production_value
  // (løn-basen); selectChangedValueUpdates diff'er + skriver den med.
  assert.deepEqual(Object.keys(u2).sort(), ["base_value", "current_production_value", "id", "primary_type", "secondary_type"]);
});

// ── #3550 punkt 5: intake-pull-kandidater med provisorisk værdi ───────────────
// (ejer-beslutning 19/8, ungdomspakken): den normale værdi-sweep (kører natligt,
// altså under alle omstændigheder inden førstkommende søndag) skal samle akademi-
// intake-ryttere med symbolsk startværdi op. Ingen kode-ændring var nødvendig HER
// — sweepet filtrerer ikke på is_academy/status/provisorisk-flag i forvejen — men
// adfærden var udokumenteret for netop dette scenarie.

test("#3550 punkt 5: en akademi-intake-kandidat med provisorisk (symbolsk) base_value INKLUDERES i sweepet og får den RIGTIGE evne-afledte værdi", () => {
  const real = recomputeRiderValue({ id: "academy-r1" }, ABIL, baseline, model);
  const provisionalRider = {
    id: "academy-r1",
    primary_type: real.primary_type,
    secondary_type: real.secondary_type,
    base_value: 3000, // #3550: provisorisk værdi trukket uniformt 1.000-5.000 ved intake-pull
    current_production_value: null,
  };
  const abilityByRider = new Map([["academy-r1", ABIL]]);
  const updates = selectChangedValueUpdates([provisionalRider], abilityByRider, baseline, model);

  assert.equal(updates.length, 1, "ingen filter i selectChangedValueUpdates udelukker intake-/akademi-ryttere");
  assert.equal(updates[0].id, "academy-r1");
  assert.notEqual(updates[0].base_value, 3000, "den symbolske startværdi overskrives");
  assert.equal(updates[0].base_value, real.base_value, "erstattes af den RIGTIGE, evne-afledte værdi — samme som enhver anden rytter ville få");
  // Lønnen (riders.salary) er FROSSEN ved signering og indgår aldrig i denne
  // patch — se testen ovenfor ("skriver KUN...") for keys-listen uden 'salary'.
  assert.ok(!("salary" in updates[0]), "sweepet rører ALDRIG salary — den symbolske løn forbliver frosset uanset værdi-genberegningen");
});

// ── #3570: nattens sweep omdøber ikke længere en rytter med fast identitet ────

test("#3570: recomputeRiderValue bruger archetype_draw som identitet — nattens sweep overskriver den ikke", () => {
  // Uden anlæg: klassifikatoren bestemmer (uændret adfærd for alle eksisterende ryttere).
  const uden = recomputeRiderValue({ id: "r1" }, ABIL, baseline, model);
  const andenType = ["gc", "brostensrytter", "rouleur", "sprinter"].find((t) => t !== uden.primary_type);

  // Med anlæg: anlægget vinder, uanset hvad evnerne ligner.
  const med = recomputeRiderValue(
    { id: "r1", archetype_draw: { primary: andenType, secondary: null, isHybrid: false } },
    ABIL, baseline, model,
  );
  assert.equal(med.primary_type, andenType, "primær type følger det persisterede anlæg");
  assert.notEqual(med.secondary_type, andenType, "sekundær er aldrig lig primær");
});

test("#3570: et tomt/ugyldigt archetype_draw ændrer intet (bagudkompatibel)", () => {
  const forventet = recomputeRiderValue({ id: "r1" }, ABIL, baseline, model);
  for (const draw of [null, undefined, {}, { primary: null }, { primary: "findes_ikke" }]) {
    const faktisk = recomputeRiderValue({ id: "r1", archetype_draw: draw }, ABIL, baseline, model);
    assert.deepEqual(faktisk, forventet, `uændret for draw=${JSON.stringify(draw)}`);
  }
});

test("#3570: selectChangedValueUpdates retter en rytter TILBAGE til sit anlæg (drift-reparation)", () => {
  // En rytter hvis persisterede label er drevet væk fra anlægget skal fanges som
  // ændret og skrives tilbage — det er sådan løkke-driften ruller af sig selv.
  const draw = { primary: "gc", secondary: null, isHybrid: false };
  const forkert = recomputeRiderValue({ id: "r1" }, ABIL, baseline, model).primary_type === "gc"
    ? "sprinter" : "gc";
  const riders = [{ id: "r1", primary_type: forkert, secondary_type: "rouleur", base_value: 1, archetype_draw: draw }];
  const updates = selectChangedValueUpdates(riders, new Map([["r1", ABIL]]), baseline, model);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].primary_type, "gc", "sweepen skriver anlægget tilbage");
});

// ── #4872: "rytter-værdi står stille for enkelte ryttere" — end-to-end-bevis ──
// Prod-fund (Ryan Cooper, egomadsen's tråd 7/9): valuation_type "tt" (frosset,
// #3345) mens rytterens FAKTISKE træning gik i sprint/acceleration. "tt" har
// kun ét positivt vægtet ability (time_trial, se riderValuation.test.js'
// tilsvarende #4872-test) — rører træningen den aldrig, står base_value
// bogstaveligt talt stille. Denne test beviser det er INGEN sweep-fejl: ingen
// gren i selectChangedValueUpdates springer rytteren over (han evalueres helt
// normalt hver gang) — den beregnede værdi er blot reelt uændret, fordi
// modellen (bevidst, ejer-godkendt) kun lytter til time_trial for "tt". En
// rytter med SAMME off-type-udvikling men et valuation_type der rent faktisk
// vægter den udviklede evne (climber → climbing) FÅR sin værdi opdateret —
// kontrolgruppen viser at pipelinen virker, problemet er specifikt "tt"s
// nul-redundans efter #3345-frysningen.
// Ryan Coopers RIGTIGE rider_derived_ability_history-snapshots (27/8 → 7/9,
// prod-målt for #4872, se PR-body). Bruges frem for syntetiske tal fordi
// elite_premium (riderCareerNpv.js) reagerer på det RÅ evne-snit (riderOverall)
// uafhængigt af typen — en for høj syntetisk baseline (fx alt-50) ville
// utilsigtet trigge præmien og sløre at kerne-NPV'en (den typespecifikke O)
// reelt står stille. Med de RIGTIGE, lave tal (snit ≈ 20) er testen tro mod
// hvad der faktisk skete i prod.
const RYAN_COOPER_BEFORE = { flat: 30, punch: 14, tempo: 15, sprint: 44, tactics: 18, climbing: 7, recovery: 22, endurance: 16, aggression: 28, descending: 17, durability: 26, time_trial: 25, cobblestone: 16, positioning: 22, acceleration: 44, prolog: 20 };
const RYAN_COOPER_AFTER = { flat: 32, punch: 14, tempo: 16, sprint: 50, tactics: 18, climbing: 7, recovery: 22, endurance: 18, aggression: 28, descending: 17, durability: 28, time_trial: 25, cobblestone: 17, positioning: 24, acceleration: 50, prolog: 20 };

test("#4872: en rytter frosset til 'tt' der kun udvikler sprint/acceleration får INGEN værdi-opdatering", () => {
  // #3570 anlæg (primary+secondary EKSPLICIT sat, spejler Ryan Coopers rigtige
  // archetype_draw {primary:sprinter, secondary:rouleur}) holder type-labelen
  // stabil på tværs af før/efter, så testen isolerer PRÆCIST base_value/cpv —
  // ikke en sideeffekt af rå-evne-reklassifikation. modelV4 (alpha=1, den LIVE
  // model) er PÅKRÆVET her — se konstant-kommentaren ovenfor.
  const draw = { primary: "sprinter", secondary: "rouleur" };
  const riderRow = { id: "stuck-1", valuation_type: "tt", archetype_draw: draw, age: 19, potentiale: 5.5 };
  const frozen = recomputeRiderValue(riderRow, RYAN_COOPER_BEFORE, baseline, modelV4, { youthBaseline: youthBaselineV4 });
  const rider = { ...riderRow, primary_type: frozen.primary_type, secondary_type: frozen.secondary_type, base_value: frozen.base_value, current_production_value: frozen.current_production_value };
  const updates = selectChangedValueUpdates([rider], new Map([["stuck-1", RYAN_COOPER_AFTER]]), baseline, modelV4, new Map(), youthBaselineV4);
  assert.equal(updates.length, 0, "base_value er reelt uændret (time_trial rørte sig ikke) — ikke en tabt skrivning");
});

test("#4872 kontrol: en rytter frosset til 'climber' der udvikler climbing FÅR sin værdi opdateret", () => {
  // Jasper Verhoevens rigtige snapshots (samme trup, samme periode, kontrol-
  // rytteren fra Discord-tråden): climbing 21 → 27, valuation_type = primary_type.
  const draw = { primary: "climber", secondary: null };
  const before = { flat: 9, punch: 24, tempo: 24, sprint: 7, tactics: 10, climbing: 21, recovery: 7, endurance: 14, aggression: 18, descending: 9, durability: 9, time_trial: 7, cobblestone: 5, positioning: 9, acceleration: 9, prolog: 20 };
  const after = { ...before, climbing: 27, punch: 27, tempo: 27, recovery: 8, endurance: 17, durability: 10, positioning: 10 };
  const riderRow = { id: "moving-1", valuation_type: "climber", archetype_draw: draw, age: 19, potentiale: 5.0 };
  const frozen = recomputeRiderValue(riderRow, before, baseline, modelV4, { youthBaseline: youthBaselineV4 });
  const rider = { ...riderRow, primary_type: frozen.primary_type, secondary_type: frozen.secondary_type, base_value: frozen.base_value, current_production_value: frozen.current_production_value };
  const updates = selectChangedValueUpdates([rider], new Map([["moving-1", after]]), baseline, modelV4, new Map(), youthBaselineV4);
  assert.equal(updates.length, 1, "climbing er positivt vægtet for 'climber' — værdien følger med");
});
