// #7982 trin 4a, dommens fund 1 (15/11): en etape afgoeres midt i trykket.
//
// Foer trin 4a laeste hvert dag-felt loebsbelastningen (training_race_loads) igen, saa en straks-
// rytters FORELOEBIGE form og traethed talte en etape med, der blev afgjort, mens trykket koerte.
// Trin 4a tog belastningen fra trykkets hukommelse og tabte den. Rettelsen laeser belastningen igen i
// det dag-felt, der skriver det foreloebige tal (kun for det tal).
//
// Proeven afgoer etapen efter trykkets gemme-kald nr. 1, 2 og 4 og sammenligner med mains motor.
// "Mains motor" er samme tryk, hvor hvert dag-felt laeser alt selv (runDay uden trykkets hukommelse):
// den vej er mains, uaendret (aftenkoerslen og den almindelige traening gaar den, og dommerens facit
// holder den fast). Dommerens filer roeres ikke; filen importerer kun harnesset.
//
// Ogsaa vist: rettelsen koster hoejst én laesning mere pr. tryk, og kun naar et dag-felt taeller en
// straks-rytter foreloebigt; et tryk uden straks-ryttere laeser praecis som foer.
import test from "node:test";
import assert from "node:assert/strict";
import { runTrainNow } from "./trainNow.js";
import { runTeamTrainingDay } from "./dailyTrainingEngine.js";
import { SCENARIOS, seedState, createFake, finishRace, canon, digest, PRESS_AT, SEASON, RACE } from "./trainNowSameResult7982.harness.js";

const QUIET = { info() {}, warn() {}, error() {}, log() {} };
const isCommit = (name) => name.replace(/^try_/, "") === "commit_training_date_tick";
const mainEngine = (args) => runTeamTrainingDay({ ...args, pressMemory: null, pressRuns: null, pressTimer: null });

async function quietly(fn) {
  const saved = { warn: console.warn, error: console.error, info: console.info, log: console.log };
  console.warn = () => {}; console.error = () => {}; console.info = () => {}; console.log = () => {};
  try { return await fn(); } finally { Object.assign(console, saved); }
}

/**
 * Ét tryk som ruten kalder det (som harnessets press), hvor etapen afgoeres lige efter gemme-kald
 * nr. `settleAfter` (null: ingen etape). `runDay` udeladt = grenens motor med trykkets hukommelse.
 */
async function pressWithStage(seed, { settleAfter = null, runDay = undefined, isBetaTester = true } = {}) {
  const state = seedState(seed);
  const fake = createFake(state);
  const realRpc = fake.supabase.rpc;
  let commits = 0;
  fake.supabase.rpc = async (name, args) => {
    const result = await realRpc(name, args);
    if (isCommit(name) && (commits += 1) === settleAfter) finishRace(state);
    return result;
  };
  fake.ctx.tryk += 1;
  const response = await quietly(() => runTrainNow({
    supabase: fake.supabase, team: structuredClone(state.teams[0]), season: SEASON, isBetaTester, now: PRESS_AT, logger: QUIET,
    loadDaySpans: async () => new Map(), confirmedShortRaceIds: state.races.map((row) => row.id),
    ...(runDay ? { runDay } : {}),
  }));
  const provisional = fake.log.filter((entry) => entry.kind === "rpc" && isCommit(entry.target))
    .flatMap((entry) => (entry.payload?.p_conditions ?? []).filter((row) => row.provisional === true)
      .map((row) => ({ game_day: entry.payload.p_game_day, rider_id: row.rider_id, form: row.form, fatigue: row.fatigue })));
  return {
    status: response.status, provisional: canon(provisional), commits, state,
    raceLoadReads: fake.log.filter((entry) => entry.kind === "read" && entry.target === "training_race_loads").length,
    reads: fake.log.filter((entry) => entry.kind === "read").length, calls: fake.log.length,
  };
}

const BIG = SCENARIOS.stort_hold_beta_tryk.seed;
const entered = new Set(BIG.entered);

test("forudsaetning: trykket har straks-ryttere med et foreloebigt tal, og etapen giver dem belastning", async () => {
  const run = await pressWithStage(BIG);
  assert.equal(run.status, 200);
  assert.equal(run.commits, 5, "fem gemme-kald, ét pr. dag-felt");
  assert.ok(run.provisional.length > 0, "mindst én straks-rytter faar et foreloebigt tal");
  assert.ok(run.provisional.every((row) => entered.has(Number(row.rider_id.slice(-4)) - 1000)), "kun de tilmeldte (straks-rytterne) taelles foreloebigt");
  const lastSettled = await pressWithStage(BIG, { settleAfter: 4 });
  assert.ok(lastSettled.state.training_race_loads.some((row) => row.race_id === RACE && row.load > 0), "etapen skriver belastning for de tilmeldte");
});

for (const settleAfter of [1, 2, 4]) {
  test(`etapen afgoeres efter gemme-kald nr. ${settleAfter}: straks-rytternes foreloebige form og traethed er som med mains motor`, async () => {
    const branch = await pressWithStage(BIG, { settleAfter });
    const main = await pressWithStage(BIG, { settleAfter, runDay: mainEngine });
    assert.equal(branch.status, 200);
    assert.equal(main.status, 200);
    assert.ok(main.provisional.length > 0, "mains motor skriver foreloebige tal i dette forloeb");
    assert.deepEqual(branch.provisional, main.provisional,
      "et foreloebigt tal afviger fra mains: belastningen fra den afgjorte etape mangler i trykkets foreloebige opgoerelse");
    // Etapen skal faktisk gøre en forskel her, ellers beviser proeven intet.
    const noStage = await pressWithStage(BIG);
    assert.notDeepEqual(main.provisional, noStage.provisional, "den afgjorte etape aendrer mains foreloebige tal i dette forloeb");
  });
}

test("sluttilstanden (evner, form, kvitteringer, afregninger, belastning, datoens arbejde) er som med mains motor, naar etapen afgoeres efter gemme-kald nr. 4", async () => {
  const branch = await pressWithStage(BIG, { settleAfter: 4 });
  const main = await pressWithStage(BIG, { settleAfter: 4, runDay: mainEngine });
  for (const table of ["rider_derived_abilities", "rider_condition", "training_rider_ticks", "training_condition_settlements", "training_race_loads", "training_date_work"]) {
    assert.equal(digest(branch.state[table]), digest(main.state[table]), `${table} er som med mains motor`);
  }
});

test("pris: hoejst én laesning mere pr. tryk med straks-ryttere, ingen for andre", async () => {
  // Tallene foer rettelsen (HEAD 9df85ea06, samme stedfortraeder): beta 90 kald / 2 laesninger af
  // belastningen (trykkets kontekst + foerste dag-felt), almindeligt 87 / 2, lille hold 81 / 1.
  const beta = await pressWithStage(BIG);
  assert.equal(beta.raceLoadReads, 3, `tryk med straks-ryttere: ${beta.raceLoadReads} laesninger af loebsbelastningen (foer: 2)`);
  assert.equal(beta.calls, 91, `tryk med straks-ryttere: ${beta.calls} kald (foer: 90)`);
  const plain = await pressWithStage(BIG, { isBetaTester: false });
  assert.equal(plain.provisional.length, 0, "et almindeligt tryk har ingen straks-ryttere");
  assert.equal(plain.raceLoadReads, 2, `tryk uden straks-ryttere: ${plain.raceLoadReads} laesninger af loebsbelastningen (som foer)`);
  assert.equal(plain.calls, 87, `tryk uden straks-ryttere: ${plain.calls} kald (som foer)`);
  const small = await pressWithStage(SCENARIOS.lille_hold_uden_loeb.seed);
  assert.equal(small.raceLoadReads, 1, "lille hold uden loeb: én laesning af loebsbelastningen (som foer)");
  assert.equal(small.calls, 81, `lille hold uden loeb: ${small.calls} kald (som foer)`);
});

test("mains motor laeser belastningen i hvert dag-felt (det, trin 4a erstattede med hukommelsen)", async () => {
  const main = await pressWithStage(BIG, { runDay: mainEngine });
  assert.equal(main.raceLoadReads, 6, "trykkets kontekst + fem dag-felter");
  if (process.env.PROVISIONAL_7982_PRINT) {
    for (const settleAfter of [1, 2, 4]) console.log(`settle ${settleAfter}`, JSON.stringify((await pressWithStage(BIG, { settleAfter })).provisional));
  }
});
