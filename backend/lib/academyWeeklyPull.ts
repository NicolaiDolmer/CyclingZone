// backend/lib/academyWeeklyPull.ts
// #6666 — ugens akademi-sweep. Efter omlægningen til ugens kuld (pull, man-søn)
// hentede kun de menneskehold der selv trykkede på knappen; AI-holdene har aldrig
// haft en kaldesti (det gamle søndags-drip filtrerede is_ai=false væk), og
// menneskehold fik ingen besked om at ugen var ved at løbe ud.
//
// Bag flaget academy_weekly_pull_assist_enabled (seedet OFF i database/2026-10-25-6666-academy-weekly-pull-assist-flag.sql, fail-safe OFF) gør
// sweep'en to ting, begge idempotente pr. (hold, uge):
//   1. AI-hold henter selv ugens kuld via SAMME pullWeeklyAcademyIntake som
//      menneskene bruger (samme claim i academy_intake_ticks, samme regler).
//      Højst MAX_AI_PULLS_PER_RUN pr. kørsel, så 100+ hold ikke genererer på én
//      gang; resten tages af de næste kørsler.
//   2. Menneskehold med akademi, der ikke har hentet ugens kuld, får ÉN påmindelse
//      i indbakken, kun på ugens sidste dag (søndag, Europe/Copenhagen). Dedup:
//      samme titel/tekst til samme bruger inden for 6 døgn leveres ikke igen.
// Flag slukket (eller pull-flaget slukket) = ingen læsning af hold og ingen skrivning.
import { fetchAllRows } from "./supabasePagination.js";
import { currentIntakeWeekSunday, pullWeeklyAcademyIntake } from "./academyIntakePull.js";
import { isAcademyIntakePullEnabled } from "./academyIntakePullFlag.js";
import { isAcademyWeeklyPullAssistEnabled } from "./academyWeeklyPullFlag.ts";
import { notifyTeamOwner } from "./notificationService.js";
import { isCopenhagenSunday } from "./sundayIntakeTick.js";

// Supabase-klienten er utypet i kernen (samme som academyBoardGift.ts); `any` ved grænsen.
type Db = any;

export const MAX_AI_PULLS_PER_RUN = 20;
export const REMINDER_DEDUPE_WINDOW_MS = 6 * 24 * 60 * 60 * 1000;

async function fetchTeamIds(supabase: Db, { isAi }: { isAi: boolean }): Promise<string[]> {
  const rows: Array<{ id: string }> = await fetchAllRows(() => {
    let q = supabase.from("teams").select("id")
      .eq("is_ai", isAi)
      .eq("is_bank", false)
      .eq("is_frozen", false)
      .eq("is_test_account", false)
      .is("retired_at", null);
    if (!isAi) {
      // Kun hold med en aktiv manager og et sat-op akademi får en påmindelse.
      q = q.is("parked_at", null).not("user_id", "is", null).not("academy_intake_seeded_at", "is", null);
    }
    return q.order("id");
  });
  return rows.map((r) => r.id);
}

async function fetchPulledTeamIds(supabase: Db, weekSunday: string): Promise<Set<string>> {
  const rows: Array<{ team_id: string }> = await fetchAllRows(() => supabase
    .from("academy_intake_ticks").select("team_id").eq("tick_date", weekSunday).order("team_id"));
  return new Set(rows.map((r) => r.team_id));
}

export type AcademyWeeklyPullResult =
  | { ran: false; reason: string }
  | { ran: true; weekSunday: string; aiPulled: number; aiRemaining: number; reminded: number; errors: string[] };

export interface AcademyWeeklyPullDeps {
  supabase: Db;
  now?: Date;
  isAssistEnabled?: (sb: Db) => Promise<boolean>;
  isPullEnabled?: (sb: Db) => Promise<boolean>;
  pullFn?: (sb: Db, args: { teamId: string; now: Date }) => Promise<{ ok?: boolean; alreadyPulled?: boolean } | null | undefined>;
  // notifyTeamOwner's JSDoc typer metadata for snævert; samme `any`-grænse som academyBoardGift.ts.
  notify?: (args: any) => Promise<unknown>;
  maxAiPulls?: number;
}

export async function runAcademyWeeklyPullSweep({
  supabase,
  now = new Date(),
  isAssistEnabled = isAcademyWeeklyPullAssistEnabled,
  isPullEnabled = isAcademyIntakePullEnabled,
  pullFn = pullWeeklyAcademyIntake,
  notify = notifyTeamOwner,
  maxAiPulls = MAX_AI_PULLS_PER_RUN,
}: AcademyWeeklyPullDeps): Promise<AcademyWeeklyPullResult> {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!(await isAssistEnabled(supabase))) return { ran: false, reason: "flag_off" };
  if (!(await isPullEnabled(supabase))) return { ran: false, reason: "pull_flag_off" };

  const weekSunday = currentIntakeWeekSunday(now);
  const pulled = await fetchPulledTeamIds(supabase, weekSunday);
  const errors: string[] = [];

  // 1. AI-hold henter selv. Claimet i pullFn er den egentlige idempotens;
  // tick-opslaget ovenfor sparer blot de dyre kald for hold der allerede har hentet.
  const aiPending = (await fetchTeamIds(supabase, { isAi: true })).filter((id) => !pulled.has(id));
  let aiPulled = 0;
  for (const teamId of aiPending.slice(0, maxAiPulls)) {
    try {
      const r = await pullFn(supabase, { teamId, now });
      if (r?.ok && !r.alreadyPulled) aiPulled += 1;
    } catch (e: unknown) {
      // best-effort: samles i errors[], som cron.js captures i Sentry; ét holds fejl må ikke stoppe de andre.
      errors.push(`ai-pull ${teamId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 2. Påmindelse: kun søndag (ugens sidste dag), kun menneskehold uden hentning.
  let reminded = 0;
  if (isCopenhagenSunday(now)) {
    const humanPending = (await fetchTeamIds(supabase, { isAi: false })).filter((id) => !pulled.has(id));
    for (const teamId of humanPending) {
      try {
        const r = await notify({
          supabase,
          teamId,
          type: "academy_intake_ready",
          title: "Your academy week ends tonight",
          message: "You haven't collected this week's candidates yet. Pull them before midnight or the batch is gone.",
          relatedId: null,
          metadata: {
            titleCode: "notif.academyPullReminder.title",
            messageCode: "notif.academyPullReminder.message",
          },
          dedupeWindowMs: REMINDER_DEDUPE_WINDOW_MS,
          now,
        });
        if ((r as { delivered?: boolean } | null | undefined)?.delivered) reminded += 1;
      } catch (e: unknown) {
        // best-effort: samles i errors[], som cron.js captures i Sentry; en mislykket påmindelse ruller intet tilbage.
        errors.push(`reminder ${teamId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return {
    ran: true,
    weekSunday,
    aiPulled,
    aiRemaining: Math.max(0, aiPending.length - maxAiPulls),
    reminded,
    errors,
  };
}
