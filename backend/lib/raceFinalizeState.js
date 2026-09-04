// #4147 — trin-markering for løbs-afslutningen (Vej B: genoptagelig tilstandsmaskine).
//
// PROBLEMET (målt 23/8, deployment e230f2c3): afslutningen af en etape er en KÆDE af
// skrivninger, ikke én handling. Dræbes processen midtvejs (SIGTERM ved deploy, OOM,
// Railway-vedligehold, statement timeout) er de trin der nåede at køre committet, og de
// resterende sker aldrig. Ingen ved det: løbet ser bare mærkeligt ud. Prod-målingen 4/9
// fandt 34 etaper (S1: 29, S2: 4, S3: 1) med skrevne `race_results` men INGEN
// `race_simulation_runs`-række og 0 `race_incidents` — enrichment-trinnet nåede aldrig at
// køre, og fordi `stages_completed` allerede var bumpet af den atomære apply_stage_result-
// RPC, kunne etapen aldrig genoptages. Berigelsen er permanent tabt for de etaper.
//
// HVORFOR IKKE VEJ A (én transaktion): trinnene er ikke alle SQL. `notify` sender til
// Discord og in-app, `matview` er 4 REFRESH MATERIALIZED VIEW (minutter, tager egne
// låse), og hele kæden tager 90-110 s målt. Én transaktion om det ville holde låse på
// race_results/season_standings i det tidsrum og alligevel ikke kunne rulle en afsendt
// Discord-besked tilbage. Vej B gør i stedet HVERT trin genoptageligt.
//
// KONTRAKTEN: `races.finalize_state` (jsonb) bærer hvilke trin der er FÆRDIGE for
// PRÆCIS ÉN etape ad gangen, og `races.finalize_updated_at` hvornår markeringen sidst
// blev flyttet. Er markeringen NULL, er der ingen igangværende afslutning — det er den
// eneste tilstand et sundt løb hviler i (både før første etape og efter sidste).
//
//   { "stage_index": 4, "stage_number": 5, "final": true,
//     "started_at": "2026-09-04T18:00:00.000Z",
//     "done": ["write", "standings", "matview"] }
//
// TO SLAGS TRIN — forskellen afgør HVORNÅR markeringen skrives:
//   • IDEMPOTENTE trin (write/standings/matview/enrichment/board/status-flush) skriver
//     markeringen EFTER succes. Fejler trinnet, står markeringen ikke, og næste tick
//     kører det igen. Gentagelse er harmløs (delete-then-insert, re-derivation, upsert).
//   • ENGANGS-trin (fatigue/rest-day/notify) skriver markeringen efter FORSØGET, uanset
//     udfald. De akkumulerer (fatigue += belastning) eller sender udadtil (Discord/in-app):
//     en gentagelse er VÆRRE end en manglende. Derfor: præcis ét forsøg, aldrig to.
//
// Det er dét der gør genoptagelsen sikker for præmier. Præmieudbetalingen selv ligger
// uden for denne kæde (autoPrizeSweep → prizePayoutEngine) og er dobbelt-beskyttet i
// forvejen: `races.prize_paid_at`-CAS'en (#1573) og `uniq_finance_idempotency_key` på
// `race_prize:<race>:<team>` (#WS1). Et genoptaget løb kan altså ikke udbetale to gange
// — det bliver blot berettiget til den ENE udbetaling det manglede.

/** Trinnene i afslutningen, i den rækkefølge simulateStageByIndex kører dem. */
export const FINALIZE_STEPS = Object.freeze([
  "write", // apply_stage_result-RPC (atomær: counter-bump + race_results)
  "standings", // ensureSeasonStandings + updateStandings (fuld re-derivation)
  "matview", // refreshRankingMatviewsSafe (kun final-etape)
  "enrichment", // persistRuns/passages/incidents/withdrawals/moments/timelines/career-firsts
  "fatigue", // applyRaceFatigue (AKKUMULERER — engangs-trin)
  "rest-day", // applyGrandTourRestDayFatigue (AKKUMULERER — engangs-trin)
  "board", // recomputeSeasonRaceDays + processBoardWeekend (kun final-etape)
  "notify", // Discord-embed + in-app (SENDER UDAD — engangs-trin)
  "status-flush", // status='completed' + deferred transfers/akademi-flush (kun final)
]);

/**
 * Trin hvis markering skrives efter FORSØGET (ikke efter succes), fordi en gentagelse
 * gør skade: fatigue/rest-day akkumulerer på rider_condition, notify sender udad.
 */
export const ATTEMPT_ONCE_STEPS = Object.freeze(new Set(["fatigue", "rest-day", "notify"]));

export function isAttemptOnceStep(step) {
  return ATTEMPT_ONCE_STEPS.has(step);
}

/**
 * PUR: normalisér en rå `finalize_state`-værdi fra DB til den form resten af koden
 * regner med — eller null hvis den ikke gælder den etape vi er ved at køre.
 *
 * Gælder markeringen en ANDEN etape end den vi står med, er den forældet (etapen den
 * beskrev blev færdig, eller et løb er blevet nulstillet). Vi returnerer null frem for
 * at genbruge den: at springe trin over på grundlag af en anden etapes markering ville
 * være præcis den slags stille datafejl denne fil findes for at forhindre.
 *
 * @param {unknown} raw - races.finalize_state som læst fra DB
 * @param {{ stageNumber: number }} ctx
 * @returns {{ stage_index: number, stage_number: number, final: boolean, started_at: string|null, done: string[] }|null}
 */
export function normalizeFinalizeState(raw, { stageNumber } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const stateStage = Number(raw.stage_number);
  if (!Number.isFinite(stateStage)) return null;
  if (Number.isFinite(Number(stageNumber)) && stateStage !== Number(stageNumber)) return null;
  const done = Array.isArray(raw.done) ? raw.done.filter((s) => FINALIZE_STEPS.includes(s)) : [];
  return {
    stage_index: Number.isFinite(Number(raw.stage_index)) ? Number(raw.stage_index) : stateStage - 1,
    stage_number: stateStage,
    final: raw.final === true,
    started_at: typeof raw.started_at === "string" ? raw.started_at : null,
    done,
  };
}

/**
 * PUR: hvilke trin mangler stadig, givet en markering og de trin denne etape overhovedet
 * har? (mellem-etaper kører fx hverken matview, board eller status-flush).
 */
export function remainingSteps(state, applicableSteps = FINALIZE_STEPS) {
  const done = new Set(state?.done ?? []);
  return applicableSteps.filter((s) => !done.has(s));
}

/**
 * PUR: er afslutningen af denne etape færdig? (alle relevante trin markeret)
 */
export function isFinalizeComplete(state, applicableSteps = FINALIZE_STEPS) {
  return remainingSteps(state, applicableSteps).length === 0;
}

/**
 * PUR: hvilke trin gælder for denne etape? Mellem-etaper afslutter ikke løbet — de
 * rører hverken matview, board eller status-flush. `rest-day` gælder kun når der
 * FAKTISK er et game_day-hul til næste etape (ellers ville markeringen love et trin
 * der aldrig kører, og løbet ville se ufuldstændigt ud for vagten for evigt).
 */
export function applicableSteps({ isFinalStage, hasRestDay = false } = {}) {
  return FINALIZE_STEPS.filter((s) => {
    if (s === "rest-day") return hasRestDay === true;
    if (s === "matview" || s === "board" || s === "status-flush") return isFinalStage === true;
    return true;
  });
}

/**
 * PUR: byg den jsonb-værdi der skrives til races.finalize_state.
 */
export function buildFinalizeState({ stageIndex, stageNumber, isFinalStage, startedAt, done = [] }) {
  return {
    stage_index: stageIndex,
    stage_number: stageNumber,
    final: isFinalStage === true,
    started_at: startedAt ?? null,
    done: FINALIZE_STEPS.filter((s) => done.includes(s)), // stabil rækkefølge
  };
}

/**
 * I/O: læs et løbs markering. Egen lille forespørgsel frem for at kræve kolonnen i
 * hvert eneste kalder-select (adminSimulateRace, admin-routes, tests) — så kan
 * markeringen ikke stille forsvinde fordi ét call-site glemte kolonnen.
 *
 * Fejler læsningen (fx kolonnen findes endnu ikke fordi migrationen ikke er kørt),
 * returnerer vi null: afslutningen fortsætter uden markering, præcis som med flaget OFF.
 * En vagt-mekanik må aldrig kunne vælte selve afviklingen.
 */
export async function readFinalizeState(supabase, raceId) {
  try {
    const { data, error } = await supabase
      .from("races")
      .select("finalize_state, finalize_updated_at")
      .eq("id", raceId)
      .maybeSingle();
    if (error) return null;
    return data ?? null;
  } catch {
    return null;
  }
}

/**
 * I/O: skriv markeringen. `state === null` rydder den (afslutningen er færdig).
 * Returnerer true/false, kaster aldrig — samme begrundelse som readFinalizeState.
 */
export async function writeFinalizeState(supabase, raceId, state, { now = new Date() } = {}) {
  try {
    const { error } = await supabase
      .from("races")
      .update({
        finalize_state: state,
        finalize_updated_at: state ? now.toISOString() : null,
      })
      .eq("id", raceId);
    return !error;
  } catch {
    return false;
  }
}
