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
import { exactEventKm, honestTimelineEvents, type SpanClimb, type SpanTimelineEvent } from "../../../lib/stageTimelineKmSpan.ts";
import { withAttackWording, type NarrativeEvent, type OrderEfforts } from "../../../../../backend/lib/engine/v4/mechanics/narrativeCauses6469.ts";

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

type LineKm = Pick<StoryLine, "km"> & { kmTo?: number | null };

/** Hvor linjens udfald kendes: et stykke vej (km-spænd) kendes først ved sin slut-km. */
function knownAtKm(line: LineKm): number {
  return line.kmTo != null && line.kmTo > line.km ? line.kmTo : line.km;
}

/** F6: referatet viser kun linjerne, hvis udfald filmen er nået til. */
export function v6VisibleLines<T extends LineKm>(lines: readonly T[], km: number): T[] {
  return lines.filter((l) => knownAtKm(l) <= km + EPS);
}

/**
 * Linjen filmen står ved: den viste linje, hvis udfald blev kendt senest (et stykke vej
 * tæller ved sin slut-km, ikke ved sin plads i den start-sorterede liste); ved lighed
 * den sidste i listen. null før den første.
 */
export function v6CurrentLine<T extends LineKm>(lines: readonly T[], km: number): T | null {
  let current: T | null = null;
  for (const l of v6VisibleLines(lines, km)) if (!current || knownAtKm(l) >= knownAtKm(current)) current = l;
  return current;
}

/** Om der står flere linjer efter positionen (referatet siger så, at filmen fortsætter). */
export function v6MoreAhead(lines: ReadonlyArray<LineKm>, km: number): boolean {
  return lines.some((l) => knownAtKm(l) > km + EPS);
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

// ── Filmens position oven på den fælles rute (#8253) ──────────────────────

/**
 * Geometrien for rutens profil (V6Route tegner StageProfileV2 i fuld størrelse, uden
 * bånd), så filmens position kan ligge som overlay i samme koordinater: samme bredde,
 * samme højde og top for smal/bred, samme km- og højdeskala. V6Route har ingen
 * markør-prop (#8253 ejer den); en kildetest låser, at tallene følger StageProfileV2.
 */
export function v6FilmProfileGeometry({ width, profile, series, floor, ceil }: {
  width: number;
  profile: { distance_km?: number | string | null };
  series: { kms: readonly number[] };
  floor: number;
  ceil: number;
}): { W: number; H: number; top: number; bottom: number; D: number; X: (km: number) => number; Y: (h: number) => number } {
  const narrow = width > 0 && width < 640;
  const H = narrow ? 220 : 320;
  const top = narrow ? 48 : 78;
  const BOT = 30;
  const W = Math.max(1, width);
  const D = Number(profile.distance_km) || series.kms[series.kms.length - 1] || 1;
  const span = ceil - floor || 1;
  return {
    W, H, top, bottom: H - BOT, D,
    X: (km) => (km / D) * W,
    Y: (h) => H - BOT - ((h - floor) / span) * (H - BOT - top),
  };
}

// ── Angrebet op ad sidste stigning (#7965, Codex P1 på #8275) ─────────────

/**
 * En referatlinje for motorens "alt ud"/angreb på en stigning (`all_out_gain` /
 * `all_out_cracked`). Hver hændelse bliver ALTID to linjer i den rækkefølge det
 * skete (RACE_ENGINE_RULES #7965, ejer 12/11 og 17/11): angrebet ved stigningens
 * fod uden resultat og uden tid, og udfaldet dér hvor motoren stemplede det.
 * Man kan ikke angribe og vinde tid på samme tid, så ingen linje siger begge dele.
 * Kun det motoren har skrevet; intet tal.
 */
export interface V6ClimbAttackLine {
  id: string;
  kind: "climbAttack";
  km: number;
  kmTo: null;
  span: false;
  time: number | null;
  riderIds: string[];
  mineIds: string[];
  /** "attack" = angrebet ved foden (uden resultat og tid), "outcome" = udfaldet. */
  phase: "attack" | "outcome";
  held: boolean;
  /** true = rytteren angreb (opgaven Angrib eller et andet holds rytter); false = egen "Alt ud"-ordre. */
  attackTask: boolean;
  climbName: string | null;
}

/** En linje i filmens referat: løbshistoriens linje eller stigningens angreb. */
export type V6FilmLine = StoryLine | V6ClimbAttackLine;

export function isClimbAttackLine(line: { kind: string }): line is V6ClimbAttackLine {
  return line.kind === "climbAttack";
}

const CLIMB_ATTACK_TYPES = new Set(["all_out_gain", "all_out_cracked"]);

/**
 * Stigningens angrebslinjer fra løbsloggen, med filmens egne km (samme afledning som
 * den hidtidige film: honestTimelineEvents + Angrib-stemplet). Tom på en enkeltstart.
 */
export function v6ClimbAttackLines(events: readonly SpanTimelineEvent[] | null | undefined, opts: {
  timelineVersion?: number | null;
  climbs?: readonly SpanClimb[] | null;
  mine?: ReadonlySet<string>;
  ownRiderIds?: readonly string[];
  effortByRider?: OrderEfforts | null;
  profileType?: string | null;
} = {}): V6ClimbAttackLine[] {
  if (!events?.some((e) => CLIMB_ATTACK_TYPES.has(String(e?.type ?? "")))) return [];
  const shown = honestTimelineEvents(events, { timelineVersion: opts.timelineVersion ?? null, climbs: opts.climbs ?? null });
  const worded = withAttackWording(shown as NarrativeEvent[], {
    ownRiderIds: opts.ownRiderIds ?? [], effortByRider: opts.effortByRider ?? null, profileType: opts.profileType ?? null,
  }) as SpanTimelineEvent[];
  const out: V6ClimbAttackLine[] = [];
  const line = (e: SpanTimelineEvent, riderId: string, phase: V6ClimbAttackLine["phase"], km: number, time: number | null, climbName: string | null): V6ClimbAttackLine => ({
    id: `climbAttack-${phase}-${e.type}-${riderId}-${km}`,
    kind: "climbAttack",
    km,
    kmTo: null,
    span: false,
    time,
    riderIds: [riderId],
    mineIds: opts.mine?.has(riderId) ? [riderId] : [],
    phase,
    held: e.type === "all_out_gain",
    attackTask: e.params?.task === "attack",
    climbName,
  });
  for (const e of worded) {
    if (!e || !CLIMB_ATTACK_TYPES.has(String(e.type ?? ""))) continue;
    const riderId = typeof e.params?.rider_id === "string" ? e.params.rider_id : null;
    const km = finite(e.km);
    if (!riderId || km == null) continue;
    if (e.climb_phase) {
      // Topankomsten er allerede delt i to af filmens fælles afledning (stageTimelineKmSpan).
      // Den sætter kun navnet på angrebet; udfaldet får samme stigning fra toppen (recorded_km).
      const top = finite(e.recorded_km) ?? km;
      const name = (typeof e.climb_name === "string" && e.climb_name ? e.climb_name : null)
        ?? climbEndingAt(top, opts.climbs ?? null)?.name ?? komNameNear(worded, top);
      // Tid kun med et ægte km (motorens exact_time); angrebet ved foden har aldrig en.
      const time = e.climb_phase === "outcome" && typeof e.race_time_s === "number" && Number.isFinite(e.race_time_s) ? e.race_time_s : null;
      out.push(line(e, riderId, e.climb_phase, km, time, name));
      continue;
    }
    // Stigningen ender før mål: samme to linjer (ejer 17/11). Foden er profilens top minus
    // længde; kendes stigningen ikke, forrige kendte punkt (som ved topankomsten).
    const climb = climbEndingAt(km, opts.climbs ?? null);
    const foot = climb?.foot ?? previousKnownKm(worded, km);
    const climbName = climb?.name ?? komNameNear(worded, km);
    const exact = exactEventKm(e);
    const exactTime = Number(e.params?.exact_time);
    const time = exact != null && exact > foot && e.params?.exact_time != null && Number.isFinite(exactTime) ? exactTime : null;
    out.push(line(e, riderId, "attack", foot, null, climbName));
    out.push(line(e, riderId, "outcome", km, time, climbName));
  }
  return out;
}

// En top inden for denne afstand af hændelsens km er stigningen hændelsen hører til.
const CREST_TOLERANCE_KM = 1;

/** Stigningen hvis strækning (fod til top) rummer km; den nærmeste top vinder. */
function climbEndingAt(km: number, climbs: readonly SpanClimb[] | null): { foot: number; name: string | null } | null {
  let best: { crest: number; foot: number; name: string | null } | null = null;
  for (const climb of climbs ?? []) {
    if (climb?.crest_km == null || climb?.length_km == null) continue;
    const crest = finite(climb.crest_km);
    const length = finite(climb.length_km);
    if (crest == null || length == null || !(length > 0)) continue;
    const foot = Math.max(0, crest - length);
    if (!(foot < km) || km > crest + CREST_TOLERANCE_KM) continue;
    if (!best || Math.abs(crest - km) < Math.abs(best.crest - km)) {
      best = { crest, foot, name: typeof climb.name === "string" && climb.name.trim() ? climb.name.trim() : null };
    }
  }
  return best ? { foot: best.foot, name: best.name } : null;
}

/** Forrige kendte punkt før km (start, tjekpunkt, top eller mellemspurt). */
function previousKnownKm(events: readonly SpanTimelineEvent[], km: number): number {
  let best = 0;
  for (const e of events) {
    const at = typeof e?.km === "number" && Number.isFinite(e.km) ? e.km : null;
    if (at == null || at >= km || at <= best) continue;
    if (e.type === "gap_update" || e.type === "kom_passage" || e.type === "intermediate_sprint") best = at;
  }
  return best;
}

/** Stigningens navn fra tidslinjens egen topmarkering ved km. */
function komNameNear(events: readonly SpanTimelineEvent[], km: number): string | null {
  let best: { d: number; name: string } | null = null;
  for (const e of events) {
    if (e?.type !== "kom_passage" || typeof e.km !== "number") continue;
    const name = e.params?.name;
    const d = Math.abs(e.km - km);
    if (typeof name !== "string" || !name.trim() || d > CREST_TOLERANCE_KM) continue;
    if (!best || d < best.d) best = { d, name: name.trim() };
  }
  return best?.name ?? null;
}

/**
 * Den fulde tekstnøgle for en angrebslinje. Angrebet bruger den hidtidige films tekst
 * (races: detail.film.event.climb_attack_start*). Udfaldet siger KUN udfaldet
 * (raceFilm: climb.*): aldrig "angriber" i samme linje som tiden eller knækket.
 */
export function v6ClimbAttackCopyKey(line: Pick<V6ClimbAttackLine, "phase" | "held" | "climbName">): string {
  if (line.phase === "attack") return line.climbName ? "detail.film.event.climb_attack_start_named" : "detail.film.event.climb_attack_start";
  const outcome = line.held ? "gained" : "cracked";
  return `raceFilm:climb.${outcome}${line.climbName ? "Named" : ""}`;
}

/**
 * Referatets linjer i rutens rækkefølge: løbshistoriens linjer og stigningens
 * angrebslinjer flettet efter km. På samme km står målet sidst, og et angreb
 * står før sit udfald (rækkefølgen ind er bevaret).
 */
export function v6ReportLines(story: readonly StoryLine[], attacks: readonly V6ClimbAttackLine[]): V6FilmLine[] {
  if (!attacks.length) return [...story];
  return [...story, ...attacks]
    .map((line, i) => ({ line, i }))
    .sort((a, b) => a.line.km - b.line.km
      || Number(a.line.kind === "finish") - Number(b.line.kind === "finish")
      || a.i - b.i)
    .map(({ line }) => line);
}
