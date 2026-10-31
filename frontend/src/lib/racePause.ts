// #6970 — "Pauset"-banner paa loebene. Ingen ny loebsstatus: en pause er en enkelt
// raekke i app_config (nøgle `race_pause_notice`, laesbar for alle indloggede),
// som ejeren/Claude saetter og fjerner uden deploy:
//   { "paused": true, "new_start": "2026-10-23T14:00:00Z" }   // new_start valgfri
// Ingen raekke, `paused` != true eller en new_start der allerede er passeret =
// ikke pauset (et glemt banner maa aldrig staa for evigt).
// Dashboardet skjuler de gamle starttider mens pausen staar paa, saa et pauset
// loeb ikke viser kl. 11, naar det i virkeligheden venter paa en ny start.

export const RACE_PAUSE_CONFIG_KEY = "race_pause_notice";

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

/** #7335: dashboard og loebsside har egen "Pauset"-flade, dér skjules den globale info-bjaelke. */
export function racePauseInfoBarHiddenOnPath(pathname: string): boolean {
  return pathname === "/dashboard" || /^\/races\/[^/]+\/?$/.test(pathname);
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

/** Henter pausen. Dynamisk import af supabase (som lib/opsNotices.js) saa filen kan testes uden loader. */
export async function fetchRacePause(): Promise<RacePause | null> {
  const { supabase } = await import("./supabase");
  const { data, error } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", RACE_PAUSE_CONFIG_KEY)
    .maybeSingle();
  if (error) throw error;
  return parseRacePause(data?.value);
}
