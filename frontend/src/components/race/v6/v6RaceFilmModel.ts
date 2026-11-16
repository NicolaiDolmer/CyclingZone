// #7861 · Løbsfilmen som én afspiller (F1-F7, spec 2026-11-07, PR 4 i byggeplanen).
// Rene regler for filmens kapitler og for referatet, der følger filmen:
//   F1/F4: én afspiller; kapitlerne er rutens egne steder (start, udbruddet,
//          stigningerne, mellemspurterne) og finalen.
//   F2:    finalen er et kapitel i samme film (ingen separat "Final 5 km").
//   F3/F6: ét referat; det viser kun linjerne op til filmens position, så
//          vinderen først står der, når filmen er nået til mål.
// Kun data siden allerede har (ruteprofilen og løbshistoriens linjer). Opfinder intet.
import type { Climb } from "../stagePageV2/stagePageV2Model.ts";
import type { StoryLine } from "../stagePageV2/raceStoryModel.ts";

/** Finalen dækker de sidste km, eller hele den sidste stigning når den topper i dem. */
export const V6_FINALE_WINDOW_KM = 10;
/** To kapitler tættere end dette på hinanden bliver ét (det første står). */
const MIN_CHAPTER_GAP_KM = 1;
const EPS = 1e-6;

export type V6ChapterKind = "start" | "break" | "climb" | "sprint" | "finale";

export interface V6Chapter {
  kind: V6ChapterKind;
  km: number;
  /** Stigningens navn (kun "climb"). */
  name?: string | null;
}

interface SprintPoint { km: number; kind?: string | null }

function finite(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Stigningens fod: toppen minus længden, aldrig før start. */
export function climbFootKm(climb: Pick<Climb, "crest_km" | "length_km">): number | null {
  const crest = finite(climb.crest_km);
  const length = finite(climb.length_km);
  if (crest == null) return null;
  return Math.max(0, crest - (length != null && length > 0 ? length : 0));
}

/**
 * Hvor finalen begynder: foden af den sidste stigning, når den topper inden for
 * finalens vindue (en bjergafslutning), ellers vinduets start. Aldrig før start.
 */
export function v6FinaleKm(distanceKm: number, climbs: ReadonlyArray<Pick<Climb, "crest_km" | "length_km">> = []): number {
  const windowStart = Math.max(0, distanceKm - V6_FINALE_WINDOW_KM);
  let start = windowStart;
  for (const c of climbs) {
    const crest = finite(c.crest_km);
    const foot = climbFootKm(c);
    if (crest == null || foot == null) continue;
    if (crest > windowStart + EPS && crest <= distanceKm + EPS) start = Math.min(start, foot);
  }
  return start;
}

/**
 * Filmens kapitler i rutens rækkefølge: start, udbruddet (første "går væk"-linje),
 * hver stigning ved sin fod, hver mellemspurt og til sidst finalen. Steder i
 * finalen hører til finalen; to steder inden for samme km bliver ét kapitel.
 */
export function v6FilmChapters({ distanceKm, climbs = [], sprints = [], lines = [] }: {
  distanceKm: number;
  climbs?: ReadonlyArray<Climb>;
  sprints?: ReadonlyArray<SprintPoint>;
  lines?: ReadonlyArray<Pick<StoryLine, "kind" | "km">>;
}): V6Chapter[] {
  if (!(distanceKm > 0)) return [];
  const finaleKm = v6FinaleKm(distanceKm, climbs);
  const candidates: V6Chapter[] = [];
  const formed = lines.find((l) => l.kind === "formed");
  if (formed && Number.isFinite(formed.km)) candidates.push({ kind: "break", km: formed.km });
  for (const c of climbs) {
    const foot = climbFootKm(c);
    if (foot != null) candidates.push({ kind: "climb", km: foot, name: c.name ?? null });
  }
  for (const s of sprints) {
    const km = finite(s.km);
    if (km != null && s.kind === "intermediate") candidates.push({ kind: "sprint", km });
  }
  const out: V6Chapter[] = [{ kind: "start", km: 0 }];
  const sorted = candidates
    .filter((c) => c.km > EPS && c.km < finaleKm - EPS)
    .sort((a, b) => a.km - b.km);
  for (const c of sorted) {
    const prev = out[out.length - 1];
    if (c.km - prev.km < MIN_CHAPTER_GAP_KM) continue;
    out.push(c);
  }
  if (finaleKm - out[out.length - 1].km < MIN_CHAPTER_GAP_KM && out.length > 1) out.pop();
  out.push({ kind: "finale", km: finaleKm });
  return out;
}

/** Kapitlet filmen står i: det sidste, der er begyndt. */
export function v6ChapterAt(chapters: readonly V6Chapter[], km: number): V6Chapter | null {
  let current: V6Chapter | null = null;
  for (const c of chapters) if (c.km <= km + EPS) current = c;
  return current;
}

/** Det næste kapitel efter positionen (Afspil med reduceret bevægelse hopper dertil). */
export function v6NextChapter(chapters: readonly V6Chapter[], km: number): V6Chapter | null {
  return chapters.find((c) => c.km > km + EPS) ?? null;
}

/** F6: referatet viser kun linjerne op til filmens position. */
export function v6VisibleLines<T extends Pick<StoryLine, "km">>(lines: readonly T[], km: number): T[] {
  return lines.filter((l) => l.km <= km + EPS);
}

/** Linjen filmen står ved (den seneste viste); null før den første. */
export function v6CurrentLine<T extends Pick<StoryLine, "km">>(lines: readonly T[], km: number): T | null {
  const visible = v6VisibleLines(lines, km);
  return visible.length ? visible[visible.length - 1] : null;
}

/** Om der står flere linjer efter positionen (referatet siger så, at filmen fortsætter). */
export function v6MoreAhead(lines: ReadonlyArray<Pick<StoryLine, "km">>, km: number): boolean {
  return lines.some((l) => l.km > km + EPS);
}

/**
 * Låst (spec 7/11): vinderen står ingen steder i Historie. Etapestriben over filmen
 * viser derfor ikke den valgte etapes vinder eller egen plads, mens Historie er åben;
 * cellen siger kun, at etapen er kørt. Andre etaper er uændrede.
 */
export function v6StoryStripCells<T extends { number: number; foot: { kind: string } }>(cells: readonly T[], selectedStage: number): T[] {
  return cells.map((c) => (c.number === selectedStage && c.foot.kind === "ridden" ? ({ ...c, foot: { kind: "ridden", winner: null, myRank: null } } as T) : c));
}

/** Afspilningens skridt pr. tik: hele etapen på cirka 15 s (som den nuværende afspiller), aldrig under en halv km. */
export function v6PlayStep(distanceKm: number): number {
  return Math.max(0.5, Math.round(distanceKm / 150));
}
