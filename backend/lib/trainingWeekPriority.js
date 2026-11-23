// #8549 PR 2 · Week blocks i motoren: prioritet pr. felt og ét låst pas pr. dag.
// Design: docs/audits/undersoegelse-docs-8549-prioritet-laast-pas-design.md §5.2-5.3.
// Dommer-scenarier: docs/audits/7456-program-dommer-scenarier.md §2 (WB-1..10), OLD-1, OFF-1/2.
//
// Reglen er en OMDIRIGERING af kildefeltet, ikke en ny træningssti:
//   kildefelt = assignDayFields(...).fieldSource[feltet]   (kun for frie felter)
//   resolveDayProgram({ slotIndex: kildefelt })            session + indsats følger passet
//   applyFatigueRules({ slotIndex: feltet })               tidspunktet er stadig det rigtige felt
// Kontakten off, plan_kind ≠ 'week' (NULL = gammel plan, 'rotation' = #8548), eller ingen
// vindende dag-række: kildefeltet = feltet (dagens kald, bit-identisk).
//
// RENE funktioner + kontaktens opslag. Motoren (dailyTrainingEngine.js) og prognosen
// (trainingWeekPlanForecast.js) bruger de samme (I5).
import { assignDayFields } from "./trainingWeekBlocks.js";
import { programSlotForRaceDay, sessionForDayEntry } from "./trainingPrograms.js";
import { isValidIntensity } from "./training.js";
import { readFlagStage } from "./featureStage.js";
import { loadRaceExitGameDays, dropBindingsAfterRaceExit } from "./trainingRaceDayTick.js";

export const TRAINING_WEEK_PRIORITY_FLAG_KEY = "training_week_priority";

// The optional rule defaults to off when app_config cannot be read.
export async function isTrainingWeekPriorityEnabledForTeam(supabase, teamId) {
  const stage = await readFlagStage(supabase, TRAINING_WEEK_PRIORITY_FLAG_KEY, { fresh: true });
  if (stage === true || stage === "on") return true;
  if (stage !== "beta") return false;
  const { data: team, error: teamError } = await supabase
    .from("teams").select("user_id").eq("id", teamId).maybeSingle();
  if (teamError) throw new Error(`training_week_priority owner load (team ${teamId}): ${teamError.message ?? teamError}`);
  if (!team?.user_id) return false;
  const { data: user, error: userError } = await supabase
    .from("users").select("role, is_beta_tester").eq("id", team.user_id).maybeSingle();
  if (userError) throw new Error(`training_week_priority owner beta load (team ${teamId}): ${userError.message ?? userError}`);
  return user?.role === "admin" || user?.is_beta_tester === true;
}

const dayHasSessions = (entry) => {
  if (!entry || typeof entry !== "object") return false;
  for (let slot = 0; slot < 5; slot += 1) if (sessionForDayEntry(entry, slot)) return true;
  return false;
};

/**
 * Hvilken dag-række der vinder, med samme lag som resolveDayProgram (#2438, TR §4):
 * rytterens egen række med pas > rytterens eksplicitte plan (ingen række) > holdets række.
 * Låsen, rækkefølgen og plan_kind læses fra den vindende række (design §5.2).
 * @returns {{ entry: object, planKind: string | null } | null}
 */
export function winningWeekEntry({ weekday, riderRow = null, teamRow = null, hasExplicitPlan = false }) {
  const riderEntry = riderRow?.days?.[weekday];
  if (dayHasSessions(riderEntry)) return { entry: riderEntry, planKind: riderRow?.plan_kind ?? null };
  // En gammel række med kun intensitet vinder som i resolveDayProgram (ingen celler at flytte).
  if (isValidIntensity(riderEntry?.intensity)) return null;
  if (hasExplicitPlan) return null;
  const teamEntry = teamRow?.days?.[weekday];
  if (dayHasSessions(teamEntry)) return { entry: teamEntry, planKind: teamRow?.plan_kind ?? null };
  return null;
}

/**
 * Feltplaceringen for datoen under Week blocks.
 *   raceGameDays  : datoens løbsdage, hvor rytteren kører (afregnede løb + planlagte etaper).
 *   priorReports  : datoens allerede afregnede kvitteringer for rytteren ({ game_day, report }).
 *                   Et felt med `source_slot` ligger fast med den kilde. Et ældre felt uden
 *                   stempel ligger fast med sin egen plads, og et løbsfelt med null (WB-6, WB-8).
 */
export function weekPriorityPlacement({ winning, dateDays, raceGameDays = [], priorReports = [] }) {
  if (winning?.planKind !== "week") return null;
  const days = [...new Set((dateDays ?? []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  if (days.length !== 5) return null;
  const slotOf = (gameDay) => programSlotForRaceDay(gameDay, days);
  const raceFields = new Set([...raceGameDays].map(Number).filter((d) => days.includes(d)).map(slotOf));
  const settled = new Map();
  for (const prior of priorReports) {
    const day = Number(prior.game_day);
    if (!days.includes(day)) continue;
    const field = slotOf(day);
    const report = prior.report ?? {};
    const raced = raceFields.has(field) || report.race_day === true
      || report.intensity === "race" || report.intensity === "unknown_pending";
    const stamped = Number.isInteger(report.source_slot) ? report.source_slot : null;
    // An injury without a training source must not change the placement of later fields.
    if (!raced && stamped == null && report.injured === true) continue;
    // Et felt, træthedsgrænsen erstattede, er afregnet MED sin kilde (WB-7-kontrakten, #8578).
    settled.set(field, raced ? null : (stamped ?? field));
  }
  return assignDayFields({ entry: winning.entry, raceFields, settled });
}

export function weekPrioritySourceSlot({ programSlot, ...input }) {
  const placement = weekPriorityPlacement(input);
  return placement
    ? { sourceSlot: placement.fieldSource[programSlot] ?? null, applied: true }
    : { sourceSlot: programSlot, applied: false };
}

/**
 * I/O (motorens læsefase, kun med kontakten on): datoens PLANLAGTE etaper pr. rytter.
 * Bindingen (race_entry_days) ∩ etapeplanen (race_stage_schedule) på datoens løbsdage, med
 * udgang af løb (#5949) som motorens binding. Afregnede løb kommer fra canonicalLoadRows.
 * Returnerer et almindeligt objekt { riderId: [game_day] }, så input kan gemmes (Træn nu).
 */
export async function loadPlannedStageDaysByRider({ supabase, seasonId, riderIds, dateDays }) {
  if (!riderIds?.length || !dateDays?.length) return {};
  // pagination-safe: one roster x five race days, UNIQUE (rider_id, season_id, game_day).
  const { data: entries, error } = await supabase.from("race_entry_days")
    .select("rider_id, race_id, game_day").eq("season_id", seasonId).in("game_day", dateDays).in("rider_id", riderIds);
  if (error) throw new Error(`week priority bindings: ${error.message ?? error}`);
  const raceIds = [...new Set((entries ?? []).map((row) => row.race_id).filter(Boolean))];
  if (!raceIds.length) return {};
  const [{ data: schedule, error: scheduleError }, exitsResult] = await Promise.all([
    // pagination-safe: a few bound races x five race days.
    supabase.from("race_stage_schedule").select("race_id, game_day").in("race_id", raceIds).in("game_day", dateDays),
    loadRaceExitGameDays({ supabase, rows: entries ?? [] }),
  ]);
  if (scheduleError) throw new Error(`week priority schedule: ${scheduleError.message ?? scheduleError}`);
  if (exitsResult?.error) throw new Error(`week priority race exits: ${exitsResult.error.message ?? exitsResult.error}`);
  const active = dropBindingsAfterRaceExit(entries ?? [], exitsResult?.data ?? new Map());
  const stageDays = new Set((schedule ?? []).map((row) => `${row.race_id}:${Number(row.game_day)}`));
  const out = {};
  for (const row of active) {
    if (!stageDays.has(`${row.race_id}:${Number(row.game_day)}`)) continue;
    (out[row.rider_id] ??= []).push(Number(row.game_day));
  }
  return out;
}
