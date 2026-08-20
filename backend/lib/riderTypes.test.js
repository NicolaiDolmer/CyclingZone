import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RIDER_TYPES,
  RIDER_TYPE_KEYS,
  ABILITY_KEYS,
  GUARDS,
  NEUTRAL_BASELINE,
  scoreRiderType,
  computeRiderTypes,
  resolveRiderTypes,
} from "./riderTypes.js";

// Syntetisk baseline (mean 35, std 15 pr. evne) ~ prod-abilities — gør testene
// uafhængige af den fittede riderTypesBaseline.json (som ændrer sig med populationen).
const BASELINE = {
  mean: Object.fromEntries(ABILITY_KEYS.map((a) => [a, 35])),
  std: Object.fromEntries(ABILITY_KEYS.map((a) => [a, 15])),
};

// Komplet ability-profil med default + overrides.
const rider = (over = {}, base = 30) =>
  Object.fromEntries(ABILITY_KEYS.map((a) => [a, over[a] ?? base]));

test("RIDER_TYPES indeholder de 8 forventede typer i tie-break-rækkefølge", () => {
  assert.equal(RIDER_TYPES.length, 8);
  assert.deepEqual(RIDER_TYPE_KEYS, [
    "sprinter", "tt", "climber", "puncheur",
    "brostensrytter", "baroudeur", "rouleur", "gc",
  ]);
});

test("goat, domestique, allrounder og leadout er fjernet som typer", () => {
  for (const k of ["goat", "domestique", "allrounder", "classics", "leadout"]) {
    assert.ok(!RIDER_TYPE_KEYS.includes(k), `${k} bør være fjernet`);
  }
});

test("type-formler refererer kun evner i ABILITY_KEYS", () => {
  const valid = new Set(ABILITY_KEYS);
  for (const t of RIDER_TYPES) {
    for (const ability of Object.keys(t.weights)) {
      assert.ok(valid.has(ability), `${t.key} bruger ukendt evne ${ability}`);
    }
  }
});

test("scoreRiderType: kontrast = snit(positive z) − snit(negative z) (hånd-regnet)", () => {
  // tt = { time_trial:3, climbing:-2, sprint:-1, punch:-1 } (#1122: climbing-straf). Neutral baseline → z = rå.
  // pos = (3·90)/3 = 90. neg = (2·0 + 1·10 + 1·20)/4 = 30/4 = 7,5. score = 90 − 7,5 = 82,5. (climbing mangler → z=0.)
  const ab = { time_trial: 90, sprint: 10, punch: 20 };
  assert.equal(scoreRiderType(ab, RIDER_TYPES.find((t) => t.key === "tt").weights, NEUTRAL_BASELINE), 82.5);
});

test("scoreRiderType: kun positive vægte → ingen negativ-straf", () => {
  // rouleur = { flat:4, endurance:1, climbing:-1, sprint:-1 } (#3325: flat 2→4)
  const ab = { flat: 50, endurance: 20, climbing: 0, sprint: 0 };
  // pos = (4·50 + 1·20)/5 = 44. neg = (0+0)/2 = 0. score = 44.
  assert.equal(scoreRiderType(ab, RIDER_TYPES.find((t) => t.key === "rouleur").weights, NEUTRAL_BASELINE), 44);
});

// ── Guards ────────────────────────────────────────────────────────────────────
test("leadout er skåret (§0.1 Besl. 6) → en sprint-tog-profil foldes i sprinter/rouleur", () => {
  // Moderat sprint uden eget speciale = den tidligere leadout-profil. Typen findes
  // ikke længere, så den må aldrig dukke op og skal lande i sprinter/rouleur.
  const r = rider({ sprint: GUARDS.highSpeciality - 5, acceleration: 60, flat: 60, durability: 50 });
  const { primary, secondary } = computeRiderTypes(r, BASELINE);
  assert.notEqual(primary.key, "leadout");
  assert.notEqual(secondary.key, "leadout");
  assert.ok(["sprinter", "rouleur"].includes(primary.key), `forventede sprinter/rouleur, fik ${primary.key}`);
});

test("guard: ≥ tærskel i et speciale → aldrig rouleur", () => {
  const r = rider({ climbing: GUARDS.highSpeciality, flat: 80, endurance: 70 });
  const { primary, secondary } = computeRiderTypes(r, BASELINE);
  assert.notEqual(primary.key, "rouleur");
  assert.notEqual(secondary.key, "rouleur");
});

test("guard: sprint > brosten → aldrig brostensrytter", () => {
  const r = rider({ sprint: 60, cobblestone: 55, flat: 70, endurance: 60 });
  const { primary, secondary } = computeRiderTypes(r, BASELINE);
  assert.notEqual(primary.key, "brostensrytter");
  assert.notEqual(secondary.key, "brostensrytter");
});

test("guard: brosten ≥ sprint tillader brostensrytter", () => {
  const r = rider({ cobblestone: 90, sprint: 40, flat: 70, endurance: 65, punch: 60, climbing: 15 });
  assert.equal(computeRiderTypes(r, BASELINE).primary.key, "brostensrytter");
});

test("gc: bjerg+tt+recovery alle høje → gc mulig (kontrast, ingen AND-guard)", () => {
  const r = rider({ climbing: 75, time_trial: 60, recovery: 60, tempo: 65, endurance: 60, durability: 55, sprint: 20 });
  const { primary, secondary } = computeRiderTypes(r, BASELINE);
  assert.ok([primary.key, secondary.key].includes("gc"), "gc bør være i top-2 for ægte etapeløbsrytter");
});

// #3570 fase 2 (ejer-beslutning 9/8, låst): den tidligere AND-guard (bjerg+tt+
// recovery alle ≥ tærskel + punch<=tt) er SLETTET fra guardedOut — se GUARDS'
// kommentar i riderTypes.js for hvorfor (den var selv en af portene gc-tragten
// døde i, målt 9/8: gc 0,0 % genfinding uanset guard-dæmpning alene). gc
// afgøres nu UDELUKKENDE af kontrast-scoren: en profil med høj climbing+time_trial
// men LAV recovery kan derfor nu havne i top-2 som gc (den gamle guard ville have
// udelukket den helt, uanset hvor stærk kontrasten var) — dette er MÅL-adfærden,
// ikke en fejl. Testen dokumenterer det faktiske (målte) udfald, tuner ikke mod det.
test("gc: guarden er fjernet — lav recovery udelukker ikke længere gc fra top-2", () => {
  const r = rider({ climbing: 90, time_trial: 80, recovery: 17, tempo: 70 });
  const { primary, secondary } = computeRiderTypes(r, BASELINE);
  assert.ok([primary.key, secondary.key].includes("gc"),
    "med guarden fjernet skal en stærk klatre+tt-profil kunne ende i top-2 som gc selv med lav recovery");
});

// ── computeRiderTypes generelt ───────────────────────────────────────────────
test("computeRiderTypes returnerer altid primær + sekundær (top-2)", () => {
  const r = rider({ acceleration: 85, sprint: 82, climbing: 12 });
  const { primary, secondary } = computeRiderTypes(r, BASELINE);
  assert.ok(primary && typeof primary.key === "string");
  assert.ok(secondary && typeof secondary.key === "string");
  assert.notEqual(primary.key, secondary.key);
  assert.ok(primary.score >= secondary.score);
});

test("edge: tom rytter → deterministisk top-2, ingen crash", () => {
  const a = computeRiderTypes({}, BASELINE);
  const b = computeRiderTypes({}, BASELINE);
  assert.deepEqual(a, b);
});

// ── Realistiske fixtures (abilities 0-99) ────────────────────────────────────
test("fixture: ren spurter → sprinter", () => {
  const sprinter = rider({
    acceleration: 88, sprint: 85, flat: 72, durability: 58, climbing: 12,
    endurance: 30, cobblestone: 22, punch: 40,
  });
  assert.equal(computeRiderTypes(sprinter, BASELINE).primary.key, "sprinter");
});

test("fixture: ren klatrer → climber", () => {
  const climber = rider({
    climbing: 88, tempo: 72, punch: 50, endurance: 60, sprint: 10,
    acceleration: 18, flat: 18, time_trial: 35, recovery: 30, cobblestone: 12,
  });
  assert.equal(computeRiderTypes(climber, BASELINE).primary.key, "climber");
});

test("fixture: tidskører → tt", () => {
  const tt = rider({
    time_trial: 90, prolog: 82, flat: 55, endurance: 50, sprint: 14,
    punch: 18, climbing: 35, acceleration: 20, cobblestone: 20,
  });
  assert.equal(computeRiderTypes(tt, BASELINE).primary.key, "tt");
});

test("fixture: brostensspecialist → brostensrytter", () => {
  const cobbles = rider({
    cobblestone: 90, flat: 75, endurance: 70, punch: 60, climbing: 14,
    sprint: 45, acceleration: 40,
  });
  assert.equal(computeRiderTypes(cobbles, BASELINE).primary.key, "brostensrytter");
});

test("fixture: ægte etapeløbsrytter → gc", () => {
  // #3325: climber/tt trukket ned (mindre punch/tempo/endurance-overlap) så gc-
  // profilen (høj climbing+time_trial+recovery SAMTIDIG) vinder med klar margin.
  const gc = rider({
    climbing: 85, time_trial: 80, recovery: 75, tempo: 50, endurance: 50,
    durability: 50, punch: 40, prolog: 50, flat: 30, sprint: 15, acceleration: 20,
  });
  assert.equal(computeRiderTypes(gc, BASELINE).primary.key, "gc");
});

// ── #3570: fast rytter-identitet (ejer-beslutning 10/8) ─────────────────────
// resolveRiderTypes bryder løkken type → ability_caps → type. Se funktionens
// topkommentar for fikspunkt-målingen der begrunder den.

test("#3570: uden archetype_draw er resolveRiderTypes BIT-IDENTISK med computeRiderTypes", () => {
  // Den bærende bagudkompatibilitets-invariant: alle 8.186 eksisterende ryttere
  // har archetype_draw = NULL og må ikke flytte sig af denne ændring.
  const profiles = [];
  for (let i = 0; i < 200; i++) {
    const p = {};
    // Deterministisk pseudo-tilfældig spredning (ingen Math.random i tests).
    for (const [j, a] of ABILITY_KEYS.entries()) p[a] = 5 + ((i * 37 + j * 61) % 90);
    profiles.push(p);
  }
  for (const [nul, label] of [[undefined, "undefined"], [null, "null"], [{}, "{}"],
    [{ primary: null }, "primary:null"], [{ primary: "ikke_en_type" }, "ukendt nøgle"],
    ["baroudeur", "streng i stedet for objekt"]]) {
    for (const p of profiles) {
      const expected = computeRiderTypes(p, BASELINE);
      const actual = resolveRiderTypes(nul, p, BASELINE);
      assert.equal(actual.primary.key, expected.primary.key, `primær uændret (${label})`);
      assert.equal(actual.secondary.key, expected.secondary.key, `sekundær uændret (${label})`);
      assert.equal(actual.primary.score, expected.primary.score, `score uændret (${label})`);
    }
  }
});

test("#3570: et gyldigt anlæg vinder over klassifikatoren — også når de er uenige", () => {
  // Ren spurter-profil, men trukket som gc: anlægget er sandheden om rytteren.
  const spurter = rider({ sprint: 95, acceleration: 92, flat: 80, climbing: 10, time_trial: 15 });
  assert.equal(computeRiderTypes(spurter, BASELINE).primary.key, "sprinter", "forudsætning: klassifikatoren siger sprinter");
  assert.equal(resolveRiderTypes({ primary: "gc" }, spurter, BASELINE).primary.key, "gc");
});

test("#3570: hybrid-træk bærer sin egen sekundære type; ikke-hybrid får klassifikatorens bedste ≠ primær", () => {
  const p = rider({ climbing: 80, tempo: 70, punch: 65 });

  const hybrid = resolveRiderTypes({ primary: "gc", secondary: "brostensrytter", isHybrid: true }, p, BASELINE);
  assert.equal(hybrid.primary.key, "gc");
  assert.equal(hybrid.secondary.key, "brostensrytter", "sekundær kommer fra trækket");

  const ren = resolveRiderTypes({ primary: "gc", secondary: null, isHybrid: false }, p, BASELINE);
  assert.equal(ren.primary.key, "gc");
  assert.ok(RIDER_TYPE_KEYS.includes(ren.secondary.key), "sekundær er en rigtig type (UI-kontrakten holder)");
  assert.notEqual(ren.secondary.key, "gc", "sekundær er aldrig lig primær");

  // Et træk der peger sekundær == primær må ikke give en duplikat.
  const dup = resolveRiderTypes({ primary: "gc", secondary: "gc", isHybrid: true }, p, BASELINE);
  assert.notEqual(dup.secondary.key, dup.primary.key);
});

test("#3570: LØKKEN ER SELVBEKRÆFTENDE — en forkert type cementeres for evigt uden forankring", async () => {
  // Selve defekten: caps formes af den persisterede type (dailyTrainingEngine) og
  // typen udledes af de samme caps (riderValueRefresh). En rytter der ÉN gang blev
  // fejlklassificeret kan derfor aldrig komme tilbage — lofterne bekræfter labelen,
  // og labelen former lofterne. Dette er den prod-drift #3450 rapporterer.
  const { buildCapsForRider } = await import("./riderProgression.js");
  const start = rider({ climbing: 40, tempo: 38, punch: 35, flat: 30 });
  // age: null — denne test måler løkke-dynamikken på en syntetisk rytter uden alder,
  // ikke taperen. #3591's kontrakt kræver at fravalget skrives eksplicit.
  const ctx = { potentiale: 5, age: null };

  // Rytteren ER trukket som gc, men bærer en gammel fejl-label: sprinter.
  //
  // FIKSPUNKTET FØLGER KALIBRERINGEN, og det har flyttet sig tre gange:
  //
  //   før trin 4 (1,00/0,82/0,45/0,12)  → `sprinter`, altså fejl-labelen selv
  //   trin 4     (1,30/1,10/0,95/0,70/0,20) → `baroudeur`, ét skridt væk
  //   15/8, tilbagerullet til trin 3    → `sprinter` igen
  //   trin 7 (16/8, fladt tag 93/80/70/55/25) → `baroudeur` igen
  //
  // Under det flade tag bærer lofterne MINDRE type-signal (magnitude-
  // information er bevidst fjernet — taget må ikke røbe anlægget), så løkken
  // glider ét skridt væk fra fejl-labelen men finder stadig aldrig hjem. Det er
  // en accepteret omkostning, fordi forankringen (archetype_draw, testet
  // nedenfor) er live og løser den i prod. Skulle forankringen nogensinde blive
  // slået fra, er denne løkke igen den defekt #3570 rapporterede.
  //
  // Påstanden testen beviser er den samme uanset hvilket navn fikspunktet har.
  //
  // Påstanden testen beviser er derfor uændret: UDEN forankring finder rytteren
  // aldrig tilbage til sit anlæg, uanset hvor mange runder man giver ham.
  let forkert = { primary: { key: "sprinter" }, secondary: { key: "rouleur" } };
  const spor = [];
  for (let runde = 0; runde < 10; runde++) {
    const caps = buildCapsForRider(start, ctx, forkert.primary.key, forkert.secondary.key);
    forkert = computeRiderTypes(caps, BASELINE);
    spor.push(forkert.primary.key);
  }
  assert.notEqual(forkert.primary.key, "gc",
    "uden forankring finder rytteren aldrig tilbage til sit anlæg (gc)");
  assert.equal(forkert.primary.key, spor[spor.length - 2],
    "løkken skal stå stille på ET fikspunkt — driver den stadig efter 10 runder, er defekten en anden");
  assert.equal(forkert.primary.key, "baroudeur",
    "fikspunktet under trin 7's flade tag — se noten ovenfor");

  // Med forankring finder han tilbage i FØRSTE runde og bliver der.
  const draw = { primary: "gc", secondary: null, isHybrid: false };
  let typer = { primary: { key: "sprinter" }, secondary: { key: "rouleur" } };
  for (let runde = 0; runde < 10; runde++) {
    const caps = buildCapsForRider(start, ctx, typer.primary.key, typer.secondary.key);
    typer = resolveRiderTypes(draw, caps, BASELINE);
    assert.equal(typer.primary.key, "gc", `runde ${runde + 1}: identiteten står fast`);
  }
});
