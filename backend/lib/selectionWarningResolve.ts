// backend/lib/selectionWarningResolve.ts
// #7508 — "Holdudtagelse mangler" (selection_warning) blev staaende ulaest i
// indbakken ("Skal handles"), ogsaa efter at holdet havde faaet ryttere i
// loebet (manageren udtog selv, eller assistenten gjorde). Ejerbeslutning
// 2/11 (#7495): naar holdet har ryttere i loebet, markeres den gamle advarsel
// for NETOP det loeb som laest. Beskeden slettes ikke og faar ingen ny tekst.
//
// Delt af de to skrivestier der goer holdet "udtaget":
//   - assistentens udfyldning (assistantFilledSquadNotification.js)
//   - managerens PUT /races/:raceId/selection (routes/api.js)
//
// En enkelt UPDATE med fuldt filter (type + user_id + related_id + ulaest) er
// pagination-sikker: PostgREST begraenser kun SELECT-sider, en UPDATE rammer alle
// matchende raekker. Best-effort: den faktiske udtagelse er allerede lykkedes,
// saa en fejl her maa ALDRIG kunne vaelte den; kun capture'es, kaster aldrig.
import { captureException } from "./sentry.js";

export const SELECTION_WARNING_NOTIFICATION_TYPE = "selection_warning";

type Db = any; // Supabase-klienten er utypet i kernen; `any` ved graensen.

export type ResolveSelectionWarningResult = { ok: boolean; reason?: string };

/**
 * Markér managerens ulaeste selection_warning for et loeb som laest.
 * Kaster aldrig.
 */
export async function resolveSelectionWarnings(
  { supabase, userId, raceId }: { supabase: Db; userId?: string | null; raceId?: string | null },
): Promise<ResolveSelectionWarningResult> {
  if (!userId || !raceId) return { ok: false, reason: "missing_target" };
  try {
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("type", SELECTION_WARNING_NOTIFICATION_TYPE)
      .eq("user_id", userId)
      .eq("related_id", raceId)
      .eq("is_read", false);
    if (error) {
      captureException(new Error(`selection_warning resolve failed: ${error.message}`));
      return { ok: false, reason: "update_failed" };
    }
    return { ok: true };
  } catch (err) {
    captureException(err);
    return { ok: false, reason: "exception" };
  }
}

/**
 * Samme, men fra et hold-id (assistentens vej kender kun teamId). Slaar
 * ejeren op i teams.user_id; hold uden bruger (AI/bank) har ingen advarsel.
 * Kaster aldrig.
 */
export async function resolveSelectionWarningsForTeam(
  { supabase, teamId, raceId }: { supabase: Db; teamId?: string | null; raceId?: string | null },
): Promise<ResolveSelectionWarningResult> {
  if (!teamId || !raceId) return { ok: false, reason: "missing_target" };
  try {
    const { data: team, error } = await supabase
      .from("teams")
      .select("user_id")
      .eq("id", teamId)
      .maybeSingle();
    if (error) {
      captureException(new Error(`selection_warning owner lookup failed: ${error.message}`));
      return { ok: false, reason: "lookup_failed" };
    }
    if (!team?.user_id) return { ok: false, reason: "no_owner" };
    return await resolveSelectionWarnings({ supabase, userId: team.user_id, raceId });
  } catch (err) {
    captureException(err);
    return { ok: false, reason: "exception" };
  }
}
