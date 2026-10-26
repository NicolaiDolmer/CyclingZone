// #6666 — flag for at AI-holdene selv henter ugens akademi-kuld. Påmindelsen til
// menneskeholdene har sit eget flag (academyReminderFlag.ts, #7177): ejeren 25/10
// "Kun påmindelsen", AI-hentningen er en senere, separat beslutning. Bor i
// app_config → flippes runtime uden re-deploy. Fail-safe: fejl/fravær/"beta" →
// false (uændret adfærd). Kun "on" tænder: sweep'en er en cron uden viewer.
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const ACADEMY_AI_WEEKLY_PULL_FLAG_KEY = "academy_ai_weekly_pull_enabled";

// Supabase-klienten er utypet i kernen (samme som academyBoardGift.ts); `any` ved grænsen.
export async function isAcademyAiWeeklyPullEnabled(supabase: any, opts: Record<string, unknown> = {}): Promise<boolean> {
  return evaluateFlagStage(await readFlagStage(supabase, ACADEMY_AI_WEEKLY_PULL_FLAG_KEY), opts);
}
