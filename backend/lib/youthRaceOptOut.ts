// #5944 · fravaelg U23-/juniorloeb pr. trup ("Enter races" / "Train only").
//
// Skitse (ejer-go 1/10): docs/design/mockups-5944-youth-opt-out-2026-10-01/sketch.png.
// Regel-SSOT: docs/YOUTH_RULES.md §2.3 og docs/ASSISTANT_RULES.md ("Train only").
//
// Én raekke i team_youth_race_opt_outs pr. (hold, trup) = "Train only":
//   • assistenten udtager ikke truppen (sweepen i raceEntryGenerator, loebstidens
//     redning i raceRunner.fillMissingTeamEntries og knappen POST /selection/auto),
//   • manuel tilmelding af truppen til et ungdomsloeb afvises server-side
//     (prepareSelectionChange → 409 selection_youth_squad_train_only).
// Ingen raekke = "Enter races" (standard, uaendret).
//
// "Laast" loebsdag = truppen kan ikke laengere aendres: loebet er ikke 'scheduled',
// en etape er koert (#1825/#4534), eller holdet har trykket "Train now" paa en af
// loebets datoer (#4847). Et skift til "Train only" fjerner holdets tilmeldinger
// til truppens ULAASTE loeb; laaste loeb beholder deres felt.
//
// Manglende tabel (foer auto-migrate har koert): alle laesere svarer "Enter
// races" (fail-open = dagens adfaerd), skrivestien svarer 503.
import { isRaceDateTrainNowLocked } from "./trainNowLock.js";

export const YOUTH_RACE_OPT_OUT_TABLE = "team_youth_race_opt_outs";
export const OPT_OUT_SQUADS = ["u23", "junior"] as const;
export type OptOutSquad = (typeof OPT_OUT_SQUADS)[number];

/** Fejlkoden en manuel tilmelding afvises med (frontend oversaetter den). */
export const TRAIN_ONLY_SELECTION_ERROR = "selection_youth_squad_train_only";

type PgError = { code?: string; message?: string } | null | undefined;
type Result<T> = { data: T | null; error: PgError };

// Minimal kontrakt for den del af supabase-js vi bruger. Testen giver en fake.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = { from: (table: string) => any };

export function isOptOutSquad(value: unknown): value is OptOutSquad {
  return value === "u23" || value === "junior";
}

export function optOutKey(teamId: string, squad: string): string {
  return `${teamId}|${squad}`;
}

/** 42P01 (Postgres) / PGRST205 (PostgREST schema cache): tabellen er ikke migreret endnu. */
export function isMissingOptOutTable(error: PgError): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

/**
 * Alle (hold, trup)-noegler sat til "Train only". Med `teamIds` kun for de hold.
 * Tabellen er lille (højst 2 raekker pr. menneskehold), men pagineres alligevel
 * stabilt paa PK, saa den aldrig rammer PostgRESTs 1000-raekkers loft tavst.
 */
export async function loadOptedOutKeys(
  supabase: Supabase,
  { teamIds = null }: { teamIds?: string[] | null } = {},
): Promise<Set<string>> {
  const keys = new Set<string>();
  if (teamIds && !teamIds.length) return keys;
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let query = supabase.from(YOUTH_RACE_OPT_OUT_TABLE).select("team_id, squad");
    if (teamIds) query = query.in("team_id", teamIds);
    const { data, error } = (await query
      .order("team_id", { ascending: true }).order("squad", { ascending: true })
      .range(from, from + PAGE - 1)) as Result<Array<{ team_id: string; squad: string }>>;
    if (error) {
      if (isMissingOptOutTable(error)) return keys;
      throw new Error(`${YOUTH_RACE_OPT_OUT_TABLE}: ${error.message ?? error}`);
    }
    for (const row of data ?? []) keys.add(optOutKey(row.team_id, row.squad));
    if ((data ?? []).length < PAGE) break;
  }
  return keys;
}

/** Er holdets trup sat til "Train only"? Seniorer er aldrig fravalgt. */
export async function isTeamSquadTrainOnly(
  supabase: Supabase,
  { teamId, squad }: { teamId: string | null | undefined; squad: string | null | undefined },
): Promise<boolean> {
  if (!teamId || !isOptOutSquad(squad)) return false;
  // (team_id, squad) er PK, saa hoejst én raekke.
  const { data, error } = (await supabase.from(YOUTH_RACE_OPT_OUT_TABLE)
    .select("team_id").eq("team_id", teamId).eq("squad", squad).maybeSingle()) as Result<unknown>;
  if (error) {
    if (isMissingOptOutTable(error)) return false;
    throw new Error(`${YOUTH_RACE_OPT_OUT_TABLE}: ${error.message ?? error}`);
  }
  return data != null;
}

/** Holdets valg for begge ungdomstrupper. `available=false` = tabellen findes ikke endnu. */
export async function loadTeamTrainOnly(
  supabase: Supabase, teamId: string,
): Promise<{ available: boolean; u23: boolean; junior: boolean }> {
  const { data, error } = (await supabase.from(YOUTH_RACE_OPT_OUT_TABLE)
    .select("squad").eq("team_id", teamId)) as Result<Array<{ squad: string }>>;
  if (error) {
    if (isMissingOptOutTable(error)) return { available: false, u23: false, junior: false };
    throw new Error(`${YOUTH_RACE_OPT_OUT_TABLE}: ${error.message ?? error}`);
  }
  const squads = new Set((data ?? []).map((r) => r.squad));
  return { available: true, u23: squads.has("u23"), junior: squads.has("junior") };
}

export interface SquadRace {
  id: string;
  status: string | null;
  stages_completed: number | null;
  game_day_start: number | null;
}

/** Kan loebets felt stadig aendres (ses bort fra holdets "Train now"-laas)? */
export function isRaceOpenForChange(race: SquadRace): boolean {
  return race.status === "scheduled" && (race.stages_completed ?? 0) === 0;
}

/**
 * Ren model: hvilke af holdets tilmeldte loeb skal ryddes ved et skift til
 * "Train only"? Kun aabne loeb, og ikke de "Train now"-laaste. Laaste loeb
 * beholder deres felt (de er allerede afgjort for holdet).
 */
export function racesToClearOnTrainOnly({
  races, enteredRaceIds, trainNowLockedRaceIds,
}: {
  races: SquadRace[]; enteredRaceIds: Set<string>; trainNowLockedRaceIds: Set<string>;
}): string[] {
  return races
    .filter((r) => enteredRaceIds.has(r.id) && isRaceOpenForChange(r) && !trainNowLockedRaceIds.has(r.id))
    .map((r) => r.id);
}

/** Holdets pulje for truppen (aldrig seniorpuljen). */
export function teamPoolForSquad(
  team: { u23_league_division_id?: number | null; junior_league_division_id?: number | null } | null | undefined,
  squad: OptOutSquad,
): number | null {
  if (!team) return null;
  const id = squad === "u23" ? team.u23_league_division_id : team.junior_league_division_id;
  return id ?? null;
}

/**
 * Truppens loeb i den aktive saeson i holdets pulje for truppen. Tom liste naar
 * holdet ingen pulje har eller ingen saeson er aktiv.
 */
async function loadSquadRaces(
  supabase: Supabase, { team, squad }: { team: TeamRow; squad: OptOutSquad },
): Promise<SquadRace[]> {
  const poolId = teamPoolForSquad(team, squad);
  if (poolId == null) return [];
  const { data: season, error: seasonError } = (await supabase.from("seasons")
    .select("id").eq("status", "active").maybeSingle()) as Result<{ id: string }>;
  if (seasonError) throw new Error(`seasons: ${seasonError.message}`);
  if (!season?.id) return [];
  // pagination-safe: én trups loeb i én pulje i én saeson (to-cifret).
  const { data, error } = (await supabase.from("races")
    .select("id, status, stages_completed, game_day_start")
    .eq("season_id", season.id).eq("squad", squad).eq("league_division_id", poolId)) as Result<SquadRace[]>;
  if (error) throw new Error(`races (${squad}): ${error.message}`);
  return data ?? [];
}

type TeamRow = { id: string; u23_league_division_id?: number | null; junior_league_division_id?: number | null };

/**
 * Foerste ulaaste loebsdag for truppen (races.game_day_start), eller null.
 * Det er dagen et skift faar virkning fra (skitsens "Takes effect from day N").
 */
export async function firstUnlockedRaceDay(
  supabase: Supabase,
  { team, squad, races = null }: { team: TeamRow; squad: OptOutSquad; races?: SquadRace[] | null },
): Promise<number | null> {
  const list = (races ?? await loadSquadRaces(supabase, { team, squad }))
    .filter(isRaceOpenForChange)
    .sort((a, b) => (a.game_day_start ?? Infinity) - (b.game_day_start ?? Infinity));
  for (const race of list) {
    if (race.game_day_start == null) continue;
    if (await isRaceDateTrainNowLocked({ supabase, teamId: team.id, raceId: race.id })) continue;
    return race.game_day_start;
  }
  return null;
}

/**
 * Saet truppens valg. "Train only" skriver raekken og fjerner holdets
 * tilmeldinger til truppens ulaaste loeb. "Enter races" sletter raekken;
 * assistenten tilmelder truppen igen ved sin naeste koersel.
 *
 * Kaster `{ code: "opt_out_unavailable" }` naar tabellen ikke er migreret.
 */
export async function setTeamSquadTrainOnly(
  supabase: Supabase,
  { team, squad, trainOnly }: { team: TeamRow; squad: OptOutSquad; trainOnly: boolean },
): Promise<{ trainOnly: boolean; clearedRaceIds: string[]; effectiveFromDay: number | null }> {
  const unavailable = () => Object.assign(new Error("opt_out_unavailable"), { code: "opt_out_unavailable" });

  if (!trainOnly) {
    const { error } = (await supabase.from(YOUTH_RACE_OPT_OUT_TABLE)
      .delete().eq("team_id", team.id).eq("squad", squad)) as Result<unknown>;
    if (error) {
      if (isMissingOptOutTable(error)) throw unavailable();
      throw new Error(`${YOUTH_RACE_OPT_OUT_TABLE} delete: ${error.message}`);
    }
    const effectiveFromDay = await firstUnlockedRaceDay(supabase, { team, squad });
    return { trainOnly: false, clearedRaceIds: [], effectiveFromDay };
  }

  // Raekken foerst: fra dette oejeblik afviser manuel tilmelding og assistenten
  // springer truppen over, saa en samtidig sweep ikke kan skrive nye raekker ind
  // i et loeb vi rydder lige nedenfor.
  const { error: upsertError } = (await supabase.from(YOUTH_RACE_OPT_OUT_TABLE)
    .upsert({ team_id: team.id, squad }, { onConflict: "team_id,squad", ignoreDuplicates: true })) as Result<unknown>;
  if (upsertError) {
    if (isMissingOptOutTable(upsertError)) throw unavailable();
    throw new Error(`${YOUTH_RACE_OPT_OUT_TABLE} upsert: ${upsertError.message}`);
  }

  const races = await loadSquadRaces(supabase, { team, squad });
  const openIds = races.filter(isRaceOpenForChange).map((r) => r.id);
  let clearedRaceIds: string[] = [];
  if (openIds.length) {
    // pagination-safe: holdets entries i truppens aabne loeb (loeb × højst én trup).
    const { data: entries, error: entriesError } = (await supabase.from("race_entries")
      .select("race_id").eq("team_id", team.id).in("race_id", openIds)) as Result<Array<{ race_id: string }>>;
    if (entriesError) throw new Error(`race_entries (${squad}): ${entriesError.message}`);
    const enteredRaceIds = new Set((entries ?? []).map((e) => e.race_id));
    const trainNowLockedRaceIds = new Set<string>();
    for (const raceId of enteredRaceIds) {
      if (await isRaceDateTrainNowLocked({ supabase, teamId: team.id, raceId })) trainNowLockedRaceIds.add(raceId);
    }
    clearedRaceIds = racesToClearOnTrainOnly({ races, enteredRaceIds, trainNowLockedRaceIds });
    if (clearedRaceIds.length) {
      // Frisk laesning lige foer sletningen: et loeb der er startet siden
      // listen blev hentet, beholder sit felt (frys, #1825).
      const { data: fresh, error: freshError } = (await supabase.from("races")
        .select("id, status, stages_completed, game_day_start").in("id", clearedRaceIds)) as Result<SquadRace[]>;
      if (freshError) throw new Error(`races (${squad} recheck): ${freshError.message}`);
      clearedRaceIds = (fresh ?? []).filter(isRaceOpenForChange).map((r) => r.id);
    }
    if (clearedRaceIds.length) {
      const { error: deleteError } = (await supabase.from("race_entries").delete()
        .eq("team_id", team.id).in("race_id", clearedRaceIds)) as Result<unknown>;
      if (deleteError) throw new Error(`race_entries delete (${squad} train only): ${deleteError.message}`);
    }
  }
  const effectiveFromDay = await firstUnlockedRaceDay(supabase, { team, squad, races });
  return { trainOnly: true, clearedRaceIds, effectiveFromDay };
}
