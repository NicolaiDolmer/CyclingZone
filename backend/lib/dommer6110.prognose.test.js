// DOMMER #6110, de to kendte fund fra verifikationen 12/11 (rettes FOERST):
//   F1 buildTypePrognosisBands skal sende developmentXp med, saa prognosen paa
//      rytterprofilen, scouting og akademiet regnes paa XP-modellen, naar den er taendt.
//   F2 En manglende evne (null) maa ikke blive til 0 i prognosen (riderPrognosis.js,
//      Number(null) omkring linje 126). En manglende evne er manglende, ikke et nul.
// Plus R1 for prognosen: uden developmentXp er svaret praecis som foer.

import test from "node:test";
import assert from "node:assert/strict";

import {
  kraev, xpParams, fingeraftryk, evner, RIGELIG_XP_RAA, UNG_KLATRER, SPRINTER,
} from "./dommer6110.fixtures.mjs";

const P = await xpParams();
const RIGELIG = await xpParams(RIGELIG_XP_RAA);
const { prognoseAbilities, prognoseAbilityBands, PROGNOSIS_ENVELOPES } =
  await kraev("./riderPrognosis.js", "prognoseAbilities", "prognoseAbilityBands", "PROGNOSIS_ENVELOPES");
const { buildTypePrognosisBands } = await kraev("./scoutingReport.js", "buildTypePrognosisBands");

const profil = (rytter, ekstra = {}) => ({
  nowAbilities: rytter.abilities, age: rytter.age, primaryType: rytter.primaryType, secondaryType: rytter.secondaryType,
  potentiale: rytter.potentiale, level: 2, riderId: rytter.riderId, teamId: "dommer-hold", ...ekstra,
});
const baand = (rytter, ekstra = {}) => ({
  nowAbilities: rytter.abilities, age: rytter.age, primaryType: rytter.primaryType, secondaryType: rytter.secondaryType,
  potLo: Math.max(1, rytter.potentiale - 0.5), potHi: Math.min(6, rytter.potentiale + 0.5), riderId: rytter.riderId, ...ekstra,
});

// Taget af dommeren paa c8fe1c2a8 (6/11, foer den foerste XP-linje); det samme paa
// origin/main 5401140f2 (13/11) med kontakten slukket.
const PROGNOSE_FOER = "aabc40d977896a2775490912c57010e03c0d5ecd4a00639572de33ca7d472e5c";

test("R1 prognose slukket: uden developmentXp er type-prognosen praecis som foer", () => {
  const nu = [UNG_KLATRER, SPRINTER].flatMap((r) => [0, 1, 3].map((level) => buildTypePrognosisBands(profil(r, { level }))));
  assert.equal(fingeraftryk(nu), PROGNOSE_FOER);
  for (const r of [UNG_KLATRER, SPRINTER]) {
    assert.deepEqual(buildTypePrognosisBands(profil(r, { developmentXp: null })), buildTypePrognosisBands(profil(r)));
  }
});

// Findes XP-prognosen overhovedet i denne udgave? Uden den kan F1 ikke doemmes.
function kraevXpPrognose() {
  const fattig = prognoseAbilityBands(baand(UNG_KLATRER, { developmentXp: P }));
  const rig = prognoseAbilityBands(baand(UNG_KLATRER, { developmentXp: RIGELIG }));
  if (JSON.stringify(fattig) === JSON.stringify(rig)) {
    throw new Error("IKKE BYGGET: prognoseAbilityBands bruger ikke developmentXp (XP-prognosen findes ikke i denne udgave)");
  }
  return { fattig, rig };
}

test("F1 forudsaetning: prognose-baandet regner paa XP-modellen, naar det faar developmentXp", () => {
  const { fattig, rig } = kraevXpPrognose();
  assert.ok(rig.climbing.hi > fattig.climbing.hi, "mere XP pr. dag skal give en hoejere prognose");
});

test("F1 buildTypePrognosisBands sender developmentXp med: type-prognosen foelger XP-modellen", () => {
  kraevXpPrognose();
  const fattig = buildTypePrognosisBands(profil(UNG_KLATRER, { developmentXp: P }));
  const rig = buildTypePrognosisBands(profil(UNG_KLATRER, { developmentXp: RIGELIG }));
  const slukket = buildTypePrognosisBands(profil(UNG_KLATRER));
  assert.equal(fattig.length, rig.length);
  assert.notDeepEqual(rig, fattig, "to forskellige XP-modeller giver samme type-prognose: developmentXp bliver ikke sendt med");
  assert.notDeepEqual(rig, slukket, "XP-modellen aendrer ikke type-prognosen: developmentXp bliver ikke sendt med");
  for (let i = 0; i < rig.length; i++) {
    assert.equal(rig[i].key, fattig[i].key);
    assert.ok(rig[i].progHi >= fattig[i].progHi, `${rig[i].key}: mere XP maa ikke give en lavere prognose`);
    assert.equal(rig[i].now, slukket[i].now, `${rig[i].key}: rating nu er den samme`);
    assert.ok(rig[i].progLo >= rig[i].now && fattig[i].progLo >= fattig[i].now, `${rig[i].key}: prognosen ligger aldrig under nu`);
  }
  assert.ok(rig.some((r, i) => r.progHi > fattig[i].progHi), "mindst én type skal have en hoejere prognose med mere XP");
});

test("F1 type-prognosen under XP er den samme som baandet under XP (én kilde, ikke to)", async () => {
  kraevXpPrognose();
  const { potentialeIntervalFor, ratingFromAbilities } = await kraev("./scoutingReport.js", "potentialeIntervalFor", "ratingFromAbilities");
  const p = profil(UNG_KLATRER, { developmentXp: RIGELIG });
  const { potLo, potHi } = potentialeIntervalFor({ potentiale: p.potentiale, level: p.level, riderId: p.riderId, teamId: p.teamId });
  const b = prognoseAbilityBands({ ...baand(UNG_KLATRER, { developmentXp: RIGELIG }), potLo, potHi });
  const hoej = Object.fromEntries(Object.entries(b).map(([evne, v]) => [evne, v.hi]));
  const typer = buildTypePrognosisBands(p);
  const klatrer = typer.find((t) => t.key === "climber");
  assert.ok(klatrer, "klatrer-typen skal vaere med");
  const facit = Math.max(0, Math.min(99, Math.round(ratingFromAbilities(hoej, "climber"))));
  assert.ok(Math.abs(klatrer.progHi - facit) <= 1, `klatrer progHi ${klatrer.progHi} mod baandets ${facit}`);
});

test("F2 null er ikke nul: en manglende evne giver samme prognose som en evne, der slet ikke er der (gammel model)", () => {
  const medNull = evner(48, { climbing: null, sprint: 61 });
  const uden = { ...medNull };
  delete uden.climbing;
  const kald = (nowAbilities) => prognoseAbilities({
    nowAbilities, age: 21, primaryType: "climber", secondaryType: "puncheur", potentiale: 4, envelope: PROGNOSIS_ENVELOPES.dedikeret,
  });
  const a = kald(medNull);
  assert.ok(!("climbing" in a), `en manglende evne maa ikke faa en prognose (fik ${a.climbing})`);
  assert.deepEqual(a, kald(uden));
});

test("F2 null er ikke nul: ogsaa i baandet og for en rytter forbi sin top", () => {
  for (const mangler of [null, undefined]) {
    const medHul = evner(55, { time_trial: mangler, tactics: mangler });
    const uden = { ...medHul };
    delete uden.time_trial;
    delete uden.tactics;
    for (const age of [20, 34]) {
      const kald = (nowAbilities) => prognoseAbilityBands({
        nowAbilities, age, primaryType: "sprinter", secondaryType: null, potLo: 2.5, potHi: 3.5,
      });
      const a = kald(medHul);
      assert.ok(!("time_trial" in a) && !("tactics" in a), `mangler=${JSON.stringify(mangler)} alder=${age}: ${JSON.stringify({ tt: a.time_trial, ta: a.tactics })}`);
      assert.deepEqual(a, kald(uden));
    }
  }
});

test("F2 null er ikke nul: en rigtig evne paa 0 er stadig en evne", () => {
  const a = prognoseAbilities({
    nowAbilities: evner(40, { cobblestone: 0 }), age: 21, primaryType: "climber", secondaryType: null, potentiale: 3,
    envelope: PROGNOSIS_ENVELOPES.spredt,
  });
  assert.ok("cobblestone" in a && Number.isFinite(a.cobblestone));
});

test("F2 null er ikke nul: samme regel under XP-modellen", () => {
  kraevXpPrognose();
  const medNull = evner(48, { climbing: null });
  const uden = { ...medNull };
  delete uden.climbing;
  const kald = (nowAbilities) => prognoseAbilities({
    nowAbilities, age: 21, primaryType: "climber", secondaryType: null, potentiale: 4, riderId: "dommer-null", developmentXp: P,
  });
  const a = kald(medNull);
  assert.ok(!("climbing" in a));
  assert.deepEqual(a, kald(uden));
});
