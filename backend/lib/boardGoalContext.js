// S-02d · Loader cumulative + plan-start kontekst-felter til de 7 nye mål-typer.
// Bruges af både economyEngine.processTeamSeasonEnd (sæson-evaluering) og
// api.js /board/status (live BoardPage-outlook). Holder query-pattern på ét sted.
//
// Q-bekræftelser:
//   A: monument_podium = cumulative over plan-perioden
//   B: jersey_wins = cumulative for 3yr/5yr, per-sæson for 1yr (vi returnerer begge)
//   D: profitable_transfers = SUM(amount) finance_transactions type IN (transfer_in, transfer_out)
//   E1: planStart-baseline fra første board_plan_snapshots-row i planen
//   F: divisionManagerCount = is_ai=false-teams i samme PULJE (league_division_id)
//      for sæsonen, når leagueDivisionId er sat (#1608); ellers tier-bredt fallback.
//
// #3494 · sponsorGrowthCurrentIncome/sponsorGrowthBaselineIncome: re-pointer
// sponsor_growth-målet fra det døde teams.sponsor_income-felt (altid
// SPONSOR_INCOME_BASE for alle hold, se docs/BOARD_RULES.md §3) til ægte
// sponsor_contracts-udbetalinger (finance_transactions, SPONSOR_GROWTH_REASON_CODES
// herunder). Baseline = planens FØRSTE afsluttede sæson (samme
// firstSnapshot-mekanik som E1/U25 ovenfor) — ikke en gemt DB-snapshot-værdi,
// da board_profiles.plan_start_sponsor_income er den samme dødte kilde.
//
// #1238 · Podie-queryen dækker hele den kanoniske klassiker-kategori
// (CLASSIC_RACE_CLASSES, Monuments ⊂ klassikere) og splittes i JS via
// isMonumentRace/isClassicRace, så monument_podium-mål med race_scope
// "classics" (klassiker-orienterede boards) kan honorere alle WT-endagsløb.
//
// #5537 (S9, spec 2026-09-15 C3) · Bestyrelsesmålene tæller KUN seniorløb. Efter
// A2 (#5517) bor U23-/juniorløb i samme `races`-tabel, og deres race_results-rækker
// bærer holdets team_id ligesom seniorresultaterne. Uden et scope ville et
// ungdomsløbs podie tælle som monument-/klassiker-podie, en ungdomstrøje som
// jersey_wins og en ungdomsendagssejr som stage_wins i seniorbestyrelsens plan.
// Se "Senior-dommen på de indlejrede races" nedenfor for HVORDAN.

import { CLASSIC_RACE_CLASSES, isClassicRace, isMonumentRace } from "./boardConstants.js";
import { getPlanDuration } from "./boardGoals.js";
import { FINANCE_REASON } from "./economyConstants.js";
import { isMissingSquadColumnError } from "./racePoolCatalog.js";
import { isSeniorSquadRow, SQUAD_COLUMN } from "./squads.js";
import { fetchAllRowsChunkedIn } from "./supabasePagination.js";

// #3494 · sponsor_growth re-pointet fra det døde teams.sponsor_income-felt til
// ægte kontrakt-økonomi: kontrakt-garanteret base (season_start_sponsor, evt.
// forholdsmæssig for hold oprettet midt i sæsonen: midseason_sponsor_prorata)
// + løbsdags-indtægt fra den aktive sponsor_contracts-kontrakt (sponsor_race_day).
// Bevidst UDEN engangsbonusser (signing/result/objective, #2948-klausuler) —
// de er ikke tilbagevendende kontrakt-"vækst" og ville gøre målet uforudsigeligt
// år-til-år (en signing-bonus i plan-start-sæsonen ville se ud som et fald året
// efter). Se docs/BOARD_RULES.md §3 + gh issue 3494 for rod-årsagen.
const SPONSOR_GROWTH_REASON_CODES = [
  FINANCE_REASON.SEASON_START_SPONSOR,
  FINANCE_REASON.MIDSEASON_SPONSOR_PRORATA,
  FINANCE_REASON.SPONSOR_RACE_DAY,
];

// ── #5537 · Senior-dommen på de indlejrede races ─────────────────────────────
//
// race_results har INGEN squad-kolonne — truppen bor på løbet. squads.
// withSeniorSquadScope lægger sit filter på TOP-niveau og ville her få 42703 fra
// Postgres, som dens fallback (korrekt, for races/league_divisions) læser som
// "kolonnen er ikke migreret endnu" og derfor kører læsningen tavst UDEN scope.
// Den må derfor ikke bruges rundt om en race_results-læsning.
//
// I stedet tager alle seks læsere (tre i prefetchen, tre pr. board) `squad` med i
// det INDLEJREDE `races!inner(...)`-select, og dommen fældes i JS med squads.
// isSeniorSquadRow på rækkens `races` — ÉT sted i loadGoalContextForBoard efter
// begge læse-stier, så prefetch og pr.-board-læsning ikke kan blive uenige.
//
// Bevidst intet SQL-filter på det indlejrede races (`races.or=(…)` via
// referencedTable): JS-dommen er tilstrækkelig og bit-identisk i dag, læserne
// har de samme rank-filtre for ungdomsløbenes rækker (podier, trøjer,
// endagssejre), så række-lofterne i "pagination-safe"-kommentarerne rykker sig
// ikke nær 1000, og kaldstedernes test-fakes (economyEngine,
// boardWeekendFinalization) kender ikke `.or`. Et SQL-filter kan lægges oven på
// senere uden at ændre dommen.
//
// 42703-vinduet (auto-migrate applier først efter deploy): findes races.squad ikke,
// fejler det indlejrede select med 42703. Det beviser at intet ungdomsløb kan
// findes, og læsningen gentages én gang uden squad — rækkerne mangler så feltet og
// dømmes senior. Kun 42703 tæller (isMissingSquadColumnError, samme dom som
// race_pool-scopet #5330); en schema-cache-fejl bobler op som enhver anden fejl.
const racesWithSquad = (columns) => `races!inner(${columns}, ${SQUAD_COLUMN})`;
const racesWithoutSquad = (columns) => `races!inner(${columns})`;

/**
 * Kør en race_results-læsning med løbets trup i det indlejrede races-select.
 *
 * `run(races)` bygger og kører læsningen og bruger `races(<kolonner>)` som det
 * indlejrede select. `run` kaldes med squad først og ÉN gang til uden, hvis
 * databasen svarer 42703 på squad. Begge fejl-former håndteres (returneret
 * `{ error }` og kastet fejl fra fetchAllRowsChunkedIn); alt andet returneres/
 * kastes uændret. `run` skal bygge en frisk builder ved hvert kald.
 */
async function withEmbeddedRaceSquad(run) {
  let result;
  try {
    result = await run(racesWithSquad);
  } catch (err) {
    if (!isMissingSquadColumnError(err)) throw err;
    return run(racesWithoutSquad);
  }
  if (result?.error && isMissingSquadColumnError(result.error)) return run(racesWithoutSquad);
  return result;
}

// JS-dommen. En række uden indlejret `races` (kan ikke ske med `!inner`, kun i
// fixtures) dømmes som en række uden squad: senior. Kun en eksplicit ungdomstrup
// på løbet fjerner rækken.
function onlySeniorRaceRows(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.filter((row) => isSeniorSquadRow(row?.races ?? {}));
}

// #2469 · Fælles kontekst-bygger for bestyrelses-motoren. #2308 fandt at tre
// live-stier håndbyggede hver sit context-objekt til calculateBoardPerformance/
// evaluateBoardSeason og drev fra hinanden; #2469 fandt en fjerde (/board/request)
// der stadig manglede isFinalSeason + goal-context — scoren der afgjorde en
// forhandling blev beregnet på et andet grundlag end det /board/status viste.
// Denne bygger lukker bugklassen strukturelt: ALLE stier der fodrer motoren
// kalder den, så en ny kontekst-parameter tilføjes ét sted.
//
// Stier (forward-guardet i boardEvalContext.test.js):
//   1. /board/status (routes/api.js) — live outlook + satisfaction-prognose
//   2. /board/request (routes/api.js) — forhandlings-afgørelsen
//   3. boardWeekendFinalization.js — weekend-satisfaction-tracking
//   4. economyEngine.processTeamSeasonEnd — autoritativ sæson-slut-evaluering
//   5. economyEngine.buildSeasonEndPreviewRows — admin-preview (synkron; kan
//      ikke kalde loadGoalContextForBoard → goalContext={}, kendt begrænsning)
//
// IKKE en sti: boardMidSeason.js — den evaluerer bevidst mid-plan-progress med
// isFinalSeason:false/planDuration:1 (anden semantik end plan-evaluering).
//
// seasonsCompleted = arbejds-sæson-indekset: den sæson planen er I, dvs.
// board.seasons_completed + 1, cappet på planDuration. Cappen matcher
// /board/status (#2308-kommentaren: ækvivalent med den uncappede sammenligning
// for isFinalSeason-flaget) og er no-op for weekend/season-end, hvor completed
// planer altid har seasons_completed < planDuration.
export function buildBoardEvalContext({
  board,
  standing = null,
  activeLoanCount = 0,
  // #1237 · nettostilling-input til no_outstanding_debt-målet (scoreFinanceHealthGoal,
  // boardUtils.js). Alle tre defaulter til 0 for opkaldssteder der (endnu) ikke
  // sender dem — no_outstanding_debt falder da tilbage til "dyb negativ netto"-scoren,
  // aldrig et krav (evaluateGoal/evaluateGoalProgress håndterer default-sikkert).
  balance = 0,
  activeDebt = 0,
  wageBillPerSeason = 0,
  currentSponsorIncome = null,
  recentSnapshots = [],
  goalContext = {},
  extra = {},
} = {}) {
  if (!board) throw new Error("buildBoardEvalContext requires a board");

  const planDuration = getPlanDuration(board.plan_type);
  const seasonsCompleted = Math.min(planDuration, (board.seasons_completed || 0) + 1);

  return {
    planDuration,
    seasonsCompleted,
    isFinalSeason: seasonsCompleted >= planDuration,
    activeLoanCount,
    balance,
    activeDebt,
    wageBillPerSeason,
    planStartSponsorIncome: board.plan_start_sponsor_income,
    currentSponsorIncome,
    recentSnapshots,
    hasSeasonData: Boolean(standing),
    // #979 · Kumulativ = afsluttede sæsoner (board.cumulative_*, persisteres ved
    // season-end) + indeværende sæsons in-progress wins (standing.*).
    // #4034 · + goalContext.cumulativeOneDayWins: endagssejre tælles ALDRIG med i
    // board.cumulative_stage_wins (season-end-persisteringen kender kun
    // season_standings.stage_wins, som er etapeløb-specifik) eller i
    // standing.stage_wins for indeværende sæson — de tælles her live oveni, så
    // stage_wins-målet honorerer "en endagssejr >= en etapesejr" på tværs af
    // hele planperioden, ikke kun indeværende sæson (se evaluateGoal/
    // evaluateGoalProgress i boardGoals.js for den ikke-kumulative variant).
    cumulativeStats: {
      stageWins: (board.cumulative_stage_wins || 0) + (standing?.stage_wins || 0)
        + (goalContext.cumulativeOneDayWins || 0),
      gcWins: (board.cumulative_gc_wins || 0) + (standing?.gc_wins || 0),
    },
    ...goalContext,
    ...extra,
  };
}

// #5182 · Prefetch af de sæson-brede kilder loadGoalContextForBoard ellers
// læser ÉN GANG PR. BOARD.
// ---------------------------------------------------------------------------
// `race_results` og `finance_transactions` indeholder de samme rækker uanset
// hvilket board vi evaluerer — kun `team_id` og plan-sæson-vinduet skifter.
// I processBoardWeekendFinalization betød det 5 opslag × 242 hold × 1-3 boards
// = langt størstedelen af de 6.364 sekventielle DB-kald der gjorde
// board-trinnet til 72-93 % af finaliserings-tiden (måling 12/9, se
// docs/drafts/5182-board-flaskehals-designsession.md).
//
// Prefetchen henter PRÆCIS de samme rækker med PRÆCIS de samme prædikater, blot
// for hele holdpopulationen på én gang (`.in("team_id", …)`) og over UNIONEN af
// alle plan-sæson-id'er. Det pr.-board-specifikke sæson-vindue anvendes derefter
// i JS (`planSeasonIds`-filteret nedenfor), så resultatet pr. board er identisk
// med det den gamle query returnerede.
//
// Fejl-semantikken er bevaret 1:1: hver kilde bærer sit eget `error`-flag, og
// loadGoalContextForBoard behandler det som den gamle `monErr`/`jerErr`/… →
// null-sentinel → `awaiting_data` i evaluator, aldrig et falsk 0.
//
// Pagineret + chunket: populationen er hele menneskefeltet (242 hold 12/9), så
// både 1000-rækkers-PostgREST-loftet (#2932) og ~430-ids-URL-loftet (#3030)
// er i spil — derfor fetchAllRowsChunkedIn med stabil .order("id").

const EMPTY_SOURCE = Object.freeze({ byTeam: new Map(), error: null });

function groupRowsByTeam(rows) {
  const byTeam = new Map();
  for (const row of rows || []) {
    const key = row?.team_id;
    if (key == null) continue;
    if (!byTeam.has(key)) byTeam.set(key, []);
    byTeam.get(key).push(row);
  }
  return byTeam;
}

// Supabase-fejl i ÉN kilde må ikke vælte de øvrige: den gamle Promise.all
// destrukturerede `{ data, error }` pr. query og lod hver kilde fejle for sig.
async function loadPrefetchSource(loader) {
  try {
    return { byTeam: groupRowsByTeam(await loader()), error: null };
  } catch (error) {
    // best-effort: fejlen sluges IKKE — den bæres videre som kildens `error`-flag,
    // præcis som `{ data, error }` gjorde pr. board før prefetchen. Kaldstedet
    // (loadGoalContextForBoard) oversætter den til null-sentinel → awaiting_data,
    // og en captureException her ville sende én Sentry-hændelse for en fejl der
    // allerede rapporteres af den finaliserings-sti der ejer kørslen.
    return { byTeam: new Map(), error: { message: error?.message ?? String(error) } };
  }
}

function emptyPrefetch() {
  return {
    classicResults: EMPTY_SOURCE,
    jerseyResults: EMPTY_SOURCE,
    transferTxs: EMPTY_SOURCE,
    oneDayResults: EMPTY_SOURCE,
    sponsorTxs: EMPTY_SOURCE,
  };
}

/**
 * Henter de fem sæson-brede kilder for HELE holdpopulationen på én gang.
 *
 * @param {object}   args
 * @param {object}   args.supabase
 * @param {string[]} args.teamIds   — alle hold der skal evalueres
 * @param {string[]} args.seasonIds — UNIONEN af alle boards' planSeasonIds
 *                                    (plan-snapshots' season_id + nuværende sæson)
 * @returns {Promise<object>} kilder med { byTeam: Map<teamId, rows[]>, error }
 */
export async function prefetchGoalContextSources({ supabase, teamIds, seasonIds } = {}) {
  if (!supabase?.from) throw new Error("Supabase client is required");
  const ids = [...new Set((teamIds || []).filter((id) => id != null))];
  const seasons = [...new Set((seasonIds || []).filter((id) => id != null))];
  if (!ids.length || !seasons.length) return emptyPrefetch();

  const [classicResults, jerseyResults, transferTxs, oneDayResults, sponsorTxs] = await Promise.all([
    // Samme prædikater som den pr.-board-query den erstatter (se nedenfor).
    // #5537: race_results-læserne tager løbets trup med (senior-dommen, se headeren).
    loadPrefetchSource(() => withEmbeddedRaceSquad((races) => fetchAllRowsChunkedIn(ids, (/** @type {string[]} */ chunk) => supabase
      .from("race_results")
      .select(`team_id, rank, ${races("race_class, race_type, season_id")}`)
      .in("team_id", chunk)
      .eq("result_type", "gc")
      .lte("rank", 3)
      .in("races.race_class", CLASSIC_RACE_CLASSES)
      .in("races.season_id", seasons)
      .order("id", { ascending: true })))),
    loadPrefetchSource(() => withEmbeddedRaceSquad((races) => fetchAllRowsChunkedIn(ids, (/** @type {string[]} */ chunk) => supabase
      .from("race_results")
      .select(`team_id, rank, ${races("season_id")}`)
      .in("team_id", chunk)
      .in("result_type", ["points", "mountain", "young"])
      .eq("rank", 1)
      .in("races.season_id", seasons)
      .order("id", { ascending: true })))),
    loadPrefetchSource(() => fetchAllRowsChunkedIn(ids, (/** @type {string[]} */ chunk) => supabase
      .from("finance_transactions")
      // season_id er tilføjet i forhold til den gamle pr.-board-select: den
      // server-side `.in("season_id", planSeasonIds)` erstattes af et JS-filter
      // pr. board, og så skal kolonnen med over wire.
      .select("team_id, amount, type, season_id")
      .in("team_id", chunk)
      .in("type", ["transfer_in", "transfer_out"])
      .in("season_id", seasons)
      .order("id", { ascending: true }))),
    loadPrefetchSource(() => withEmbeddedRaceSquad((races) => fetchAllRowsChunkedIn(ids, (/** @type {string[]} */ chunk) => supabase
      .from("race_results")
      .select(`team_id, ${races("season_id")}`)
      .in("team_id", chunk)
      .eq("result_type", "gc")
      .eq("rank", 1)
      .eq("races.race_type", "single")
      .in("races.season_id", seasons)
      .order("id", { ascending: true })))),
    loadPrefetchSource(() => fetchAllRowsChunkedIn(ids, (/** @type {string[]} */ chunk) => supabase
      .from("finance_transactions")
      .select("team_id, amount, season_id")
      .in("team_id", chunk)
      .in("reason_code", SPONSOR_GROWTH_REASON_CODES)
      .in("season_id", seasons)
      .order("id", { ascending: true }))),
  ]);

  return { classicResults, jerseyResults, transferTxs, oneDayResults, sponsorTxs };
}

/**
 * Skærer et prefetch-resultat ned til ÉT hold. Resultatet er formen
 * loadGoalContextForBoard forventer i `prefetched.sources`.
 */
export function selectGoalContextSourcesForTeam(prefetch, teamId) {
  if (!prefetch) return null;
  const pick = (source) => ({
    rows: source?.byTeam?.get(teamId) ?? [],
    error: source?.error ?? null,
  });
  return {
    classicResults: pick(prefetch.classicResults),
    jerseyResults: pick(prefetch.jerseyResults),
    transferTxs: pick(prefetch.transferTxs),
    oneDayResults: pick(prefetch.oneDayResults),
    sponsorTxs: pick(prefetch.sponsorTxs),
  };
}

// Postgres-paritet for ORDER BY <col> ASC: NULL sorteres sidst.
function compareAscNullsLast(a, b) {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * JS-ækvivalent til den pr.-board board_plan_snapshots-query nedenfor:
 * `.eq("board_id", …)` er allerede anvendt af kaldstedet (rækkerne er boardets
 * egne), her anvendes `.gte("season_number", planStartSeasonNumber)` +
 * `.order("season_within_plan", { ascending: true })`.
 */
export function selectPlanCycleSnapshots(rows, planStartSeasonNumber = null) {
  const filtered = (rows || []).filter((row) => {
    if (planStartSeasonNumber == null) return true;
    // Postgres: NULL >= n er NULL → rækken falder ud af filteret.
    if (row?.season_number == null) return false;
    return row.season_number >= planStartSeasonNumber;
  });
  return [...filtered].sort((a, b) =>
    compareAscNullsLast(a?.season_within_plan, b?.season_within_plan));
}

/**
 * @param {object} [args.prefetched] — #5182. Valgfri prefetch:
 *   { snapshots: board_plan_snapshots-rækker for DETTE board (ufiltrerede),
 *     sources: selectGoalContextSourcesForTeam(...) for DETTE hold }.
 *   Udelades den (eller en af de to nøgler), læses præcis som før fra DB —
 *   adfærden er uændret for alle eksisterende kaldssteder.
 */
export async function loadGoalContextForBoard({
  supabase,
  teamId,
  boardId,
  currentSeasonId,
  division = null,
  leagueDivisionId = null,
  standings = null,
  planStartSeasonNumber = null,
  prefetched = null,
}) {
  // Plan-season-ids: alle tidligere snapshots i denne plan + nuværende sæson.
  // (Nuværende sæson har endnu ikke et snapshot på dette tidspunkt — den
  // tilføjes efter evaluateBoardSeason.)
  //
  // #54 · Afgræns til den AKTUELLE plan-cyklus. board_plan_snapshots akkumulerer
  // under samme board_id på tværs af cyklusser: ved plan-fornyelse genbruges
  // board-rowet (seasons_completed nulstilles, plan_start_season_number rykker
  // frem), så season_within_plan kolliderer mellem cyklusser. Uden cyklus-filter
  // ville cumulative monument/jersey/transfer + u25-baselinen spænde over hele
  // boardets historik (gamle planer). Læse-stien i /board/status filtrerer
  // allerede sådan (season_number >= plan_start_season_number, api.js:6196).
  // season_number indgår ikke i select'en — .gte() filtrerer server-side på
  // kolonnen uanset om den returneres, og vi bruger den ikke i resultatet.
  //
  // #5182 · Er rækkerne allerede hentet af kaldstedet (ét opslag for hele
  // holdpopulationen i stedet for ét pr. board), anvendes cyklus-filteret +
  // sorteringen i JS i stedet — samme prædikat, samme rækkefølge.
  let prevSnapshots;
  if (prefetched?.snapshots) {
    prevSnapshots = selectPlanCycleSnapshots(prefetched.snapshots, planStartSeasonNumber);
  } else {
    let snapshotQuery = supabase
      .from("board_plan_snapshots")
      .select("season_id, u25_stat_sum, u25_count, season_within_plan")
      .eq("board_id", boardId);
    if (planStartSeasonNumber != null) {
      snapshotQuery = snapshotQuery.gte("season_number", planStartSeasonNumber);
    }
    ({ data: prevSnapshots } = await snapshotQuery
      .order("season_within_plan", { ascending: true }));
  }

  const planSeasonIds = [
    ...((prevSnapshots || []).map((s) => s.season_id).filter(Boolean)),
    currentSeasonId,
  ].filter(Boolean);

  // Plan-start U25 baseline fra første snapshot. Hvis ingen tidligere snapshots
  // (= dette er første sæson i planen), returner null så u25_development_delta
  // returnerer awaiting_data — målet evaluerer først fra sæson 2 i planen.
  const firstSnapshot = (prevSnapshots || [])[0] || null;
  const planStartU25StatSum = firstSnapshot?.u25_stat_sum ?? null;
  const planStartU25Count = firstSnapshot?.u25_count ?? null;

  // Defaults — null betyder "missing data" så evaluator returnerer awaiting_data
  let cumulativeMonumentPodiums = null;
  let cumulativeClassicPodiums = null;
  let cumulativeJerseyWins = null;
  let seasonJerseyWins = null;
  let cumulativeTransferBalance = null;
  // #4034 · endagssejre (race_type='single', vindes som en 'gc'-række på etape 1,
  // samme model som riderPalmares.js' oneDayWins-skel #1997) — se query nedenfor.
  let cumulativeOneDayWins = null;
  let seasonOneDayWins = null;
  // #3494 · sponsor_growth-kontekst. null = "kunne ikke måles" (query-fejl),
  // så evaluator returnerer awaiting_data i stedet for at regne på et forkert
  // tal. sponsorGrowthBaselineIncome læses fra PLANENS FØRSTE (allerede
  // afsluttede) sæson via firstSnapshot herunder — findes ingen tidligere
  // snapshot (plan-sæson 1) forbliver den null: samme "evaluerer først fra
  // sæson 2"-princip som u25_development_delta ovenfor.
  let sponsorGrowthCurrentIncome = null;
  let sponsorGrowthBaselineIncome = null;

  if (planSeasonIds.length > 0) {
    // #2444 · de fem queries herunder er uafhængige af hinanden (samme input:
    // teamId + planSeasonIds) og kørte tidligere sekventielt (3 round-trips
    // efter hinanden pr. plan-type, ×3 plan-typer i /board/status-loopet).
    // Promise.all parallelliserer dem til én round-trip-bredde.
    //
    // #5182 · …og er kilderne allerede hentet for hele holdpopulationen
    // (prefetchGoalContextSources), springes hele runden over: det eneste
    // pr.-board-specifikke prædikat er sæson-vinduet, som anvendes i JS her.
    let classicResults; let monErr;
    let jerseyResults; let jerErr;
    let transferTxs; let trxErr;
    let oneDayResults; let odErr;
    let sponsorTxs; let sponsorErr;

    if (prefetched?.sources) {
      const planSeasonIdSet = new Set(planSeasonIds);
      const inPlanWindow = (source, getSeasonId) => [
        (source?.rows || []).filter((row) => planSeasonIdSet.has(getSeasonId(row))),
        source?.error ?? null,
      ];
      const raceSeasonId = (row) => row?.races?.season_id;
      const ownSeasonId = (row) => row?.season_id;
      [classicResults, monErr] = inPlanWindow(prefetched.sources.classicResults, raceSeasonId);
      [jerseyResults, jerErr] = inPlanWindow(prefetched.sources.jerseyResults, raceSeasonId);
      [transferTxs, trxErr] = inPlanWindow(prefetched.sources.transferTxs, ownSeasonId);
      [oneDayResults, odErr] = inPlanWindow(prefetched.sources.oneDayResults, raceSeasonId);
      [sponsorTxs, sponsorErr] = inPlanWindow(prefetched.sources.sponsorTxs, ownSeasonId);
    } else {
      [
        { data: classicResults, error: monErr },
        { data: jerseyResults, error: jerErr },
        { data: transferTxs, error: trxErr },
        { data: oneDayResults, error: odErr },
        { data: sponsorTxs, error: sponsorErr },
      ] = await Promise.all([
      // Podie-placeringer (rank 1-3 i GC) i klassiker-kategorien. #1238: én query
      // over den kanoniske klasse-liste; Monuments-delmængden + den fulde
      // klassiker-optælling (kun endagsløb) splittes i JS via de delte helpers.
      // pagination-safe: one team's rank<=3 GC results, further narrowed to
      // classic-only races within the plan's season window — verified max 54
      // rows per team repo-wide even WITHOUT the race_class/season narrowing
      // (#3331 audit, 2026-08-05), far under the 1000-row cap.
      // #5537: løbets trup med i det indlejrede select (senior-dommen, se headeren).
      withEmbeddedRaceSquad((races) => supabase
        .from("race_results")
        .select(`rank, ${races("race_class, race_type, season_id")}`)
        .eq("team_id", teamId)
        .eq("result_type", "gc")
        .lte("rank", 3)
        .in("races.race_class", CLASSIC_RACE_CLASSES)
        .in("races.season_id", planSeasonIds)),
      // Etapeløb-trøjer (point/bjerg/young, rank=1)
      // pagination-safe: one team's rank=1 jersey wins, further narrowed to
      // the plan's season window — verified max 23 rows per team repo-wide
      // even WITHOUT the season narrowing (#3331 audit, 2026-08-05).
      withEmbeddedRaceSquad((races) => supabase
        .from("race_results")
        .select(`rank, ${races("season_id")}`)
        .eq("team_id", teamId)
        .in("result_type", ["points", "mountain", "young"])
        .eq("rank", 1)
        .in("races.season_id", planSeasonIds)),
      // Netto transfer-balance (positive = transfer_in/salg, negative = transfer_out/køb)
      // pagination-safe: one team's transfer-only transactions, narrowed to
      // the plan's season window — verified max 114 rows per team repo-wide
      // even WITHOUT the season narrowing (#3331 audit, 2026-08-05).
      supabase
        .from("finance_transactions")
        .select("amount, type")
        .eq("team_id", teamId)
        .in("type", ["transfer_in", "transfer_out"])
        .in("season_id", planSeasonIds),
      // #4034 · Endagssejre — separat fra classicResults ovenfor, som kun dækker
      // CLASSIC_RACE_CLASSES. En endagssejr skal tælle med i stage_wins-målet
      // uanset race_class (spiller-rapport 20/8: registreres i dag som en
      // gc-sejr, ikke en etapesejr, så målet aldrig opfyldes). result_type='gc'
      // + race_type='single' er samme skel som riderPalmares.js' oneDayWins.
      // pagination-safe: one team's rank=1 GC results on single-day races,
      // narrowed to the plan's season window — a season has ~28 race days, so
      // wins per team are bounded far under the 1000-row cap (same bound class
      // as the rank<=3 classic query above, #3331 audit).
      withEmbeddedRaceSquad((races) => supabase
        .from("race_results")
        .select(races("season_id"))
        .eq("team_id", teamId)
        .eq("result_type", "gc")
        .eq("rank", 1)
        .eq("races.race_type", "single")
        .in("races.season_id", planSeasonIds)),
      // #3494 · Sponsor-udbetalinger (kontrakt-base + løbsdags-indtægt, se
      // SPONSOR_GROWTH_REASON_CODES) for hele plan-cyklussens sæson-vindue.
      // Summeres pr. sæson i JS herunder — nuværende sæson = "actual",
      // planens FØRSTE (afsluttede) sæson = baseline.
      // pagination-safe: bounded by season count in the plan window (max 5),
      // ~3-4 payout rows/season/team (base + prorata + per-race-day-batches),
      // far under the 1000-row cap (same reasoning as the other queries above).
      supabase
        .from("finance_transactions")
        .select("amount, season_id")
        .eq("team_id", teamId)
        .in("reason_code", SPONSOR_GROWTH_REASON_CODES)
        .in("season_id", planSeasonIds),
      ]);
    }
    // #5537: senior-dommen på de tre race_results-kilder, ÉT sted efter begge
    // læse-stier (prefetch + pr. board), så de to stier ikke kan blive uenige.
    // finance_transactions-kilderne har ingen løbs-trup og røres ikke
    // (løbsdags-sponsoren er selv senior-only fra sponsorRaceDayIncome, #5537).
    classicResults = onlySeniorRaceRows(classicResults);
    jerseyResults = onlySeniorRaceRows(jerseyResults);
    oneDayResults = onlySeniorRaceRows(oneDayResults);
    // #3494 (CodeRabbit-fund, PR #4550) · `sponsorTxs || []` ville stille sig
    // tavst tilfreds med et malformet svar (error faldsk, data IKKE et array —
    // teoretisk uden for den ægte Supabase-klient, men denne funktion kaldes
    // fra economyEngine.processTeamSeasonEnd's PER-HOLD-loop, som har NUL
    // try/catch pr. hold (dokumenteret economyEngine.js:2724-2749: en kastet
    // fejl for ÉT hold afbryder resten af sæson-slut-batchen for ALLE
    // resterende hold). Vi kaster derfor IKKE her — i stedet behandles et
    // ikke-array-svar som en query-fejl: sponsorGrowthCurrentIncome/
    // BaselineIncome forbliver `null` (samme "ukendt, ikke nul"-sentinel som
    // enhver anden fejl i denne funktion), så evaluator returnerer
    // awaiting_data i stedet for at regne en falsk -100 %-vækst ud fra et
    // stiltiende 0 for indeværende sæson.
    if (!sponsorErr && Array.isArray(sponsorTxs)) {
      const sponsorBySeasonId = new Map();
      for (const row of sponsorTxs) {
        const key = row.season_id;
        sponsorBySeasonId.set(key, (sponsorBySeasonId.get(key) || 0) + Number(row.amount || 0));
      }
      sponsorGrowthCurrentIncome = sponsorBySeasonId.get(currentSeasonId) ?? 0;
      const baselineSeasonId = firstSnapshot?.season_id ?? null;
      sponsorGrowthBaselineIncome = baselineSeasonId != null
        ? (sponsorBySeasonId.get(baselineSeasonId) ?? 0)
        : null;
    }
    if (!monErr) {
      const podiumRows = classicResults || [];
      cumulativeMonumentPodiums = podiumRows.filter((row) => isMonumentRace(row.races)).length;
      cumulativeClassicPodiums = podiumRows.filter((row) => isClassicRace(row.races)).length;
    }
    if (!jerErr) {
      cumulativeJerseyWins = (jerseyResults || []).length;
      seasonJerseyWins = (jerseyResults || [])
        .filter((r) => r.races?.season_id === currentSeasonId)
        .length;
    }
    if (!trxErr) {
      cumulativeTransferBalance = (transferTxs || [])
        .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    }
    if (!odErr) {
      cumulativeOneDayWins = (oneDayResults || []).length;
      seasonOneDayWins = (oneDayResults || [])
        .filter((r) => r.races?.season_id === currentSeasonId)
        .length;
    }
  }

  // Antal humane managers i samme PULJE (#1608). Efter form-frysen er
  // rank_in_division pulje-rang (updateStandings ranger pr. league_division_id),
  // så relative_rank-målet ("slå N managere") skal måles mod managere i SAMME
  // pulje — ikke hele tier'en. Når leagueDivisionId er sat tælles pr. pulje;
  // ellers (pre-pulje-DB'er / kald uden pulje) falder vi tilbage til den gamle
  // tier-brede tælling, så eksisterende sæsoner bevarer adfærd.
  // Fra pre-loaded standings hvis muligt (sparer en query), ellers løs fra DB.
  // #2308 · divisionTeamCount = FULD pulje/division-størrelse (inkl. AI), matcher
  // rank_in_division (som også rangerer inkl. AI). Bruges af
  // computeResultsCompetitivenessFloor (boardEvaluation.js) til at normalisere
  // gulvet mod samme population som placeringen selv blev udregnet mod — ellers
  // normaliserer gulvet fejlagtigt mod den (mindre) human-only-tælling
  // (divisionManagerCount) og inflaterer competitiveness.
  let divisionManagerCount = null;
  let divisionTeamCount = null;
  const usePool = leagueDivisionId != null;
  if (Array.isArray(standings) && (usePool || division != null)) {
    const poolStandings = standings.filter((s) =>
      usePool ? s.league_division_id === leagueDivisionId : s.division === division
    );
    divisionTeamCount = poolStandings.length;
    divisionManagerCount = poolStandings.filter((s) => s.team && !s.team.is_ai).length;
  } else if (usePool) {
    const { data: poolStandings, error: poolErr } = await supabase
      .from("season_standings")
      .select("team:team_id(is_ai)")
      .eq("season_id", currentSeasonId)
      .eq("league_division_id", leagueDivisionId);
    if (!poolErr) {
      divisionTeamCount = (poolStandings || []).length;
      divisionManagerCount = (poolStandings || [])
        .filter((s) => s.team && !s.team.is_ai)
        .length;
    }
  } else if (division != null) {
    const { data: divisionStandings, error: divErr } = await supabase
      .from("season_standings")
      .select("team:team_id(is_ai)")
      .eq("season_id", currentSeasonId)
      .eq("division", division);
    if (!divErr) {
      divisionTeamCount = (divisionStandings || []).length;
      divisionManagerCount = (divisionStandings || [])
        .filter((s) => s.team && !s.team.is_ai)
        .length;
    }
  }

  return {
    planStartU25StatSum,
    planStartU25Count,
    cumulativeMonumentPodiums,
    cumulativeClassicPodiums,
    cumulativeJerseyWins,
    seasonJerseyWins,
    cumulativeTransferBalance,
    cumulativeOneDayWins,
    seasonOneDayWins,
    divisionManagerCount,
    divisionTeamCount,
    sponsorGrowthCurrentIncome,
    sponsorGrowthBaselineIncome,
  };
}
