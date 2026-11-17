// #7801 fund A + #7982: et Træn nu-tryk, hvor en etape afgøres og/eller løbets session gemmes
// midt i trykket (lige efter et bestemt gemme-kald). Bruges af trainNowFundA7801.test.js og
// trainNowSettleMidPress7982.test.js. Bygger kun på dommerens harness; ændrer intet i den.
//
// "Mains motor" er samme tryk, hvor hvert dag-felt læser alt selv (runDay uden trykkets
// hukommelse). Den vej er uændret af trin 4a og af denne rettelse (aftenkørslen og den almindelige
// træning går den), og den frosne golden-fil holder den fast mod merge-basens kode.
import { runTrainNow } from "../trainNow.js";
import { runTeamTrainingDay } from "../dailyTrainingEngine.js";
import { seedState, createFake, finishRace, canon, digest, PRESS_AT, SEASON, RACE, TEAM, DATE1, DAYS1 } from "../trainNowSameResult7982.harness.js";

const QUIET = { info() {}, warn() {}, error() {}, log() {} };
export const isCommit = (name) => name.replace(/^try_/, "") === "commit_training_date_tick";
export const mainEngine = (args) => runTeamTrainingDay({ ...args, pressMemory: null, pressRuns: null, pressTimer: null });
export const TABLES = ["rider_derived_abilities", "rider_condition", "training_rider_ticks", "training_condition_settlements", "training_race_loads", "training_date_work", "training_day_runs"];

async function quietly(fn) {
  const saved = { warn: console.warn, error: console.error, info: console.info, log: console.log };
  console.warn = () => {}; console.error = () => {}; console.info = () => {}; console.log = () => {};
  try { return await fn(); } finally { Object.assign(console, saved); }
}

/** Delkørslen efter etapen: kun løbets løbsdag, kun løbets ryttere (som runRaceSessionSettlement). */
async function settleRaceSession(fake, state, now) {
  const ids = state.race_entries.filter((row) => row.race_id === RACE).map((row) => row.rider_id);
  await runTeamTrainingDay({
    supabase: fake.supabase, teamId: TEAM, seasonId: SEASON.id, seasonNumber: SEASON.number, now,
    tickDateOverride: DATE1, gameDay: 43, dateGameDays: DAYS1, executedBy: "assistant", eligibleRiderIds: ids,
    unresolvedSlotsByRider: {}, deadlineAt: new Date(Date.parse(`${DATE1}T00:00:00Z`) + 25 * 3600 * 1000).toISOString(),
    deadlineReached: false, raceSessionRiderIds: new Set(ids),
  });
}

/**
 * Ét tryk som ruten kalder det. `stageAfter`: etapen afgøres lige efter gemme-kald nr. n.
 * `sessionAfter`: løbets session gemmes lige efter gemme-kald nr. n (efter etapen, hvis samme n).
 * `runDay` udeladt = grenens motor med trykkets hukommelse. `retryOnThrow`: et nyt tryk et minut
 * senere, hvis det første svarer med en fejl. `makeFake`: stedfortræderen (standard: dommerens;
 * #8195's fakeWithRaceSessionRule giver den migrationens løbssessions-regel for ryttere uden stempel).
 */
export async function pressMidway(seed, {
  stageAfter = null, sessionAfter = null, runDay = undefined, isBetaTester = true, now = PRESS_AT, retryOnThrow = false,
  makeFake = createFake,
} = {}) {
  const state = seedState(seed);
  const fake = makeFake(state);
  const realRpc = fake.supabase.rpc;
  const attempts = [];
  const applied = [];
  let commits = 0;
  let inSession = false;
  fake.supabase.rpc = async (name, args) => {
    const result = await realRpc(name, args);
    if (inSession || !isCommit(name)) return result;
    attempts.push({ args: canon(args), error: result?.error?.message ?? null });
    if (result?.error) return result;
    applied.push(canon(args));
    commits += 1;
    if (commits === stageAfter) finishRace(state);
    if (commits === sessionAfter) {
      inSession = true;
      try { await settleRaceSession(fake, state, now); } finally { inSession = false; }
    }
    return result;
  };
  const once = (at) => quietly(() => runTrainNow({
    supabase: fake.supabase, team: structuredClone(state.teams[0]), season: SEASON, isBetaTester, now: at, logger: QUIET,
    loadDaySpans: async () => new Map(), confirmedShortRaceIds: state.races.map((row) => row.id),
    ...(runDay ? { runDay } : {}),
  })).catch((err) => {
    // swallow-ok: et kast ER trykkets svar i prøven; det gemmes som status og sammenlignes.
    return { status: `kast: ${err.message}` };
  });
  fake.ctx.tryk += 1;
  const response = await once(now);
  const retry = retryOnThrow && typeof response.status === "string" ? await once(new Date(now.getTime() + 60_000)) : null;
  const provisional = applied.flatMap((args) => (args.p_conditions ?? []).filter((row) => row.provisional === true)
    .map((row) => ({ game_day: args.p_game_day, rider_id: row.rider_id, form: row.form, fatigue: row.fatigue })));
  const reads = fake.log.filter((entry) => entry.kind === "read");
  return {
    status: response.status, retryStatus: retry?.status ?? null, state, attempts, applied, provisional: canon(provisional),
    raceLoadReads: reads.filter((entry) => entry.target === "training_race_loads").length,
    reads: reads.length, calls: fake.log.length,
  };
}

/** Fjerner tidsstempler (et nyt tryk har sit eget øjeblik). */
export const untimed = (value) => (Array.isArray(value) ? value.map(untimed) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== "at" && !key.endsWith("_at") && key !== "p_now").map(([key, item]) => [key, untimed(item)])) : value);

/** Fingeraftryk af ét tryk: svar, antal kald og læsninger, alle gemme-kald og sluttilstanden. Kun hashes og antal. */
export function fingerprint(run) {
  return {
    status: run.status, retryStatus: run.retryStatus, calls: run.calls, reads: run.reads, raceLoadReads: run.raceLoadReads,
    attempts: digest(run.attempts), applied: digest(run.applied), provisional: digest(run.provisional),
    state: Object.fromEntries(TABLES.map((table) => [table, digest(run.state[table])])),
  };
}

// ── Den frosne golden (#7587): genereret af merge-basens kode, aldrig af den nye ────────────────
// `off`: grenens motor (med trykkets hukommelse) med kontakterne som i prod (fatigue_now_7801 slukket).
// `main_on`: mains motor (hvert dag-felt læser alt) med fatigue_now_7801 tændt: mains genlæsning.
export const AFTER_STAGE_AT = new Date("2026-11-09T17:30:00Z");
const ON = { fatigue_now_7801: "on" };
// [etape efter gemme-kald nr., løbets session efter gemme-kald nr.]
export const MIDWAY = [[null, null], [1, null], [2, null], [3, null], [4, null], [1, 1], [2, 2], [4, 4], [1, 2], [1, 3], [1, 4], [3, 4]];
export const caseLabel = (stageAfter, sessionAfter) => `etape_${stageAfter ?? "nej"}_session_${sessionAfter ?? "nej"}`;
export const GOLDEN_CASES = [
  ...MIDWAY.map(([stageAfter, sessionAfter]) => ({
    name: `off_stort_beta_${caseLabel(stageAfter, sessionAfter)}`, seed: "stort_hold_beta_tryk", stageAfter, sessionAfter, retryOnThrow: true,
  })),
  { name: "off_stort_almindeligt", seed: "stort_hold_beta_tryk", isBetaTester: false },
  { name: "off_stort_almindeligt_etape_2", seed: "stort_hold_beta_tryk", isBetaTester: false, stageAfter: 2 },
  { name: "off_lille_hold", seed: "lille_hold_uden_loeb" },
  { name: "off_etape_koert_session_2", seed: "stort_hold_beta_tryk", stageRun: true, sessionAfter: 2, now: AFTER_STAGE_AT },
  ...MIDWAY.map(([stageAfter, sessionAfter]) => ({
    name: `main_on_stort_beta_${caseLabel(stageAfter, sessionAfter)}`, seed: "stort_hold_beta_tryk", stageAfter, sessionAfter, flags: ON, main: true,
  })),
];

// Fable-dom 16/11: ryttere UDEN stempel (almindeligt tryk: løbsrytterne venter på deres løb), og
// løbets session gemmes midt i trykket. Kun #8195's stedfortræder (fakeWithRaceSessionRule) kender
// migrationens regel, der regner en løbssessions-rytter som stemplet i netop det kald; derfor køres
// disse tilfælde med den. Begge kontakter tændt, som de tændes sammen. Facit: mains motor, frosset af
// merge-basens kode i trainNowNoStampSession7801Golden.json.
export const NO_STAMP_FLAGS = { fatigue_now_7801: "on", training_settle_race_session: "on" };
export const NO_STAMP_CASES = MIDWAY.filter(([, sessionAfter]) => sessionAfter != null).map(([stageAfter, sessionAfter]) => ({
  name: `uden_stempel_main_on_${caseLabel(stageAfter, sessionAfter)}`, seed: "stort_hold_beta_tryk", stageAfter, sessionAfter,
  isBetaTester: false, flags: NO_STAMP_FLAGS, main: true,
}));

/**
 * Kør ét golden-tilfælde. `flags`/`main` kan overstyres (fx grenens motor med kontakten tændt).
 * `makeFake`: stedfortræderen (standard: dommerens).
 */
export async function runGoldenCase(c, scenarios, { flags = c.flags, main = c.main, makeFake = undefined } = {}) {
  const base = scenarios[c.seed].seed;
  const seed = { ...base, ...(c.stageRun ? { stageRun: true } : {}), ...(flags ? { flags } : {}) };
  return pressMidway(seed, {
    stageAfter: c.stageAfter ?? null, sessionAfter: c.sessionAfter ?? null, isBetaTester: c.isBetaTester ?? true,
    now: c.now ?? PRESS_AT, retryOnThrow: c.retryOnThrow ?? false, ...(main ? { runDay: mainEngine } : {}),
    ...(makeFake ? { makeFake } : {}),
  });
}
