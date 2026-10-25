// #6666 — flag for ugens akademi-sweep: AI-hold henter selv ugens kuld, og
// menneskehold der ikke har hentet får én påmindelse. Bor i app_config → flippes
// runtime uden re-deploy. Fail-safe: fejl/fravær/"beta" → false (uændret adfærd).
// Kun "on" tænder: sweep'en er en cron uden viewer, så der er ingen beta-læsegate.
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const ACADEMY_WEEKLY_PULL_ASSIST_FLAG_KEY = "academy_weekly_pull_assist_enabled";

export async function isAcademyWeeklyPullAssistEnabled(supabase, opts = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, ACADEMY_WEEKLY_PULL_ASSIST_FLAG_KEY), opts);
}
