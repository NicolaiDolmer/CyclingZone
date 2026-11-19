// #6110 Fable-fund 2 (16/11): datoreglen under XP prøvet på de stier, der kører live.
//
// Reglen (R16, ejervalg A 16/11): en evne stiger højst +1 pr. dato, +2 kun for et ungt
// toptalent på en meget lav evne, og det gælder på tværs af datoens ticks. Før denne fil
// var reglen kun prøvet på reserve-stien (uden training_condition_per_date). Her køres:
//   1. Aftenkørslen på løbsdags-aksen med XP OG training_condition_per_date tændt: hver af
//      datoens fem løbsdage er sit eget tick og læser de andre løbsdages kvitteringer
//      (training_rider_ticks) fra databasen.
//   2. Træn nu-presset (runTrainNow -> settleWholeDayPress -> runPressDayFromMemory): de
//      senere dag-felter læser de tidligere kvitteringer fra pressets hukommelse.
// Beviset er det samme begge steder: en stor gemt bjælke rækker til mange point, men datoen
// giver tilsammen højst reglens tal; datoens første løbsdag tager det hele, de andre intet,
// og resten venter på bjælken. Tallene er opdigtede (hard rule 17).
import test from "node:test";
import assert from "node:assert/strict";

import { seedState, createFake, press, sweep, rider, DATE1, DAYS1, DATE2 } from "./trainNowSameResult7982.harness.js";
import { XP_TEST_PARAMS } from "./__fixtures__/developmentXpOffScenarios.js";

const RIDER = rider(0);
const ABILITY = "climbing";
const STORED = 6; // seks point gemt på bjælken: rækker langt over datoens tal
// XP tændt fra før datoen, så datoen ikke er tændingsnatten (der udbetales gemt fremgang helt).
const XP_ON = { development_xp_model: "on", development_xp_from_date: "2026-11-01" };

/**
 * Én ung toptalent-rytter på en lav evne; `datePlus2` afgør, om han får +2. Han har allerede
 * udviklet sig under XP på en tidligere dato (ejervalg B 19/11: ellers er datoen hans første
 * XP-dato, og den gemte fremgang udbetales helt), så datoreglen gælder.
 */
function xpState(datePlus2, { developedBefore = true, managerAtIgnition = true } = {}) {
  const state = seedState({ count: 1, flags: XP_ON });
  Object.assign(state.riders[0], { potentiale: 5, birthdate: "2010-03-15" }); // 20 aar i saeson 5 (saeson-alder)
  state.rider_derived_abilities[0].ability_progress = { [ABILITY]: STORED };
  state.private_config = [{ key: "development_xp_params", value: { ...XP_TEST_PARAMS, datePlus2 } }];
  if (developedBefore) state.training_rider_ticks.push(earlierReceipt(state, { xp_developed: true }));
  // Ejervalg 19/11 (forbehold 4): kvitteringen fra startdatoen viser, at han stod på et managerhold
  // (her skadet den nat, så ingen udvikling og intet xp_developed).
  if (managerAtIgnition) state.training_rider_ticks.push(ignitionReceipt(state));
  return state;
}

/** Et ejerskifte (rider_ownership_events). */
function ownership(fromTeam, toTeam, occurredAt) {
  return { rider_id: RIDER, from_team_id: fromTeam, to_team_id: toTeam, occurred_at: occurredAt };
}

/** Kvitteringen fra XP-startdatoen (2026-11-01) for en managerrytter, der var skadet den nat. */
function ignitionReceipt(state) {
  return { rider_id: RIDER, season_id: state.seasons[0].id, game_day: 30, tick_date: "2026-11-01", team_id: state.riders[0].team_id,
    report: { injured: true, gains: {}, xp_ignition_manager: true } };
}

/** En kvittering fra en tidligere dato efter startdatoen (opdigtet løbsdag 40). */
function earlierReceipt(state, report) {
  return { rider_id: RIDER, season_id: state.seasons[0].id, game_day: 40, tick_date: "2026-11-08", team_id: state.riders[0].team_id, report };
}

// Opdigtede grænser: rytteren er ung, toptalent og på en meget lav evne ...
const ELIGIBLE = { maxAge: 23, minPotential: 5, belowLevel: 60 };
// ... eller ikke ung nok efter talfilen: det lave tal.
const TOO_OLD = { maxAge: 18, minPotential: 5, belowLevel: 60 };

const receipts = (state) => state.training_rider_ticks
  .filter((row) => row.rider_id === RIDER && row.tick_date === DATE1)
  .sort((a, b) => a.game_day - b.game_day);

function assertDateRule(state, { cap, label }) {
  const rows = receipts(state);
  assert.deepEqual(rows.map((row) => row.game_day), DAYS1, `${label}: alle fem løbsdage er afregnet`);
  // XP kørte: dagens model med dato-loftet (#6210) ville kvittere det klippede point her.
  for (const row of rows) assert.equal(row.report?.gains_deferred_by_date_cap, undefined, `${label}: XP-grenen kørte`);
  const perAbility = {};
  for (const row of rows) {
    for (const [ability, n] of Object.entries(row.report?.gains ?? {})) perAbility[ability] = (perAbility[ability] ?? 0) + n;
  }
  for (const [ability, n] of Object.entries(perAbility)) assert.ok(n <= cap, `${label}: ${ability} +${n} på én dato`);
  assert.equal(perAbility[ABILITY], cap, `${label}: bjælken rækker til mere, men datoen giver ${cap}`);
  assert.equal(rows[0].report.gains[ABILITY], cap, `${label}: datoens første løbsdag tager datoens tal`);
  for (const row of rows.slice(1)) {
    assert.equal(row.report.gains?.[ABILITY], undefined, `${label}: løbsdag ${row.game_day} læser de tidligere kvitteringer og køber intet`);
  }
  const ab = state.rider_derived_abilities.find((row) => row.rider_id === RIDER);
  assert.ok(ab.ability_progress[ABILITY] >= 1, `${label}: resten venter på bjælken (intet tabt)`);
}

for (const [rule, cap] of [[ELIGIBLE, 2], [TOO_OLD, 1]]) {
  test(`#6110 R16 løbsdags-aksen (XP + training_condition_per_date): højst +${cap} på tværs af datoens ticks`, async () => {
    const state = xpState(rule);
    const levelBefore = state.rider_derived_abilities[0][ABILITY];
    const fake = createFake(state);
    const out = await sweep(state, fake, { deadlineReached: true });
    assert.ok(out.every((day) => !day.error), JSON.stringify(out));
    assertDateRule(state, { cap, label: "aftenkørslen" });
    assert.equal(state.rider_derived_abilities[0][ABILITY] - levelBefore, cap, "gemt evne = kvitteringernes sum");
    assert.ok(receipts(state).every((row) => row.report?.condition_per_date !== false));
  });

  test(`#6110 R16 Træn nu-presset (runPressDayFromMemory): højst +${cap} på tværs af datoens ticks`, async () => {
    const state = xpState(rule);
    const levelBefore = state.rider_derived_abilities[0][ABILITY];
    const fake = createFake(state);
    const res = await press(state, fake);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.settledGameDays, DAYS1, "presset afregner hele datoen");
    assertDateRule(state, { cap, label: "presset" });
    assert.equal(state.rider_derived_abilities[0][ABILITY] - levelBefore, cap, "gemt evne = kvitteringernes sum");
  });
}

test("#6110 R16 forudsætning: uden XP giver samme opsætning dagens model (prøven måler XP, ikke noget andet)", async () => {
  const state = xpState(ELIGIBLE);
  state.app_config = state.app_config.filter((row) => row.key !== "development_xp_model");
  const fake = createFake(state);
  await press(state, fake);
  // Dagens model med dato-loftet (#6210) tændt: højst +1 pr. evne pr. dato, uanset bjælken.
  const total = receipts(state).reduce((sum, row) => sum + (row.report?.gains?.[ABILITY] ?? 0), 0);
  assert.ok(total <= 1, `dagens model: +${total}`);
  assert.ok(receipts(state).some((row) => row.report?.gains_deferred_by_date_cap?.[ABILITY] > 0), "dagens model kvitterer det klippede point");
});

// ── #6110 ejervalg B (19/11): gemt fremgang udbetales helt på rytterens første XP-dato ──────
// En rytter, der ikke udviklede sig på startdatoen (skadet, bunden hviledag), får sin gemte
// fremgang helt ud den første dato, han udvikler sig under XP. Derefter gælder datoreglen.
const datePoints = (state) => receipts(state).reduce((sum, row) => sum + (row.report?.gains?.[ABILITY] ?? 0), 0);

for (const [label, run] of [["aftenkørslen", (state, fake) => sweep(state, fake, { deadlineReached: true })], ["presset", (state, fake) => press(state, fake)]]) {
  test(`#6110 ejervalg B (${label}): første XP-dato efter startdatoen udbetaler den gemte bjælke helt`, async () => {
    const state = xpState(TOO_OLD, { developedBefore: false });
    const levelBefore = state.rider_derived_abilities[0][ABILITY];
    const fake = createFake(state);
    await run(state, fake);
    const gained = state.rider_derived_abilities[0][ABILITY] - levelBefore;
    assert.ok(gained > 1, `${label}: den gemte fremgang kom ud på én dato (+${gained}), ikke højst +1`);
    assert.equal(datePoints(state), gained, `${label}: gemt evne = kvitteringernes sum`);
    // Præcis som hvis datoen var startdatoen (tændingsnatten): samme evner, samme bjælker.
    const ignition = xpState(TOO_OLD, { developedBefore: false });
    ignition.app_config = ignition.app_config.map((row) => (row.key === "development_xp_from_date" ? { ...row, value: DATE1 } : row));
    await run(ignition, createFake(ignition));
    assert.deepEqual(state.rider_derived_abilities[0], ignition.rider_derived_abilities[0], `${label}: samme udfald som tændingsnatten`);
    assert.ok(receipts(state).some((row) => row.report?.xp_developed === true), `${label}: kvitteringen markerer, at XP-udviklingen kørte`);
  });

  test(`#6110 ejervalg B (${label}): en tidligere dato, hvor han var skadet, tæller ikke som hans første XP-dato`, async () => {
    const state = xpState(TOO_OLD, { developedBefore: false });
    state.training_rider_ticks.push(earlierReceipt(state, { injured: true, gains: {} })); // ingen xp_developed
    const levelBefore = state.rider_derived_abilities[0][ABILITY];
    const fake = createFake(state);
    await run(state, fake);
    assert.ok(state.rider_derived_abilities[0][ABILITY] - levelBefore > 1, `${label}: udbetalingen kommer, når han udvikler sig første gang`);
  });

  test(`#6110 ejervalg B (${label}): har han udviklet sig under XP før, gælder datoreglen (ingen ny udbetaling)`, async () => {
    const state = xpState(TOO_OLD); // tidligere kvittering med xp_developed
    const levelBefore = state.rider_derived_abilities[0][ABILITY];
    const fake = createFake(state);
    await run(state, fake);
    assert.equal(state.rider_derived_abilities[0][ABILITY] - levelBefore, 1, `${label}: højst +1, resten venter`);
  });
}

test("#6110 ejervalg B: en kvittering fra FØR startdatoen tæller ikke (dagens model kørte dér)", async () => {
  const state = xpState(TOO_OLD, { developedBefore: false });
  state.training_rider_ticks.push({ ...earlierReceipt(state, { xp_developed: true }), tick_date: "2026-10-31", game_day: 30 });
  const levelBefore = state.rider_derived_abilities[0][ABILITY];
  await sweep(state, createFake(state), { deadlineReached: true });
  assert.ok(state.rider_derived_abilities[0][ABILITY] - levelBefore > 1, "første XP-dato efter startdatoen udbetaler stadig");
});

test("#6110 ejervalg B: slukket XP skriver intet xp_developed (dagens model uroert)", async () => {
  const state = xpState(ELIGIBLE, { developedBefore: false });
  state.app_config = state.app_config.filter((row) => row.key !== "development_xp_model");
  await sweep(state, createFake(state), { deadlineReached: true });
  assert.ok(receipts(state).length > 0);
  assert.ok(receipts(state).every((row) => !("xp_developed" in (row.report ?? {}))), "intet nyt felt uden XP");
});

// Fable-dom 19/11 på #8468, fund 1: kæden med motorens egen kvittering, og datoens senere løbsdage.
test("#6110 ejervalg B: kæden over to datoer bruger motorens egen kvittering (ingen anden fuld udbetaling)", async () => {
  const state = xpState(TOO_OLD, { developedBefore: false });
  const fake = createFake(state);
  const level0 = state.rider_derived_abilities[0][ABILITY];
  await sweep(state, fake, { deadlineReached: true });
  const level1 = state.rider_derived_abilities[0][ABILITY];
  assert.ok(level1 - level0 > 1, "dato 1 er hans første XP-dato: udbetalingen kommer");
  assert.ok(receipts(state).every((row) => row.report?.xp_developed === true), "motoren skrev xp_developed på dato 1");
  // Bjælken fyldes igen (fx XP ud over datoreglen); dato 2 må ikke udbetale den helt igen.
  state.rider_derived_abilities[0].ability_progress[ABILITY] = STORED;
  await sweep(state, fake, { tickDate: DATE2, now: new Date("2026-11-10T19:30:00Z"), deadlineReached: true });
  assert.ok(state.training_rider_ticks.some((row) => row.tick_date === DATE2), "dato 2 er afregnet");
  assert.equal(state.rider_derived_abilities[0][ABILITY] - level1, 1, "dato 2: datoreglen, højst +1, resten venter");
});

test("#6110 ejervalg B: datoens senere løbsdage udbetaler intet igen efter udbetalingen", async () => {
  const state = xpState(TOO_OLD, { developedBefore: false });
  const level0 = state.rider_derived_abilities[0][ABILITY];
  await sweep(state, createFake(state), { deadlineReached: true });
  const rows = receipts(state);
  assert.deepEqual(rows.map((row) => row.game_day), DAYS1, "alle fem løbsdage er afregnet");
  assert.ok(rows[0].report.gains[ABILITY] > 1, "datoens første løbsdag tager udbetalingen");
  for (const row of rows.slice(1)) assert.equal(row.report.gains?.[ABILITY], undefined, `løbsdag ${row.game_day} udbetaler intet igen`);
  assert.equal(state.rider_derived_abilities[0][ABILITY] - level0, rows[0].report.gains[ABILITY], "gemt evne = første løbsdags udbetaling");
});

// ── Ejervalg 19/11 (forbehold 4): kun ryttere på managerhold ved tænding ────────────────────
test("#6110 forbehold 4 (a): rytter på et AI-hold ved tænding, købt senere: ingen udbetaling, almindelig datoregel", async () => {
  const state = xpState(TOO_OLD, { developedBefore: false, managerAtIgnition: false });
  // På startdatoen stod han på et AI-hold: kvitteringen findes, men uden markøren, og ejerskiftet
  // til managerholdet kom efter startdatoen.
  state.training_rider_ticks.push({ ...ignitionReceipt(state), team_id: "ai-team", report: { gains: {} } });
  state.teams.push({ id: "ai-team", user_id: null, is_ai: true, is_bank: false, is_test_account: false });
  state.rider_ownership_events = [ownership("ai-team", state.riders[0].team_id, "2026-11-05T10:00:00Z")];
  const before = state.rider_derived_abilities[0][ABILITY];
  await sweep(state, createFake(state), { deadlineReached: true });
  assert.equal(state.rider_derived_abilities[0][ABILITY] - before, 1, "datoreglen: højst +1, resten venter på bjælken");
  assert.ok(state.rider_derived_abilities[0].ability_progress[ABILITY] >= 1, "bjælken står (intet tabt, intet udbetalt på én nat)");
});

test("#6110 forbehold 4: fri rytter uden kvittering på startdatoen: ingen udbetaling", async () => {
  const state = xpState(TOO_OLD, { developedBefore: false, managerAtIgnition: false });
  state.rider_ownership_events = [ownership(null, state.riders[0].team_id, "2026-11-04T09:00:00Z")]; // skrevet på efter tænding
  const before = state.rider_derived_abilities[0][ABILITY];
  await press(state, createFake(state));
  assert.equal(state.rider_derived_abilities[0][ABILITY] - before, 1);
});

test("#6110 forbehold 4 (b): managerrytter skadet ved tænding får udbetalingen på sin første XP-dato", async () => {
  const state = xpState(TOO_OLD, { developedBefore: false }); // tændings-kvittering fra managerhold, skadet
  const before = state.rider_derived_abilities[0][ABILITY];
  await sweep(state, createFake(state), { deadlineReached: true });
  assert.ok(state.rider_derived_abilities[0][ABILITY] - before > 1, "hele den gemte fremgang på én dato");
});

test("#6110 forbehold 4 (c): managerrytter solgt til et AI-hold før sin første XP-dato: ingen udbetaling", async () => {
  const state = xpState(TOO_OLD, { developedBefore: false });
  const team = state.teams.find((row) => row.id === state.riders[0].team_id);
  Object.assign(team, { is_ai: true, user_id: null }); // holdet er nu et AI-hold (rytteren er solgt dertil)
  const before = state.rider_derived_abilities[0][ABILITY];
  await sweep(state, createFake(state), { deadlineReached: true });
  assert.equal(state.rider_derived_abilities[0][ABILITY] - before, 0, "ingen udvikling på et AI-hold, heller ingen udbetaling");
  assert.ok(receipts(state).every((row) => row.report?.xp_ignition_manager === undefined && row.report?.xp_developed === undefined));
});

test("#6110 forbehold 4: tændingsnatten markerer managerryttere, også uden udviklings-tick", async () => {
  const state = xpState(TOO_OLD, { developedBefore: false, managerAtIgnition: false });
  state.app_config = state.app_config.map((row) => (row.key === "development_xp_from_date" ? { ...row, value: DATE1 } : row));
  await sweep(state, createFake(state), { deadlineReached: true });
  assert.ok(receipts(state).every((row) => row.report?.xp_ignition_manager === true), "alle datoens kvitteringer bærer markøren");
});

// ── Fable-dom 19/11 fund A: ejerskabet afgør, også uden kvittering på startdatoen ───────────
test("#6110 fund A: managerrytter uden kvittering på startdatoen (karantæne, frosset eller divisionsløst hold) får udbetalingen", async () => {
  const state = xpState(TOO_OLD, { developedBefore: false, managerAtIgnition: false }); // ingen kvittering, intet ejerskifte
  const before = state.rider_derived_abilities[0][ABILITY];
  await sweep(state, createFake(state), { deadlineReached: true });
  assert.ok(state.rider_derived_abilities[0][ABILITY] - before > 1, "han stod på managerholdet ved tænding (ejerskab)");
});

test("#6110 fund A: trup købt af en manager på selve startdatoen tæller som managerhold ved tænding", async () => {
  const state = xpState(TOO_OLD, { developedBefore: false, managerAtIgnition: false });
  state.teams.push({ id: "ai-team", user_id: null, is_ai: true, is_bank: false, is_test_account: false });
  state.rider_ownership_events = [ownership("ai-team", state.riders[0].team_id, "2026-11-01T15:00:00Z")]; // samme dag
  const before = state.rider_derived_abilities[0][ABILITY];
  await press(state, createFake(state));
  assert.ok(state.rider_derived_abilities[0][ABILITY] - before > 1);
});

test("#6110 fund A: managerrytter skiftet mellem to managerhold efter tænding får stadig udbetalingen", async () => {
  const state = xpState(TOO_OLD, { developedBefore: false, managerAtIgnition: false });
  state.teams.push({ id: "other-manager", user_id: "u-other", is_ai: false, is_bank: false, is_test_account: false });
  state.rider_ownership_events = [ownership("other-manager", state.riders[0].team_id, "2026-11-06T12:00:00Z")];
  const before = state.rider_derived_abilities[0][ABILITY];
  await sweep(state, createFake(state), { deadlineReached: true });
  assert.ok(state.rider_derived_abilities[0][ABILITY] - before > 1);
});

test("#6110 fund C: Træn nu-presset på startdatoen markerer managerryttere", async () => {
  const state = xpState(TOO_OLD, { developedBefore: false, managerAtIgnition: false });
  state.app_config = state.app_config.map((row) => (row.key === "development_xp_from_date" ? { ...row, value: DATE1 } : row));
  await press(state, createFake(state));
  assert.ok(receipts(state).length > 0);
  assert.ok(receipts(state).every((row) => row.report?.xp_ignition_manager === true));
});
