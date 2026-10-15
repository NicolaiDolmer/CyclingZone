// #6570 · Loebshistorien paa etapeside 2.0 (spor 2): ren logik, ingen React.
//
// KILDE: kun loebslog-kontrakten fra #6632
// (docs/superpowers/specs/2026-10-14-race-story-contract.md) - `story` fra
// GET /api/races/:raceId/timeline?stage=N&story=1 - plus etapens resultat
// (navne, placeringer) og dine egne ryttere. Intet her opdigter et sted, en tid
// eller et hul: kan noget ikke laeses i historien, udelades det.
//
// Indhold:
//   - curateMoments:    ~50 oejeblikke pr. etape -> hoejst ca. 8 linjer
//   - splitRows:        mellemtider pr. top/spurt/maal + din bedste rytters hul
//   - buildReport:      3-5 saetninger, deterministisk, fra linjerne + resultatet
//   - groupMembersAt:   hvem kører i hvilken gruppe ved et km (replay-navne)
//   - finaleData/…:     "Final 5 km"-grafikkens tidsmodel og gruppevalg
import { replayFrames as replayFramesJs, checkpointGapForRider as checkpointGapJs } from "../../../../../backend/lib/raceStory.js";
import { classificationRowsForStage } from "../../../lib/raceStageClassifications.js";
import type { ResultRow, RoleRider } from "./stagePageV2Model.ts";

// ── Kontraktens former (spec §3) ───────────────────────────────────────────

export interface StoryMoment {
  type: string;
  key: string;
  km: number;
  km_span?: { from: number; to: number };
  recorded_km?: number;
  race_time_s: number | null;
  time_source?: "event" | "leader_line" | null;
  importance: "key" | "detail";
  data: Record<string, unknown>;
}

export interface GroupAt {
  group_id: string;
  rider_ids: string[];
  size: number | null;
  includes_rest: boolean;
  members_inferred?: boolean;
  gap_s: number;
  time_s?: number | null;
  gap_source?: "reported" | "carried" | "front";
}

export interface StoryCheckpoint {
  kind: "climb" | "sprint" | "finish";
  km: number;
  name: string | null;
  category: string | null;
  top: Array<{ rider_id: string; points?: number; bonus_seconds?: number }>;
  leader_time_s: number | null;
  leader_group_id: string | null;
  leader_rider_ids: string[];
  groups: GroupAt[];
  groups_from_km: number | null;
  interpolated: boolean;
  out_rider_ids: string[];
  pending_rider_ids: string[];
}

export interface StorySnapshot { km: number; leader_time_s: number | null; groups: GroupAt[]; out_rider_ids: string[]; pending_rider_ids: string[] }

export interface GroupSpan {
  group_id: string;
  from_km: number;
  to_km: number | null;
  source_group_id: string | null;
  into_group_id: string | null;
  rider_ids: string[];
}

export interface RaceStory {
  version: number;
  timeline_version: number | null;
  distance_km: number | null;
  field_count: number | null;
  precise_times: boolean;
  time_trial: boolean;
  leader_line: Array<{ km: number; time: number }>;
  moments: StoryMoment[];
  checkpoints: StoryCheckpoint[];
  snapshots: StorySnapshot[];
  group_spans: GroupSpan[];
  breakaway: { morning_rider_ids: string[]; outcomes: Record<string, "caught" | "dropped" | "survived" | null> } | null;
}

export interface FrameGroup { group_id: string; size: number | null; includes_rest: boolean; gap_s: number; km_behind: number | null }
export interface ReplayFrame { km: number; leader_time_s: number | null; groups: FrameGroup[] }
export interface RiderGap { group_id: string; gap_s: number; time_s: number | null; in_front: boolean; via_rest: boolean }

/** Kontraktens egne funktioner (backend/lib/raceStory.js), typet her. */
export const replayFrames = replayFramesJs as unknown as (story: RaceStory, opts?: { finaleKm?: number; stepKm?: number }) => ReplayFrame[];
export const checkpointGapForRider = checkpointGapJs as unknown as (checkpoint: StoryCheckpoint, riderId: string) => RiderGap | null;

/** Kun et svar der ligner kontrakten bruges; alt andet = ingen historie. */
export function asStory(value: unknown): RaceStory | null {
  if (!value || typeof value !== "object") return null;
  const s = value as Partial<RaceStory>;
  if (s.version !== 1 || !Array.isArray(s.moments) || !Array.isArray(s.checkpoints) || !Array.isArray(s.snapshots)) return null;
  return s as RaceStory;
}

// ── Holdet: navne, dine ryttere, placeringer ───────────────────────────────

export interface Cast {
  nameOf: (id: string) => string | null;
  mine: Set<string>;
  rankOf: (id: string) => number | null;
  /** Etapens maalresultat i placeringsorden (endagsloeb: gc-raekkerne). */
  finishers: Array<{ riderId: string; rank: number; gap: string | null }>;
}

function surname(r: ResultRow): string {
  const last = r.rider?.lastname?.trim();
  if (last) return last;
  const parts = String(r.rider_name ?? "").trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

function surnameOf(full: string | null | undefined): string {
  const parts = String(full ?? "").trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

export function castFrom(results: ResultRow[], roles: RoleRider[], stageNumber: number, myTeamId: string | null): Cast {
  const names = new Map<string, string>();
  const mine = new Set<string>();
  for (const r of results || []) {
    if (!r.rider_id) continue;
    const n = surname(r);
    if (n && !names.has(String(r.rider_id))) names.set(String(r.rider_id), n);
    const team = r.team_id ?? r.rider?.team?.id ?? null;
    if (myTeamId != null && team != null && String(team) === String(myTeamId)) mine.add(String(r.rider_id));
  }
  for (const r of roles || []) {
    mine.add(String(r.rider_id));
    const n = surnameOf(r.name);
    if (n && !names.has(String(r.rider_id))) names.set(String(r.rider_id), n);
  }
  let rows = classificationRowsForStage(results, stageNumber, "stage") as ResultRow[];
  if (!rows.length && stageNumber === 1) rows = classificationRowsForStage(results, stageNumber, "gc") as ResultRow[];
  const finishers = rows
    .filter((r) => r.rider_id && r.rank != null && Number.isFinite(Number(r.rank)))
    .map((r) => ({ riderId: String(r.rider_id), rank: Number(r.rank), gap: r.finish_time ?? null }))
    .sort((a, b) => a.rank - b.rank);
  const rank = new Map(finishers.map((f) => [f.riderId, f.rank]));
  return {
    nameOf: (id) => names.get(id) ?? null,
    mine,
    rankOf: (id) => rank.get(id) ?? null,
    finishers,
  };
}

/**
 * "Rojas, Marchetti +3" - bedst placerede foerst, kun kendte navne. `total`
 * er gruppens stoerrelse naar den er stoerre end de navngivne (resten).
 */
export function namesList(ids: string[], cast: Cast, max = 2, total: number | null = null): string {
  const known = [...new Set(ids)].filter((id) => cast.nameOf(id));
  known.sort((a, b) => (cast.rankOf(a) ?? 9999) - (cast.rankOf(b) ?? 9999) || String(cast.nameOf(a)).localeCompare(String(cast.nameOf(b))));
  const shown = known.slice(0, max).map((id) => cast.nameOf(id) as string);
  const more = Math.max(ids.length, total ?? 0) - shown.length;
  if (!shown.length) return "";
  return more > 0 ? `${shown.join(", ")} +${more}` : shown.join(", ");
}

/** Under dette antal er resten ikke "feltet" laengere, men en gruppe der navngives. */
export const PELOTON_MIN_SIZE = 10;

/** Gruppen hedder "Peloton" naar den baerer resten og stadig er et felt. */
export function isPeloton(includesRest: boolean, size: number | null): boolean {
  return includesRest && (size == null || size >= PELOTON_MIN_SIZE);
}

/** Din bedste rytter i etapen: bedste placering, ellers den foerste i historien. */
export function myBestRider(story: RaceStory, cast: Cast): string | null {
  const ranked = [...cast.mine].filter((id) => cast.rankOf(id) != null).sort((a, b) => (cast.rankOf(a) as number) - (cast.rankOf(b) as number));
  if (ranked.length) return ranked[0];
  const finish = story.checkpoints.find((c) => c.kind === "finish");
  for (const id of cast.mine) if (finish && checkpointGapForRider(finish, id)) return id;
  return null;
}

// ── Tider og km ────────────────────────────────────────────────────────────

/** Race-tid "4:41:12" (eller "41:12"). */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
}

/** Hul "0:24" / "1:10" / "1:02:10" (uden fortegn). */
export function formatGapPlain(seconds: number): string {
  return formatClock(seconds);
}

/** km paa en decimal naar det ikke er et helt tal: "76.6", "84". */
export function kmValue(km: number): number {
  return Math.round(km * 10) / 10;
}

// ── 1. "How it unfolded": kuratering ───────────────────────────────────────

export type LineKind =
  | "formed" | "caught" | "survived" | "attack" | "incident" | "climb" | "gap"
  | "split" | "dropped" | "joined" | "gcLead" | "crack" | "finish";

export interface StoryLine {
  id: string;
  kind: LineKind;
  km: number;
  /** Slut-km naar linjen daekker et stykke vej (km-spaend eller sammenlagte linjer). */
  kmTo: number | null;
  /** true = loggen kender ikke det praecise sted (kontraktens km_span). */
  span: boolean;
  /** Race-tid fra loggen; null = loggen kender den ikke (vises ikke). */
  time: number | null;
  count: number;
  riderIds: string[];
  mineIds: string[];
  priority: number;
  data: Record<string, string | number | boolean | null>;
}

/** Hoejst saa mange linjer (ejer 15/10: "vis hoejst ca. 8"). */
export const MAX_STORY_LINES = 8;
/** Splits/samlinger/indhentninger inden for dette vindue bliver een linje. */
export const CLUSTER_KM = 2;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function riderIdsOf(m: StoryMoment): string[] {
  const many = strs(m.data.rider_ids);
  if (many.length) return many;
  return typeof m.data.rider_id === "string" ? [m.data.rider_id] : [];
}

function baseLine(m: StoryMoment, kind: LineKind, priority: number, cast: Cast, data: StoryLine["data"] = {}): StoryLine {
  const riderIds = riderIdsOf(m);
  return {
    id: `${kind}-${m.km}-${m.type}`,
    kind,
    km: m.km,
    kmTo: m.km_span ? m.km_span.to : null,
    span: Boolean(m.km_span),
    time: m.km_span ? null : m.race_time_s,
    count: riderIds.length,
    riderIds,
    mineIds: riderIds.filter((id) => cast.mine.has(id)),
    priority,
    data,
  };
}

/** En klynge strækker sig aldrig over mere end dette (km). */
export const CLUSTER_MAX_SPAN_KM = 5;

/**
 * Saml linjer af samme slags: hver ny linje inden for CLUSTER_KM af klyngens
 * seneste linje (og hoejst CLUSTER_MAX_SPAN_KM fra dens start) bliver en del af den.
 */
function cluster(lines: StoryLine[], kind: LineKind, priority: number): StoryLine[] {
  const sorted = [...lines].sort((a, b) => a.km - b.km);
  const out: StoryLine[] = [];
  for (const line of sorted) {
    const last = out[out.length - 1];
    const lastKm = last ? Math.max(last.km, last.kmTo ?? last.km) : 0;
    if (last && line.km - lastKm <= CLUSTER_KM && line.km - last.km <= CLUSTER_MAX_SPAN_KM) {
      const ids = [...new Set([...last.riderIds, ...line.riderIds])];
      const end = Math.max(last.kmTo ?? last.km, line.kmTo ?? line.km);
      last.kmTo = end > last.km ? end : null;
      last.span = last.span || line.span;
      last.time = last.span ? null : last.time;
      last.count += 1;
      last.riderIds = ids;
      last.mineIds = [...new Set([...last.mineIds, ...line.mineIds])];
      last.data.riders = ids.length;
      continue;
    }
    out.push({ ...line, kind, priority, id: `${kind}-${line.km}`, count: 1, data: { ...line.data, riders: line.riderIds.length } });
  }
  return out;
}

/**
 * Etapens ~50 oejeblikke -> hoejst MAX_STORY_LINES linjer i km-orden.
 * Prioritet (lavt tal = vigtigst): maal 0, udbrud dannet / indhentet / holder
 * hjem 1, angreb med ryttere 2, uheld med tidstab, store toppe, ny foerer og
 * en favorit der knaekker 3, hul der vokser/skrumper mellem front og foerste
 * jagt samt splits 4, samlinger 6. Linjer med dine ryttere rykker et trin op.
 * Samme prioritet: stoerst foerst (grupper, hul), saa senest i etapen.
 */
export function curateMoments(story: RaceStory, cast: Cast, max = MAX_STORY_LINES): StoryLine[] {
  const single: StoryLine[] = [];
  const caught: StoryLine[] = [];
  const splits: StoryLine[] = [];
  const joins: StoryLine[] = [];
  const dropped: StoryLine[] = [];
  const finishKm = story.distance_km ?? Math.max(0, ...story.moments.map((m) => m.km));
  const sprint = story.moments.find((m) => m.type === "sprint_decided");

  for (const m of story.moments) {
    switch (m.key) {
      case "story.breakaway_formed":
        single.push(baseLine(m, "formed", 1, cast));
        break;
      case "story.breakaway_caught":
        caught.push(baseLine(m, "caught", 1, cast));
        break;
      case "story.breakaway_survived":
        single.push(baseLine(m, "survived", 1, cast));
        break;
      case "story.finale_attack":
        single.push(baseLine(m, "attack", 2, cast, { gain: num(m.data.gained_seconds) }));
        break;
      case "story.gc_change": {
        const id = typeof m.data.new_leader_id === "string" ? m.data.new_leader_id : null;
        if (!id) break;
        const line = baseLine(m, "gcLead", 3, cast);
        line.riderIds = [id];
        line.mineIds = cast.mine.has(id) ? [id] : [];
        line.count = 1;
        single.push(line);
        break;
      }
      case "story.incident": {
        if (m.importance !== "key") break;
        const outcome = typeof m.data.outcome === "string" ? m.data.outcome : null;
        if (outcome !== "time_loss" && outcome !== "abandoned") break;
        single.push(baseLine(m, "incident", 3, cast, {
          incident: typeof m.data.kind === "string" ? m.data.kind : "other",
          outcome,
          loss: num(m.data.time_loss_seconds),
        }));
        break;
      }
      case "story.kom_passage": {
        if (m.importance !== "key") break;
        const top = Array.isArray(m.data.top) ? (m.data.top as Array<{ rider_id?: unknown }>) : [];
        const first = typeof top[0]?.rider_id === "string" ? (top[0].rider_id as string) : null;
        const line = baseLine(m, "climb", 3, cast, { name: typeof m.data.name === "string" ? m.data.name : null, category: typeof m.data.category === "string" ? m.data.category : null });
        line.riderIds = first ? [first] : [];
        line.mineIds = first && cast.mine.has(first) ? [first] : [];
        line.count = line.riderIds.length;
        single.push(line);
        break;
      }
      case "story.favorite_crack":
        single.push(baseLine(m, "crack", 3, cast));
        break;
      case "story.gap_grew":
      case "story.gap_shrank": {
        if (m.importance !== "key") break;
        const before = num(m.data.gap_before_s), after = num(m.data.gap_after_s);
        if (before == null || after == null) break;
        single.push(baseLine(m, "gap", 4, cast, {
          dir: m.key === "story.gap_grew" ? "grew" : "shrank",
          group: m.data.includes_rest === true ? "rest" : "chase",
          before,
          after,
        }));
        break;
      }
      case "story.split": {
        const line = baseLine(m, "split", 4, cast);
        if (m.importance === "key" || line.mineIds.length) splits.push(line);
        break;
      }
      case "story.breakaway_dropped": {
        const line = baseLine(m, "dropped", 5, cast);
        if (line.mineIds.length) dropped.push(line);
        break;
      }
      case "story.groups_joined":
      case "story.group_caught":
      case "story.breakaway_regrouped":
        joins.push(baseLine(m, "joined", 6, cast));
        break;
      case "story.finish": {
        const winner = cast.finishers[0]?.riderId
          ?? (sprint ? riderIdsOf(sprint)[0] : null)
          ?? story.checkpoints.find((c) => c.kind === "finish")?.top?.[0]?.rider_id
          ?? null;
        const line = baseLine(m, "finish", 0, cast, { sprint: Boolean(sprint && Math.abs(sprint.km - m.km) <= 1) });
        line.riderIds = winner ? [winner] : [];
        line.mineIds = winner && cast.mine.has(winner) ? [winner] : [];
        line.count = line.riderIds.length;
        line.km = Math.max(line.km, finishKm);
        single.push(line);
        break;
      }
      default:
        break;
    }
  }

  const all = [
    ...single,
    ...cluster(caught, "caught", 1),
    ...cluster(splits, "split", 4),
    ...cluster(dropped, "dropped", 5),
    ...cluster(joins, "joined", 6),
  ];
  for (const line of all) if (line.mineIds.length && line.kind !== "finish") line.priority = Math.max(0, line.priority - 1);
  // Unikke id'er (samme slags paa samme km kan forekomme to gange).
  const seen = new Map<string, number>();
  for (const line of all) {
    const n = seen.get(line.id) ?? 0;
    seen.set(line.id, n + 1);
    if (n) line.id = `${line.id}-${n}`;
  }
  // Samme prioritet: det stoerste (flest grupper/ryttere, stoerste hul) foerst,
  // derefter det senere i etapen (taettere paa afgoerelsen).
  const weight = (l: StoryLine) => (l.kind === "gap" ? Math.abs(Number(l.data.after) - Number(l.data.before)) / 60 : l.kind === "split" || l.kind === "joined" ? l.count : 0);
  const chosen = [...all].sort((a, b) => a.priority - b.priority || weight(b) - weight(a) || b.km - a.km).slice(0, max);
  return chosen.sort((a, b) => a.km - b.km || a.priority - b.priority);
}

/** km hvor replayet skal staa naar man trykker paa linjen (slut-km for et stykke vej). */
export function lineReplayKm(line: StoryLine, distanceKm: number | null): number {
  const km = line.kmTo ?? line.km;
  return distanceKm != null ? Math.min(distanceKm, Math.max(0, km)) : Math.max(0, km);
}

// ── 2. "Split times" ───────────────────────────────────────────────────────

export interface SplitRow {
  key: string;
  kind: StoryCheckpoint["kind"];
  name: string | null;
  category: string | null;
  km: number;
  leaderTime: number | null;
  leaderIds: string[];
  leaderIsRest: boolean;
  leaderSize: number | null;
  /** Foerst over toppen/spurten (passagens point i loggen); kendt ogsaa uden praecise tider. */
  firstId: string | null;
  myGap: RiderGap | null;
}

export function splitRows(story: RaceStory, myRiderId: string | null): SplitRow[] {
  return story.checkpoints.map((c, i) => {
    const front = c.groups.find((g) => g.group_id === c.leader_group_id) ?? null;
    return {
      key: `${c.kind}-${c.km}-${i}`,
      kind: c.kind,
      name: c.name,
      category: c.category,
      km: c.km,
      leaderTime: story.precise_times ? c.leader_time_s : null,
      leaderIds: c.leader_rider_ids ?? [],
      leaderIsRest: Boolean(front?.includes_rest),
      leaderSize: front?.size ?? (c.leader_rider_ids?.length || null),
      firstId: typeof c.top?.[0]?.rider_id === "string" ? c.top[0].rider_id : null,
      // Uden praecise tider kender loggen ikke hullerne (spec §6): intet hul.
      myGap: myRiderId && story.precise_times ? checkpointGapForRider(c, myRiderId) : null,
    };
  });
}

// ── 3. "Report": 3-5 saetninger ────────────────────────────────────────────

export interface ReportSentence { key: string; params: Record<string, string | number> }

/**
 * Referatet: kun hvad loggen og resultatet viser, i fast raekkefoelge:
 * udbruddet (dannet), dets udfald, det sidste angreb, vinderen, din bedste.
 * Mindst 3 saetninger naar etapen har et resultat; hoejst 5.
 */
export function buildReport(story: RaceStory, lines: StoryLine[], cast: Cast): ReportSentence[] {
  const out: ReportSentence[] = [];
  const km = (v: number) => kmValue(v);
  const formed = lines.find((l) => l.kind === "formed");
  if (formed) {
    const mine = namesList(formed.mineIds, cast, 2);
    out.push(mine
      ? { key: "formedMine", params: { count: formed.count, km: km(formed.km), mine } }
      : { key: "formed", params: { count: formed.count, km: km(formed.km) } });
  }
  const outcomes = story.breakaway?.outcomes ?? null;
  if (formed && outcomes) {
    const survivors = Object.entries(outcomes).filter(([, o]) => o === "survived").map(([id]) => id);
    const caughtLines = lines.filter((l) => l.kind === "caught");
    if (survivors.length) {
      const names = namesList(survivors, cast, 2);
      if (names) out.push({ key: "survived", params: { names, count: survivors.length } });
    } else if (caughtLines.length) {
      const last = caughtLines[caughtLines.length - 1];
      out.push({ key: "caught", params: { km: km(last.kmTo ?? last.km) } });
    }
  }
  const attacks = lines.filter((l) => l.kind === "attack" && l.riderIds.length);
  const attack = attacks[attacks.length - 1];
  if (attack) {
    const names = namesList(attack.riderIds, cast, 2);
    const gain = typeof attack.data.gain === "number" && attack.data.gain >= 1 ? formatGapPlain(attack.data.gain) : null;
    if (names) out.push(gain ? { key: "attackGain", params: { names, km: km(attack.km), gain } } : { key: "attack", params: { names, km: km(attack.km) } });
  }
  const [first, second] = cast.finishers;
  const winnerName = first ? cast.nameOf(first.riderId) : null;
  // Vandt din rytter, bruges kun din egen saetning (mineWon nedenfor), ikke begge.
  if (first && winnerName && !cast.mine.has(first.riderId)) {
    const secondName = second ? cast.nameOf(second.riderId) : null;
    const gapS = second ? parseGap(second.gap) : null;
    if (secondName && gapS != null && gapS > 0) out.push({ key: "winnerGap", params: { winner: winnerName, second: secondName, gap: formatGapPlain(gapS) } });
    else if (secondName && gapS === 0) out.push({ key: "winnerSame", params: { winner: winnerName, second: secondName } });
    else out.push({ key: "winner", params: { winner: winnerName } });
  }
  const mineRanked = cast.finishers.filter((f) => cast.mine.has(f.riderId));
  const best = mineRanked[0];
  const bestName = best ? cast.nameOf(best.riderId) : null;
  if (best && bestName && best.rank !== 1) {
    const gapS = parseGap(best.gap);
    out.push(gapS != null && gapS > 0
      ? { key: "mineGap", params: { name: bestName, rank: best.rank, gap: formatGapPlain(gapS) } }
      : { key: "mine", params: { name: bestName, rank: best.rank } });
  } else if (best && bestName && best.rank === 1) {
    out.push({ key: "mineWon", params: { name: bestName } });
  }
  // For faa saetninger: en stor top eller et hul fra kuratering fylder op.
  if (out.length < 3) {
    for (const l of lines) {
      if (out.length >= 3) break;
      if (l.kind === "climb" && l.data.name) {
        const rider = l.riderIds[0] ? cast.nameOf(l.riderIds[0]) : null;
        out.splice(Math.max(0, out.length - 2), 0, rider
          ? { key: "climbFirst", params: { name: String(l.data.name), rider } }
          : { key: "climb", params: { name: String(l.data.name), km: km(l.km) } });
      }
    }
  }
  // Hoejst 5: angrebet ryger foerst, saa udfaldet.
  while (out.length > 5) {
    const i = out.findIndex((s) => s.key.startsWith("attack"));
    out.splice(i >= 0 ? i : 1, 1);
  }
  return out;
}

/** "+1:10" / "1:10" / "+0:00" -> sekunder; null hvis det ikke er et hul. */
export function parseGap(text: string | null | undefined): number | null {
  const m = /^\+?(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(String(text ?? "").trim());
  if (!m) return null;
  return (Number(m[1] ?? 0) * 3600) + Number(m[2]) * 60 + Number(m[3]);
}

// ── 4. Replay: hvem kører i hvilken gruppe ─────────────────────────────────

export interface Members { riders: Set<string>; includesRest: boolean }

/**
 * Gruppernes medlemmer ved km: seneste snapshot foer km, plus levetidernes
 * overgange (group_spans) frem til km - samme afspilning som kontraktens
 * replayFrames (spec §3.4), saa navnene passer til prikkerne.
 */
export function groupMembersAt(story: RaceStory, km: number): Map<string, Members> {
  const EPS = 1e-9;
  let a: StorySnapshot | null = null;
  for (const s of story.snapshots) if (s.km <= km + EPS) a = s; else break;
  const state = new Map<string, Members>();
  if (!a) return state;
  for (const g of a.groups) state.set(g.group_id, { riders: new Set(g.rider_ids), includesRest: g.includes_rest });
  const transitions: Array<{ km: number; order: number; span: GroupSpan }> = [];
  for (const s of story.group_spans ?? []) {
    if (s.to_km != null && s.to_km < s.from_km - EPS) continue;
    if (s.from_km >= a.km - EPS && s.from_km <= km + EPS) transitions.push({ km: s.from_km, order: 0, span: s });
    if (s.to_km != null && s.to_km >= a.km - EPS && s.to_km < km - EPS) transitions.push({ km: s.to_km, order: 1, span: s });
  }
  transitions.sort((x, y) => x.km - y.km || x.order - y.order);
  for (const { order, span } of transitions) {
    if (order === 0) {
      if (state.has(span.group_id)) continue;
      for (const r of span.rider_ids ?? []) for (const g of state.values()) g.riders.delete(r);
      state.set(span.group_id, { riders: new Set(span.rider_ids ?? []), includesRest: false });
    } else {
      const from = state.get(span.group_id);
      if (!from || !span.into_group_id) continue;
      const into = state.get(span.into_group_id) ?? { riders: new Set<string>(), includesRest: false };
      for (const r of from.riders) into.riders.add(r);
      into.includesRest = into.includesRest || from.includesRest;
      state.delete(span.group_id);
      state.set(span.into_group_id, into);
    }
  }
  return state;
}

/** Gruppen rytteren kører i: eksplicit medlem, ellers resten. */
export function groupOfRider(members: Map<string, Members>, riderId: string): string | null {
  for (const [id, g] of members) if (g.riders.has(riderId)) return id;
  for (const [id, g] of members) if (g.includesRest) return id;
  return null;
}

/** Hele etapen som frames pr. km (kontraktens replayFrames med finale = hele etapen). */
export function wholeStageFrames(story: RaceStory): ReplayFrame[] {
  if (story.time_trial || story.distance_km == null) return [];
  return replayFrames(story, { finaleKm: story.distance_km, stepKm: 1 });
}

/** Seneste frame ved eller foer km. */
export function frameAt(frames: ReplayFrame[], km: number): ReplayFrame | null {
  let out: ReplayFrame | null = null;
  for (const f of frames) if (f.km <= km + 1e-9) out = f; else break;
  return out;
}

export interface ReplayGroup {
  groupId: string;
  /** km paa vejen; null = afstanden er ukendt (ingen praecise tider). */
  km: number | null;
  gapS: number;
  size: number | null;
  front: boolean;
  rest: boolean;
  mine: string[];
  riderIds: string[];
}

/** Gruppernes plads paa profilen ved km, med dine ryttere og medlemmerne. */
export function replayGroupsAt(story: RaceStory, frames: ReplayFrame[], km: number, cast: Cast): ReplayGroup[] {
  const frame = frameAt(frames, km);
  if (!frame) return [];
  const members = groupMembersAt(story, km);
  const mineByGroup = new Map<string, string[]>();
  for (const id of cast.mine) {
    const g = groupOfRider(members, id);
    if (g) mineByGroup.set(g, [...(mineByGroup.get(g) ?? []), id]);
  }
  return frame.groups.map((g) => ({
    groupId: g.group_id,
    km: g.km_behind == null ? (g.gap_s === 0 ? km : null) : Math.max(0, km - g.km_behind),
    gapS: g.gap_s,
    size: g.size,
    front: g.gap_s === 0,
    rest: g.includes_rest,
    mine: mineByGroup.get(g.group_id) ?? [],
    riderIds: [...(members.get(g.group_id)?.riders ?? [])],
  }));
}

/**
 * Hvilke grupper der faar et navn: fronten, din forreste gruppe (altid) og
 * hoejst `extra` andre i hul-orden. Resten samles (antal grupper, ryttere,
 * hul-spaend). Dine ryttere i senere grupper staar i den samlede linje.
 */
export function pickGroups<T extends { groupId: string; gapS: number; size: number | null; front: boolean; mine: string[] }>(groups: T[], extra = 3): { shown: T[]; rest: { groups: number; riders: number; minGap: number; maxGap: number } | null } {
  const sorted = [...groups].sort((a, b) => a.gapS - b.gapS || a.groupId.localeCompare(b.groupId));
  const shown: T[] = [];
  const front = sorted.find((g) => g.front) ?? sorted[0];
  if (front) shown.push(front);
  const mineFirst = sorted.find((g) => g.mine.length);
  if (mineFirst && mineFirst !== front) shown.push(mineFirst);
  let added = 0;
  for (const g of sorted) {
    if (added >= extra) break;
    if (shown.includes(g)) continue;
    shown.push(g);
    added += 1;
  }
  shown.sort((a, b) => a.gapS - b.gapS || a.groupId.localeCompare(b.groupId));
  const left = sorted.filter((g) => !shown.includes(g));
  const rest = left.length
    ? { groups: left.length, riders: left.reduce((s, g) => s + (g.size ?? 0), 0), minGap: left[0].gapS, maxGap: left[left.length - 1].gapS }
    : null;
  return { shown, rest };
}

// ── 5. Final 5 km ─────────────────────────────────────────────────────────

export const FINALE_KM = 5;
export const FINALE_STEP_KM = 0.1;

export interface FinaleData {
  startKm: number;
  endKm: number;
  /** Foererens tid ved 5 km-skiltet og paa stregen. */
  t0: number;
  tLeaderEnd: number;
  frames: ReplayFrame[];
  line: Array<{ km: number; time: number }>;
}

/** Kun med praecise tider og en foererlinje der naar stregen; ellers null (knappen skjules). */
export function finaleData(story: RaceStory): FinaleData | null {
  if (!story.precise_times || story.time_trial || story.distance_km == null) return null;
  const line = (story.leader_line ?? []).filter((p) => Number.isFinite(p.km) && Number.isFinite(p.time)).sort((a, b) => a.km - b.km);
  if (line.length < 2) return null;
  const endKm = story.distance_km;
  const startKm = Math.max(0, endKm - FINALE_KM);
  const t0 = leaderTimeOnLine(line, startKm);
  const tLeaderEnd = leaderTimeOnLine(line, endKm);
  if (t0 == null || tLeaderEnd == null || tLeaderEnd <= t0) return null;
  const frames = replayFrames(story, { finaleKm: FINALE_KM, stepKm: FINALE_STEP_KM }).filter((f) => f.km >= startKm - 1e-6);
  if (!frames.length) return null;
  return { startKm, endKm, t0, tLeaderEnd, frames, line };
}

function leaderTimeOnLine(line: Array<{ km: number; time: number }>, km: number): number | null {
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    if (b.km >= km - 1e-9) {
      if (b.km === a.km) return b.time;
      return a.time + ((b.time - a.time) * (km - a.km)) / (b.km - a.km);
    }
  }
  return null;
}

/** Foererens km ved race-tid t (foererlinjen vendt om; konstant tempo mellem tjekpunkter). */
export function leaderKmAt(line: Array<{ km: number; time: number }>, t: number): number {
  if (!line.length) return 0;
  if (t <= line[0].time) return line[0].km;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    if (b.time >= t) return b.time === a.time ? b.km : a.km + ((b.km - a.km) * (t - a.time)) / (b.time - a.time);
  }
  return line[line.length - 1].km;
}

/** Hullet for hver gruppe ved foererens km (lineaert mellem finale-frames). */
function gapsAt(frames: ReplayFrame[], km: number): FrameGroup[] {
  let a = frames[0], b = frames[frames.length - 1];
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].km <= km + 1e-9) a = frames[i];
    if (frames[i].km >= km - 1e-9) { b = frames[i]; break; }
  }
  if (a === b || b.km === a.km) return a.groups;
  const f = (km - a.km) / (b.km - a.km);
  const inB = new Map(b.groups.map((g) => [g.group_id, g]));
  return a.groups.map((g) => {
    const n = inB.get(g.group_id);
    return n ? { ...g, gap_s: g.gap_s + (n.gap_s - g.gap_s) * f } : g;
  });
}

export interface FinaleGroup extends ReplayGroup { km: number; finished: boolean; toGoKm: number }
export interface FinaleState { t: number; leaderKm: number; toGoKm: number; leaderFinished: boolean; groups: FinaleGroup[] }

/**
 * Tilstanden ved race-tid t: en gruppe med hul g er dér hvor foereren var
 * g sekunder tidligere (samme bevaegelse som kontraktens km_behind).
 */
export function finaleStateAt(story: RaceStory, data: FinaleData, cast: Cast, t: number): FinaleState {
  const leaderKm = Math.min(data.endKm, leaderKmAt(data.line, Math.min(t, data.tLeaderEnd)));
  const members = groupMembersAt(story, leaderKm);
  const mineByGroup = new Map<string, string[]>();
  for (const id of cast.mine) {
    const g = groupOfRider(members, id);
    if (g) mineByGroup.set(g, [...(mineByGroup.get(g) ?? []), id]);
  }
  const groups = gapsAt(data.frames, leaderKm).map((g) => {
    const km = Math.min(data.endKm, leaderKmAt(data.line, t - g.gap_s));
    return {
      groupId: g.group_id,
      km,
      gapS: Math.max(0, Math.round(g.gap_s)),
      size: g.size,
      front: g.gap_s < 0.5,
      rest: g.includes_rest,
      mine: mineByGroup.get(g.group_id) ?? [],
      riderIds: [...(members.get(g.group_id)?.riders ?? [])],
      finished: t - g.gap_s >= data.tLeaderEnd - 1e-6,
      toGoKm: Math.max(0, data.endKm - km),
    };
  });
  return { t, leaderKm, toGoKm: Math.max(0, data.endKm - leaderKm), leaderFinished: t >= data.tLeaderEnd - 1e-6, groups };
}

/** Afspilningens slut: sidste viste gruppe paa stregen (hoejst 10 min efter foereren). */
export function finaleEndTime(story: RaceStory, data: FinaleData, cast: Cast): number {
  const atLine = finaleStateAt(story, data, cast, data.tLeaderEnd);
  const { shown } = pickGroups(atLine.groups);
  const lastGap = Math.max(0, ...shown.map((g) => g.gapS));
  return data.tLeaderEnd + Math.min(600, lastGap) + 4;
}

/** Oejeblikke i finalen (kuraterede linjer i de sidste 5 km) til billedteksten. */
export function finaleCaptions(lines: StoryLine[], data: FinaleData): StoryLine[] {
  return lines.filter((l) => l.km >= data.startKm - 1e-6 && !l.span).sort((a, b) => a.km - b.km);
}
