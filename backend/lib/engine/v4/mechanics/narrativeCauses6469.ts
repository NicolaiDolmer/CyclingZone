// #6469 (ejer 26/10, designbord S9): hvorfor holdt udbruddet, eller hvorfor blev det
// hentet, og hvornaar gjorde spillerens egen ordre en synlig forskel.
// Spec: docs/superpowers/specs/2026-10-17-6804-hilly-breakaway-design.md P5 (K6) og
// 2026-10-22-loebsfilm-pakken-design.md.
//
// REN afledning af en FAERDIG tidslinje: ingen IO, ingen rng, ingen motor-tilstand,
// input muteres aldrig. Motoren og loebsudfaldet roeres ikke; modulet kaldes ikke af
// motoren. Det bor her, fordi det laeser motorens egne hændelser og deres ordforraad
// (breakaway_unchased, own_riders_ahead, gc_reaction, gap_update), og fordi baade
// loebsfilmen og etapehistorien i frontend skal fortaelle det samme.
//
// Fog of war (#1791): ud kommer kun arter (kind), hold-id'er, rytter-id'er og
// stigningens navn, aldrig et tal. Ingen tilfaeldighed, intet opdigtet: en aarsag
// findes kun, naar en hændelse eller tidslinjens egen afstandsmaaling viser den.
// Ved tvivl er svaret ingen aarsag (aerlig degradering).
//
// Ordrer: kun spillerens EGNE ryttere og hans EGEN indsats-ordre (frontend har den
// kun for eget hold), saa intet om andre holds ordrer kan udledes herfra.

export type NarrativeEvent = { km?: number; recorded_km?: number; type?: string; params?: Record<string, unknown> | null } | null | undefined;

const TIME_TRIAL_TYPES = new Set(["itt", "itt_hilly", "ttt"]);
/** Discipline is context, never inferred from a winning time gap. */
export function isTimeTrialNarrative(events: readonly NarrativeEvent[] = [], profileType: unknown = null): boolean {
  if (typeof profileType === "string" && TIME_TRIAL_TYPES.has(profileType)) return true;
  return events.some(event => {
    const profile = event?.params?.profile_type;
    return (event?.type === "stage_start" && typeof profile === "string" && TIME_TRIAL_TYPES.has(profile))
      || (event?.type === "finish" && (event.params?.win_type === "itt_win" || event.params?.win_type === "ttt_win"));
  });
}
const GROUP_RACE_EVENTS = new Set(["order_impact", "peloton_splits", "group_merged", "group_caught", "own_riders_ahead", "gc_reaction", "gc_context", "chase_faded", "finale_attack", "sprint_decided"]);
function groupRaceEvent(event: NarrativeEvent): boolean {
  const type = event?.type;
  return typeof type === "string" && (type.startsWith("breakaway_") || GROUP_RACE_EVENTS.has(type));
}
export type BreakawayCauseKind =
  | "unchased" // intet hold ville jage (breakaway_unchased uden reason)
  | "no_chasers" // holdene med interesse havde ingen ryttere at jage med (reason no_riders)
  | "own_riders_ahead" // hold der lod vaere, fordi de havde egne ryttere i udbruddet
  | "reaction_spent" // klassementsreaktionen havde brugt det den kunne (gc_reaction exhausted)
  | "no_free_riders" // klassementsholdet havde ingen ledige ryttere (gc_reaction unavailable)
  | "gc_contained" // klassementsholdet koerte kun for klassementet og stoppede (contained)
  | "chase_faded" // jagten lukkede ind og slap saa igen (tidslinjens afstand)
  | "chase_too_late" // jagten lukkede ind, men naaede det ikke
  | "gap_never_closed" // afstanden kom aldrig ned (kun naar intet andet forklarer)
  | "gc_threat" // hentet: et hold jagede, fordi en udbryder truede deres klassementsrytter
  | "closed_on_climb"; // hentet: hullet faldt mest over en stigning

export type BreakawayCause = {
  kind: BreakawayCauseKind;
  team_ids?: string[];
  rider_ids?: string[];
  protected_rider_id?: string;
  climb_name?: string;
};

export type BreakawayStory = {
  group_id: string | null;
  rider_ids: string[];
  outcome: "held" | "caught";
  /** Indeks i input-listen for udfaldets hændelse (breakaway_survived / breakaway_caught). */
  outcome_index: number;
  outcome_km: number;
  /** Rytterne der holdt hjem (kun outcome "held"). */
  survivor_ids: string[];
  causes: BreakawayCause[];
};

/** Hoejst saa mange aarsagslinjer pr. udbrud: de vigtigste foerst. */
export const MAX_CAUSES_PER_BREAKAWAY = 2;

/** Visnings-tolerance (sekunder) for "afstanden flyttede sig" i tidslinjens egne maalinger. */
const GAP_MOVE_EPSILON_SECONDS = 1;

// Kun "Alt ud": teksten siger "koerte alt ud paa din ordre". "Arbejd eller angrib" er
// en anden ordre (arbejde for kaptajnen) og faar ikke samme saetning.
const ALL_OUT_EFFORTS: ReadonlySet<string> = new Set(["all_out"]);

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : [];
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Motorens egen km (et film-spaend kan have flyttet `km`; `recorded_km` er det motoren skrev). */
function raceKm(e: NarrativeEvent): number {
  return num(e?.recorded_km) ?? num(e?.km) ?? 0;
}

function uniq(list: readonly string[]): string[] {
  return [...new Set(list)];
}

// groupIds: udbruddets gruppe-id og udfaldets (et afsat/delt udbrud holder hjem under
// et nyt id, #6185); riders: udbrydderne fra dannelsen.
type Window = { from: number; to: number; groupIds: ReadonlySet<string>; riders: ReadonlySet<string> };

const inGroup = (w: Window, e: NarrativeEvent): boolean => {
  const gid = str(e?.params?.group_id);
  return gid !== null && w.groupIds.has(gid);
};

function inWindow(events: readonly NarrativeEvent[], w: Window): NarrativeEvent[] {
  return events.slice(w.from, w.to + 1);
}

/**
 * Udbruddets afstand til jagten gennem vinduet, som tidslinjen selv maalte den.
 * s5_profiles_v3 skriver `separation_seconds` direkte (#6814). Aeldre v4-tidslinjer
 * skriver kun hver gruppes hul til fronten: afstanden er da jagtgruppens hul minus
 * udbruddets eget (begge "baaret" til naeste melding, samme regel som raceStory.js).
 */
function separationSeries(events: readonly NarrativeEvent[], w: Window, chaseId: string): Array<{ km: number; seconds: number }> {
  const slice = inWindow(events, w);
  const explicit = slice
    .filter((e) => e?.type === "gap_update" && inGroup(w, e) && num(e.params?.separation_seconds) !== null)
    .map((e) => ({ km: raceKm(e), seconds: num(e?.params?.separation_seconds) as number }));
  if (explicit.length) return explicit;
  if (!w.groupIds.size) return [];
  let breakGap = 0;
  let chaseGap: number | null = null;
  const out: Array<{ km: number; seconds: number }> = [];
  for (const e of slice) {
    if (e?.type !== "gap_update") continue;
    const gid = str(e.params?.group_id);
    const gap = num(e.params?.gap_seconds);
    const own = inGroup(w, e);
    if (gap === null || (!own && gid !== chaseId)) continue;
    if (own) breakGap = gap;
    else chaseGap = gap;
    if (chaseGap !== null) out.push({ km: raceKm(e), seconds: Math.max(0, chaseGap - breakGap) });
  }
  return out;
}

function climbBetween(events: readonly NarrativeEvent[], w: Window, fromKm: number, toKm: number): string | null {
  const climb = inWindow(events, w).find((e) => e?.type === "kom_passage" && raceKm(e) > fromKm && raceKm(e) <= toKm);
  return str(climb?.params?.name);
}

function curveCauseHeld(series: ReadonlyArray<{ km: number; seconds: number }>, events: readonly NarrativeEvent[], w: Window): BreakawayCause | null {
  if (series.length < 2) return null;
  // Jagtens stoerste indhentning: faldet fra hidtil stoerste afstand til et senere punkt
  // (ikke kun fra den foerste maaling: 100 -> 300 -> 150 er ogsaa at lukke ind).
  let peak = series[0].seconds;
  let troughIndex = -1;
  let bestDrop = GAP_MOVE_EPSILON_SECONDS;
  for (let i = 1; i < series.length; i++) {
    peak = Math.max(peak, series[i - 1].seconds);
    if (peak - series[i].seconds > bestDrop) { bestDrop = peak - series[i].seconds; troughIndex = i; }
  }
  const closedIn = troughIndex >= 0;
  const last = series[series.length - 1].seconds;
  if (closedIn && troughIndex < series.length - 1 && last - series[troughIndex].seconds > GAP_MOVE_EPSILON_SECONDS) {
    // Afstanden voksede igen efter bunden. Stigningen naevnes kun, naar dens top
    // ligger i stykket omkring vendepunktet (fra maalingen foer til maalingen efter).
    const climb = climbBetween(events, w, series[troughIndex - 1].km, series[troughIndex + 1].km);
    return climb ? { kind: "chase_faded", climb_name: climb } : { kind: "chase_faded" };
  }
  if (closedIn) return { kind: "chase_too_late" };
  return null;
}

function climbWhereGapFell(series: ReadonlyArray<{ km: number; seconds: number }>, events: readonly NarrativeEvent[], w: Window): string | null {
  let best = 0;
  let climb: string | null = null;
  for (let i = 1; i < series.length; i++) {
    const drop = series[i - 1].seconds - series[i].seconds;
    if (drop <= best + GAP_MOVE_EPSILON_SECONDS) continue;
    best = drop;
    climb = climbBetween(events, w, series[i - 1].km, series[i].km);
  }
  return climb;
}

/** Hold der reagerede paa en trussel fra netop dette udbrud (truslens ryttere er udbrydere). */
function reactionsOnBreak(slice: readonly NarrativeEvent[], riders: ReadonlySet<string>): NarrativeEvent[] {
  return slice.filter((e) => e?.type === "gc_reaction" && str(e.params?.team_id) && ids(e.params?.rider_ids).some((id) => riders.has(id)));
}

function teamsWith(reactions: readonly NarrativeEvent[], status: string, reason?: string): string[] {
  return uniq(reactions
    .filter((e) => e?.params?.status === status && (reason === undefined || e.params?.reason === reason))
    .map((e) => str(e?.params?.team_id) as string));
}

function heldCauses(events: readonly NarrativeEvent[], w: Window, chaseId: string): BreakawayCause[] {
  const slice = inWindow(events, w);
  const causes: BreakawayCause[] = [];
  const unchased = slice.filter((e) => e?.type === "breakaway_unchased" && inGroup(w, e));
  if (unchased.some((e) => e?.params?.reason === undefined || e?.params?.reason === null)) causes.push({ kind: "unchased" });
  if (unchased.some((e) => e?.params?.reason === "no_riders")) causes.push({ kind: "no_chasers" });
  const ownAhead = uniq(slice
    .filter((e) => e?.type === "own_riders_ahead" && (inGroup(w, e) || ids(e.params?.rider_ids).some((id) => w.riders.has(id))))
    .map((e) => str(e?.params?.team_id))
    .filter((id): id is string => id !== null));
  if (ownAhead.length) causes.push({ kind: "own_riders_ahead", team_ids: ownAhead });
  const reactions = reactionsOnBreak(slice, w.riders);
  const spent = teamsWith(reactions, "exhausted");
  if (spent.length) causes.push({ kind: "reaction_spent", team_ids: spent });
  const noRiders = teamsWith(reactions, "unavailable");
  if (noRiders.length) causes.push({ kind: "no_free_riders", team_ids: noRiders });
  const contained = teamsWith(reactions, "stopped", "contained").filter((id) => !spent.includes(id));
  if (contained.length) causes.push({ kind: "gc_contained", team_ids: contained });
  const series = separationSeries(events, w, chaseId);
  const curve = curveCauseHeld(series, events, w);
  if (curve) causes.push(curve);
  if (!causes.length && series.length >= 2) causes.push({ kind: "gap_never_closed" });
  return causes;
}

function caughtCauses(events: readonly NarrativeEvent[], w: Window, caught: NarrativeEvent, chaseId: string): BreakawayCause[] {
  const slice = inWindow(events, w);
  const causes: BreakawayCause[] = [];
  const chasers = new Set(ids(caught?.params?.chasing_team_ids));
  const seen = new Set<string>();
  for (const e of reactionsOnBreak(slice, w.riders)) {
    if (e?.params?.status !== "started") continue;
    const teamId = str(e.params?.team_id) as string;
    const protectedId = str(e.params?.protected_rider_id);
    if (!protectedId || seen.has(teamId) || (chasers.size > 0 && !chasers.has(teamId))) continue;
    seen.add(teamId);
    causes.push({ kind: "gc_threat", team_ids: [teamId], protected_rider_id: protectedId, rider_ids: ids(e.params?.rider_ids).filter((id) => w.riders.has(id)) });
  }
  const climb = climbWhereGapFell(separationSeries(events, w, chaseId), events, w);
  if (climb) causes.push({ kind: "closed_on_climb", climb_name: climb });
  return causes;
}

/**
 * Hvert udbrud paa etapen (morgen-udbruddet og nye udbrud efter en indhentning) med
 * sit udfald og dets aarsager. Input skal vaere i loebets raekkefoelge (motorens km)
 * og uden "indhentninger" der kun er en samling inden i udbruddet (frontend:
 * `honestTimelineEvents`/`withoutRegroupCatches`). Hvert udfald (hentet / holdt hjem)
 * hoerer til den seneste dannelse foer det, hvis ryttere det roerer: et udbrud der
 * deler sig, kan saaledes baade blive hentet og holde hjem (to historier).
 * Dannelser uden udfald, og udfald uden dannelse (fx et senere angreb), udelades.
 */
export function deriveBreakawayStories(events: readonly NarrativeEvent[] = []): BreakawayStory[] {
  if (isTimeTrialNarrative(events)) return [];
  const stories: BreakawayStory[] = [];
  events.forEach((outcome, to) => {
    if (outcome?.type !== "breakaway_caught" && outcome?.type !== "breakaway_survived") return;
    const outcomeRiders = ids(outcome.params?.rider_ids);
    const outcomeGroup = str(outcome.params?.group_id);
    let from = -1;
    for (let i = to - 1; i >= 0; i--) {
      const e = events[i];
      if (e?.type !== "breakaway_formed") continue;
      const formedIds = new Set(ids(e.params?.rider_ids));
      if ((outcomeGroup !== null && str(e.params?.group_id) === outcomeGroup) || outcomeRiders.some((id) => formedIds.has(id))) { from = i; break; }
    }
    if (from < 0) return;
    const formed = events[from];
    const groupId = str(formed?.params?.group_id);
    const riders = new Set(ids(formed?.params?.rider_ids));
    if (!riders.size) return;
    const w: Window = { from, to, groupIds: new Set([groupId, outcomeGroup].filter((g): g is string => g !== null)), riders };
    const chaseId = str(outcome?.params?.chase_group_id) ?? "peloton-0";
    const held = outcome?.type === "breakaway_survived";
    const causes = held ? heldCauses(events, w, chaseId) : caughtCauses(events, w, outcome, chaseId);
    stories.push({
      group_id: groupId,
      rider_ids: [...riders],
      outcome: held ? "held" : "caught",
      outcome_index: to,
      outcome_km: num(outcome?.km) ?? raceKm(outcome),
      survivor_ids: held ? ids(outcome?.params?.rider_ids) : [],
      causes: causes.slice(0, MAX_CAUSES_PER_BREAKAWAY),
    });
  });
  return stories;
}

export type OrderImpact = { kind: "all_out_stayed_away" | "all_out_held_on"; rider_id: string; climb_name?: string };

/**
 * Hvor spillerens egen indsats-ordre "Alt ud" ses i udfaldet:
 * - rytteren var i et udbrud der holdt hjem, og kom selv hjem med det;
 * - ellers kom rytteren i maal i samme tid som vinderen paa en etape hvor feltet blev
 *   splittet (nogen i top-listen tabte tid): "blev i den forreste gruppe". Stigningen
 *   naevnes kun, naar rytteren selv staar blandt de foerste over etapens sidste top
 *   (kom_passage.top): maaltiden alene siger intet om hvad der skete paa stigningen.
 * Kun egne ryttere med en ordre fra spilleren selv; ingen ordre, intet udsagn.
 */
export function deriveOrderImpacts(
  events: readonly NarrativeEvent[] = [],
  { ownRiderIds = [], effortByRider = null, stories = null, profileType = null }: { ownRiderIds?: Iterable<unknown> | null; effortByRider?: { get(id: string): unknown } | null; stories?: readonly BreakawayStory[] | null; profileType?: string | null } = {},
): Array<OrderImpact & { km: number; after_index: number }> {
  if (!effortByRider || isTimeTrialNarrative(events, profileType)) return [];
  const own = [...(ownRiderIds ?? [])].filter((id): id is string => typeof id === "string");
  const allOut = own.filter((id) => ALL_OUT_EFFORTS.has(String(effortByRider.get(id) ?? "")));
  if (!allOut.length) return [];
  const out: Array<OrderImpact & { km: number; after_index: number }> = [];
  const used = new Set<string>();
  for (const story of stories ?? deriveBreakawayStories(events)) {
    if (story.outcome !== "held") continue;
    for (const id of allOut) {
      if (used.has(id) || !story.survivor_ids.includes(id)) continue;
      used.add(id);
      out.push({ kind: "all_out_stayed_away", rider_id: id, km: story.outcome_km, after_index: story.outcome_index });
    }
  }
  const finishIndex = events.findIndex((e) => e?.type === "finish");
  const top = finishIndex >= 0 ? (Array.isArray(events[finishIndex]?.params?.top) ? events[finishIndex]?.params?.top as Array<Record<string, unknown>> : []) : [];
  const selective = top.some((t) => (num(t?.gap) ?? 0) > GAP_MOVE_EPSILON_SECONDS);
  const lastClimb = [...events].reverse().find((e) => e?.type === "kom_passage");
  const overTop = new Set((Array.isArray(lastClimb?.params?.top) ? lastClimb?.params?.top as Array<Record<string, unknown>> : []).map((t) => t?.rider_id));
  if (selective) {
    for (const id of allOut) {
      const row = top.find((t) => t?.rider_id === id);
      if (used.has(id) || !row || (num(row.gap) ?? Infinity) > GAP_MOVE_EPSILON_SECONDS) continue;
      used.add(id);
      const climb = overTop.has(id) ? str(lastClimb?.params?.name) : null;
      out.push({ kind: "all_out_held_on", rider_id: id, ...(climb ? { climb_name: climb } : {}), km: num(events[finishIndex]?.km) ?? 0, after_index: finishIndex });
    }
  }
  return out;
}

/**
 * Tidslinjen med en linje pr. aarsag (`breakaway_cause`) og pr. synlig ordre
 * (`order_impact`) indsat lige efter den hændelse de forklarer, paa samme km.
 * Nye objekter; input muteres ikke. Uden udbrud og uden ordrer: samme indhold.
 */
export type NarrativeLine = { km: number; type: "breakaway_cause" | "order_impact"; params: Record<string, unknown> };

export function withNarrativeCauses<T extends NarrativeEvent>(
  events: readonly T[] = [],
  opts: { ownRiderIds?: Iterable<unknown> | null; effortByRider?: { get(id: string): unknown } | null; profileType?: string | null } = {},
): Array<T | NarrativeLine> {
  if (isTimeTrialNarrative(events, opts.profileType)) return events.filter(event => !groupRaceEvent(event));
  // Aarsagerne udledes i loebets egen raekkefoelge (motorens km: `recorded_km` naar et
  // film-spaend har flyttet `km`), og linjerne saettes efter udfaldet der hvor listen
  // viser det. Ellers kan et spaend lukke vinduet foer de maalinger der forklarer det.
  const order = events.map((e, i) => ({ e, i })).sort((a, b) => raceKm(a.e) - raceKm(b.e) || a.i - b.i);
  const chrono = order.map(({ e }) => e);
  const original = (chronoIndex: number) => order[chronoIndex].i;
  const stories = deriveBreakawayStories(chrono);
  const extra = new Map<number, NarrativeLine[]>();
  const add = (index: number, e: NarrativeLine) => {
    if (!extra.has(index)) extra.set(index, []);
    extra.get(index)!.push(e);
  };
  for (const story of stories) {
    for (const { kind, ...rest } of story.causes) {
      add(original(story.outcome_index), { km: story.outcome_km, type: "breakaway_cause", params: { group_id: story.group_id, outcome: story.outcome, cause: kind, ...rest } });
    }
  }
  for (const impact of deriveOrderImpacts(chrono, { ...opts, stories })) {
    const { km, after_index, ...params } = impact;
    add(original(after_index), { km, type: "order_impact", params });
  }
  if (!extra.size) return [...events];
  return events.flatMap((e, i) => [e, ...(extra.get(i) ?? [])]);
}
