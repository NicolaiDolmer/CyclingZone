// #6514 · Løbshistorik (Resultater → Arkiv bag race_library_v2). Ren model uden
// React/IO, så `node --test` kan loade den.
//
// Ejer-beslutning 15/10: kun afsluttede løb; pr. løb vindere pr. sæson, dit
// bedste resultat, forsvarende mester og typisk afgørelse. Ingen km. Søgning og
// paginering genbruger idéerne fra codex/6514-loebsbibliotek (PR #6636):
// accent-uafhængig navnesøgning og faste sider.
//
// "Et løb" er en familie af udgaver med samme navn og løbstype i én pulje, én
// udgave pr. sæson. Vindere og placeringer læses af race_results:
//   - endagsløb: result_type "stage"
//   - etapeløb:  result_type "gc" ved løbets sidste etape (højeste stage_number),
//     samme regel som løbssiden ("endeligt klassement = højeste etape-nummer").

import { decidedIn, profileGroup, type DecidedGroup, type PeekGroup } from "./racePeek.ts";

export interface HistoryRace {
  id: string;
  name: string;
  race_type?: string | null;
  race_class?: string | null;
  stages?: number | null;
  season_number?: number | null;
}
export interface ResultRow {
  race_id: string;
  stage_number?: number | null;
  result_type?: string | null;
  rank?: number | null;
  rider_id?: string | null;
  rider_name?: string | null;
  team_name?: string | null;
}
export interface ProfileRow { race_id: string; stage_number?: number | null; profile_type?: string | null }
export interface EditionWinner { riderId: string | null; name: string | null; teamName: string | null }
export interface Edition { raceId: string; season: number | null; winner: EditionWinner | null; myRank: number | null }
export interface Champion extends EditionWinner { season: number | null; raceId: string }
export interface HistoryRow {
  key: string;
  name: string;
  raceType: string | null;
  raceClass: string | null;
  stages: number;
  latestSeason: number | null;
  editions: Edition[];
  myBest: { rank: number; season: number | null; raceId: string } | null;
  decided: DecidedGroup[];
  decidedStageCount: number;
  champion: Champion | null;
}

/** Accent- og tegn-uafhængig søgenøgle: "Tour de l'Hexagone" ≈ "tour de lhexagone". */
export function normalizeRaceName(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function matchesSearch(name: string, query: string): boolean {
  const q = normalizeRaceName(query);
  return q === "" || normalizeRaceName(name).includes(q);
}

const isStageRace = (race: HistoryRace | undefined) => race?.race_type === "stage_race";
const primaryType = (race: HistoryRace | undefined) => (isStageRace(race) ? "gc" : "stage");

/** Sidste etapes nummer pr. løb ud fra rank-1-rækkerne (gc for etapeløb). */
export function finalStageByRace(races: readonly HistoryRace[] = [], winnerRows: readonly ResultRow[] = []): Map<string, number> {
  const byId = new Map(races.map((r) => [r.id, r]));
  const out = new Map<string, number>();
  for (const row of winnerRows) {
    const race = byId.get(row.race_id);
    if (!race || row.result_type !== primaryType(race)) continue;
    const n = Number(row.stage_number) || 1;
    const cur = out.get(row.race_id);
    if (cur === undefined || n > cur) out.set(row.race_id, n);
  }
  return out;
}

/** Udgavens vinder: rank 1 i den primære klassifikation ved sidste etape. */
function editionWinner(race: HistoryRace, rows: readonly ResultRow[], finalStage: number): EditionWinner | null {
  const want = primaryType(race);
  const hit = rows.find((r) => r.result_type === want && Number(r.rank) === 1
    && (Number(r.stage_number) || 1) === finalStage);
  if (!hit) return null;
  return { riderId: hit.rider_id ?? null, name: hit.rider_name || null, teamName: hit.team_name || null };
}

/** Bygger løbshistorikken: én række pr. løb, nyeste udgave først, så navn. */
export function buildRaceHistory({ races = [], winnerRows = [], myRows = [], profiles = [] }: {
  races?: readonly HistoryRace[];
  winnerRows?: readonly ResultRow[];
  myRows?: readonly ResultRow[];
  profiles?: readonly ProfileRow[];
} = {}): HistoryRow[] {
  const finals = finalStageByRace(races, winnerRows);
  const winnersByRace = groupBy(winnerRows, (r) => r.race_id);
  const mineByRace = groupBy(myRows, (r) => r.race_id);
  const profilesByRace = groupBy(profiles, (p) => p.race_id);

  const families = new Map<string, HistoryRace[]>();
  for (const race of races) {
    const key = `${race.name}|${race.race_type ?? ""}`;
    const list = families.get(key) ?? [];
    list.push(race);
    families.set(key, list);
  }

  const rows: HistoryRow[] = [];
  for (const [key, editions] of families) {
    editions.sort((a, b) => (b.season_number ?? 0) - (a.season_number ?? 0));
    const latest = editions[0];
    const eds: Edition[] = editions.map((race) => {
      const finalStage = finals.get(race.id) ?? 1;
      const mine = (mineByRace.get(race.id) || [])
        .filter((r) => r.result_type === primaryType(race) && (Number(r.stage_number) || 1) === finalStage)
        .map((r) => Number(r.rank))
        .filter((n) => Number.isFinite(n) && n > 0);
      return {
        raceId: race.id,
        season: race.season_number ?? null,
        winner: editionWinner(race, winnersByRace.get(race.id) || [], finalStage),
        myRank: mine.length ? Math.min(...mine) : null,
      };
    });

    // Dit bedste: laveste placering; ved lighed den nyeste sæson.
    let myBest: HistoryRow["myBest"] = null;
    for (const ed of eds) {
      if (ed.myRank == null) continue;
      if (!myBest || ed.myRank < myBest.rank) myBest = { rank: ed.myRank, season: ed.season, raceId: ed.raceId };
    }

    // Typisk afgørelse: den nyeste udgave med en offentliggjort rute.
    const withProfiles = editions.find((r) => (profilesByRace.get(r.id) || []).length > 0);
    const groups: PeekGroup[] = withProfiles
      ? (profilesByRace.get(withProfiles.id) || [])
        .slice().sort((a, b) => (a.stage_number ?? 0) - (b.stage_number ?? 0))
        .map((p) => profileGroup(p.profile_type))
      : [];

    const row: HistoryRow = {
      key,
      name: latest.name,
      raceType: latest.race_type ?? null,
      raceClass: latest.race_class ?? null,
      stages: latest.stages ?? 1,
      latestSeason: latest.season_number ?? null,
      editions: eds,
      myBest,
      decided: decidedIn(groups),
      decidedStageCount: groups.length,
      champion: null,
    };
    row.champion = defendingChampion(row);
    rows.push(row);
  }

  rows.sort((a, b) => (b.latestSeason ?? 0) - (a.latestSeason ?? 0) || a.name.localeCompare(b.name));
  return rows;
}

// Forsvarende mester = vinderen af den NYESTE udgave. Har den nyeste udgave
// ingen registreret vinder, er der ingen forsvarende mester (aldrig en ældre).
export function defendingChampion(row: Pick<HistoryRow, "editions"> | null | undefined): Champion | null {
  const latest = row?.editions?.[0];
  return latest?.winner ? { ...latest.winner, season: latest.season, raceId: latest.raceId } : null;
}

export const HISTORY_PAGE_SIZE = 25;

/** Side `page` (0-baseret) af rækkerne + tællere til "Viser 1-25 af 61". */
export function paginate<T>(rows: readonly T[] = [], page = 0, size = HISTORY_PAGE_SIZE) {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(0, page), pages - 1);
  const from = p * size;
  return { rows: rows.slice(from, from + size), page: p, pages, total, from: total ? from + 1 : 0, to: Math.min(from + size, total) };
}

function groupBy<T>(list: readonly T[], keyFn: (item: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const item of list || []) {
    const k = keyFn(item);
    const arr = m.get(k) ?? [];
    arr.push(item);
    m.set(k, arr);
  }
  return m;
}
