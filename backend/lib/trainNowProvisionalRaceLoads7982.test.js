// #7982 trin 4a, dommens fund 1 (15/11): en etape afgoeres midt i trykket.
//
// Foer trin 4a laeste hvert dag-felt loebsbelastningen (training_race_loads) igen, saa en straks-
// rytters FORELOEBIGE form og traethed talte en etape med, der blev afgjort, mens trykket koerte.
// Trin 4a tog belastningen fra trykkets hukommelse og tabte den. Rettelsen stiller dag-feltets eget
// spoergsmaal om belastningen igen i det dag-felt, der skriver det foreloebige tal; har bogen aendret
// sig, siden trykket hentede, traeder hukommelsen til side, og dag-feltet laeser alt som foer.
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
import { SCENARIOS, seedState, createFake, finishRace, canon, digest, PRESS_AT, SEASON, RACE, TEAM, DATE1, DAYS1 } from "./trainNowSameResult7982.harness.js";

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
async function pressWithStage(seed, { settleAfter = null, runDay = undefined, isBetaTester = true, raceSession = false, retryOnThrow = false } = {}) {
  const state = seedState(seed);
  const fake = createFake(state);
  const realRpc = fake.supabase.rpc;
  let commits = 0;
  let inSession = false;
  fake.supabase.rpc = async (name, args) => {
    const result = await realRpc(name, args);
    if (!inSession && isCommit(name) && (commits += 1) === settleAfter) {
      finishRace(state);
      // #8195: delkoerslen afregner loebets session lige efter etapen, midt i trykket (som
      // runRaceSessionSettlement kalder motoren: kun loebets loebsdag, kun loebets ryttere).
      if (raceSession) {
        inSession = true;
        const ids = state.race_entries.filter((row) => row.race_id === RACE).map((row) => row.rider_id);
        try {
          await runTeamTrainingDay({
            supabase: fake.supabase, teamId: TEAM, seasonId: SEASON.id, seasonNumber: SEASON.number, now: PRESS_AT,
            tickDateOverride: DATE1, gameDay: 43, dateGameDays: DAYS1, executedBy: "assistant", eligibleRiderIds: ids,
            unresolvedSlotsByRider: {}, deadlineAt: new Date(Date.parse(`${DATE1}T00:00:00Z`) + 25 * 3600 * 1000).toISOString(),
            deadlineReached: false, raceSessionRiderIds: new Set(ids),
          });
        } finally { inSession = false; }
      }
    }
    return result;
  };
  fake.ctx.tryk += 1;
  const response = await quietly(() => runTrainNow({
    supabase: fake.supabase, team: structuredClone(state.teams[0]), season: SEASON, isBetaTester, now: PRESS_AT, logger: QUIET,
    loadDaySpans: async () => new Map(), confirmedShortRaceIds: state.races.map((row) => row.id),
    ...(runDay ? { runDay } : {}),
  })).catch((err) => ({ status: `kast: ${err.message}` }));
  const provisional = fake.log.filter((entry) => entry.kind === "rpc" && isCommit(entry.target))
    .flatMap((entry) => (entry.payload?.p_conditions ?? []).filter((row) => row.provisional === true)
      .map((row) => ({ game_day: entry.payload.p_game_day, rider_id: row.rider_id, form: row.form, fatigue: row.fatigue })));
  let retry = null;
  if (retryOnThrow && typeof response.status === "string") {
    retry = await quietly(() => runTrainNow({
      supabase: fake.supabase, team: structuredClone(state.teams[0]), season: SEASON, isBetaTester, now: new Date(PRESS_AT.getTime() + 60_000), logger: QUIET,
      loadDaySpans: async () => new Map(), confirmedShortRaceIds: state.races.map((row) => row.id),
    })).catch((err) => ({ status: `kast: ${err.message}` }));
  }
  return {
    status: response.status, retryStatus: retry?.status ?? null, provisional: canon(provisional), commits, state,
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

// #8195 (delkoerslen efter etapen, bag slukket kontakt): gemmer den loebets session midt i trykket,
// mangler trykkets hukommelse den nye kvittering. Efter gemme-kald nr. 4 opdager det foreloebige
// dag-felt det (belastningen er aendret) og laeser alt som foer: trykket ender som paa main. Efter
// gemme-kald nr. 1 og 2 kommer et dag-felt foer det, og databasen afviser dets gemme-kald
// ("receipt snapshot changed"): intet gemmes, trykket svarer med en fejl, og et nyt tryk goer datoen
// faerdig. Det er dommens fund 4 (LAVT), som nu ogsaa kan ramme via delkoerslen. Proeven laaser, at
// intet forkert bliver staaende: efter det nye tryk er alle tabeller som efter mains ene tryk.
const RACE_TABLES = ["rider_derived_abilities", "rider_condition", "training_rider_ticks", "training_condition_settlements", "training_race_loads", "training_date_work"];
test("#8195: loebets session afregnes efter etapen midt i trykket (efter gemme-kald nr. 4): trykket ender som med mains motor", async () => {
  const branch = await pressWithStage(BIG, { settleAfter: 4, raceSession: true });
  const main = await pressWithStage(BIG, { settleAfter: 4, raceSession: true, runDay: mainEngine });
  assert.equal(main.status, 200);
  assert.equal(branch.status, 200);
  assert.ok(main.state.training_rider_ticks.some((row) => row.report?.race_session_7982 === true), "delkoerslen skrev loebets session");
  assert.deepEqual(branch.provisional, main.provisional);
  for (const table of RACE_TABLES) assert.equal(digest(branch.state[table]), digest(main.state[table]), `${table} er som med mains motor`);
});
for (const settleAfter of [1, 2]) {
  test(`#8195: loebets session midt i trykket (efter gemme-kald nr. ${settleAfter}): databasen afviser, intet forkert gemmes, og et nyt tryk ender som mains`, async () => {
    const branch = await pressWithStage(BIG, { settleAfter, raceSession: true, retryOnThrow: true });
    const main = await pressWithStage(BIG, { settleAfter, raceSession: true, runDay: mainEngine });
    assert.equal(main.status, 200, "mains motor laeser kvitteringerne igen og gaar igennem");
    assert.match(String(branch.status), /receipt snapshot changed/, "grenens tryk afvises af databasen (fund 4)");
    assert.equal(branch.retryStatus, 200, "det nye tryk gaar igennem");
    // Tidsstempler kommer fra det nye tryks oejeblik; alt andet skal vaere som efter mains ene tryk.
    const untimed = (value) => (Array.isArray(value) ? value.map(untimed) : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== "at" && !key.endsWith("_at")).map(([key, item]) => [key, untimed(item)])) : value);
    for (const table of RACE_TABLES) {
      assert.equal(digest(untimed(branch.state[table])), digest(untimed(main.state[table])), `${table} er som efter mains ene tryk (tidsstempler undtaget)`);
    }
  });
}
