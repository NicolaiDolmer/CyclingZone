// #8383 · Det den gamle film havde under sig, lagt under løbsfilmen og referatet i Historie
// (ejer 17/11, #8275 runde 5 punkt 13 = A): Din dag-sætningen, vejret, mellemtiderne,
// referat-afsnittet, "Where your riders lost time" og kildelinjen.
//
// Spoiler-reglen 7/11: intet afslører den valgte etapes vinder eller egen plads, mens
// Historie er åben og filmen ikke er i mål (samme regel som striben og referatet).
// Mellemtiderne følger filmen punkt for punkt (som referatet); målet, referat-afsnittet og
// tabt tid venter, til filmen er i mål. Din dag-sætningen står, når filmen er i mål eller
// Resultater er åbnet for etapen.
import { parseGapSeconds } from "../../../lib/raceLiveStandings.js";
import { filmAtFinish } from "../../spoiler/spoilerShieldModel.ts";
import type { SplitRow } from "../stagePageV2/raceStoryModel.ts";
import { formatGap, yourDay, type DnfRowInput, type ResultRow } from "../stagePageV2/stagePageV2Model.ts";

export interface V6DaySentence { key: string; params: Record<string, string | number> }

/**
 * Din dag-sætningen fra den gamle side ("X won, 0:12 ahead of Y. Your best was Z, #4, +0:12 down."),
 * samme regler som YourDayCard med etapen valgt: kun et tidshul vi kan læse giver vinder-
 * sætningen, og din bedste er din bedste på etapen. Et endagsløb uden etaperækker læser klassementet.
 */
export function v6DaySentences({ results, stageNumber, isStageRace, myTeamId, dnfRows = [] }: {
  results: ResultRow[];
  stageNumber: number;
  isStageRace: boolean;
  myTeamId: string | null;
  dnfRows?: DnfRowInput[];
}): V6DaySentence[] {
  const stageDay = yourDay(results, stageNumber, myTeamId, "stage", dnfRows);
  const day = !isStageRace && !stageDay.top.length ? yourDay(results, stageNumber, myTeamId, "gc", dnfRows) : stageDay;
  const winner = stageDay.winner ?? day.top[0] ?? null;
  const second = (stageDay.top.length ? stageDay.top : day.top)[1] ?? null;
  const out: V6DaySentence[] = [];
  if (winner && second && /^\+?\d+:\d{1,2}$/.test(second.gap ?? "")) {
    const margin = parseGapSeconds(second.gap);
    out.push(margin > 0
      ? { key: "stagePageV2.yourDay.whyGap", params: { winner: winner.name, gap: formatGap(margin), second: second.name } }
      : { key: "stagePageV2.yourDay.whySame", params: { winner: winner.name, second: second.name } });
  }
  const myBest = stageDay.mine[0] ?? null;
  if (myBest && myBest.rank === 1) out.push({ key: "stagePageV2.yourDay.mineWon", params: { name: myBest.name } });
  else if (myBest && myBest.rank) out.push({ key: "stagePageV2.yourDay.mineLine", params: { name: myBest.name, rank: myBest.rank, gap: myBest.gap ?? "" } });
  return out;
}

export interface V6ExtrasView {
  /** Filmen er i mål: målet, referat-afsnittet, tabt tid og enkeltstartens sætninger står. */
  full: boolean;
  /** Din dag-sætningen står (filmen i mål, eller Resultater er åbnet for etapen). */
  day: boolean;
  /** Mellemtiderne der vises: op til filmens position, alle når filmen er i mål. */
  rows: SplitRow[];
  /** "Resten følger, mens filmen kører" står under det viste. */
  ahead: boolean;
}

/**
 * Hvad der står under filmen ved filmens position. Med spoiler-skjoldet (#7859) står kun
 * vejret: filmen i mål åbner etapen, og så slipper skjoldet, som på den gamle side.
 */
export function v6ExtrasView({ km, distanceKm, spoilerActive, resultsSeen, splitRows }: {
  km: number;
  distanceKm: number;
  spoilerActive: boolean;
  resultsSeen: boolean;
  splitRows: readonly SplitRow[];
}): V6ExtrasView {
  if (spoilerActive) return { full: false, day: false, rows: [], ahead: false };
  const full = filmAtFinish(km, distanceKm);
  return {
    full,
    day: full || resultsSeen,
    rows: full ? [...splitRows] : splitRows.filter((r) => r.kind !== "finish" && r.km <= km + 1e-6),
    ahead: !full,
  };
}

// Resultater åbnet for en etape i denne fane (kun hukommelse, ingen lagring): Din dag-
// sætningen må stå i Historie, når spilleren allerede har set resultatet.
const resultsSeenStages = new Set<string>();

export function markV6ResultsSeen(raceId: string | null, stageNumber: number): void {
  if (raceId) resultsSeenStages.add(`${raceId}:${stageNumber}`);
}

export function v6ResultsSeen(raceId: string | null, stageNumber: number): boolean {
  return raceId ? resultsSeenStages.has(`${raceId}:${stageNumber}`) : false;
}
