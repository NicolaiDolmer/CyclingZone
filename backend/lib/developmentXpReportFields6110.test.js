// #6110 tændingsliste pkt. 2 (#8210, gennemgang #8476): motoren skriver XP i rapporten.
//
// Frontend (trainingReportXp.ts) læser pr. slot `xp` (XP tjent pr. evne) og `bar_paid`
// (hele point betalt af XP gemt før datoen), og pr. rytter `xp_bar` ({ xp, price } pr. evne,
// "x af y XP"). "Optjent i dag" og "udbetalt fra bjælken" står hver for sig. Slukket kontakt
// skriver intet nyt. Tallene er opdigtede (hard rule 17).
import test from "node:test";
import assert from "node:assert/strict";

import { seedState, createFake, press, sweep, rider, DATE1, DAYS1 } from "./trainNowSameResult7982.harness.js";
import { XP_TEST_PARAMS } from "./__fixtures__/developmentXpOffScenarios.js";
import { developmentXpTick, roundedXp, xpBarsFor, xpBarView, xpDateStartFromRows, xpPriceForNextPoint } from "./developmentXp.ts";
import { trainingProgressView } from "./trainingProgressView.js";

const RIDER = rider(0);
const ABILITY = "climbing";
const STORED = 6;
const TOO_OLD = { maxAge: 18, minPotential: 5, belowLevel: 60 };

/** XP tændt fra `fromDate`; rytteren har seks point gemt på bjælken. */
function xpState(fromDate, { xpOn = true } = {}) {
  const flags = xpOn ? { development_xp_model: "on", development_xp_from_date: fromDate } : {};
  const state = seedState({ count: 1, flags });
  Object.assign(state.riders[0], { potentiale: 5, birthdate: "2010-03-15" });
  state.rider_derived_abilities[0].ability_progress = { [ABILITY]: STORED };
  state.private_config = [{ key: "development_xp_params", value: { ...XP_TEST_PARAMS, datePlus2: TOO_OLD } }];
  return state;
}
const receipts = (state) => state.training_rider_ticks
  .filter((row) => row.rider_id === RIDER && row.tick_date === DATE1)
  .sort((a, b) => a.game_day - b.game_day);
const sum = (rows, field) => rows.reduce((n, row) => n + (row.report?.[field]?.[ABILITY] ?? 0), 0);

for (const [label, run] of [["aftenkørslen", (s, f) => sweep(s, f, { deadlineReached: true })], ["presset", (s, f) => press(s, f)]]) {
  test(`#6110 rapport (${label}): hvert slot har xp, bar_paid og xp_bar under XP`, async () => {
    const state = xpState("2026-11-01");
    await run(state, createFake(state));
    const rows = receipts(state);
    assert.deepEqual(rows.map((row) => row.game_day), DAYS1);
    for (const row of rows) {
      assert.equal(typeof row.report.xp, "object", `løbsdag ${row.game_day}: xp`);
      assert.equal(typeof row.report.bar_paid, "object", `løbsdag ${row.game_day}: bar_paid`);
      const bar = row.report.xp_bar?.[ABILITY];
      assert.ok(bar && bar.price > 0 && bar.xp >= 0, `løbsdag ${row.game_day}: xp_bar { xp, price }`);
    }
    assert.ok(rows.some((row) => Object.values(row.report.xp).some((v) => v > 0)), "der er tjent XP på datoen");
    for (const row of rows) {
      for (const v of Object.values(row.report.xp)) assert.ok(Number.isInteger(v) && v > 0, "XP i hele tal");
      for (const bar of Object.values(row.report.xp_bar)) assert.ok(Number.isInteger(bar.xp) && Number.isInteger(bar.price), "bjælken i hele tal");
      const progress = row.report.progress_after ?? {};
      for (const ability of Object.keys(row.report.xp_bar)) {
        assert.ok(row.report.xp[ability] > 0 || Number(progress[ability]) > 0, `xp_bar kun for evner med XP eller bjælke (${ability})`);
      }
    }
    // Løbenummer pr. dato i afregningsrækkefølge.
    assert.deepEqual(rows.map((row) => row.report.xp_slot_seq), rows.map((_, i) => i + 1));
  });

  test(`#6110 rapport (${label}): point fra den gemte bjælke er bar_paid, ikke dagens træning`, async () => {
    const state = xpState("2026-11-01"); // ikke tændingsnatten: datoreglen giver +1
    const before = state.rider_derived_abilities[0][ABILITY];
    await run(state, createFake(state));
    const rows = receipts(state);
    const gained = state.rider_derived_abilities[0][ABILITY] - before;
    assert.equal(sum(rows, "gains"), gained);
    assert.equal(sum(rows, "bar_paid"), gained, "seks point gemt før datoen dækker datoens point: alt er fra bjælken");
    assert.equal(rows[0].report.bar_paid[ABILITY], gained, "udbetalingen står på det slot, hvor den lander");
    for (const row of rows.slice(1)) assert.equal(row.report.bar_paid[ABILITY], undefined, `løbsdag ${row.game_day} gentager ikke datoens total`);
  });

  test(`#6110 rapport (${label}): tændingsnatten markerer hele udbetalingen som bar_paid`, async () => {
    const state = xpState(DATE1);
    const before = state.rider_derived_abilities[0][ABILITY];
    await run(state, createFake(state));
    const gained = state.rider_derived_abilities[0][ABILITY] - before;
    assert.ok(gained > 1, "tændingsnatten udbetaler den gemte fremgang");
    assert.equal(sum(receipts(state), "bar_paid"), gained);
  });

  test(`#6110 rapport (${label}): slukket kontakt skriver ingen XP-felter (som i dag)`, async () => {
    const state = xpState(null, { xpOn: false });
    await run(state, createFake(state));
    const rows = receipts(state);
    assert.ok(rows.length > 0);
    for (const row of rows) for (const key of ["xp", "bar_paid", "xp_bar"]) assert.ok(!(key in row.report), `${key} findes ikke uden XP`);
  });
}

test("developmentXpTick: barPaid tæller kun point, som XP gemt før datoen dækker", () => {
  const params = XP_TEST_PARAMS;
  const level = 40;
  const price = xpPriceForNextPoint(level, params);
  // Ingen gemt bjælke: alt er tjent i dag.
  const earned = developmentXpTick({ abilities: { [ABILITY]: level }, progress: {}, xpFor: (a) => (a === ABILITY ? price * 1.5 : 0) }, params);
  assert.equal(earned.gains[ABILITY], 1);
  assert.equal(earned.barPaid[ABILITY], undefined);
  // Bjælken ved datoens start dækker allerede et point: det er bar_paid.
  const paid = developmentXpTick({ abilities: { [ABILITY]: level }, progress: { [ABILITY]: 1.2 }, xpFor: () => 0 }, params);
  assert.equal(paid.gains[ABILITY], 1);
  assert.equal(paid.barPaid[ABILITY], 1);
  // Senere tick samme dato: det, der allerede er betalt fra bjælken, tælles ikke igen.
  const later = developmentXpTick({
    abilities: { [ABILITY]: level + 1 }, progress: { [ABILITY]: 0.5 }, dateUsedGains: { [ABILITY]: 1 },
    dateStart: { progress: { [ABILITY]: 1.2 }, paid: { [ABILITY]: 1 } },
    xpFor: (a) => (a === ABILITY ? xpPriceForNextPoint(level + 1, params) * 3 : 0),
  }, params);
  assert.equal(later.barPaid[ABILITY], undefined, "datoens anden point er tjent af datoens egen XP");
});

test("xpBarsFor: bjælken i XP er brøken gange prisen for næste point, i hele tal; `only` begrænser", () => {
  const bars = xpBarsFor({ [ABILITY]: 40, sprint: 70 }, { [ABILITY]: 0.25 }, XP_TEST_PARAMS);
  assert.deepEqual(Object.keys(bars).sort(), [ABILITY, "sprint"].sort());
  const view = xpBarView({ level: 40, bar: 0.25 }, XP_TEST_PARAMS);
  assert.equal(bars[ABILITY].price, Math.round(view.price));
  assert.equal(bars[ABILITY].xp, Math.round(view.xp));
  assert.equal(bars.sprint.xp, 0);
  assert.ok(bars.sprint.price > bars[ABILITY].price, "en højere evne koster mere");
  assert.deepEqual(Object.keys(xpBarsFor({ [ABILITY]: 40, sprint: 70 }, {}, XP_TEST_PARAMS, { only: new Set([ABILITY]) })), [ABILITY]);
  assert.deepEqual(roundedXp({ a: 2.6, b: 0.3, c: Number.NaN }), { a: 3 });
});

test("xpDateStartFromRows: løbsfeltet afregnet først (løbsdag 43 før 41) afgør datoens start", () => {
  const raceFirst = { game_day: 43, xp_slot_seq: 1, progress_before: { [ABILITY]: 3 }, bar_paid: { [ABILITY]: 1 } };
  const thenDay41 = { game_day: 41, xp_slot_seq: 2, progress_before: { [ABILITY]: 2.4 }, bar_paid: {} };
  const out = xpDateStartFromRows([thenDay41, raceFirst]);
  assert.deepEqual(out.dateStart.progress, { [ABILITY]: 3 }, "bjælken før datoens FØRSTE afregnede slot, ikke den laveste løbsdag");
  assert.deepEqual(out.dateStart.paid, { [ABILITY]: 1 });
  assert.equal(out.seq, 3, "næste slot får løbenummer 3");
  assert.deepEqual(xpDateStartFromRows([]), { dateStart: null, seq: 1 });
  // Ældre linjer uden løbenummer: laveste løbsdag vælges, og nummeret tæller dem med.
  const legacy = xpDateStartFromRows([{ game_day: 42, progress_before: { [ABILITY]: 1 } }, { game_day: 41, progress_before: { [ABILITY]: 2 } }]);
  assert.deepEqual(legacy.dateStart.progress, { [ABILITY]: 2 });
  assert.equal(legacy.seq, 3);
});

test("trainingProgressView: slukket = progress og capped som før; XP = ingen lofter og x af y XP", () => {
  const rows = [{ rider_id: "r1", climbing: 40, ability_progress: { climbing: 0.5 } }];
  const off = trainingProgressView(rows, null);
  assert.deepEqual(off.progress, { r1: { climbing: 0.5 } });
  assert.equal(off.xpBar, null);
  const on = trainingProgressView(rows, XP_TEST_PARAMS);
  assert.deepEqual(on.capped, {}, "intet loft under XP");
  assert.ok(on.xpBar.r1.climbing.price > 0);
  assert.deepEqual(on.progress, off.progress, "brøken sendes stadig");
});
