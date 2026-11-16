// #5841 · Udgave-skiftet på løbssiden (variant A, ejer 16/11), ren model uden React og IO.
//
// Domænet: kalendermaterialiseringen indsætter én kopi af hvert katalogløb i hver pulje,
// så "samme løb" er samme pool_race_id. Puljerne er rækkerne med samme sæson og samme
// division (league_divisions.tier); sæsonerne er rækkerne med andre season_id.
// Pulje-bogstavet kommer fra league_divisions.pool_index (0 = A), som kalenderen.
//
// Vinder og forspring pr. udgave læses af de gemte resultater:
//   kørt færdig: rank 1 i "gc" ved højeste etape (samme kanon som Løbshistorik), forspring
//     = rank 2's gab ved samme etape.
//   i gang: seneste kørte etapes vinder (rank 1 i "stage"), forspring = rank 2's gab.
//   ikke startet: intet navn.
// Et gab der ikke kan læses ("+M:SS"), vises ikke: hellere intet tal end et forkert.

export interface EditionRaceRow {
  id: string;
  season_id: string | null;
  league_division_id: number | null;
  status?: string | null;
  stages?: number | null;
  stages_completed?: number | null;
  season?: { number?: number | null; status?: string | null } | null;
  division?: { tier?: number | null; pool_index?: number | null; label?: string | null } | null;
}

export interface EditionResultRow {
  race_id: string;
  stage_number?: number | null;
  result_type: string;
  rank: number | null;
  rider_name?: string | null;
  finish_time?: string | null;
  rider?: { firstname?: string | null; lastname?: string | null } | null;
}

export type EditionSummary =
  | { kind: "won"; name: string; marginSec: number | null; time: string | null }
  | { kind: "stage"; stage: number; name: string; marginSec: number | null }
  | { kind: "upcoming" }
  | { kind: "unknown" };

export interface PoolOption {
  raceId: string;
  letter: string;
  own: boolean;
  current: boolean;
  summary: EditionSummary;
}

export interface SeasonOption {
  /** Udgaven et klik åbner: holdets pulje den sæson, ellers første pulje (divisionstræets orden). */
  raceId: string;
  seasonNumber: number | null;
  live: boolean;
  current: boolean;
  tier: number | null;
  /** Holdets pulje den sæson (bogstav), eller null når holdet ikke kørte løbet. */
  ownLetter: string | null;
  summary: EditionSummary;
}

export interface EditionSwitchModel {
  pools: PoolOption[];
  seasons: SeasonOption[];
  currentLetter: string | null;
  currentSeasonNumber: number | null;
  tier: number | null;
  /** Holdets egen udgave i den viste sæson, når det ikke er den der vises. */
  ownElsewhere: { raceId: string; letter: string | null; tier: number | null; sameTier: boolean } | null;
}

/** Pulje-bogstav fra pool_index (0 = A). */
export function poolLetter(poolIndex: number | null | undefined): string | null {
  if (poolIndex == null || !Number.isInteger(poolIndex) || poolIndex < 0 || poolIndex > 25) return null;
  return String.fromCharCode(65 + poolIndex);
}

/** "+M:SS" eller "M:SS" til sekunder, ellers null (ukendt er ikke 0). */
export function gapToSeconds(finishTime: string | null | undefined): number | null {
  if (typeof finishTime !== "string") return null;
  const m = /^\+?(\d+):(\d{1,2})$/.exec(finishTime.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Forspring som "M:SS" (tabeltal). */
export function formatMargin(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function riderName(row: EditionResultRow): string | null {
  const first = row.rider?.firstname?.trim() ?? "";
  const last = row.rider?.lastname?.trim() ?? "";
  const joined = `${first} ${last}`.trim();
  return joined || row.rider_name?.trim() || null;
}

function isFinished(race: EditionRaceRow): boolean {
  if (race.status === "completed") return true;
  const stages = Number(race.stages) || 0;
  return stages > 0 && (Number(race.stages_completed) || 0) >= stages;
}

function topTwo(rows: EditionResultRow[]): { first: EditionResultRow | null; second: EditionResultRow | null } {
  return {
    first: rows.find((r) => r.rank === 1) ?? null,
    second: rows.find((r) => r.rank === 2) ?? null,
  };
}

/** Vinder og forspring for én udgave (se filens hoved). */
export function editionSummary(race: EditionRaceRow, results: readonly EditionResultRow[]): EditionSummary {
  const mine = results.filter((r) => r.race_id === race.id);
  if (isFinished(race)) {
    const gc = mine.filter((r) => r.result_type === "gc");
    if (gc.length === 0) return { kind: "unknown" };
    const last = Math.max(...gc.map((r) => Number(r.stage_number) || 1));
    const { first, second } = topTwo(gc.filter((r) => (Number(r.stage_number) || 1) === last));
    const name = first ? riderName(first) : null;
    if (!first || !name) return { kind: "unknown" };
    const time = typeof first.finish_time === "string" && /^\d+:\d{2}:\d{2}$/.test(first.finish_time.trim())
      ? first.finish_time.trim() : null;
    return { kind: "won", name, marginSec: second ? gapToSeconds(second.finish_time) : null, time };
  }
  const done = Number(race.stages_completed) || 0;
  if (done <= 0) return { kind: "upcoming" };
  const { first, second } = topTwo(mine.filter((r) => r.result_type === "stage" && (Number(r.stage_number) || 1) === done));
  const name = first ? riderName(first) : null;
  if (!first || !name) return { kind: "unknown" };
  return { kind: "stage", stage: done, name, marginSec: second ? gapToSeconds(second.finish_time) : null };
}

const tierOf = (r: EditionRaceRow) => (r.division?.tier ?? null);
const poolIndexOf = (r: EditionRaceRow) => (r.division?.pool_index ?? null);
function byTree(a: EditionRaceRow, b: EditionRaceRow): number {
  return (tierOf(a) ?? 99) - (tierOf(b) ?? 99) || (poolIndexOf(a) ?? 99) - (poolIndexOf(b) ?? 99) || a.id.localeCompare(b.id);
}

/**
 * Menuernes indhold. `editions` er alle rækker med løbets pool_race_id (inkl. den viste),
 * `ownRaceIds` de udgaver holdet har ryttere i. null = intet at skifte imellem.
 */
export function buildEditionSwitch({ currentRaceId, editions, results, ownRaceIds }: {
  currentRaceId: string;
  editions: readonly EditionRaceRow[];
  results: readonly EditionResultRow[];
  ownRaceIds: ReadonlySet<string>;
}): EditionSwitchModel | null {
  const current = editions.find((e) => e.id === currentRaceId);
  if (!current) return null;
  const tier = tierOf(current);

  const sameSeason = editions.filter((e) => e.season_id === current.season_id);
  const pools: PoolOption[] = sameSeason
    .filter((e) => tierOf(e) === tier && poolLetter(poolIndexOf(e)) != null)
    .sort(byTree)
    .map((e) => ({
      raceId: e.id,
      letter: poolLetter(poolIndexOf(e)) as string,
      own: ownRaceIds.has(e.id),
      current: e.id === current.id,
      summary: editionSummary(e, results),
    }));

  const bySeason = new Map<string, EditionRaceRow[]>();
  for (const e of editions) {
    if (!e.season_id) continue;
    const list = bySeason.get(e.season_id) ?? [];
    list.push(e);
    bySeason.set(e.season_id, list);
  }
  const seasons: SeasonOption[] = [...bySeason.entries()].map(([seasonId, rows]) => {
    const sorted = [...rows].sort(byTree);
    const own = sorted.find((e) => ownRaceIds.has(e.id)) ?? null;
    const isCurrent = seasonId === current.season_id;
    const target = isCurrent ? current : own ?? sorted.find((e) => tierOf(e) === tier) ?? sorted[0];
    return {
      raceId: target.id,
      seasonNumber: target.season?.number ?? null,
      live: target.season?.status === "active",
      current: isCurrent,
      tier: tierOf(target),
      ownLetter: own ? poolLetter(poolIndexOf(own)) : null,
      summary: editionSummary(target, results),
    };
  }).sort((a, b) => (b.seasonNumber ?? -1) - (a.seasonNumber ?? -1));

  const ownHere = sameSeason.filter((e) => ownRaceIds.has(e.id)).sort(byTree)[0] ?? null;
  const ownElsewhere = ownHere && ownHere.id !== current.id
    ? { raceId: ownHere.id, letter: poolLetter(poolIndexOf(ownHere)), tier: tierOf(ownHere), sameTier: tierOf(ownHere) === tier }
    : null;

  // "Tilbage til dit løb" skal stå, selv når ingen af menuerne har et valg (Codex #8303): komponenten skjuler
  // selv en menu med under to valg.
  if (pools.length < 2 && seasons.length < 2 && !ownElsewhere) return null;
  return {
    pools,
    seasons,
    currentLetter: poolLetter(poolIndexOf(current)),
    currentSeasonNumber: current.season?.number ?? null,
    tier,
    ownElsewhere,
  };
}

/** Næste fokus i en menu (pil op/ned, Home/End), rundt i begge ender. */
export function nextMenuFocus(index: number, count: number, key: string): number | null {
  if (count <= 0) return null;
  if (key === "ArrowDown") return (index + 1 + count) % count;
  if (key === "ArrowUp") return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
