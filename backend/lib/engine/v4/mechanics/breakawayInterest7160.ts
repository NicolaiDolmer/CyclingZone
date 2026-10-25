// backend/lib/engine/v4/mechanics/breakawayInterest7160.ts
// #7160 (KUN s5_profiles_v3, SLUKKET): favoritholdene lader et ufarligt udbrud gaa paa bjerg.
//
// Virkeligheden (Touren og Giroen 2023-2024): udbruddet vinder klart flere bjergetaper end i
// spillet (maalingen er privat, balance-internals/6804-tilvalg/). Retning (ejer 25/10): i et
// etapeloeb paa en bjergetape vaegtes etapeinteressen (stageWinChaseForceV3, viljen til at
// jagte udbruddet for etapesejren) NED for et hold hvis bedste mand i jagtgruppen er en
// klassementsrytter, naar udbruddet er ufarligt for ham: hver udbryder ligger langt efter
// ham i klassementet. Samme greb som #6804 P1 paa kuperet (finalevaegten), bare pr. hold.
//
// Hvad der IKKE roeres: ordrer og klassementsreaktioner (teamSignals, gcThreat, P6-snoren) er
// uaendrede, saa et udbrud med en reel klassementstrussel jages som foer, og en "jag"-ordre kan
// stadig kun oege kraften. Endagsloeb, foerste etape (intet klassement) og andre profiler er
// uroerte. Et hold uden saadan en rytter, eller hvor bare én udbryder er taet paa (eller mangler
// i klassementet), faar ingen faktor.
//
// REN: ingen IO, ingen rng. Gaelder reglen ikke, er resultatet undefined, saa kaldet i
// breakaway.ts er byte-identisk med foer (alle aeldre revisioner og v3 uden for reglen).

import type { Entrant, GcContext, ProfileType } from "../types.ts";
import { S5_V3_MOUNTAIN_LET_GO_7160_TUNING } from "../tuning.ts";

/** Reglen gaelder: v3, en bjergprofil og et etapeloeb med et publiceret klassement. */
export function s5V3MountainLetGoApplies(input: { s5ProfilesV3?: boolean; profileType: ProfileType; gcContext: GcContext | null | undefined }): boolean {
  return input.s5ProfilesV3 === true
    && S5_V3_MOUNTAIN_LET_GO_7160_TUNING.profiles.includes(input.profileType)
    && input.gcContext?.status === "standings";
}

/** Faktoren et klassementshold faar paa etapeinteressen, i (0, 1] (ugyldig tuning = 1, ingen effekt). */
export function s5V3GcTeamInterestScale(): number {
  const s = S5_V3_MOUNTAIN_LET_GO_7160_TUNING.gcTeamInterestScale;
  return Number.isFinite(s) && s > 0 && s <= 1 ? s : 1;
}

type GcRow = { rank: number; gap: number };

function gcRowsById(gc: GcContext): Map<string, GcRow> {
  const rows = new Map<string, GcRow>();
  if (gc.status !== "standings") return rows;
  for (const s of gc.standings) {
    const rank = Number(s.rank);
    const gap = Number(s.gap_seconds);
    if (s.rider_id && Number.isFinite(rank) && Number.isFinite(gap)) rows.set(s.rider_id, { rank, gap });
  }
  return rows;
}

/**
 * Hvert holds klassementsrytter i jagtgruppen: holdets bedst placerede rytter i klassementet,
 * hvis han ligger hoejst paa `gcRiderMaxRank`. team_id -> hans afstand til foereren (sekunder).
 * Hold uden en saadan rytter i jagtgruppen er ikke med. Deterministisk (fast raekkefoelge).
 */
export function gcRiderGapByTeam(input: {
  chaseGroupRiderIds: readonly string[];
  entrants: Readonly<Record<string, Entrant>>;
  gcContext: GcContext;
}): Map<string, number> {
  const rows = gcRowsById(input.gcContext);
  const maxRank = S5_V3_MOUNTAIN_LET_GO_7160_TUNING.gcRiderMaxRank;
  const best = new Map<string, GcRow>();
  for (const id of [...input.chaseGroupRiderIds].sort((a, b) => a.localeCompare(b))) {
    const raw = input.entrants[id]?.team_id;
    const teamId = typeof raw === "string" && raw.length > 0 ? raw : null; // samme som breakaway.ts teamIdOf
    const row = rows.get(id);
    if (!teamId || !row) continue;
    const prior = best.get(teamId);
    if (!prior || row.rank < prior.rank) best.set(teamId, row);
  }
  const out = new Map<string, number>();
  for (const [teamId, row] of [...best].sort(([a], [b]) => a.localeCompare(b))) {
    if (row.rank <= maxRank) out.set(teamId, row.gap);
  }
  return out;
}

/**
 * Er udbruddet ufarligt for en klassementsrytter med afstanden `gcRiderGapSeconds` til foereren?
 * Ja kun naar HVER udbryder staar i klassementet og ligger mindst `harmlessGcGapSeconds` efter
 * ham. En udbryder der mangler i klassementet taeller som farlig (ingen smuthul). Tomt udbrud = nej.
 */
export function breakawayHarmlessFor(input: {
  breakawayRiderIds: readonly string[];
  gcContext: GcContext;
  gcRiderGapSeconds: number;
}): boolean {
  if (input.breakawayRiderIds.length === 0 || !Number.isFinite(input.gcRiderGapSeconds)) return false;
  const rows = gcRowsById(input.gcContext);
  const margin = S5_V3_MOUNTAIN_LET_GO_7160_TUNING.harmlessGcGapSeconds;
  return input.breakawayRiderIds.every((id) => {
    const row = rows.get(id);
    return row !== undefined && row.gap - input.gcRiderGapSeconds >= margin;
  });
}

/**
 * #7160: faktoren pr. hold paa etapeinteressen bag ÉT udbrud (stageWinChaseForceV3's
 * `teamInterestScale`). Kun klassementshold for hvem udbruddet er ufarligt faar en faktor.
 * undefined naar reglen ikke gaelder eller intet hold kvalificerer (byte-identisk kald).
 */
export function s5V3MountainLetGoInterestScale(input: {
  s5ProfilesV3?: boolean;
  profileType: ProfileType;
  gcContext: GcContext | null | undefined;
  chaseGroupRiderIds: readonly string[];
  breakawayRiderIds: readonly string[];
  entrants: Readonly<Record<string, Entrant>>;
}): Map<string, number> | undefined {
  const gc = input.gcContext;
  if (!gc || !s5V3MountainLetGoApplies({ s5ProfilesV3: input.s5ProfilesV3, profileType: input.profileType, gcContext: gc })) return undefined;
  const scale = s5V3GcTeamInterestScale();
  if (scale === 1) return undefined;
  const out = new Map<string, number>();
  for (const [teamId, gap] of gcRiderGapByTeam({ chaseGroupRiderIds: input.chaseGroupRiderIds, entrants: input.entrants, gcContext: gc })) {
    if (breakawayHarmlessFor({ breakawayRiderIds: input.breakawayRiderIds, gcContext: gc, gcRiderGapSeconds: gap })) out.set(teamId, scale);
  }
  return out.size > 0 ? out : undefined;
}
