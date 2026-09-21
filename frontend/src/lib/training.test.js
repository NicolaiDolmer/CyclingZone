import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRAINING_FOCUS_ABILITIES, TRAINING_FOCUS_KEYS, TRAINING_INTENSITIES,
  isValidFocus, isValidIntensity, injuryDaysLeft,
  isRiderInjured, flattenCondition, CONDITION_SELECT,
  injuryTimeLeft, injuryBadgeMessage,
} from "./training.js";

test("fokus-nøgler matcher abilities-mappens nøgler", () => {
  assert.deepEqual(TRAINING_FOCUS_KEYS, Object.keys(TRAINING_FOCUS_ABILITIES));
  // #3762: `tempo` og `restitution` kom til som sessioner i dagstype-modellen.
  // trin 2 (#3746, 16/8): `loebslaere` kom til (positioning/tactics/aggression).
  // #4631 (2/9): intervaldagen blev tre pakker — hybriden `vo2max` plus
  // `vo2max_climb` og `vo2max_punch`.
  // #5236/#5237 (14/9): tre nye hårde sessioner — cobbled_sectors,
  // echelon_drills, attack_repeats.
  assert.equal(TRAINING_FOCUS_KEYS.length, 14);
});

// #5236/#5237: fladens kopi af de tre nye sessioner. Drift mod backend fanges
// af backend/lib/handheldCopyGuards.test.js; her vogtes selve pakkerne.
test("#5236/#5237 · fladen kender de tre nye hårde sessioner", () => {
  assert.deepEqual([...TRAINING_FOCUS_ABILITIES.cobbled_sectors], ["cobblestone", "durability", "positioning"]);
  assert.deepEqual([...TRAINING_FOCUS_ABILITIES.echelon_drills], ["flat", "positioning", "durability"]);
  assert.deepEqual([...TRAINING_FOCUS_ABILITIES.attack_repeats], ["aggression", "punch", "acceleration"]);
  for (const key of ["cobbled_sectors", "echelon_drills", "attack_repeats"]) assert.ok(isValidFocus(key));
});

// #4631: fladens kopi af pakke-tabellen skal vise præcis det motoren træner.
// Drift mellem de to fanges af backend/lib/handheldCopyGuards.test.js; her
// vogtes selve splittet, så en halv tilbagerulning ikke går ubemærket hen.
test("#4631 · fladen kender de tre intervaldage, og hybriden er uændret", () => {
  assert.deepEqual([...TRAINING_FOCUS_ABILITIES.vo2max], ["climbing", "punch", "tempo"]);
  assert.deepEqual([...TRAINING_FOCUS_ABILITIES.vo2max_climb], ["climbing", "tempo"]);
  assert.deepEqual([...TRAINING_FOCUS_ABILITIES.vo2max_punch], ["punch", "tempo"]);
  assert.ok(isValidFocus("vo2max_climb"));
  assert.ok(isValidFocus("vo2max_punch"));
});

test("hvert fokus peger på mindst én evne", () => {
  for (const k of TRAINING_FOCUS_KEYS) {
    assert.ok(Array.isArray(TRAINING_FOCUS_ABILITIES[k]) && TRAINING_FOCUS_ABILITIES[k].length > 0, k);
  }
});

test("intensiteter inkluderer rest", () => {
  // #3762: `recovery` (aktiv restitution) er kommet til mellem hvile og let.
  assert.deepEqual(TRAINING_INTENSITIES, ["rest", "recovery", "easy", "normal", "hard"]);
});

test("validatorer afviser ukendte værdier + accepterer rest", () => {
  assert.ok(isValidFocus("vo2max"));
  assert.ok(!isValidFocus("nope"));
  assert.ok(isValidIntensity("hard"));
  assert.ok(isValidIntensity("rest"));
  assert.ok(!isValidIntensity("extreme"));
});

// injuryDaysLeft tests
test("injuryDaysLeft returnerer 0 ved null", () => {
  assert.equal(injuryDaysLeft(null), 0);
  assert.equal(injuryDaysLeft(undefined), 0);
});

test("injuryDaysLeft returnerer 0 når rask (fortid, dagen efter sidste skadedag)", () => {
  // injured_until = den SIDSTE skadede dag (inklusiv, jf. backend injured_until >= tickDate).
  // Dagen EFTER (i morgen er rytteren rask) => 0 dage tilbage.
  const today = new Date("2026-06-12T08:00:00");
  assert.equal(injuryDaysLeft("2026-06-11", today), 0);
});

// #1672: På den SIDSTE skadedag (today == injured_until) er rytteren STADIG skadet
// (backend: injured_until >= tickDate => kan ikke træne). UI skal vise "1 dag tilbage",
// ikke "0 dage tilbage". Den gamle strict >0-logik gav fejlagtigt 0.
test("injuryDaysLeft returnerer 1 på sidste skadedag (#1672 — ikke 0)", () => {
  const today = new Date("2026-06-25T08:00:00");
  assert.equal(injuryDaysLeft("2026-06-25", today), 1);
});

// #1672: injured_until lagres som DATE-kolonne => PostgREST returnerer ren dato-streng.
// Reproducér mod en kendt slutdato 3 kalenderdage frem fra dags dato.
test("injuryDaysLeft tæller inklusiv sidste skadedag (DATE-streng)", () => {
  // 22/6 i dag, sidste skadedag 25/6 => skadet 22, 23, 24, 25 = 4 dage tilbage.
  const today = new Date("2026-06-22T08:00:00");
  assert.equal(injuryDaysLeft("2026-06-25", today), 4);
});

test("injuryDaysLeft returnerer 2 når sidste skadedag er i morgen", () => {
  // 22/6 i dag, sidste skadedag 23/6 => skadet 22 + 23 = 2 dage tilbage.
  const today = new Date("2026-06-22T08:00:00");
  assert.equal(injuryDaysLeft("2026-06-23", today), 2);
});

// Robust på tværs af klokkeslæt: ren DATE-streng + vilkårligt klokkeslæt på today
// må ikke trække en dag af pga. tidszone/normalisering.
test("injuryDaysLeft er stabil hen over dagen (ingen tidszone-off-by-one)", () => {
  for (const hh of ["00:30", "08:00", "23:30"]) {
    assert.equal(injuryDaysLeft("2026-06-25", new Date(`2026-06-22T${hh}:00`)), 4, `kl. ${hh}`);
  }
});

// isRiderInjured tests (#1531 — skade-badge)
test("isRiderInjured er false ved null/undefined/fortid", () => {
  const today = new Date("2026-06-12T00:00:00Z");
  assert.equal(isRiderInjured(null, today), false);
  assert.equal(isRiderInjured(undefined, today), false);
  assert.equal(isRiderInjured("2026-06-11T00:00:00Z", today), false);
});

test("isRiderInjured er true når injured_until er i fremtiden", () => {
  const today = new Date("2026-06-12T00:00:00Z");
  assert.equal(isRiderInjured("2026-06-15T00:00:00Z", today), true);
});

// flattenCondition tests (#1531 — løft injured_until op fra embed)
test("flattenCondition løfter injured_until op fra objekt-embed", () => {
  const r = { id: "x", rider_condition: { injured_until: "2026-06-15" } };
  const out = flattenCondition(r);
  assert.equal(out.injured_until, "2026-06-15");
  assert.equal(out.rider_condition, undefined);
});

test("flattenCondition løfter injured_until op fra array-embed", () => {
  const r = { id: "x", rider_condition: [{ injured_until: "2026-06-15" }] };
  assert.equal(flattenCondition(r).injured_until, "2026-06-15");
});

test("flattenCondition tåler manglende/null embed (ingen skade-rad)", () => {
  assert.equal(flattenCondition({ id: "x" }).injured_until, undefined);
  assert.equal(flattenCondition({ id: "x", rider_condition: null }).injured_until, undefined);
  assert.equal(flattenCondition(null), null);
});

// #5462: loebsdags-tallet er med, form/fatigue er det stadig IKKE — skade-badget
// paa andres hold maa ikke traekke hele condition-raekken med sig.
test("CONDITION_SELECT embedder kun skade-felterne (ikke form/fatigue)", () => {
  assert.equal(CONDITION_SELECT, "rider_condition(injured_until, injury_race_days_left)");
});

// ── #5462: skadesvarighed i loebsdage (ejer-laast 15/9, §13.3 pkt. 7) ────────

test("#5462 injuryTimeLeft: med loebsdags-tallet svares der i LOEBSDAGE + en ca.-dato", () => {
  const injury = injuryTimeLeft({ injured_until: "2026-06-13", injury_race_days_left: 3 });
  assert.equal(injury.unit, "race_day");
  assert.equal(injury.count, 3);
  assert.equal(injury.approxDate, "2026-06-13", "datoen er altid et skoen — derfor 'ca.' i teksten");
});

test("#5462 injuryTimeLeft: UDEN loebsdags-tallet er svaret uaendret kalenderdage (flag off + overgang)", () => {
  const today = new Date("2026-06-22T08:00:00+02:00");
  const injury = injuryTimeLeft({ injured_until: "2026-06-25" }, today);
  assert.equal(injury.unit, "calendar_day");
  assert.equal(injury.count, injuryDaysLeft("2026-06-25", today), "samme tal som den kanoniske kalenderfunktion");
});

test("#5462 injuryTimeLeft: rask rytter og manglende condition giver 0", () => {
  assert.equal(injuryTimeLeft(null).count, 0);
  assert.equal(injuryTimeLeft({}).count, 0);
  assert.equal(injuryTimeLeft({ injured_until: null, injury_race_days_left: 0 }).count, 0);
});

test("#5462 injuryTimeLeft: et loebsdags-tal paa 0 er 'rask', ikke en loebsdags-skade", () => {
  const injury = injuryTimeLeft({ injured_until: "2026-06-13", injury_race_days_left: 0 },
    new Date("2026-06-20T08:00:00+02:00"));
  assert.equal(injury.count, 0);
  assert.equal(injury.unit, "calendar_day");
});

test("#5462 injuryBadgeMessage: noeglen foelger enheden, og ca.-dato-noeglen kraever en dato", () => {
  assert.deepEqual(
    injuryBadgeMessage({ unit: "race_day", count: 3, approxDate: "2026-06-13" }),
    { key: "injuredRaceDays", days: 3, date: "2026-06-13" },
  );
  assert.deepEqual(
    injuryBadgeMessage({ unit: "race_day", count: 3, approxDate: null }),
    { key: "injuredRaceDaysPlain", days: 3, date: null },
    "uden en dato maa teksten ikke love en '(ca. )'",
  );
  assert.equal(injuryBadgeMessage({ unit: "calendar_day", count: 1 }).key, "injured");
  assert.equal(injuryBadgeMessage({ unit: "calendar_day", count: 4 }).key, "injured_plural");
});
