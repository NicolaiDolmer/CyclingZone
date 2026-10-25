// backend/lib/academyWeeklyPull.ts
// #6666 — AI-holdenes egen hentning af ugens akademi-kuld. Efter omlægningen til
// ugens kuld (pull) hentede kun de menneskehold der selv trykkede på knappen;
// AI-holdene har aldrig haft en kaldesti (det gamle søndags-drip filtrerede
// is_ai=false væk).
//
// Bag sit EGET flag academy_ai_weekly_pull_enabled (seedet OFF, fail-safe OFF).
// Ejeren 25/10: "Kun påmindelsen", så AI-hentningen forbliver slukket og er en
// senere, separat beslutning. Påmindelsen til menneskeholdene bor i
// academyReminder.ts bag sit eget flag (#7177).
//
// AI-hold henter via SAMME pullWeeklyAcademyIntake som menneskene (samme claim i
// academy_intake_ticks, samme regler), idempotent pr. (hold, uge). Højst
// MAX_AI_PULLS_PER_RUN pr. kørsel, så 100+ hold ikke genererer på én gang; resten
// tages af de næste kørsler (søndagens akademi-cron kører hver hele time).
// Flag slukket (eller pull-flaget slukket) = ingen læsning af hold og ingen skrivning.
import { fetchAllRows } from "./supabasePagination.js";
import { currentIntakeWeekKey, pullWeeklyAcademyIntake } from "./academyIntakePull.js";
import { isAcademyIntakePullEnabled } from "./academyIntakePullFlag.js";
import { isAcademyAiWeeklyPullEnabled } from "./academyWeeklyPullFlag.ts";

// Supabase-klienten er utypet i kernen (samme som academyBoardGift.ts); `any` ved grænsen.
type Db = any;

export const MAX_AI_PULLS_PER_RUN = 20;

/**
 * Hold der kan hente ugens kuld. AI: alle aktive AI-hold. Menneske: kun hold med
 * en aktiv manager (ikke parkeret) og et sat-op akademi. Banker, frosne hold,
 * testkonti og nedlagte hold er altid ude. Delt med påmindelsen (academyReminder.ts).
 */
export async function fetchEligibleTeamIds(supabase: Db, { isAi }: { isAi: boolean }): Promise<string[]> {
  const rows: Array<{ id: string }> = await fetchAllRows(() => {
    let q = supabase.from("teams").select("id")
      .eq("is_ai", isAi)
      .eq("is_bank", false)
      .eq("is_frozen", false)
      .eq("is_test_account", false)
      .is("retired_at", null);
    if (!isAi) {
      q = q.is("parked_at", null).not("user_id", "is", null).not("academy_intake_seeded_at", "is", null);
    }
    return q.order("id");
  });
  return rows.map((r) => r.id);
}

/** Hold der allerede har hentet ugens kuld (claim i academy_intake_ticks for ugens nøgle). */
export async function fetchPulledTeamIds(supabase: Db, weekKey: string): Promise<Set<string>> {
  const rows: Array<{ team_id: string }> = await fetchAllRows(() => supabase
    .from("academy_intake_ticks").select("team_id").eq("tick_date", weekKey).order("team_id"));
  return new Set(rows.map((r) => r.team_id));
}

export type AcademyWeeklyPullResult =
  | { ran: false; reason: string }
  | { ran: true; weekKey: string; aiPulled: number; aiRemaining: number; errors: string[] };

export interface AcademyWeeklyPullDeps {
  supabase: Db;
  now?: Date;
  isAiPullEnabled?: (sb: Db) => Promise<boolean>;
  isPullEnabled?: (sb: Db) => Promise<boolean>;
  pullFn?: (sb: Db, args: { teamId: string; now: Date }) => Promise<{ ok?: boolean; alreadyPulled?: boolean } | null | undefined>;
  maxAiPulls?: number;
}

export async function runAcademyWeeklyPullSweep({
  supabase,
  now = new Date(),
  isAiPullEnabled = isAcademyAiWeeklyPullEnabled,
  isPullEnabled = isAcademyIntakePullEnabled,
  pullFn = pullWeeklyAcademyIntake,
  maxAiPulls = MAX_AI_PULLS_PER_RUN,
}: AcademyWeeklyPullDeps): Promise<AcademyWeeklyPullResult> {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!(await isAiPullEnabled(supabase))) return { ran: false, reason: "flag_off" };
  if (!(await isPullEnabled(supabase))) return { ran: false, reason: "pull_flag_off" };

  const weekKey = currentIntakeWeekKey(now);
  const pulled = await fetchPulledTeamIds(supabase, weekKey);
  const errors: string[] = [];

  // Claimet i pullFn er den egentlige idempotens; tick-opslaget ovenfor sparer
  // blot de dyre kald for hold der allerede har hentet.
  const aiPending = (await fetchEligibleTeamIds(supabase, { isAi: true })).filter((id) => !pulled.has(id));
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

  return {
    ran: true,
    weekKey,
    aiPulled,
    aiRemaining: Math.max(0, aiPending.length - maxAiPulls),
    errors,
  };
}
