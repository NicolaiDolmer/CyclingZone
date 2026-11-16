// #7859 · Spoiler-skjoldet: skjul vinderen, til spilleren selv åbner etapen.
//
// Ejer 16/11 (issue #7859): byg billede 1-4 (løbssiden), 6 (indbakken og beskeder
// i spillet neutrale) og 7 (indstillingen) bag den SLUKKEDE kontakt
// spoiler_shield_7859. Slukket = alt som i dag: ruterne svarer `enabled: false`,
// og notifikationerne skrives præcis som før.
//
// Tre stykker data pr. spiller (database/2026-11-16-7859-spoiler-shield.sql):
//   - valget for alle løb (FRA som standard, ejervalg 16/11) og hvor en færdig
//     etape åbner (Results eller Story),
//   - kontakten i et løbs hoved (null = følg valget for alle løb),
//   - de etaper spilleren har åbnet. Gemt på brugeren, ikke på enheden, så ét tryk
//     eller filmen i mål åbner etapen overalt og på alle enheder.
//
// Kun backenden læser og skriver tabellerne, altid med den indloggedes id.

import { Router } from "express";
import type { Request, RequestHandler } from "express";
import { evaluateFlagStage, readFlagStage } from "./featureStage.js";
import { fetchAllRowsChunkedIn } from "./supabasePagination.js";

export const SPOILER_SHIELD_FLAG_KEY = "spoiler_shield_7859";
export const SETTINGS_TABLE = "user_spoiler_shield_7859";
export const RACES_TABLE = "user_spoiler_races_7859";
export const OPEN_STAGE_RPC = "spoiler_open_stage_7859";
export const MAX_STAGE = 64;

export type OpenFinishedIn = "results" | "story";
export const OPEN_FINISHED_IN: readonly OpenFinishedIn[] = Object.freeze(["results", "story"]);

export interface SpoilerSettings {
  /** Skjoldet for alle løb. Fra som standard. */
  shieldAll: boolean;
  /** Hvor en færdig etape åbner uden skjold. Skjoldet åbner altid i Story. */
  openFinishedIn: OpenFinishedIn;
}

export const DEFAULT_SETTINGS: Readonly<SpoilerSettings> = Object.freeze({ shieldAll: false, openFinishedIn: "results" });

export interface RaceSpoilerState {
  /** Kontakten i løbets hoved; null = følg valget for alle løb. */
  shield: boolean | null;
  /** Skjoldet gælder for løbet (kontakten, ellers valget for alle løb). */
  shielded: boolean;
  /** Etaper spilleren har åbnet, stigende. */
  openedStages: number[];
}

// Samme (løse) type som featureStage.js giver klienten: ruterne og cronen sender den rigtige supabase-klient.
type Db = Parameters<typeof readFlagStage>[0];
interface DbError { code?: string; message?: string }

// ── Rene hjælpere ─────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function isValidStage(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_STAGE;
}

/** Databasens række (eller ingenting) → spillerens valg med standarder. */
export function settingsFromRow(row: { shield_all?: unknown; open_finished_in?: unknown } | null | undefined): SpoilerSettings {
  return {
    shieldAll: row?.shield_all === true,
    openFinishedIn: row?.open_finished_in === "story" ? "story" : "results",
  };
}

/** Kun gyldige etapenumre, uden dubletter, stigende. */
export function cleanStages(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isValidStage))].sort((a, b) => a - b);
}

/** Kontakten i løbets hoved vinder; uden den gælder valget for alle løb. */
export function isRaceShielded(settings: SpoilerSettings, raceShield: boolean | null): boolean {
  return typeof raceShield === "boolean" ? raceShield : settings.shieldAll;
}

export function raceStateFrom(settings: SpoilerSettings, row: { shield?: unknown; opened_stages?: unknown } | null | undefined): RaceSpoilerState {
  const shield = typeof row?.shield === "boolean" ? row.shield : null;
  return { shield, shielded: isRaceShielded(settings, shield), openedStages: cleanStages(row?.opened_stages) };
}

/** PUT /settings: { shieldAll?: boolean, openFinishedIn?: "results" | "story" }. */
export function sanitizeSettingsPatch(body: unknown):
  | { ok: true; patch: Partial<SpoilerSettings> }
  | { ok: false; reason: string; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: "spoiler_invalid_payload", error: "body must be an object" };
  }
  const input = body as Record<string, unknown>;
  const unknown = Object.keys(input).filter((k) => k !== "shieldAll" && k !== "openFinishedIn");
  if (unknown.length) return { ok: false, reason: "spoiler_unknown_keys", error: `Unknown keys: ${unknown.join(", ")}` };
  const patch: Partial<SpoilerSettings> = {};
  if ("shieldAll" in input) {
    if (typeof input.shieldAll !== "boolean") return { ok: false, reason: "spoiler_invalid_value", error: "shieldAll must be a boolean" };
    patch.shieldAll = input.shieldAll;
  }
  if ("openFinishedIn" in input) {
    if (!OPEN_FINISHED_IN.includes(input.openFinishedIn as OpenFinishedIn)) {
      return { ok: false, reason: "spoiler_invalid_value", error: "openFinishedIn must be results or story" };
    }
    patch.openFinishedIn = input.openFinishedIn as OpenFinishedIn;
  }
  if (!Object.keys(patch).length) return { ok: false, reason: "spoiler_invalid_payload", error: "nothing to save" };
  return { ok: true, patch };
}

/**
 * Tabellerne eller funktionen findes ikke endnu (backend deployet før migrationen).
 * Postgres: 42P01 (tabel), 42883 (funktion). PostgREST: PGRST205 (tabel), PGRST202 (funktion).
 */
export function isMissingSpoilerStorage(error: DbError | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const message = String(error.message ?? "");
  const ours = /user_spoiler_(shield|races)_7859|spoiler_open_stage_7859/.test(message);
  if (code === "42P01" || code === "PGRST205") return true;
  if (code === "42883" || code === "PGRST202") return ours || !message;
  return ours && /does not exist|schema cache|could not find/i.test(message);
}

// ── Læs og skriv ──────────────────────────────────────────────────────────

export async function readSettings(supabase: Db, userId: string): Promise<{ settings: SpoilerSettings; available: boolean }> {
  const { data, error } = await supabase.from(SETTINGS_TABLE).select("shield_all, open_finished_in").eq("user_id", userId).limit(1);
  if (error) {
    if (isMissingSpoilerStorage(error)) return { settings: { ...DEFAULT_SETTINGS }, available: false };
    throw new Error(`${SETTINGS_TABLE}: ${error.message}`);
  }
  return { settings: settingsFromRow(Array.isArray(data) ? data[0] : null), available: true };
}

export async function readRaceState(supabase: Db, userId: string, raceId: string, settings: SpoilerSettings): Promise<{ race: RaceSpoilerState; available: boolean }> {
  const { data, error } = await supabase.from(RACES_TABLE).select("shield, opened_stages").eq("user_id", userId).eq("race_id", raceId).limit(1);
  if (error) {
    if (isMissingSpoilerStorage(error)) return { race: raceStateFrom(settings, null), available: false };
    throw new Error(`${RACES_TABLE}: ${error.message}`);
  }
  return { race: raceStateFrom(settings, Array.isArray(data) ? data[0] : null), available: true };
}

/** Flet ét valg ind. Én bruger skriver kun sin egen række; sidste valg vinder pr. felt. */
export async function writeSettings(supabase: Db, userId: string, patch: Partial<SpoilerSettings>, nowIso: () => string = () => new Date().toISOString()) {
  const current = await readSettings(supabase, userId);
  if (!current.available) return current;
  const next: SpoilerSettings = { ...current.settings, ...patch };
  const { error } = await supabase.from(SETTINGS_TABLE).upsert(
    { user_id: userId, shield_all: next.shieldAll, open_finished_in: next.openFinishedIn, updated_at: nowIso() },
    { onConflict: "user_id" },
  );
  if (error) {
    if (isMissingSpoilerStorage(error)) return { settings: current.settings, available: false };
    throw new Error(`${SETTINGS_TABLE}: ${error.message}`);
  }
  return { settings: next, available: true };
}

/** Kontakten i løbets hoved. Rører kun kolonnen shield, så åbnede etaper står urørt. */
export async function writeRaceShield(supabase: Db, userId: string, raceId: string, shield: boolean | null, nowIso: () => string = () => new Date().toISOString()) {
  const { error } = await supabase.from(RACES_TABLE).upsert(
    { user_id: userId, race_id: raceId, shield, updated_at: nowIso() },
    { onConflict: "user_id,race_id" },
  );
  if (error) {
    if (isMissingSpoilerStorage(error)) return { available: false };
    throw new Error(`${RACES_TABLE}: ${error.message}`);
  }
  return { available: true };
}

/** Åbn en etape (atomisk i databasen; en etape kan kun tilføjes). */
export async function openStage(supabase: Db, userId: string, raceId: string, stage: number): Promise<{ openedStages: number[]; available: boolean }> {
  const { data, error } = await supabase.rpc(OPEN_STAGE_RPC, { p_user_id: userId, p_race_id: raceId, p_stage: stage });
  if (error) {
    if (isMissingSpoilerStorage(error)) return { openedStages: [], available: false };
    throw new Error(`${OPEN_STAGE_RPC}: ${error.message}`);
  }
  return { openedStages: cleanStages(data), available: true };
}

// ── Notifikationerne (billede 6) ──────────────────────────────────────────

interface ShieldUserRow { id?: string; role?: string | null; is_beta_tester?: boolean | null }

/**
 * Modtagere af et løbs resultat-notifikation, for hvem skjoldet gælder lige nu
 * (og som ikke allerede har åbnet etapen). De får den neutrale tekst ("Stage 3 of
 * X is done"), aldrig vinderen eller deres placering.
 *
 * Slukket kontakt, manglende tabeller eller en fejl = tomt sæt = alt som i dag.
 * Fejlen meldes til `reportError`, men vælter aldrig notifikationerne.
 */
export async function fetchShieldedRecipients({
  supabase, raceId, userIds, stageNumber = null, reportError = () => {},
}: {
  supabase: Db; raceId: string; userIds: Iterable<string>; stageNumber?: number | null;
  reportError?: (error: unknown, context?: Record<string, unknown>) => void;
}): Promise<Set<string>> {
  const ids = [...new Set([...userIds].filter(isUuid))].sort();
  if (!ids.length || !raceId) return new Set();
  try {
    const stage = await readFlagStage(supabase, SPOILER_SHIELD_FLAG_KEY);
    if (stage !== "on" && stage !== "beta" && stage !== true) return new Set();
    let eligible = ids;
    if (!evaluateFlagStage(stage)) {
      // "beta": kun beta-testere og admins (samme regel som featureFlagsApi).
      const users: ShieldUserRow[] = await fetchAllRowsChunkedIn(ids, (chunk: string[]) => supabase
        .from("users").select("id, role, is_beta_tester").in("id", chunk).order("id"));
      eligible = users
        .filter((u) => u.id && evaluateFlagStage(stage, { isBetaTester: u.role === "admin" || u.is_beta_tester === true }))
        .map((u) => String(u.id));
      if (!eligible.length) return new Set();
    }
    const settingsRows: Array<{ user_id: string; shield_all?: boolean; open_finished_in?: string }> = await fetchAllRowsChunkedIn(eligible, (chunk: string[]) => supabase
      .from(SETTINGS_TABLE).select("user_id, shield_all, open_finished_in").in("user_id", chunk).order("user_id"));
    const raceRows: Array<{ user_id: string; shield?: boolean | null; opened_stages?: number[] }> = await fetchAllRowsChunkedIn(eligible, (chunk: string[]) => supabase
      .from(RACES_TABLE).select("user_id, shield, opened_stages").eq("race_id", raceId).in("user_id", chunk).order("user_id"));
    const settingsBy = new Map(settingsRows.map((r) => [r.user_id, settingsFromRow(r)]));
    const raceBy = new Map(raceRows.map((r) => [r.user_id, r]));
    const out = new Set<string>();
    for (const userId of eligible) {
      const race = raceStateFrom(settingsBy.get(userId) ?? { ...DEFAULT_SETTINGS }, raceBy.get(userId));
      if (!race.shielded) continue;
      if (stageNumber != null && race.openedStages.includes(stageNumber)) continue;
      out.add(userId);
    }
    return out;
  } catch (error) {
    if (!isMissingSpoilerStorage(error as DbError)) reportError(error, { tags: { flow: "notifications", stage: "spoiler-shield" }, raceId });
    return new Set(); // best-effort: uden svar skrives notifikationen som i dag (skjoldet er fra som standard)
  }
}

// ── /api/me/spoiler-shield ────────────────────────────────────────────────
//
//   GET  /?raceId=<uuid>             { enabled, available, settings, race }
//   PUT  /settings                   { shieldAll?, openFinishedIn? }
//   PUT  /races/:raceId              { shield: boolean | null }
//   POST /races/:raceId/opened       { stage }
//
// Slukket kontakt for viewer: GET svarer { enabled: false } og skriv svarer 404,
// så klienten tegner alt som i dag. Svaret er aldrig det rå flag-stadie.

type AuthedRequest = Request & { user?: { id?: string } };

export function createSpoilerShieldRouter({
  supabase, requireAuth, isViewerBetaTester, readLimiter, writeLimiter, reportError = () => {},
}: {
  supabase: Db;
  requireAuth: RequestHandler;
  isViewerBetaTester: (req: Request) => Promise<boolean>;
  readLimiter: RequestHandler;
  writeLimiter: RequestHandler;
  reportError?: (error: unknown, context?: Record<string, unknown>) => void;
}) {
  const router = Router();
  const userIdOf = (req: Request): string | null => (req as AuthedRequest).user?.id ?? null;

  async function enabledFor(req: Request): Promise<boolean> {
    const stage = await readFlagStage(supabase, SPOILER_SHIELD_FLAG_KEY);
    return evaluateFlagStage(stage, { isBetaTester: await isViewerBetaTester(req) });
  }

  router.get("/", requireAuth, readLimiter, async (req, res) => {
    const userId = userIdOf(req);
    if (!userId) return res.status(401).json({ error: "unauthorized" });
    const raceId = typeof req.query.raceId === "string" ? req.query.raceId : null;
    if (raceId !== null && !isUuid(raceId)) return res.status(400).json({ error: "raceId must be a uuid", reason: "spoiler_invalid_race" });
    try {
      if (!(await enabledFor(req))) return res.json({ enabled: false, available: false, settings: { ...DEFAULT_SETTINGS }, race: null });
      const { settings, available } = await readSettings(supabase, userId);
      const race = raceId ? await readRaceState(supabase, userId, raceId, settings) : null;
      return res.json({ enabled: true, available: available && (race?.available ?? true), settings, race: race?.race ?? null });
    } catch (error) {
      reportError(error, { tags: { route: "me_spoiler_shield_get" } });
      return res.status(500).json({ error: "Could not read the spoiler shield", reason: "spoiler_read_failed" });
    }
  });

  router.put("/settings", requireAuth, writeLimiter, async (req, res) => {
    const userId = userIdOf(req);
    if (!userId) return res.status(401).json({ error: "unauthorized" });
    const checked = sanitizeSettingsPatch(req.body);
    if (!checked.ok) return res.status(400).json({ error: checked.error, reason: checked.reason });
    try {
      if (!(await enabledFor(req))) return res.status(404).json({ error: "Not available", reason: "spoiler_off" });
      const out = await writeSettings(supabase, userId, checked.patch);
      if (!out.available) return res.status(503).json({ error: "Not available yet", reason: "spoiler_unavailable" });
      return res.json({ ok: true, settings: out.settings });
    } catch (error) {
      reportError(error, { tags: { route: "me_spoiler_shield_settings" } });
      return res.status(500).json({ error: "Could not save the spoiler shield", reason: "spoiler_write_failed" });
    }
  });

  router.put("/races/:raceId", requireAuth, writeLimiter, async (req, res) => {
    const userId = userIdOf(req);
    if (!userId) return res.status(401).json({ error: "unauthorized" });
    const raceId = req.params.raceId;
    const shield = (req.body as { shield?: unknown } | null)?.shield;
    if (!isUuid(raceId)) return res.status(400).json({ error: "raceId must be a uuid", reason: "spoiler_invalid_race" });
    if (shield !== null && typeof shield !== "boolean") return res.status(400).json({ error: "shield must be a boolean or null", reason: "spoiler_invalid_value" });
    try {
      if (!(await enabledFor(req))) return res.status(404).json({ error: "Not available", reason: "spoiler_off" });
      const out = await writeRaceShield(supabase, userId, raceId, shield as boolean | null);
      if (!out.available) return res.status(503).json({ error: "Not available yet", reason: "spoiler_unavailable" });
      return res.json({ ok: true, shield });
    } catch (error) {
      reportError(error, { tags: { route: "me_spoiler_shield_race" } });
      return res.status(500).json({ error: "Could not save the spoiler shield", reason: "spoiler_write_failed" });
    }
  });

  router.post("/races/:raceId/opened", requireAuth, writeLimiter, async (req, res) => {
    const userId = userIdOf(req);
    if (!userId) return res.status(401).json({ error: "unauthorized" });
    const raceId = req.params.raceId;
    const stage = (req.body as { stage?: unknown } | null)?.stage;
    if (!isUuid(raceId)) return res.status(400).json({ error: "raceId must be a uuid", reason: "spoiler_invalid_race" });
    if (!isValidStage(stage)) return res.status(400).json({ error: "stage must be an integer between 1 and 64", reason: "spoiler_invalid_stage" });
    try {
      if (!(await enabledFor(req))) return res.status(404).json({ error: "Not available", reason: "spoiler_off" });
      const out = await openStage(supabase, userId, raceId, stage);
      if (!out.available) return res.status(503).json({ error: "Not available yet", reason: "spoiler_unavailable" });
      return res.json({ ok: true, openedStages: out.openedStages });
    } catch (error) {
      reportError(error, { tags: { route: "me_spoiler_shield_open" } });
      return res.status(500).json({ error: "Could not open the stage", reason: "spoiler_write_failed" });
    }
  });

  return router;
}
