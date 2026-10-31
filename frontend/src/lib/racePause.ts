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
// mens den staar paa, er pausen `silent`: ingen pause-besked (samme besked maa ikke
// staa to gange), men dashboardet skjuler stadig de gamle starttider.
// Kontakten slukket uden en aktiv saeson med uafsluttede loeb = ingen pause.
// Dashboardet skjuler de gamle starttider mens pausen staar paa, saa et pauset
// loeb ikke viser kl. 11, naar det i virkeligheden venter paa en ny start.
import { fetchActiveOpsNotices, isSeasonChangeNotice } from "./opsNotices.js";

export const RACE_PAUSE_CONFIG_KEY = "race_pause_notice";
export const STAGE_SCHEDULER_CONFIG_KEY = "stage_scheduler_enabled";

export interface RacePause {
  paused: true;
  /** Ny starttid i ms, eller null naar den endnu ikke er kendt. */
  newStartMs: number | null;
  /**
   * Pausen gaelder (dashboardet skjuler stadig de gamle starttider), men der vises
   * ingen pause-besked, fordi saesonskiftets egen blaa bjaelke staar paa.
   */
  silent?: true;
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

export interface RacePauseInputs {
  /** Raa `race_pause_notice`-vaerdi (eller undefined). */
  notice: unknown;
  /** Raa `stage_scheduler_enabled`-vaerdi (eller undefined). */
  scheduler: unknown;
  /** Der er en aktiv saeson med mindst et loeb, der ikke er afsluttet. */
  seasonInPlay: boolean;
  /** Et saesonskifte-banner (ops_notices) staar paa. */
  seasonChange: boolean;
}

/**
 * #7335: den samlede pause. En aktiv notice (med evt. ny starttid), ellers kontakten
 * slukket mens saesonen har loeb tilbage. Under saesonskiftet gaelder pausen stadig,
 * men den er `silent`: saesonskiftet har sin egen bjaelke, saa ingen dobbelt-besked.
 */
export function resolveRacePause(inputs: RacePauseInputs | null, nowMs: number): RacePause | null {
  if (!inputs) return null;
  const notice = parseRacePause(inputs.notice);
  let pause: RacePause | null = null;
  if (isRacePauseActive(notice, nowMs)) pause = notice;
  else if (isSchedulerSwitchedOff(inputs.scheduler) && inputs.seasonInPlay) pause = { paused: true, newStartMs: null };
  if (!pause) return null;
  return inputs.seasonChange ? { ...pause, silent: true } : pause;
}

/** Pausen skal vises som besked (ikke bare skjule gamle starttider). */
export function shouldAnnounceRacePause(pause: RacePause | null): pause is RacePause {
  return pause != null && pause.silent !== true;
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
    seasonInPlay: false,
    seasonChange: false,
  };
  const schedulerOff = isSchedulerSwitchedOff(inputs.scheduler);
  if (!parseRacePause(inputs.notice) && !schedulerOff) return inputs;

  // Saesonen er "i gang" naar den aktive saeson har mindst et loeb der ikke er
  // afsluttet. Bevidst ikke seasons.race_days_completed: den taeller dage med
  // mindst et afsluttet loeb, saa den kan staa lig totalen mens sidste dag koerer.
  async function fetchSeasonInPlay(): Promise<boolean> {
    const seasonRes = await supabase.from("seasons").select("id").eq("status", "active").limit(1);
    if (seasonRes.error) throw seasonRes.error;
    const seasonId = seasonRes.data?.[0]?.id;
    if (!seasonId) return false;
    const raceRes = await supabase
      .from("races")
      .select("id")
      .eq("season_id", seasonId)
      .neq("status", "completed")
      .limit(1);
    if (raceRes.error) throw raceRes.error;
    return (raceRes.data?.length ?? 0) > 0;
  }

  const [seasonInPlay, notices] = await Promise.all([
    schedulerOff ? fetchSeasonInPlay() : Promise.resolve(false),
    // Fejler hentningen, vises saesonskifte-bjaelken heller ikke (samme kilde), saa ingen dobbelt-besked.
    fetchActiveOpsNotices().catch(() => []),
  ]);
  inputs.seasonInPlay = seasonInPlay;
  inputs.seasonChange = (notices || []).some(isSeasonChangeNotice);
  return inputs;
}
