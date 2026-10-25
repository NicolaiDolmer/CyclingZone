// backend/lib/academyReminder.ts
// #6666 / #7177 — påmindelser om ugens akademi-kuld til menneskeholdene.
//
// Ejer-beslutninger 25/10: "Kun påmindelsen" (AI-holdene henter IKKE selv; det
// ligger bag sit eget, slukkede flag i academyWeeklyPull.ts) og "Søndag + lørdag".
// Ugen er søndag-lørdag (Europe/Copenhagen, #7185); ugens nøgle er lørdagen
// (currentIntakeWeekKey, samme funktion som hentningen bruger).
//
//   - Søndag fra kl. 10:00: "Nye akademi-kandidater er klar".
//   - Lørdag fra kl. 18:00: "Ugens akademi-kuld udløber i nat".
//
// Begge går kun til aktive menneskehold (aktiv manager, ikke parkeret, sat-op
// akademi) der ikke har hentet ugens kuld. Højst én af hver pr. hold pr. uge:
// cron'en kører hver hele time i vinduet, og notifikations-dedup (samme type,
// titel og tekst til samme bruger inden for REMINDER_DEDUPE_WINDOW_MS) holder
// genforsøgene samme dag ude, mens næste uges påmindelse (7 døgn senere) går
// igennem.
//
// Bag flaget academy_pull_reminder_enabled (seedet OFF, fail-safe OFF) OG
// academy_intake_pull_enabled. Uden for vinduet eller med et flag slukket læses
// og skrives intet om hold.
import { copenhagenDateString, copenhagenHour, copenhagenWeekdayKey } from "./copenhagenTime.js";
import { currentIntakeWeekKey } from "./academyIntakePull.js";
import { isAcademyIntakePullEnabled } from "./academyIntakePullFlag.js";
import { isAcademyPullReminderEnabled } from "./academyReminderFlag.ts";
import { fetchEligibleTeamIds, fetchPulledTeamIds } from "./academyWeeklyPull.ts";
import { notifyTeamOwner } from "./notificationService.js";

// Supabase-klienten er utypet i kernen (samme som academyBoardGift.ts); `any` ved grænsen.
type Db = any;

/** Søndag fra denne time (dansk tid): ugens kuld er klar. */
export const REMINDER_READY_HOUR = 10;
/** Lørdag fra denne time (dansk tid): ugens kuld udløber ved midnat. */
export const REMINDER_EXPIRING_HOUR = 18;
/** Under en uge, så genforsøg samme dag dedupes og næste uges påmindelse går igennem. */
export const REMINDER_DEDUPE_WINDOW_MS = 6 * 24 * 60 * 60 * 1000;

export type AcademyReminderKind = "ready" | "expiring";

// EN-tekst er fallback i notifications-rækken (og dedup-nøglen); spilleren ser
// sin egen oversættelse via koderne (backendMessages.json, en/da/es/fr/nl).
export const REMINDER_COPY: Record<AcademyReminderKind, { title: string; message: string; titleCode: string; messageCode: string }> = {
  ready: {
    title: "New academy candidates are ready",
    message: "This week's intake is waiting in your academy. Bring it in before Saturday at midnight.",
    titleCode: "notif.academyPullReminderReady.title",
    messageCode: "notif.academyPullReminderReady.message",
  },
  expiring: {
    title: "This week's academy intake expires tonight",
    message: "You haven't brought in this week's candidates yet. Do it before midnight, or the intake is gone.",
    titleCode: "notif.academyPullReminderExpiring.title",
    messageCode: "notif.academyPullReminderExpiring.message",
  },
};

/** Hvilken påmindelse (om nogen) gælder lige nu, i dansk tid. */
export function academyReminderKind(now: Date = new Date()): AcademyReminderKind | null {
  const weekday = copenhagenWeekdayKey(copenhagenDateString(now));
  const hour = copenhagenHour(now);
  if (weekday === "sun" && hour >= REMINDER_READY_HOUR) return "ready";
  if (weekday === "sat" && hour >= REMINDER_EXPIRING_HOUR) return "expiring";
  return null;
}

export type AcademyReminderResult =
  | { ran: false; reason: string }
  | { ran: true; kind: AcademyReminderKind; weekKey: string; reminded: number; deduped: number; errors: string[] };

export interface AcademyReminderDeps {
  supabase: Db;
  now?: Date;
  isReminderEnabled?: (sb: Db) => Promise<boolean>;
  isPullEnabled?: (sb: Db) => Promise<boolean>;
  // notifyTeamOwner's JSDoc typer metadata for snævert; samme `any`-grænse som academyBoardGift.ts.
  notify?: (args: any) => Promise<unknown>;
}

export async function runAcademyPullReminderSweep({
  supabase,
  now = new Date(),
  isReminderEnabled = isAcademyPullReminderEnabled,
  isPullEnabled = isAcademyIntakePullEnabled,
  notify = notifyTeamOwner,
}: AcademyReminderDeps): Promise<AcademyReminderResult> {
  if (!supabase?.from) throw new Error("Supabase client required");
  const kind = academyReminderKind(now);
  if (!kind) return { ran: false, reason: "outside_window" };
  if (!(await isReminderEnabled(supabase))) return { ran: false, reason: "flag_off" };
  if (!(await isPullEnabled(supabase))) return { ran: false, reason: "pull_flag_off" };

  const weekKey = currentIntakeWeekKey(now);
  const pulled = await fetchPulledTeamIds(supabase, weekKey);
  const pending = (await fetchEligibleTeamIds(supabase, { isAi: false })).filter((id) => !pulled.has(id));
  const copy = REMINDER_COPY[kind];
  const errors: string[] = [];
  let reminded = 0;
  let deduped = 0;

  for (const teamId of pending) {
    try {
      const r = (await notify({
        supabase,
        teamId,
        type: "academy_intake_ready",
        title: copy.title,
        message: copy.message,
        relatedId: null,
        metadata: { titleCode: copy.titleCode, messageCode: copy.messageCode },
        dedupeWindowMs: REMINDER_DEDUPE_WINDOW_MS,
        now,
      })) as { delivered?: boolean; deduped?: boolean } | null | undefined;
      if (r?.delivered) reminded += 1;
      else if (r?.deduped) deduped += 1;
    } catch (e: unknown) {
      // best-effort: samles i errors[], som cron.js captures i Sentry; én mislykket påmindelse stopper ikke de andre.
      errors.push(`reminder ${teamId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { ran: true, kind, weekKey, reminded, deduped, errors };
}
