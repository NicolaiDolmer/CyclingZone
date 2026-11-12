// #6110 trin 2: kontakten for XP-modellen og grenen i motoren. Tallene er syntetiske
// (hard rule 17). Testene laaser:
//   · slukket (alle former) = identisk med en FROSSEN kopi fra merge-basen (#7587); hele tal
//     eksakt, kommatal til faste betydende cifre, saa Windows og Linux giver samme hash
//   · loaderen: kontakt, startdato (tick-datoen afgoer), params, strict og de ugyldige par
//   · grenen: intet loft, prisen bremser, maks +1 pr. dato uden XP-tab, kurve B taber
//   · loebsdagens rolletillaeg laegger det samme oven i, uanset off-fokus-andelen
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { applyDailyTick, dailyAbilityDelta } from "./dailyTraining.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { TRAINING_FOCUSES } from "./training.js";
import { RACE_DAY_FOCUS, raceDayProgram } from "./raceDayYield.js";
import { VALID_RACE_ROLES } from "./raceRoles.js";
import { withRaceDayRoleYield } from "./raceDayRoleYield5950.js";
import { FRESH_FLAG_KEYS } from "./featureStage.js";
import { STAGE_FLAGS } from "./stageFlagCatalog.js";
import {
  XP_RACE_DAY_FOCUS, buyPoints, capXpTickGainsPerDate, developmentXpAbilityDelta, validateDevelopmentXpParams,
  xpPriceForNextPoint,
} from "./developmentXp.ts";
import {
  DEVELOPMENT_XP_FLAG_KEY, DEVELOPMENT_XP_FROM_DATE_KEY, DEVELOPMENT_XP_PARAMS_KEY,
  developmentXpFromDateValue, loadDevelopmentXp, withRaceDayRoleYieldXp,
} from "./developmentXpFlag.ts";
import {
  XP_TEST_PARAMS, ENGINE_SCENARIOS, allOffDigests, engineSeed, gameState, runEngine,
} from "./__fixtures__/developmentXpOffScenarios.js";

const GOLDEN = JSON.parse(readFileSync(new URL("./__fixtures__/developmentXpOffGolden.json", import.meta.url), "utf8"));
const XP = validateDevelopmentXpParams(XP_TEST_PARAMS);
const FIXED_NOW = () => 1_700_000_000_000;

// ── Frossen golden ────────────────────────────────────────────────────────────

test("#6110 golden: slukket XP er identisk med merge-basen (funktioner og motor, alle slukkede former)", async () => {
  assert.match(GOLDEN.sourceCommit, /^[0-9a-f]{40}$/);
  const now = await allOffDigests({ withRoleYield: (extra, ctx) => withRaceDayRoleYieldXp(null, extra, ctx) });
  assert.equal(now.applyDailyTick, GOLDEN.applyDailyTick, "applyDailyTick");
  assert.equal(now.dailyAbilityDelta, GOLDEN.dailyAbilityDelta, "dailyAbilityDelta");
  assert.deepEqual(Object.keys(now.engine).sort(), Object.keys(GOLDEN.engine).sort());
  for (const [key, digest] of Object.entries(GOLDEN.engine)) assert.equal(now.engine[key], digest, key);
});

test("#6110 golden: scenarierne er ikke tomme (motoren giver faktisk point og fremdrift)", async () => {
  const state = engineSeed({ flags: ENGINE_SCENARIOS.cap.flags, raced: false, overlay: { app: [], params: undefined }, plan: "vo2max" });
  const result = await runEngine(state);
  const gains = result.report.riders.flatMap((r) => Object.values(r.gains ?? {}));
  assert.ok(gains.length > 0, "mindst ét point i scenariet");
});

// ── Registrering ──────────────────────────────────────────────────────────────

test("#6110: kontakten er registreret (aldrig cachet, i kataloget) og loebsdagens fokus er det samme", () => {
  assert.ok(FRESH_FLAG_KEYS.has(DEVELOPMENT_XP_FLAG_KEY));
  assert.ok(STAGE_FLAGS.some((f) => f.key === DEVELOPMENT_XP_FLAG_KEY && f.area === "training"));
  assert.equal(XP_RACE_DAY_FOCUS, RACE_DAY_FOCUS);
});

// ── Loaderen ──────────────────────────────────────────────────────────────────

function fakeDb({ app = {}, priv = {}, failApp = [], failPriv = false } = {}) {
  const reads = [];
  return {
    reads,
    from(table) {
      const q = { key: null };
      const chain = {
        select() { return chain; },
        eq(_col, key) { q.key = key; return chain; },
        async maybeSingle() {
          reads.push({ table, key: q.key });
          if (table === "app_config") {
            if (failApp.includes(q.key)) return { data: null, error: { message: "boom" } };
            return { data: q.key in app ? { value: app[q.key] } : null, error: null };
          }
          if (failPriv) return { data: null, error: { message: "boom" } };
          return { data: q.key in priv ? { value: priv[q.key] } : null, error: null };
        },
      };
      return chain;
    },
  };
}

const ON = { [DEVELOPMENT_XP_FLAG_KEY]: "on", [DEVELOPMENT_XP_FROM_DATE_KEY]: "2026-11-15" };
const PRIV = { [DEVELOPMENT_XP_PARAMS_KEY]: XP_TEST_PARAMS };
const quiet = () => { const warnings = []; return { warnings, log: { warn: (m) => warnings.push(String(m)) } }; };
const load = (db, extra = {}) => loadDevelopmentXp({ supabase: db, tickDate: "2026-11-15", now: FIXED_NOW, ...extra });

test("#7739 loader: XP kraever ikke dato-loftet (ejer 7/11); ingen advarsel om ability_cap_per_date_enabled", async () => {
  const { warnings, log } = quiet();
  const db = fakeDb({ app: ON, priv: PRIV });
  assert.deepEqual(await load(db, { log }), XP);
  assert.ok(!warnings.some((w) => w.includes("ability_cap_per_date_enabled")));
});

test("#6110 loader: slukket, beta og false er null uden at laese params", async () => {
  for (const value of [undefined, "off", "beta", false, null, "yes"]) {
    for (const strict of [false, true]) {
      const db = fakeDb({ app: value === undefined ? {} : { [DEVELOPMENT_XP_FLAG_KEY]: value, [DEVELOPMENT_XP_FROM_DATE_KEY]: "2026-01-01" }, priv: PRIV });
      assert.equal(await load(db, { strict }), null, `${value} strict=${strict}`);
      assert.ok(!db.reads.some((r) => r.table === "private_config"), "ingen params-opslag naar kontakten er slukket");
    }
  }
});

test("#6110 loader: tick-datoen afgoer modellen; foer startdatoen (ogsaa efterslaeb) er dagens model", async () => {
  const db = () => fakeDb({ app: ON, priv: PRIV });
  assert.deepEqual(await load(db(), { tickDate: "2026-11-15" }), XP);
  assert.deepEqual(await load(db(), { tickDate: "2026-12-01", strict: true }), XP);
  assert.equal(await load(db(), { tickDate: "2026-11-14" }), null);
  assert.equal(await load(db(), { tickDate: null }), null);
  assert.equal(await load(db(), { tickDate: "15/11/2026" }), null);
});

test("#6110 loader: on uden gyldig startdato eller params = dagens model + advarsel uden tal", async () => {
  const cases = [
    fakeDb({ app: { [DEVELOPMENT_XP_FLAG_KEY]: "on" }, priv: PRIV }),
    fakeDb({ app: { ...ON, [DEVELOPMENT_XP_FROM_DATE_KEY]: "2026-02-30" }, priv: PRIV }),
    fakeDb({ app: { ...ON, [DEVELOPMENT_XP_FROM_DATE_KEY]: 20261115 }, priv: PRIV }),
    fakeDb({ app: ON }),
    fakeDb({ app: ON, priv: { [DEVELOPMENT_XP_PARAMS_KEY]: { ...XP_TEST_PARAMS, offFocusShare: 2 } } }),
  ];
  for (const db of cases) {
    const { warnings, log } = quiet();
    assert.equal(await load(db, { log }), null);
    assert.ok(warnings.some((w) => w.includes("[development-xp]") || w.includes("[private-config]")), "advarsel");
    assert.ok(!warnings.some((w) => /potentialXp|exponent|typeShare|\b0\.1\b/.test(w)), "advarslen viser aldrig params");
  }
});

test("#6110 loader: strict kaster ved fejlet laesning, uden strict er det dagens model", async () => {
  for (const db of [fakeDb({ app: ON, priv: PRIV, failApp: [DEVELOPMENT_XP_FLAG_KEY] }), fakeDb({ app: ON, priv: PRIV, failApp: [DEVELOPMENT_XP_FROM_DATE_KEY] }), fakeDb({ app: ON, failPriv: true })]) {
    await assert.rejects(load(db, { strict: true }));
  }
  const { log } = quiet();
  assert.equal(await load(fakeDb({ app: ON, priv: PRIV, failApp: [DEVELOPMENT_XP_FROM_DATE_KEY] }), { log }), null);
  assert.equal(await load(fakeDb({ app: ON, failPriv: true }), { log }), null);
  // Ugyldige params i strict kaster ogsaa (privateConfig.ts' strict-regel).
  await assert.rejects(load(fakeDb({ app: ON, priv: { [DEVELOPMENT_XP_PARAMS_KEY]: {} } }), { strict: true, log }));
});

test("#6110 loader: XP sammen med Udviklingsscore B eller catch-up er ugyldigt og kaster", async () => {
  await assert.rejects(load(fakeDb({ app: ON, priv: PRIV }), { developmentScoreB: { any: 1 } }), /development_score_v2/);
  await assert.rejects(load(fakeDb({ app: ON, priv: PRIV }), { raceCatchUp: { any: 1 } }), /race_day_catchup_enabled/);
  // Er XP ikke aktiv paa datoen, kaster det ikke: dagens opsaetning koerer uaendret.
  assert.equal(await load(fakeDb({ app: ON, priv: PRIV }), { tickDate: "2026-11-01", developmentScoreB: { any: 1 } }), null);
});

test("#6110 startdato: kun en rigtig dansk dato", () => {
  assert.equal(developmentXpFromDateValue("2026-11-15"), "2026-11-15");
  for (const v of ["2026-13-01", "2026-02-29", "2026-11-15T00:00:00Z", "", null, 5, {}]) assert.equal(developmentXpFromDateValue(v), null);
});

// ── Grenen i applyDailyTick ───────────────────────────────────────────────────

const abilitiesAt = (v) => Object.fromEntries(VISIBLE_ABILITIES.map((k) => [k, v]));
function tickArgs(extra = {}) {
  return {
    riderId: "r1", dateStr: "2026-11-15", age: 24, potentiale: 4, primaryType: "climber", secondaryType: "puncheur",
    abilities: abilitiesAt(60), caps: abilitiesAt(60), progress: {}, conditionMult: 1,
    program: { focus: "vo2max_climb", intensity: "hard" }, developmentXp: XP, ...extra,
  };
}

test("#6110 gren: intet loft (B4). En evne paa sit gamle tag faar XP og koeber point til prisen", () => {
  const r = applyDailyTick(tickArgs());
  assert.ok(r.xp.climbing > 0, "fokus-evnen tjener XP, selv om den staar paa taget");
  const expected = buyPoints({ level: 60, bar: 0, xp: r.xp.climbing }, XP);
  assert.equal(r.abilities.climbing, expected.level);
  assert.equal(r.progress.climbing, expected.bar);
  assert.ok(r.trainingScore, "passets kvalitet regnes stadig");
  assert.ok(["over", "under", "normal"].includes(r.status));
});

test("#6110 gren: mest i fokus, lidt i resten; hvile giver intet, restitution kun egen evne", () => {
  const hard = applyDailyTick(tickArgs());
  const off = VISIBLE_ABILITIES.find((a) => !["climbing", "endurance", "punch", "tempo", "recovery"].includes(a) && hard.xp[a] > 0);
  assert.ok(off, "en evne uden for sessionen faar lidt");
  assert.ok(hard.xp.climbing > hard.xp[off]);
  const rest = applyDailyTick(tickArgs({ program: { focus: "vo2max_climb", intensity: "rest" } }));
  assert.deepEqual(rest.xp, {});
  const recovery = applyDailyTick(tickArgs({ program: { focus: "restitution", intensity: "recovery" } }));
  assert.ok(Object.keys(recovery.xp).length >= 1);
  for (const a of Object.keys(recovery.xp)) assert.ok(TRAINING_FOCUSES.restitution.includes(a), `${a}: kun sessionens egen evne`);
});

test("#6110 gren: XP vinder over kurve B, og Score B/catch-up-felterne paa tick'et roerer ikke XP-delen", () => {
  const plain = applyDailyTick(tickArgs());
  const withCurveB = applyDailyTick(tickArgs({ curveB: { rate: 1 }, curveBTransition: { weight: 0.5, abilities: ["climbing"] } }));
  assert.deepEqual(withCurveB.abilities, plain.abilities);
  assert.deepEqual(withCurveB.progress, plain.progress);
  assert.deepEqual(withCurveB.xp, plain.xp);
});

test("#6110 gren: alder er aldrig en turbo, og form/traethed er ikke et led (S29)", () => {
  const young = applyDailyTick(tickArgs({ age: 18 }));
  const adult = applyDailyTick(tickArgs({ age: 26 }));
  assert.deepEqual(young.xp, adult.xp, "fuld XP til og med 28, ingen ungdomsfaktor");
  const tired = applyDailyTick(tickArgs({ conditionMult: 0.6 }));
  assert.deepEqual(tired.xp, applyDailyTick(tickArgs()).xp);
  const veteran = applyDailyTick(tickArgs({ age: 33 }));
  assert.ok(veteran.xp.climbing < adult.xp.climbing, "XP falder efter toppen");
});

test("#6110 gren: maks +1 pr. tick paa loebsdags-aksen; resten bliver paa bjaelken uden tab", () => {
  const args = tickArgs({ abilities: abilitiesAt(5), caps: abilitiesAt(5), hardDailyCap: 1, budgetDivisor: 126 });
  const r = applyDailyTick(args);
  for (const n of Object.values(r.gains)) assert.ok(n <= 1);
  // Bevarelse: XP foer + tjent = XP brugt paa point + XP paa bjaelken bagefter.
  const a = "climbing";
  const spent = r.gains[a] ? xpPriceForNextPoint(5, XP) : 0;
  const after = r.progress[a] * xpPriceForNextPoint(r.abilities[a], XP);
  assert.ok(Math.abs(r.xp[a] - (spent + after)) < 1e-9);
});

test("#6110 gren: dailyAbilityDelta under XP er XP pr. tick, og en dato paa loebsdags-aksen deler den", () => {
  const base = { ability: "climbing", current: 60, cap: 60, age: 24, potentiale: 4, program: { focus: "vo2max_climb", intensity: "hard" }, primaryType: "climber", developmentXp: XP };
  const calendar = dailyAbilityDelta(base);
  const raceAxis = dailyAbilityDelta({ ...base, budgetDivisor: 126 });
  assert.ok(calendar > 0);
  assert.ok(raceAxis > 0 && raceAxis < calendar);
  assert.equal(dailyAbilityDelta({ ...base, developmentXp: null }), 0, "dagens model: paa taget = 0");
});

test("#6110 gren: traener og facilitet kun paa traeningsdage (S13)", () => {
  const staff = { training_staff: [{ dimension: "physical", level: 5 }] };
  const args = { ability: "climbing", age: 24, potentiale: 4, primaryType: "climber" };
  const train = { focus: "vo2max_climb", intensity: "hard" };
  const race = { ...raceDayProgram("mountain"), intensity: "hard" };
  const t0 = developmentXpAbilityDelta({ ...args, program: train }, XP);
  const t1 = developmentXpAbilityDelta({ ...args, program: train, staff, facilityTier: 3, riderLevel: "senior" }, XP);
  const r0 = developmentXpAbilityDelta({ ...args, program: race }, XP);
  const r1 = developmentXpAbilityDelta({ ...args, program: race, staff, facilityTier: 3, riderLevel: "senior" }, XP);
  assert.ok(t1 >= t0);
  assert.equal(r1, r0);
});

// ── Maks +1 pr. dato i XP ─────────────────────────────────────────────────────

test("#6110 dato-loft: klippet tick koebes om fra tilstanden foer tick'et, ingen XP tabt", () => {
  const abilities = abilitiesAt(5);
  const progress = { climbing: 0.5 };
  const tick = applyDailyTick(tickArgs({ abilities, caps: abilities, progress }));
  assert.ok(tick.gains.climbing >= 2, "scenariet koeber flere point");
  const capped = capXpTickGainsPerDate({ tickResult: tick, abilities, progress, usedGains: {} }, XP);
  assert.equal(capped.gains.climbing, 1);
  const again = buyPoints({ level: 5, bar: 0.5, xp: tick.xp.climbing, maxPoints: 1 }, XP);
  assert.equal(capped.abilities.climbing, again.level);
  assert.equal(capped.progress.climbing, again.bar);
  assert.equal(capped.capped_by_date.climbing, tick.gains.climbing - 1);
  const used = capXpTickGainsPerDate({ tickResult: tick, abilities, progress, usedGains: { climbing: 1 } }, XP);
  assert.equal(used.gains.climbing, undefined);
  assert.equal(used.abilities.climbing, 5);
  // Uden klip: samme objekt.
  const small = { gains: { climbing: 1 }, abilities, progress };
  assert.equal(capXpTickGainsPerDate({ tickResult: small, abilities, progress }, XP), small);
});

// ── Loebsdagens rolletillaeg ──────────────────────────────────────────────────

const ROLE_PARAMS = Object.freeze({ stageBonus: 0.37, leadShare: 0.43 });

test("#6110 rolletillaeg: slukket = withRaceDayRoleYield med samme argumenter", () => {
  for (const params of [null, ROLE_PARAMS, { ...ROLE_PARAMS, roleDrivesBaseDay: true }]) {
    for (const role of [...VALID_RACE_ROLES, null]) {
      for (const extra of [{}, { abilityYieldMult: { climbing: 1.2 } }]) {
        assert.deepEqual(withRaceDayRoleYieldXp(null, extra, { params, profileType: "mountain", role }),
          withRaceDayRoleYield(extra, { params, profileType: "mountain", role }));
      }
    }
  }
});

test("#6110 rolletillaeg: tillaegget er det samme, uanset loebsdagens off-fokus-andel", () => {
  const other = validateDevelopmentXpParams({ ...XP_TEST_PARAMS, raceOffFocusShare: 0.05 });
  for (const role of VALID_RACE_ROLES) {
    for (const params of [ROLE_PARAMS, { ...ROLE_PARAMS, roleDrivesBaseDay: true }]) {
      const a = withRaceDayRoleYieldXp(XP, {}, { params, profileType: "mountain", role });
      const b = withRaceDayRoleYieldXp(other, {}, { params, profileType: "mountain", role });
      assert.equal(a.program.focus, RACE_DAY_FOCUS);
      for (const ability of VISIBLE_ABILITIES) {
        const xpOf = (xp, args) => developmentXpAbilityDelta({ ability, age: 24, potentiale: 4, primaryType: "climber", program: args.program }, xp)
          * (args.abilityYieldMult?.[ability] ?? 1);
        const inFocus = a.program.focusAbilities.includes(ability);
        if (!inFocus && (a.abilityYieldMult[ability] ?? 1) !== 1 && !params.roleDrivesBaseDay) {
          // Off-fokus: XP = basis(andel) + tillaeg. Forskellen mellem to andele er kun basis-forskellen.
          const baseA = developmentXpAbilityDelta({ ability, age: 24, potentiale: 4, primaryType: "climber", program: a.program }, XP);
          const baseB = developmentXpAbilityDelta({ ability, age: 24, potentiale: 4, primaryType: "climber", program: b.program }, other);
          assert.ok(Math.abs((xpOf(XP, a) - baseA) - (xpOf(other, b) - baseB)) < 1e-9, `${role} ${ability}`);
        }
      }
    }
  }
  assert.deepEqual(withRaceDayRoleYieldXp(XP, { x: 1 }, { params: null, profileType: "mountain" }), { x: 1 }, "uden rolletillaeg: loebsdagen som i dag");
});

// ── Motoren med kontakten taendt ──────────────────────────────────────────────

const XP_ON = { app: [[DEVELOPMENT_XP_FLAG_KEY, "on"], [DEVELOPMENT_XP_FROM_DATE_KEY, "2026-06-12"]], params: XP_TEST_PARAMS };
const NONE = { app: [], params: undefined };

test("#6110 motor: taendt paa datoen skifter model; evner falder aldrig (intet dato-loft, #7739)", async () => {
  for (const raced of [false, true]) {
    const today = engineSeed({ flags: ENGINE_SCENARIOS.cap.flags, raced, overlay: NONE, plan: "vo2max" });
    await runEngine(today);
    const on = engineSeed({ flags: ENGINE_SCENARIOS.cap.flags, raced, overlay: XP_ON, plan: "vo2max" });
    const before = structuredClone(on.rider_derived_abilities);
    const result = await runEngine(on);
    assert.notDeepEqual(gameState(on, result).rider_derived_abilities, gameState(today).rider_derived_abilities, "XP aendrer udviklingen");
    for (const [i, row] of on.rider_derived_abilities.entries()) {
      for (const k of VISIBLE_ABILITIES) assert.ok(row[k] >= before[i][k], `${k}: aldrig ned`);
    }
  }
});

test("#7739 motor: XP taendt uden dato-loft-kontakten koerer XP, ikke dagens model", async () => {
  const today = engineSeed({ flags: ENGINE_SCENARIOS.noCap.flags, raced: false, overlay: NONE, plan: "vo2max" });
  const r0 = await runEngine(today);
  const on = engineSeed({ flags: ENGINE_SCENARIOS.noCap.flags, raced: false, overlay: XP_ON, plan: "vo2max" });
  const r1 = await runEngine(on);
  assert.notDeepEqual(gameState(on, r1).rider_derived_abilities, gameState(today, r0).rider_derived_abilities);
});

test("#6110 motor: D6 under XP, et AI-hold udvikler sig ikke (ogsaa uden aldrings-flaget)", async () => {
  const ai = engineSeed({ flags: ENGINE_SCENARIOS.cap.flags, raced: false, overlay: XP_ON, plan: "vo2max" });
  const before = structuredClone(ai.rider_derived_abilities);
  await runEngine(ai, { teamAi: true });
  // ability_caps genberegnes ved hvert tick (ogsaa for AI); evner og fremdrift staar stille.
  const strip = (rows) => rows.map(({ ability_caps: _c, ...row }) => row);
  assert.deepEqual(strip(ai.rider_derived_abilities), strip(before));
});

test("#6110 motor: XP og Udviklingsscore B paa samme dato naegter at afregne", async () => {
  const both = engineSeed({ flags: ENGINE_SCENARIOS.scoreB.flags, raced: false, overlay: XP_ON, plan: "vo2max" });
  const before = structuredClone(both.rider_derived_abilities);
  await assert.rejects(runEngine(both), /development_score_v2/);
  assert.deepEqual(both.rider_derived_abilities, before, "intet skrevet");
});
