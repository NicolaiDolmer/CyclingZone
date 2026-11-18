// #7982 (Fable 15/11, TRAINING_RULES 13.5 "proevekoersel mod prod-billede"): koer EN dags rigtige
// data for ET hold gennem afregningen i dommerens database-stedfortraeder, uden at skrive til prod.
//
// Tre trin (scriptet backend/scripts/dev/facit7982ProdImage.mjs kalder dem):
//  1. captureProdImage: laeser holdets raekker for datoen (kun SELECT) og datoens kontekst med den
//     RIGTIGE loadTrainingDateContext. Billedet er rigtige spillerdata: det gemmes kun privat
//     (balance-internals/, gitignoreret), aldrig i repoet (regel 17).
//  2. runProdImage: fylder stedfortraederen (trainNowSameResult7982.harness.js + facit-proevens
//     #7982-regel) med billedet og koerer de to veje fra samme udgangspunkt:
//       "alt kl. 20"  - aftenkoerslen for holdet, og
//       "tidligt"     - delkoerslen (runRaceSessionSettlement) for de lukkede etaper, saa aftenen.
//     Spillets tal sammenlignes bit for bit som i facit-proeven.
//  3. compareWithProd: efter prods rigtige aftenkoersel sammenlignes "alt kl. 20"-vejen med det,
//     prod faktisk skrev for holdet (beviser at stedfortraederen ligner prod paa rigtige data).
//
// Selvtjek: laeser motoren en tabel, billedet ikke har, eller kalder den en databasefunktion,
// stedfortraederen ikke kender, er koerslen ugyldig (missingTables / unsupported), aldrig groen.
// Output fra denne fil er kun noegler, antal og fingeraftryk; ingen motortal.
import { runRaceSessionSettlement } from "./trainingSettleRaceSession7982.js";
import { runTeamTrainingDay } from "./dailyTrainingEngine.js";
import { fetchAllRows } from "./supabasePagination.js";
import { loadFinalTrainingDate } from "./seasonTransitionReadiness.js";
import {
  loadTrainingDateContext, resolveTrainingDateReadiness, trainingDateBounds, trainingDateDeadline,
} from "./trainingDateReadiness.js";
import { copenhagenDateString, copenhagenWallTimeToUTC } from "./copenhagenTime.js";
import { digest } from "./trainNowSameResult7982.harness.js";
import {
  fakeWithRaceSessionRule, numbersOf, firstDiff, receiptFieldsThatDiffer,
} from "./trainingSettleRaceSession7982.facit.test.js";

export const PROD_IMAGE_VERSION = 1;
const SETTLE_FLAG = "training_settle_race_session";
const FATIGUE_NOW_FLAG = "fatigue_now_7801";
// Taendings-maalet (ejervalg 15/11): de to kontakter taendes sammen.
export const IGNITION_FLAGS = Object.freeze({ [SETTLE_FLAG]: "on", [FATIGUE_NOW_FLAG]: "on" });

/**
 * Kun-laesning paa netvaerksniveau: alt andet end GET og HEAD afvises, ogsaa fra moduler, der
 * laver deres egen forespoergsel gennem klienten. `stats.blocked` skal vaere 0 efter en koersel.
 */
export function readOnlyFetch(realFetch, stats = { calls: 0, blocked: 0 }) {
  return async (input, init = {}) => {
    const fromRequest = input !== null && typeof input === "object" ? input.method : undefined;
    const method = String(init?.method ?? fromRequest ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      stats.blocked += 1;
      throw new Error(`prod-billedet afviste ${method}: kun laesning`);
    }
    stats.calls += 1;
    return realFetch(input, init);
  };
}

async function rows(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data ?? [];
}
// Offset-paginering kraever en UNIK sortering, ellers kan raekker springes over eller komme to gange
// mellem siderne. `order` er derfor tabellens primaernoegle, evt. sammensat (liste af kolonner).
const all = (supabase, table, scope, order) => fetchAllRows(() => [order].flat()
  .reduce((query, column) => query.order(column), scope(supabase.from(table).select("*"))));
const unique = (values) => [...new Set(values.filter((value) => value != null))];

/**
 * Holdets raekker for datoen. Raekkevidden er det, motoren laeser for ét hold paa én dato (maalt
 * med stedfortraederens log over facit-scenarierne), plus det, sammenligningen med prod skal se.
 * @returns {Promise<Record<string, object[]>>}
 */
export async function captureTeamTables({ supabase, teamId, seasonId, tickDate, riderIds, todayRaceIds }) {
  const team = (await rows(supabase.from("teams").select("*").eq("id", teamId), "teams"))[0];
  if (!team) throw new Error("holdet findes ikke");
  const divisions = unique([team.league_division_id, team.u23_league_division_id, team.junior_league_division_id]);
  const tables = { teams: [team] };
  tables.app_config = await all(supabase, "app_config", (q) => q, "key");
  tables.private_config = await all(supabase, "private_config", (q) => q, "key");
  tables.seasons = await all(supabase, "seasons", (q) => q, "id");
  tables.users = team.user_id ? await rows(supabase.from("users").select("id,is_beta_tester,role").eq("id", team.user_id), "users") : [];
  tables.riders = await all(supabase, "riders", (q) => q.in("id", riderIds), "id");
  const perRider = [
    ["rider_derived_abilities", (q) => q.in("rider_id", riderIds), "rider_id"],
    ["rider_condition", (q) => q.in("rider_id", riderIds), "rider_id"],
    ["race_entries", (q) => q.in("rider_id", riderIds), ["race_id", "rider_id"]],
    ["race_entry_days", (q) => q.in("rider_id", riderIds).eq("season_id", seasonId), ["race_id", "rider_id", "game_day"]],
    ["race_incidents", (q) => q.in("rider_id", riderIds), "id"],
    ["training_race_loads", (q) => q.in("rider_id", riderIds).eq("season_id", seasonId).eq("tick_date", tickDate), ["rider_id", "race_id", "stage_number"]],
    ["training_rider_ticks", (q) => q.in("rider_id", riderIds).eq("season_id", seasonId).eq("tick_date", tickDate), ["rider_id", "season_id", "game_day"]],
    ["training_condition_settlements", (q) => q.in("rider_id", riderIds).eq("season_id", seasonId), ["rider_id", "season_id", "tick_date"]],
    ["training_train_now_locks", (q) => q.in("rider_id", riderIds).eq("tick_date", tickDate), ["rider_id", "tick_date"]],
    ["rider_derived_ability_history", (q) => q.in("rider_id", riderIds).eq("snapshot_date", tickDate), "id"],
    ["rider_ability_race_day_history", (q) => q.in("rider_id", riderIds).eq("snapshot_date", tickDate), "id"],
    ["rider_training_scores", (q) => q.in("rider_id", riderIds).eq("tick_date", tickDate), "id"],
  ];
  const perTeam = [
    ["training_plans", (q) => q.eq("team_id", teamId), "id"],
    ["training_week_plans", (q) => q.eq("team_id", teamId), "id"],
    ["team_training_rules", (q) => q.eq("team_id", teamId), "id"],
    ["training_groups", (q) => q.eq("team_id", teamId), "id"],
    ["team_staff", (q) => q.eq("team_id", teamId), "id"],
    ["team_facilities", (q) => q.eq("team_id", teamId), "id"],
    ["training_date_work", (q) => q.eq("team_id", teamId).eq("season_id", seasonId).eq("tick_date", tickDate), ["team_id", "season_id", "tick_date"]],
    ["training_day_runs", (q) => q.eq("team_id", teamId).eq("season_id", seasonId).eq("tick_date", tickDate), "id"],
  ];
  for (const [table, scope, order] of [...perRider, ...perTeam]) tables[table] = await all(supabase, table, scope, order);
  const groupIds = unique(tables.training_groups.map((row) => row.id));
  tables.training_group_members = groupIds.length ? await all(supabase, "training_group_members", (q) => q.in("group_id", groupIds), "rider_id") : [];
  const staffIds = unique(tables.team_staff.map((row) => row.id));
  tables.staff_derived_abilities = staffIds.length ? await all(supabase, "staff_derived_abilities", (q) => q.in("staff_id", staffIds), "staff_id") : [];
  tables.races = await all(supabase, "races", (q) => q.eq("season_id", seasonId).in("league_division_id", divisions.length ? divisions : ["00000000-0000-0000-0000-000000000000"]), "id");
  const raceIds = unique([...tables.races.map((row) => row.id), ...todayRaceIds]);
  tables.race_stage_schedule = raceIds.length ? await all(supabase, "race_stage_schedule", (q) => q.in("race_id", raceIds), ["race_id", "stage_number"]) : [];
  const today = unique(todayRaceIds);
  for (const [table, extra, order] of [
    ["race_simulation_runs", (q) => q, "id"], ["race_stage_profiles", (q) => q, "id"],
    ["race_team_orders", (q) => q, ["team_id", "race_id", "stage_number"]], ["race_stage_roles", (q) => q.in("rider_id", riderIds), ["race_id", "stage_number", "rider_id"]],
    ["race_results", (q) => q.in("rider_id", riderIds), "id"],
  ]) tables[table] = today.length ? await all(supabase, table, (q) => extra(q.in("race_id", today)), order) : [];
  return tables;
}

// JSON kan ikke baere Map/Set: datoens kontekst gemmes med lister og genskabes ved koersel.
const contextToJson = (context) => ({
  ...context,
  candidateRiderIdsByRace: [...(context.candidateRiderIdsByRace ?? new Map())].map(([race, ids]) => [race, [...ids]]),
  gameDaysByDivision: [...(context.gameDaysByDivision ?? new Map())],
});
const contextFromJson = (json) => ({
  ...structuredClone(json),
  candidateRiderIdsByRace: new Map((json.candidateRiderIdsByRace ?? []).map(([race, ids]) => [race, [...ids]])),
  gameDaysByDivision: new Map(structuredClone(json.gameDaysByDivision ?? [])),
});

/**
 * Trin 1, kun laesning. Kald det efter holdets sidste etape og FOER aftenkoerslen (19:15-19:55),
 * saa billedet er datoens udgangspunkt med etaperne koert.
 */
export async function captureProdImage({ supabase, teamId, now = new Date(), loadDaySpans, loadContext = loadTrainingDateContext, loadFinalDate = loadFinalTrainingDate }) {
  const season = (await rows(supabase.from("seasons").select("id,number,start_date,end_date,status").eq("status", "active"), "active season"))[0];
  if (!season) throw new Error("ingen aktiv saeson");
  const tickDate = copenhagenDateString(now);
  const context = await loadContext({ supabase, season, tickDate, loadDaySpans });
  const team = (context.teams ?? []).find((row) => row.id === teamId);
  if (!team) throw new Error("holdet er ikke et traeningshold paa datoen");
  const [work] = await rows(supabase.from("training_date_work").select("expected_rider_ids").eq("team_id", teamId).eq("season_id", season.id).eq("tick_date", tickDate), "training_date_work");
  const riderIds = unique([...(context.riders ?? []).filter((row) => row.team_id === teamId).map((row) => row.id), ...(work?.expected_rider_ids ?? [])]).sort();
  const mine = new Set(riderIds);
  const todayRaceIds = unique((context.stages ?? []).map((row) => row.race_id));
  const teamContext = {
    ...context, teams: [team],
    riders: (context.riders ?? []).filter((row) => mine.has(row.id)),
    entries: (context.entries ?? []).filter((row) => mine.has(row.rider_id)),
    results: (context.results ?? []).filter((row) => mine.has(row.rider_id)),
    incidents: (context.incidents ?? []).filter((row) => mine.has(row.rider_id)),
    loads: (context.loads ?? []).filter((row) => mine.has(row.rider_id)),
    frozenEntries: (context.frozenEntries ?? []).filter((row) => mine.has(row.rider_id)),
    candidateRiderIdsByRace: new Map([...(context.candidateRiderIdsByRace ?? new Map())].map(([race, ids]) => [race, [...ids].filter((id) => mine.has(id))])),
    gameDaysByDivision: new Map([...(context.gameDaysByDivision ?? new Map())].filter(([division]) => division === team.league_division_id)),
  };
  const tables = await captureTeamTables({ supabase, teamId, seasonId: season.id, tickDate, riderIds, todayRaceIds });
  return {
    version: PROD_IMAGE_VERSION, capturedAt: now.toISOString(), tickDate, teamId, season,
    finalDate: await loadFinalDate({ supabase, seasonId: season.id }),
    riderIds, context: contextToJson(teamContext), tables,
  };
}


function stateOf(image, flags) {
  const state = structuredClone(image.tables);
  for (const [key, value] of Object.entries(flags)) {
    const row = state.app_config.find((r) => r.key === key);
    if (row) row.value = value; else state.app_config.push({ key, value });
  }
  return state;
}

/** Aftenkoerslen for ét hold, som sweepen kalder motoren: ét kald pr. loebsdag i datoens raekkefoelge. */
export async function eveningForTeam({ state, fake, image, now }) {
  const { teamId, season, tickDate } = image;
  const context = contextFromJson(image.context);
  const team = context.teams[0];
  const work = state.training_date_work.find((row) => row.team_id === teamId && row.season_id === season.id && row.tick_date === tickDate);
  const days = work?.game_days ?? context.gameDaysByDivision.get(team.league_division_id);
  if (!Array.isArray(days) || days.length !== 5) throw new Error("datoen har ikke fem loebsdage for holdet");
  const dateEnd = trainingDateBounds(tickDate).end;
  const roster = work ? work.expected_rider_ids.filter((id) => !(work.quarantined_rider_ids ?? []).includes(id))
    : state.riders.filter((row) => row.team_id === teamId && row.is_retired !== true
      && (!row.created_at || new Date(row.created_at) < dateEnd) && (!row.acquired_at || new Date(row.acquired_at) < dateEnd)).map((row) => row.id);
  const { unresolvedSlotsByRider } = resolveTrainingDateReadiness({ ...context, tickDate, now, riderIds: roster });
  const stamped = new Set(state.training_train_now_locks.filter((row) => row.tick_date === tickDate && row.instant_at != null).map((row) => row.rider_id));
  const eligible = roster.filter((id) => !unresolvedSlotsByRider[id] || stamped.has(id));
  const out = [];
  for (const gameDay of days) {
    out.push(await runTeamTrainingDay({
      supabase: fake.supabase, teamId, seasonId: season.id, seasonNumber: season.number, now, tickDateOverride: tickDate, gameDay,
      dateGameDays: days, executedBy: "assistant", eligibleRiderIds: eligible, unresolvedSlotsByRider,
      deadlineAt: trainingDateDeadline(tickDate).toISOString(), deadlineReached: false,
    }).then((r) => ({ alreadyRan: r.alreadyRan, gameDay: r.gameDay, riders: (r.report?.riders ?? []).length }),
      (error) => ({ gameDay, error: String(error?.message ?? error) })));
  }
  return out;
}

const QUIET = { log() {}, warn() {}, error() {}, info() {} };
// Tabeller, motoren har laest i koerslen (stedfortraederens log), som billedet ikke har med.
const missingTablesOf = (fake, image) => unique(fake.log.filter((entry) => entry.kind === "read" && !(entry.target in image.tables)).map((entry) => entry.target)).sort();

/** Én vej fra billedet. early=true: delkoerslen ved `settleAt`, saa aftenen ved `eveningAt`. */
export async function runPath(image, { early, flags, settleAt, eveningAt, quiet = true }) {
  const state = stateOf(image, flags);
  const fake = fakeWithRaceSessionRule(state);
  let settled = null;
  if (early) {
    settled = await runRaceSessionSettlement({
      supabase: fake.supabase, now: settleAt, logger: quiet ? QUIET : console, loadDaySpans: async () => new Map(),
      loadContext: async () => contextFromJson(image.context), loadFinalDate: async () => image.finalDate,
    });
  }
  const evening = await eveningForTeam({ state, fake, image, now: eveningAt });
  return { state, settled, evening, unsupported: [...fake.unsupported], missingTables: missingTablesOf(fake, image) };
}

/** Standardtider: delkoerslen ved billedets tidspunkt, aftenen kl. 20:05 dansk tid paa datoen. */
export function defaultTimes(image) {
  return { settleAt: new Date(image.capturedAt), eveningAt: copenhagenWallTimeToUTC(image.tickDate, 20, 5) };
}

/**
 * Trin 2: "alt kl. 20" mod "tidligt" fra samme billede, med taendings-kontakterne (eller `flags`).
 * Spillets tal skal vaere ens; kvitteringernes oejebliksbilleder maa afvige som i facit (13.5).
 */
export async function runProdImage(image, { flags = IGNITION_FLAGS, ...times } = {}) {
  const { settleAt, eveningAt } = { ...defaultTimes(image), ...times };
  const late = await runPath(image, { early: false, flags, settleAt, eveningAt });
  const early = await runPath(image, { early: true, flags: { ...flags, [SETTLE_FLAG]: "on" }, settleAt, eveningAt });
  const lateNumbers = numbersOf(late.state), earlyNumbers = numbersOf(early.state);
  const { receipts: lateReceipts, ...lateRest } = lateNumbers;
  const { receipts: earlyReceipts, ...earlyRest } = earlyNumbers;
  const plain = (list) => list.map((r) => ({ id: `${r.rider_id}#${r.game_day}`, gains: r.report.gains, gains_detail: r.report.gains_detail, score: r.report.score, intensity: r.report.intensity, status: r.report.status, injured: r.report.injured }));
  const raceSessions = early.state.training_rider_ticks.filter((t) => t.report?.race_session_7982 === true).length;
  const errors = [...late.evening, ...early.evening].filter((row) => row.error).map((row) => row.error);
  const valid = !late.unsupported.length && !early.unsupported.length && !late.missingTables.length && !early.missingTables.length && !errors.length;
  return {
    valid, errors, unsupported: unique([...late.unsupported, ...early.unsupported]), missingTables: unique([...late.missingTables, ...early.missingTables]),
    settled: early.settled, raceSessions,
    numbersEqual: digest(lateRest) === digest(earlyRest), firstDifference: firstDiff(lateRest, earlyRest),
    receiptsPlainEqual: digest(plain(lateReceipts)) === digest(plain(earlyReceipts)),
    receiptFieldsThatDiffer: lateReceipts.length === earlyReceipts.length ? receiptFieldsThatDiffer(lateNumbers, earlyNumbers) : ["(antal kvitteringer)"],
    digests: { late: digest(lateNumbers), early: digest(earlyNumbers) },
    late, early,
  };
}

// Kvitteringens oejebliksfelter, der maa afvige mellem "alt kl. 20" og "tidligt" (facit 13.5):
// fremgangen foer/efter sessionen, og form/traethed naar loebet er datoens sidste session.
export const PROOF_ALLOWED_RECEIPT_FIELDS = Object.freeze(["fatigue", "fatigue_delta", "form", "progress_after", "progress_before"]);

/**
 * #8391 (Codex P2): proeven er kun bestaaet, naar de dokumenterede betingelser holder, ikke blot
 * naar koerslen ikke fejlede. Den tidlige afregning skal faktisk have koert (ingen skipped, ingen
 * fejl, mindst én afregnet) og givet loebssessioner, spillets tal og kvitteringernes vaerdier skal
 * vaere ens, og kun tilladte oejebliksfelter maa afvige. Returnerer de brudte betingelser.
 */
export function proofFailures(result) {
  const failures = [];
  if (!result.valid) failures.push("valid");
  const settled = result.settled;
  if (!settled) failures.push("settled:missing");
  else {
    if (settled.skipped) failures.push(`settled:skipped:${settled.skipped}`);
    if (settled.failed) failures.push("settled:failed");
    if (!(settled.settled > 0)) failures.push("settled:none");
  }
  if (!(result.raceSessions > 0)) failures.push("raceSessions");
  if (!result.numbersEqual) failures.push("numbersEqual");
  if (!result.receiptsPlainEqual) failures.push("receiptsPlainEqual");
  const extra = (result.receiptFieldsThatDiffer ?? []).filter((field) => !PROOF_ALLOWED_RECEIPT_FIELDS.includes(field));
  if (extra.length) failures.push(`receiptFields:${extra.join(",")}`);
  return failures;
}

// Kolonner, der beskriver HVORNAAR/HVORDAN en raekke blev gemt i prod (id'er, tidsstempler), og som
// stedfortraederen ikke saetter. Spillets tal sammenlignes uden dem.
// En kolonne, prod udfylder med null, og som stedfortraederen slet ikke saetter, er samme vaerdi.
// Datoregnskabet sammenlignes paa trup, karantaene, status og aabning; dets beviser baerer
// koerslens klokkeslaet og er ikke spillets tal.
const PROD_ONLY = new Set(["id", "created_at", "settled_at", "updated_at", "imported_at"]);
const WORK_FIELDS = ["team_id", "season_id", "tick_date", "game_days", "expected_rider_ids", "quarantined_rider_ids", "status", "opening_conditions"];
const withoutProdOnly = (tables) => Object.fromEntries(Object.entries(tables).map(([table, list]) => [table,
  (list ?? []).map((row) => Object.fromEntries(Object.entries(row)
    .filter(([key, value]) => !PROD_ONLY.has(key) && value !== null && (table !== "training_date_work" || WORK_FIELDS.includes(key)))))]));

/**
 * Trin 3, kun laesning: efter prods aftenkoersel. `prodTables` er holdets raekker laest med samme
 * raekkevidde som billedet (captureTeamTables). Sammenligner "alt kl. 20"-vejen fra billedet med
 * prods faktiske resultat, noegle for noegle, og kvitteringerne felt for felt.
 */
export async function compareWithProd(image, prodTables, { flags = {}, ...times } = {}) {
  const { settleAt, eveningAt } = { ...defaultTimes(image), ...times };
  const late = await runPath(image, { early: false, flags, settleAt, eveningAt });
  const mine = new Set(image.riderIds);
  const scoped = (tables) => {
    const out = withoutProdOnly(tables);
    for (const key of ["rider_derived_abilities", "rider_condition"]) out[key] = (out[key] ?? []).filter((row) => mine.has(row.rider_id));
    return out;
  };
  const simulated = numbersOf(scoped(late.state));
  const actual = numbersOf(scoped({ ...image.tables, ...prodTables }));
  const keys = {};
  for (const key of Object.keys(simulated)) {
    if (key === "receipts") continue;
    keys[key] = { equal: digest(simulated[key]) === digest(actual[key]), rows: [simulated[key]?.length ?? 0, actual[key]?.length ?? 0], firstDifference: firstDiff(actual[key], simulated[key]) };
  }
  const receiptCount = [simulated.receipts.length, actual.receipts.length];
  return {
    valid: !late.unsupported.length && !late.missingTables.length && late.evening.every((row) => !row.error),
    unsupported: late.unsupported, missingTables: late.missingTables,
    keys, receiptCount,
    receiptFieldsThatDiffer: receiptCount[0] === receiptCount[1] ? receiptFieldsThatDiffer(actual, simulated) : ["(antal kvitteringer)"],
    equal: Object.values(keys).every((row) => row.equal) && receiptCount[0] === receiptCount[1] && receiptFieldsThatDiffer(actual, simulated).length === 0,
  };
}
