// #6666 (#7177) — flag for påmindelsen om ugens akademi-kuld til menneskeholdene.
// Eget flag, adskilt fra AI-holdenes egen hentning (academyWeeklyPullFlag.ts):
// ejeren 25/10 "Kun påmindelsen". Bor i app_config, flippes runtime uden re-deploy.
// Fail-safe: fejl/fravær/"beta" → false. Kun "on" tænder: påmindelsen er en cron
// uden viewer, så der er ingen beta-læsegate.
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const ACADEMY_PULL_REMINDER_FLAG_KEY = "academy_pull_reminder_enabled";

// Supabase-klienten er utypet i kernen (samme som academyBoardGift.ts); `any` ved grænsen.
export async function isAcademyPullReminderEnabled(supabase: any, opts: Record<string, unknown> = {}): Promise<boolean> {
  return evaluateFlagStage(await readFlagStage(supabase, ACADEMY_PULL_REMINDER_FLAG_KEY), opts);
}
