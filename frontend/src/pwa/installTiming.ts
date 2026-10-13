// #6584 · Hvornaar tilbyder vi installation?
//
// Ejerens krav: installationen skal foeles som en beloenning, ikke en banner-
// plage. Aldrig ved foerste besoeg. Browserens egen mini-infobar er allerede
// slaaet fra (installPrompt.ts kalder preventDefault), saa dette modul er den
// ENESTE beslutning om hvornaar spilleren ser tilbuddet.
//
// Reglen (ren funktion, unit-testet i installTiming.test.ts):
//   - spilleren er logget ind og staar i appen (ikke forsiden/login)
//   - appen er ikke allerede installeret / koerer ikke allerede standalone
//   - spilleren er kommet igen: mindst RETURN_DAYS forskellige dage med besoeg.
//     Tredje dag er det tidligste tidspunkt; en spiller der kommer tilbage tre
//     dage har vist at spillet er en vane, og saa er en genvej en tjeneste.
//   - "Ikke nu" respekteres: SNOOZE_DAYS pause, og efter MAX_DISMISSALS gange
//     spoerger vi aldrig igen.
//
// Tilstanden ligger i localStorage pr. browser (det er en browser-egenskab om
// appen er installeret, ikke en konto-egenskab). Alt er fail-closed: kan vi
// ikke laese/skrive storage, tilbyder vi ingenting.

export const STORAGE_KEY = "cz_pwa_install_v1";
export const RETURN_DAYS = 3;
export const SNOOZE_DAYS = 30;
export const MAX_DISMISSALS = 3;
// Vi husker hoejst saa mange besoegsdage; mere end RETURN_DAYS bruges aldrig.
const MAX_REMEMBERED_DAYS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

// Offentlige flader uden en spillers app-tilstand. Sessionen gater resten.
const NON_APP_PATHS = new Set(["/", "/login", "/reset-password"]);

export interface InstallState {
  /** Lokale datoer (YYYY-MM-DD) med mindst ét besoeg, nyeste sidst. */
  days: string[];
  dismissals: number;
  /** Epoch-ms for seneste "Ikke nu", eller null. */
  dismissedAt: number | null;
  installed: boolean;
}

export type InstallPlatform = "prompt" | "ios" | "none";

export interface InstallContext {
  now: number;
  platform: InstallPlatform;
  standalone: boolean;
  hasSession: boolean;
  pathname: string;
}

export type InstallDecisionReason =
  | "offer"
  | "unsupported"
  | "standalone"
  | "installed"
  | "no-session"
  | "not-app-route"
  | "too-early"
  | "gave-up"
  | "snoozed";

export function emptyInstallState(): InstallState {
  return { days: [], dismissals: 0, dismissedAt: null, installed: false };
}

/** Lokal kalenderdato for et tidspunkt, som YYYY-MM-DD. */
export function localDayKey(now: number): string {
  const d = new Date(now);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Tolerant parser: alt der ikke ligner vores form bliver en tom tilstand. */
export function parseInstallState(raw: string | null | undefined): InstallState {
  if (typeof raw !== "string" || raw.trim() === "") return emptyInstallState();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return emptyInstallState();
    const p = parsed as Record<string, unknown>;
    const days = Array.isArray(p.days)
      ? p.days.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d))
      : [];
    const dismissals = typeof p.dismissals === "number" && Number.isFinite(p.dismissals) ? Math.max(0, Math.floor(p.dismissals)) : 0;
    const dismissedAt = typeof p.dismissedAt === "number" && Number.isFinite(p.dismissedAt) ? p.dismissedAt : null;
    return { days: days.slice(-MAX_REMEMBERED_DAYS), dismissals, dismissedAt, installed: p.installed === true };
  } catch {
    return emptyInstallState();
  }
}

/** Ny tilstand med dagens dato registreret (uaendret hvis dagen allerede er der). */
export function recordVisit(state: InstallState, now: number): InstallState {
  const today = localDayKey(now);
  if (state.days.includes(today)) return state;
  return { ...state, days: [...state.days, today].slice(-MAX_REMEMBERED_DAYS) };
}

export function recordDismissal(state: InstallState, now: number): InstallState {
  return { ...state, dismissals: state.dismissals + 1, dismissedAt: now };
}

export function recordInstalled(state: InstallState): InstallState {
  return { ...state, installed: true };
}

export function decideInstallOffer(state: InstallState, ctx: InstallContext): InstallDecisionReason {
  if (ctx.platform === "none") return "unsupported";
  if (ctx.standalone) return "standalone";
  if (state.installed) return "installed";
  if (!ctx.hasSession) return "no-session";
  if (NON_APP_PATHS.has(ctx.pathname)) return "not-app-route";
  if (state.dismissals >= MAX_DISMISSALS) return "gave-up";
  if (state.dismissedAt !== null && ctx.now - state.dismissedAt < SNOOZE_DAYS * DAY_MS) return "snoozed";
  if (new Set(state.days).size < RETURN_DAYS) return "too-early";
  return "offer";
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readInstallState(storage: StorageLike | null | undefined): InstallState | null {
  if (!storage) return null;
  try {
    return parseInstallState(storage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeInstallState(storage: StorageLike | null | undefined, state: InstallState): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
