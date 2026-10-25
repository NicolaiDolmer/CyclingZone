// #6666 — flag for ugens akademi-sweep: AI-hold henter selv ugens kuld, og
// menneskehold der ikke har hentet får én påmindelse. Bor i app_config → flippes
// runtime uden re-deploy. Fail-safe: fejl/fravær/"beta" → false (uændret adfærd).
// Kun "on" tænder: sweep'en er en cron uden viewer, så der er ingen beta-læsegate.
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const ACADEMY_WEEKLY_PULL_ASSIST_FLAG_KEY = "academy_weekly_pull_assist_enabled";

// Supabase-klienten er utypet i kernen (samme som academyBoardGift.ts); `any` ved grænsen.
export async function isAcademyWeeklyPullAssistEnabled(supabase: any, opts: Record<string, unknown> = {}): Promise<boolean> {
  return evaluateFlagStage(await readFlagStage(supabase, ACADEMY_WEEKLY_PULL_ASSIST_FLAG_KEY), opts);
}
