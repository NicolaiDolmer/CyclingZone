// #6278 (del af #4321, ejer-beslutning 6/10 #2+#3) · server-side PostHog-milepael
// i kerne-rejsen: `first_race_with_own_squad` = foerste gang et menneskeligt holds
// ryttere har koert et faerdigt officielt loeb/etape.
//
// Hvorfor server-side: milepaelen sker i loebsfinaliseringen (cron/scheduler),
// ikke i browseren. Brugeren er ofte slet ikke online, naar hans foerste etape
// bliver koert, saa en klient-event ville tabe netop de spillere tragten skal maale.
//
// Kontrakt (bindende, se #6278):
//   • Postgres er sandheden og de-dup'en: en `player_events`-raekke med
//     event_name = FIRST_RACE_WITH_OWN_SQUAD_EVENT pr. bruger. Findes raekken,
//     sker der intet (hverken DB eller PostHog).
//   • PostHog faar en kopi via en afhaengighedsfri `fetch` til EU-endpointet,
//     distinct_id = brugerens interne UUID (samme id som frontendens identify).
//   • No-op mod PostHog naar env POSTHOG_PROJECT_KEY mangler. Raekken i Postgres
//     skrives stadig: den er produktets egen sandhed, ikke en PostHog-kopi.
//   • Aktiv afvisning respekteres: users.consent_preferences.analytics === false
//     (banneret er besvaret med nej) sendes aldrig til PostHog. Ubesvaret (null)
//     er ikke en afvisning (ejer 6/10 #3: identify efter login, intet nyt banner).
//   • Maa ALDRIG blokere eller vaelte loebsfinaliseringen: kaldet er
//     fire-and-forget, hver fejl sluges, PostHog-kaldet har timeout (~2 s).
//   • Kaldes EFTER resultat-skrivningen er committet, aldrig inde i den, og med
//     faste opslag pr. loeb (teams, player_events, users), aldrig pr. rytter.
//
// Kendt graense: to loeb der finaliseres i samme sekund for den samme nye
// manager kan begge naa at skrive raekken (ingen unik-noegle, ingen migration).
// Konsekvensen er en dublet-raekke/-event, aldrig et tab; analyse bruger
// "foerste forekomst pr. bruger".

import { captureException } from "./sentry.js";

export const POSTHOG_EU_CAPTURE_URL = "https://eu.i.posthog.com/i/v0/e/";
export const POSTHOG_KEY_ENV = "POSTHOG_PROJECT_KEY";
export const POSTHOG_DEFAULT_TIMEOUT_MS = 2000;
export const FIRST_RACE_WITH_OWN_SQUAD_EVENT = "first_race_with_own_squad";

// PostgREST `.in()` bygger id-listen ind i URL'en. Et loebsfelt er langt under
// denne graense, men chunking holder URL'en kort selv i et stort felt.
const IN_CHUNK_SIZE = 150;
const DAY_MS = 24 * 60 * 60 * 1000;

type PgError = { message?: string } | null | undefined;
type Result<T> = { data: T | null; error: PgError };
// Minimal kontrakt for den del af supabase-js vi bruger. Testen giver en fake.
// Samme bevidste `any`-moenster som youthRaceOptOut.ts.
type Supabase = { from: (table: string) => any };

type FetchResponse = { ok: boolean; status: number };
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<FetchResponse>;

type ErrorReporter = (err: unknown, context: Record<string, unknown>) => void;

export type ServerEvent = {
  event: string;
  distinctId: string;
  properties?: Record<string, unknown>;
  timestamp?: string;
};

export type CaptureOptions = {
  apiKey?: string | null;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  onError?: (err: unknown) => void;
};

/** Projekt-noeglen fra env, eller null (= PostHog-delen er en no-op). */
export function getPosthogProjectKey(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env[POSTHOG_KEY_ENV];
  const key = typeof raw === "string" ? raw.trim() : "";
  return key ? key : null;
}

/**
 * true KUN naar brugeren aktivt har sagt nej til analytics (banneret besvaret).
 * null/ubesvaret/ugyldig form er ikke en afvisning.
 */
export function hasDeclinedAnalytics(consentPreferences: unknown): boolean {
  if (!consentPreferences || typeof consentPreferences !== "object") return false;
  return (consentPreferences as { analytics?: unknown }).analytics === false;
}

/**
 * Sender ét event til PostHogs EU capture-endpoint. Kaster ALDRIG: returnerer
 * true ved 2xx, ellers false (manglende noegle, timeout, netvaerk, ikke-2xx).
 */
export async function captureServerEvent(event: ServerEvent, options: CaptureOptions = {}): Promise<boolean> {
  const apiKey = options.apiKey === undefined ? getPosthogProjectKey() : options.apiKey;
  if (!apiKey) return false;
  if (!event?.event || !event?.distinctId) return false;

  const fetchImpl: FetchLike | undefined = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (typeof fetchImpl !== "function") return false;

  const timeoutMs = options.timeoutMs ?? POSTHOG_DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // En haengende PostHog-forbindelse maa ikke holde processen (fx et cron-script) i live.
  (timer as { unref?: () => void }).unref?.();

  try {
    const body = JSON.stringify({
      api_key: apiKey,
      event: event.event,
      distinct_id: event.distinctId,
      timestamp: event.timestamp ?? new Date().toISOString(),
      properties: { ...(event.properties ?? {}), $lib: "cyclingzone-backend" },
    });
    const request = fetchImpl(POSTHOG_EU_CAPTURE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });
    // Timeouten haandhaeves ogsaa selv om fetch-implementationen ignorerer signalet.
    const timedOut = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(new Error(`PostHog capture timed out after ${timeoutMs} ms`)), { once: true });
    });
    const res = await Promise.race([request, timedOut]);
    if (!res?.ok) {
      options.onError?.(new Error(`PostHog capture returned HTTP ${res?.status ?? "?"}`));
      return false;
    }
    return true;
  } catch (err) {
    // best-effort: analytics-kopien maa aldrig kaste ind i kalderen.
    try {
      options.onError?.(err);
    } catch {
      // best-effort: en fejlende onError-callback sluges ogsaa.
    }
    return false;
  } finally {
    clearTimeout(timer);
  }
}

type ResultRow = { team_id?: string | null };
type TeamRow = {
  id: string;
  user_id: string | null;
  is_ai?: boolean | null;
  is_bank?: boolean | null;
  is_test_account?: boolean | null;
};

/** Unikke, ikke-tomme team_id'er fra loebets resultat-raekker (sorteret, deterministisk). */
export function teamIdsFromResultRows(resultRows: ResultRow[] | null | undefined): string[] {
  const ids = new Set<string>();
  for (const row of resultRows ?? []) {
    if (row?.team_id) ids.add(String(row.team_id));
  }
  return [...ids].sort();
}

/** Menneskehold-diskriminatoren fra ANALYTICS_STACK §4a. */
export function isHumanTeam(team: TeamRow | null | undefined): boolean {
  return Boolean(team && team.user_id && team.is_ai === false && team.is_bank !== true && team.is_test_account !== true);
}

/**
 * De-dup-udvaelgelsen: hvilke brugere i loebet har endnu IKKE milepaelen?
 * Én manager med to hold i samme loeb giver én kandidat (laveste team-id).
 */
export function selectNewMilestoneCandidates({
  teams,
  existingUserIds,
}: {
  teams: TeamRow[] | null | undefined;
  existingUserIds: Iterable<string>;
}): Array<{ userId: string; teamId: string }> {
  const seen = new Set<string>(existingUserIds);
  const out: Array<{ userId: string; teamId: string }> = [];
  const sorted = [...(teams ?? [])].filter(isHumanTeam).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const team of sorted) {
    const userId = String(team.user_id);
    if (seen.has(userId)) continue;
    seen.add(userId);
    out.push({ userId, teamId: String(team.id) });
  }
  return out;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function selectIn<T>(supabase: Supabase, table: string, columns: string, column: string, ids: string[], extra?: (q: any) => any): Promise<T[]> {
  const rows: T[] = [];
  for (const part of chunk(ids, IN_CHUNK_SIZE)) {
    let query = supabase.from(table).select(columns).in(column, part);
    if (extra) query = extra(query);
    const { data, error } = (await query) as Result<T[]>;
    if (error) throw new Error(`${table} lookup failed: ${error.message ?? "unknown error"}`);
    rows.push(...(data ?? []));
  }
  return rows;
}

export type RecordMilestoneArgs = {
  supabase: Supabase;
  race: { id?: string | null; season_id?: string | null; squad?: string | null } | null | undefined;
  resultRows: ResultRow[] | null | undefined;
  stageNumber?: number | null;
  apiKey?: string | null;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: () => Date;
  reportError?: ErrorReporter;
};

export type RecordMilestoneResult = { recorded: number; sent: number; skipped?: string };

/**
 * Skriver milepaelen for de menneskehold i loebet der endnu ikke har den, og
 * sender en kopi til PostHog for dem der ikke har afvist analytics. Kaster aldrig.
 */
export async function recordFirstRaceWithOwnSquad(args: RecordMilestoneArgs): Promise<RecordMilestoneResult> {
  const reportError: ErrorReporter = args.reportError ?? captureException;
  const report = (err: unknown, stage: string) => {
    try {
      reportError(err, { tags: { flow: "race-run", stage: `posthog-milestone-${stage}` }, raceId: args.race?.id ?? null });
    } catch {
      // best-effort: fejl-rapporteringen maa heller ikke kaste.
    }
  };

  try {
    const { supabase, race } = args;
    // Officielt loeb = et rigtigt saesonloeb (dry-run og preview naar aldrig hertil).
    if (!supabase || !race?.id || !race.season_id) return { recorded: 0, sent: 0, skipped: "not_official" };

    const teamIds = teamIdsFromResultRows(args.resultRows);
    if (!teamIds.length) return { recorded: 0, sent: 0, skipped: "no_teams" };

    const teams = await selectIn<TeamRow>(supabase, "teams", "id, user_id, is_ai, is_bank, is_test_account", "id", teamIds);
    const humanUserIds = [...new Set(teams.filter(isHumanTeam).map((t) => String(t.user_id)))].sort();
    if (!humanUserIds.length) return { recorded: 0, sent: 0, skipped: "no_human_teams" };

    const existing = await selectIn<{ user_id: string }>(supabase, "player_events", "user_id", "user_id", humanUserIds, (q) =>
      q.eq("event_name", FIRST_RACE_WITH_OWN_SQUAD_EVENT),
    );
    const candidates = selectNewMilestoneCandidates({ teams, existingUserIds: existing.map((r) => String(r.user_id)) });
    if (!candidates.length) return { recorded: 0, sent: 0, skipped: "already_recorded" };

    const users = await selectIn<{ id: string; created_at?: string | null; consent_preferences?: unknown }>(
      supabase,
      "users",
      "id, created_at, consent_preferences",
      "id",
      candidates.map((c) => c.userId),
    );
    const userById = new Map(users.map((u) => [String(u.id), u]));
    const now = (args.now ?? (() => new Date()))();

    const rows = candidates.map((c) => {
      const createdAt = userById.get(c.userId)?.created_at;
      const createdMs = createdAt ? Date.parse(createdAt) : NaN;
      return {
        team_id: c.teamId,
        user_id: c.userId,
        event_name: FIRST_RACE_WITH_OWN_SQUAD_EVENT,
        event_data: {
          race_id: race.id,
          stage_number: args.stageNumber ?? null,
          squad: race.squad ?? null,
          // Skiller rigtige nye managere fra veteraner der faar raekken ved
          // deres foerste loeb efter udrulningen (ingen backfill).
          days_since_signup: Number.isFinite(createdMs) ? Math.max(0, Math.floor((now.getTime() - createdMs) / DAY_MS)) : null,
          source: "server",
        },
      };
    });

    const { error: insertError } = (await supabase.from("player_events").insert(rows)) as Result<unknown>;
    if (insertError) {
      // Ingen PostHog-kopi uden Postgres-raekken: ellers ville naeste etape sende igen.
      report(new Error(`player_events ${FIRST_RACE_WITH_OWN_SQUAD_EVENT} insert failed: ${insertError.message ?? "unknown error"}`), "insert");
      return { recorded: 0, sent: 0, skipped: "insert_failed" };
    }

    const apiKey = args.apiKey === undefined ? getPosthogProjectKey() : args.apiKey;
    if (!apiKey) return { recorded: rows.length, sent: 0, skipped: "no_posthog_key" };

    const timestamp = now.toISOString();
    const sends = rows
      .filter((row) => !hasDeclinedAnalytics(userById.get(row.user_id)?.consent_preferences))
      .map((row) =>
        captureServerEvent(
          { event: FIRST_RACE_WITH_OWN_SQUAD_EVENT, distinctId: row.user_id, timestamp, properties: { ...row.event_data, team_id: row.team_id } },
          {
            apiKey,
            fetchImpl: args.fetchImpl,
            timeoutMs: args.timeoutMs,
            onError: (err) => console.warn(`  ⚠️  PostHog ${FIRST_RACE_WITH_OWN_SQUAD_EVENT} capture failed (race ${race.id}): ${(err as Error)?.message ?? err}`),
          },
        ),
      );
    const outcomes = await Promise.all(sends);
    return { recorded: rows.length, sent: outcomes.filter(Boolean).length };
  } catch (err) {
    // best-effort: milepaelen er analytics oven paa et allerede skrevet resultat.
    report(err, "record");
    return { recorded: 0, sent: 0, skipped: "error" };
  }
}

/**
 * Fire-and-forget-indgangen til loebsfinaliseringen: returnerer med det samme,
 * venter aldrig og kaster aldrig. Returnerer promiset kun til tests.
 */
export function recordFirstRaceWithOwnSquadInBackground(args: RecordMilestoneArgs): Promise<RecordMilestoneResult> {
  try {
    return recordFirstRaceWithOwnSquad(args).catch(() => ({ recorded: 0, sent: 0, skipped: "error" }));
  } catch {
    // best-effort: selv en synkron fejl i opsaetningen maa ikke naa kalderen.
    return Promise.resolve({ recorded: 0, sent: 0, skipped: "error" });
  }
}
