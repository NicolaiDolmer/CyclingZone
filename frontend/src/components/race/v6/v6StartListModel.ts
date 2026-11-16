// #7862 · Løbssiden v6: Startliste-fanen (beslutningslisten på #7778, valg 9 og 10).
//
// Ren model (ingen React), så startlisten kan prøves uden at rendere fanen.
//   valg 9: rygnumre pr. hold (første hold 1, 2, 3 ..., næste hold 11, 12, 13 ...).
//   valg 10: favoritter viser resultatlinjen under navnet; ingen stjerner, før en
//     beregning er godkendt. Favoritterne er klassementernes stilling i løbet,
//     altså kun resultater alle kan se, aldrig form, træthed, rutematch eller roller.
// Rygnumrene er ens for alle, der ser listen: holdene står efter navn, rytterne
// efter efternavn. Ingen roller (andre holds kaptajner er deres taktik).
// Synlighed som divisionernes startlister (backend/lib/raceDistribution.js
// startListVisible): feltet vises først, når løbet starter inden for horisonten.
import { isU25 } from "../../../lib/riderAge.js";
import { classificationRowsForStage } from "../../../lib/raceStageClassifications.js";
import { normalizeSearchText } from "./resultsControlsModel.ts";

/** Samme horisont som backend/lib/raceDistribution.js STARTLIST_HORIZON_DAYS; ændres den ene, SKAL den anden med. */
export const START_LIST_HORIZON_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** En race_entries-række med rytter og hold, som fanen henter den. */
export interface StartListEntry {
  rider_id: string;
  team_id: string | null;
  rider?: {
    id?: string | null;
    firstname?: string | null;
    lastname?: string | null;
    nationality_code?: string | null;
    birthdate?: string | null;
    primary_type?: string | null;
    best_role_rating?: number | null;
  } | null;
  team?: { id?: string | null; name?: string | null } | null;
}

export interface StartListRider {
  riderId: string;
  bib: number;
  name: string;
  lastname: string;
  nation: string | null;
  primaryType: string | null;
  rating: number | null;
  u25: boolean;
}

export interface StartListTeam {
  teamId: string;
  name: string;
  mine: boolean;
  riders: StartListRider[];
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

function riderName(r: StartListEntry["rider"]): string {
  return [r?.firstname, r?.lastname].filter(Boolean).join(" ").trim();
}

/**
 * Feltet pr. hold med rygnumre. Hold der har meldt fra (race_withdrawals) står ikke
 * på listen (#5301). Rygnummeret er holdets plads gange holdstørrelsens tier-loft
 * plus rytterens plads: hold 1 = 1-7, hold 2 = 11-17. Har et hold flere end ni
 * ryttere, vokser springet, så to hold aldrig deler et nummer.
 */
export function buildStartList(
  entries: readonly StartListEntry[] | null | undefined,
  { withdrawnTeamIds = new Set<string>(), myTeamId = null, seasonYear = null }: {
    withdrawnTeamIds?: ReadonlySet<string>; myTeamId?: string | number | null; seasonYear?: number | null;
  } = {},
): StartListTeam[] {
  const byTeam = new Map<string, { name: string; riders: Map<string, StartListEntry> }>();
  for (const e of entries || []) {
    if (!e?.rider_id || e.team_id == null) continue;
    const teamId = String(e.team_id);
    if (withdrawnTeamIds.has(teamId)) continue;
    const team = byTeam.get(teamId) ?? { name: (e.team?.name ?? "").trim(), riders: new Map() };
    if (!team.name && e.team?.name) team.name = e.team.name.trim();
    team.riders.set(String(e.rider_id), e);
    byTeam.set(teamId, team);
  }
  const teams = [...byTeam.entries()].sort(([aId, a], [bId, b]) => collator.compare(a.name, b.name) || aId.localeCompare(bId));
  const largest = teams.reduce((m, [, t]) => Math.max(m, t.riders.size), 0);
  const stride = 10 * Math.max(1, Math.ceil((largest + 1) / 10));
  return teams.map(([teamId, t], ti) => {
    const riders = [...t.riders.values()]
      .map((e) => ({ e, name: riderName(e.rider), lastname: (e.rider?.lastname ?? "").trim() }))
      .sort((a, b) => collator.compare(a.lastname, b.lastname) || collator.compare(a.name, b.name) || String(a.e.rider_id).localeCompare(String(b.e.rider_id)))
      .map(({ e, name, lastname }, i): StartListRider => {
        const rating = e.rider?.best_role_rating;
        return {
          riderId: String(e.rider_id),
          bib: ti * stride + i + 1,
          name,
          lastname,
          nation: e.rider?.nationality_code ? String(e.rider.nationality_code).toLowerCase() : null,
          primaryType: e.rider?.primary_type ?? null,
          rating: Number.isFinite(rating) ? Number(rating) : null,
          u25: seasonYear != null && isU25(e.rider?.birthdate ?? null, seasonYear),
        };
      });
    return { teamId, name: t.name, mine: myTeamId != null && String(myTeamId) === teamId, riders };
  });
}

export interface StartListFilter {
  query: string;
  mineOnly: boolean;
  /** "all" eller en landekode (små bogstaver). */
  nation: string;
}

export const EMPTY_START_LIST_FILTER: StartListFilter = Object.freeze({ query: "", mineOnly: false, nation: "all" });

/**
 * Søgning på rytter, hold eller nation (navnet på brugerens sprog og på engelsk samt koden).
 * Matcher holdnavnet, står hele holdet; ellers kun de ryttere der matcher. Nationsfilteret
 * og "Mit hold" virker på rytterne. Hold uden ryttere tilbage udelades.
 */
export function filterStartList(
  teams: readonly StartListTeam[],
  filter: StartListFilter,
  nationNames: (code: string) => string[] = () => [],
): StartListTeam[] {
  const words = normalizeSearchText(filter.query).split(" ").filter(Boolean);
  const nation = filter.nation && filter.nation !== "all" ? filter.nation.toLowerCase() : null;
  const out: StartListTeam[] = [];
  for (const team of teams) {
    if (filter.mineOnly && !team.mine) continue;
    const teamText = normalizeSearchText(team.name);
    const riders = team.riders.filter((r) => {
      if (nation && r.nation !== nation) return false;
      if (!words.length) return true;
      const text = `${normalizeSearchText(r.name)} | ${teamText} | ${r.nation ?? ""} | ${r.nation ? nationNames(r.nation).map(normalizeSearchText).join(" | ") : ""}`;
      return words.every((w) => text.includes(w));
    });
    if (riders.length) out.push({ ...team, riders });
  }
  return out;
}

/** Nationerne i feltet (til nationsvælgeren), sorteret efter det viste navn. */
export function startListNations(teams: readonly StartListTeam[], nameOf: (code: string) => string): Array<{ code: string; name: string }> {
  const codes = new Set<string>();
  for (const t of teams) for (const r of t.riders) if (r.nation) codes.add(r.nation);
  return [...codes].map((code) => ({ code, name: nameOf(code) || code.toUpperCase() })).sort((a, b) => collator.compare(a.name, b.name));
}

export function startListCount(teams: readonly StartListTeam[]): number {
  return teams.reduce((n, t) => n + t.riders.length, 0);
}

/**
 * Er feltet synligt endnu? Som divisionernes startlister: når løbets første etape
 * starter inden for horisonten. Et løb uden kendt starttid, eller som er startet,
 * er synligt. Returnerer dagene til listen åbner, når den ikke er synlig.
 */
export function startListOpensIn(firstStartMs: number | null | undefined, nowMs: number): number | null {
  if (firstStartMs == null || !Number.isFinite(firstStartMs) || !Number.isFinite(nowMs)) return null;
  const opensAt = firstStartMs - START_LIST_HORIZON_DAYS * DAY_MS;
  if (nowMs >= opensAt) return null;
  return Math.max(1, Math.ceil((opensAt - nowMs) / DAY_MS));
}

// ── Favoritter (valg 10) ─────────────────────────────────────────────────────

export const START_LIST_FAVOURITE_CLASSES = ["gc", "points", "mountain", "young"] as const;
export type StartListFavouriteClass = (typeof START_LIST_FAVOURITE_CLASSES)[number];

interface ClassRow {
  rank?: number | null;
  rider_id?: string | null;
  team_id?: string | null;
  finish_time?: string | null;
  rider_name?: string | null;
  team_name?: string | null;
  rider?: { firstname?: string | null; lastname?: string | null; nationality_code?: string | null; team?: { id?: string | null; name?: string | null } | null } | null;
}

export interface StartListFavourite {
  riderId: string;
  name: string;
  nation: string | null;
  teamId: string | null;
  teamName: string | null;
  mine: boolean;
  rank: number;
  /** Tidsafstand til føreren ("+M:SS"); null for føreren og for klassementer uden tid. */
  gap: string | null;
}

/**
 * Favoritterne pr. klassement: stillingen efter den senest kørte etape (top `limit`).
 * Resultatlinjen er pladsen og, hvor klassementet har tid, afstanden. Før første etape
 * er der ingen synlige resultater i løbet, og listen er tom (fanen siger det).
 */
export function startListFavourites(
  results: readonly ClassRow[] | null | undefined,
  { stagesCompleted, cls, myTeamId = null, limit = 5 }: {
    stagesCompleted: number; cls: StartListFavouriteClass; myTeamId?: string | number | null; limit?: number;
  },
): StartListFavourite[] {
  if (!(stagesCompleted >= 1)) return [];
  const rows = classificationRowsForStage(results ?? [], stagesCompleted, cls) as ClassRow[];
  const out: StartListFavourite[] = [];
  for (const r of rows) {
    if (out.length >= limit) break;
    const rank = Number(r.rank);
    if (!r.rider_id || !Number.isFinite(rank)) continue;
    const name = r.rider ? `${r.rider.firstname ?? ""} ${r.rider.lastname ?? ""}`.trim() : (r.rider_name ?? "").trim();
    if (!name) continue;
    const teamId = r.team_id ?? r.rider?.team?.id ?? null;
    out.push({
      riderId: String(r.rider_id),
      name,
      nation: r.rider?.nationality_code ? String(r.rider.nationality_code).toLowerCase() : null,
      teamId: teamId == null ? null : String(teamId),
      teamName: r.rider?.team?.name ?? r.team_name ?? null,
      mine: myTeamId != null && teamId != null && String(teamId) === String(myTeamId),
      rank,
      gap: rank > 1 && /^\+\d+:\d{2}(:\d{2})?$/.test(r.finish_time ?? "") ? r.finish_time ?? null : null,
    });
  }
  return out;
}

/** Klassementerne der har en stilling efter den senest kørte etape (vælgeren viser kun dem). */
export function startListFavouriteClasses(results: readonly ClassRow[] | null | undefined, stagesCompleted: number): StartListFavouriteClass[] {
  if (!(stagesCompleted >= 1)) return [];
  return START_LIST_FAVOURITE_CLASSES.filter((cls) => (classificationRowsForStage(results ?? [], stagesCompleted, cls) as ClassRow[]).some((r) => r.rider_id));
}
