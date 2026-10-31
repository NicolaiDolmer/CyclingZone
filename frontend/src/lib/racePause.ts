// #6970/#7335 — "Pauset"-besked paa loebene. Ingen ny loebsstatus. To kilder i
// app_config (laesbar for alle indloggede, RLS select = true):
//  1. AUTOMATISK (#7335, ejer 31/10): kontakten `stage_scheduler_enabled` er
//     eksplicit slukket mens en saeson er i gang. Det er den kontakt loebene
//     faktisk pauses med (28/10 11:46-13:57 UTC: ingen etape-claims i vinduet,
//     kontakten skrevet "on" igen 13:51 UTC). Ingen skal huske en ekstra raekke.
//  2. VALGFRI `race_pause_notice` (#6970), kun for at give en ny starttid:
//       { "paused": true, "new_start": "2026-10-23T14:00:00Z" }   // new_start valgfri
//     En new_start der allerede er passeret = noticen gaelder ikke laengere
//     (et glemt banner maa aldrig staa for evigt); er kontakten stadig slukket,
//     staar pausen videre uden tid.
// Saesonskiftet har sin egen blaa bjaelke (ops_notices "Season change ..."), saa
// mens den staar paa, vises ingen pause (samme besked maa ikke staa to gange).
// En afsluttet saeson (alle loebsdage koert) eller ingen aktiv saeson = ingen pause.
// Dashboardet skjuler de gamle starttider mens pausen staar paa, saa et pauset
// loeb ikke viser kl. 11, naar det i virkeligheden venter paa en ny start.
import { fetchActiveOpsNotices, isSeasonChangeNotice } from "./opsNotices.js";

export const RACE_PAUSE_CONFIG_KEY = "race_pause_notice";
export const STAGE_SCHEDULER_CONFIG_KEY = "stage_scheduler_enabled";

export interface RacePause {
  paused: true;
  /** Ny starttid i ms, eller null naar den endnu ikke er kendt. */
  newStartMs: number | null;
}

/** Parser app_config-vaerdien (objekt eller JSON-streng). Ukendt form = null. */
export function parseRacePause(raw: unknown): RacePause | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const v = value as { paused?: unknown; new_start?: unknown };
  if (v.paused !== true) return null;
  const ms = typeof v.new_start === "string" ? Date.parse(v.new_start) : NaN;
  return { paused: true, newStartMs: Number.isFinite(ms) ? ms : null };
}

/** Pausen gaelder, indtil den annoncerede nye start er naaet. */
export function isRacePauseActive(pause: RacePause | null, nowMs: number): pause is RacePause {
  if (!pause) return false;
  return pause.newStartMs == null || pause.newStartMs > nowMs;
}

/**
 * Kontakten er EKSPLICIT slukket ("off"/false). Fravaer, ukendt vaerdi og "beta"
 * er ikke pausebevis: hellere ingen bjaelke end en falsk pause.
 */
export function isSchedulerSwitchedOff(raw: unknown): boolean {
  if (raw === false) return true;
  if (typeof raw !== "string") return false;
  const v = raw.trim().replace(/^"|"$/g, "").toLowerCase();
  return v === "off" || v === "false";
}

export interface SeasonLike {
  status?: string | null;
  race_days_completed?: number | null;
  race_days_total?: number | null;
}

/** En aktiv saeson med loebsdage tilbage. Afsluttet saeson = venter paa skiftet, ikke en pause. */
export function isSeasonInPlay(season: SeasonLike | null | undefined): boolean {
  if (!season || season.status !== "active") return false;
  const total = Number(season.race_days_total);
  const done = Number(season.race_days_completed);
  if (Number.isFinite(total) && total > 0 && Number.isFinite(done) && done >= total) return false;
  return true;
}

export interface RacePauseInputs {
  /** Raa `race_pause_notice`-vaerdi (eller undefined). */
  notice: unknown;
  /** Raa `stage_scheduler_enabled`-vaerdi (eller undefined). */
  scheduler: unknown;
  /** Den aktive saeson, eller null. */
  season: SeasonLike | null;
  /** Et saesonskifte-banner (ops_notices) staar paa. */
  seasonChange: boolean;
}

/**
 * #7335: den samlede pause. Saesonskiftet vinder (egen bjaelke). Ellers en aktiv
 * notice (med evt. ny starttid), ellers kontakten slukket i en saeson der er i gang.
 */
export function resolveRacePause(inputs: RacePauseInputs | null, nowMs: number): RacePause | null {
  if (!inputs || inputs.seasonChange) return null;
  const notice = parseRacePause(inputs.notice);
  if (isRacePauseActive(notice, nowMs)) return notice;
  if (isSchedulerSwitchedOff(inputs.scheduler) && isSeasonInPlay(inputs.season)) {
    return { paused: true, newStartMs: null };
  }
  return null;
}

/** #7335: dashboardet har egen "Pauset"-flade, dér skjules den globale info-bjaelke (loebssiden viser ingen paa afsluttede loeb, saa den beholder bjaelken). */
export function racePauseInfoBarHiddenOnPath(pathname: string): boolean {
  return pathname === "/dashboard";
}

interface StageCardLike {
  state?: string;
  stageNumber?: number;
  stagesCompleted?: number;
}

function isUnrunStage(c: StageCardLike): boolean {
  if (c.state === "upcoming") return true;
  if (c.state !== "live") return false;
  const { stageNumber, stagesCompleted } = c;
  return typeof stageNumber === "number" && typeof stagesCompleted === "number"
    ? stagesCompleted < stageNumber
    : false;
}

/**
 * Dashboardets "Today's stages": skjul kort for etaper der IKKE er kørt (kommende, og
 * forfaldne uden resultat som Race Centre ellers viser som LIVE) mens pausen staar.
 * Kørte etaper (afspilning/resultat) bevares.
 */
export function withoutPausedUpcoming<T extends { cards?: StageCardLike[] }>(
  stages: T,
  paused: boolean,
): T {
  if (!paused || !stages || !Array.isArray(stages.cards)) return stages;
  return { ...stages, cards: stages.cards.filter((c) => !isUnrunStage(c)) };
}

/**
 * Henter pausens kilder. Normalt EN forespoergsel (begge app_config-noegler);
 * saeson og saesonskifte-banner hentes kun, naar der er en kandidat til en pause.
 * Dynamisk import af supabase (som lib/opsNotices.js) saa filen kan testes uden loader.
 */
export async function fetchRacePauseInputs(): Promise<RacePauseInputs> {
  const { supabase } = await import("./supabase");
  const { data, error } = await supabase
    .from("app_config")
    .select("key,value")
    .in("key", [RACE_PAUSE_CONFIG_KEY, STAGE_SCHEDULER_CONFIG_KEY]);
  if (error) throw error;
  const byKey = new Map((data || []).map((row) => [row.key, row.value] as const));
  const inputs: RacePauseInputs = {
    notice: byKey.get(RACE_PAUSE_CONFIG_KEY),
    scheduler: byKey.get(STAGE_SCHEDULER_CONFIG_KEY),
    season: null,
    seasonChange: false,
  };
  if (!parseRacePause(inputs.notice) && !isSchedulerSwitchedOff(inputs.scheduler)) return inputs;

  const [seasonRes, notices] = await Promise.all([
    supabase
      .from("seasons")
      .select("status,race_days_completed,race_days_total")
      .eq("status", "active")
      .limit(1),
    // Fejler hentningen, vises saesonskifte-bjaelken heller ikke (samme kilde), saa ingen dobbelt-besked.
    fetchActiveOpsNotices().catch(() => []),
  ]);
  if (seasonRes.error) throw seasonRes.error;
  inputs.season = seasonRes.data?.[0] ?? null;
  inputs.seasonChange = (notices || []).some(isSeasonChangeNotice);
  return inputs;
}
