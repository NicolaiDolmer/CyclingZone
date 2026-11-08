// backend/lib/dayFormVisibility7725.js
//
// #7725 (ejer 8/11): dagsformen er privat. Klienten faar kun `day_word` og `bad_day`
// for den indloggede managers egne ryttere. Motoren og den gemte tidslinje er uroerte;
// filteret sidder alene paa det der sendes ud (GET /api/races/:raceId/timeline), saa
// alt der laeser svaret (referat, film, Hvorfor?-knappen) er daekket af det samme sted.

import { captureException } from "./sentry.js";

const DAY_FORM_TYPES = new Set(["day_word", "bad_day"]);

const isDayForm = (event) => DAY_FORM_TYPES.has(event?.type);

/** Fjerner dagsform-haendelser for ryttere uden for `ownRiderIds`. Alt andet er uroert. */
export function withOwnDayFormOnly(events, ownRiderIds) {
  if (!Array.isArray(events)) return events;
  return events.filter((event) => !isDayForm(event) || ownRiderIds.has(event.params?.rider_id));
}

/** Holdets ryttere i dette loeb: startlisten plus etapens resultat, som referatets "dine egne". */
async function loadOwnRiderIds(supabase, { raceId, stageNumber, teamId }) {
  const [entries, results] = await Promise.all([
    supabase.from("race_entries").select("rider_id").eq("race_id", raceId).eq("team_id", teamId),
    supabase.from("race_results").select("rider_id").eq("race_id", raceId).eq("team_id", teamId)
      .eq("stage_number", stageNumber).eq("result_type", "stage"),
  ]);
  const failed = entries.error ?? results.error;
  if (failed) throw new Error(`day_form_visibility: ${failed.message}`);
  return new Set([...(entries.data ?? []), ...(results.data ?? [])].map((row) => row.rider_id).filter(Boolean));
}

/**
 * Tidslinjens haendelser som denne seer maa faa dem. Ingen hold = ingen dagsform.
 * Fejler opslaget, sendes ingen dagsform: filmen virker stadig, og intet slipper ud.
 */
export async function ownDayFormEvents(supabase, { events, raceId, stageNumber, teamId }) {
  // Etaper uden dagsform koster intet opslag.
  if (!Array.isArray(events) || !events.some(isDayForm)) return events;
  if (!teamId) return withOwnDayFormOnly(events, new Set());
  try {
    return withOwnDayFormOnly(events, await loadOwnRiderIds(supabase, { raceId, stageNumber, teamId }));
  } catch (err) {
    captureException(err);
    return withOwnDayFormOnly(events, new Set());
  }
}
