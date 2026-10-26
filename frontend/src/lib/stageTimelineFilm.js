// #3859 (bølge 2 — løbsfilm-afspilleren): ren afledningslogik for TimelineFilmPlayer.
// Bygger på spec §2.2's event-taksonomi (docs/superpowers/specs/2026-08-17-race-
// event-log-stage-timeline-design.md). Samme adskillelse som finalKilometre.js:
// AL data-afledning bor her (testbar uden DOM); komponenten er kun tidsstyring +
// rendering.
//
// km→pixel-mapping, "hvilke events er afspillet ved km X" og broadcast-tekst-
// nøgler/params er alle rene funktioner af (events, distanceKm) — ingen skjult
// tilstand, ingen engine-kald.

import { catchActor, findMorningCatch, findReformationCatches } from "./raceCatchActor.ts";

// gap_update er kurve-punkter (spec §2.2 "(S) kurvepunkter — valg 2"), ALDRIG en
// narrativ feed-linje — samme udelukkelse som stageTimelineStory.js.
// ttt_team_result (M13, #3463) er af samme art: motoren emitterer ÉT resultat-
// event pr. hold på målstregen, så holdets officielle tid står i tidslinjen som
// data. Som feed-linjer ville det være hele startlisten af hold på én km — en
// mur, ikke en broadcast. Vinderen står allerede i `finish`-eventet.
const NON_FEED_TYPES = new Set(["gap_update", "ttt_team_result"]);

// #6067: orders_gc_v1's GC-reaktion (importen står her, ikke øverst, så den
// ikke kolliderer med #6050's import i samme fil).
import { describeGcReactionEvent } from "./ordersGcSurface.ts";
// #6137: gentagne ens hændelser på samme km bliver én linje (kun visningen).
import { groupRepeatedFeedEvents, describeGroupedEvent } from "./stageTimelineGrouping.ts";
// #6294/#6350: én indgang til den tidslinje filmen viser (ingen falske
// indhentninger, ærlige km-spænd). filmKmValue skriver "km A-B"-værdien.
import { honestTimelineEvents, exactEventKm } from "./stageTimelineKmSpan.ts";
export { filmKmValue } from "./stageTimelineKmSpan.ts";
import { labelBreakawayEvents, breakawayFilmCopy, breakawayLabelOf } from "./breakawayLabels6299.ts"; // #6299: kun udbruddet hedder udbrud
// #6469: hvorfor udbruddet holdt/blev hentet + spillerens egen "Alt ud" i udfaldet.
// Ren afledning af tidslinjen; samme modul som backendens kontrakt-tests (G7).
import { withNarrativeCauses } from "../../../backend/lib/engine/v4/mechanics/narrativeCauses6469.ts";

// Kategori-skala til stignings-trekanterne på scrubberen — samme rækkefølge/
// bogstaver som race_stage_passages.climb_category og StageProfileGraph.jsx's
// CAT_ALPHA (HC størst, kat. 4 mindst). Højde i px (scrubber er kompakt, ikke
// den fulde højdeprofil-graf).
const CLIMB_CATEGORY_HEIGHT = { HC: 22, "1": 17, "2": 13, "3": 9, "4": 6 };
const DEFAULT_CLIMB_HEIGHT = 6;

export function climbMarkerHeight(category) {
  return CLIMB_CATEGORY_HEIGHT[category] ?? DEFAULT_CLIMB_HEIGHT;
}

/**
 * km ⇄ pixel-mapping over scrubberens plot-bredde. Lineær (samme princip som
 * StageProfileGraph.jsx's X(km)) — ren funktion, testbar uden SVG/DOM.
 */
export function kmToX(km, distanceKm, plotWidth) {
  if (!distanceKm || distanceKm <= 0) return 0;
  const clamped = Math.max(0, Math.min(km, distanceKm));
  return (clamped / distanceKm) * plotWidth;
}

/**
 * #6814/#6803: motoren (v3) skriver selv et sidste jagtpunkt ved indhentningen
 * (samme km, separation 0). Kurven faar da ét nul-punkt, ikke to oven i hinanden.
 */
function pushCaughtAt(curve, km) {
  const last = curve[curve.length - 1];
  if (last && last.km === km) last.gapSeconds = 0;
  else curve.push({ km, gapSeconds: 0 });
}

/**
 * #6803: udbruddets forspring paa jagten ved en scrub-position (km): seneste
 * kendte kurvepunkt op til km (trin-funktion, samme "afspillet"-regel som feedet).
 * null foer kurvens foerste punkt eller uden kurve; 0 mellem to udbrud.
 */
export function gapAtKm(gapCurve, km) {
  let last = null;
  for (const p of gapCurve ?? []) {
    if (p.km > km) break;
    last = p.gapSeconds;
  }
  return last;
}

/** Forspring som "M:SS" (tabelcifre i visningen), samme afrunding som formatGap. */
export function formatLead(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function xToKm(x, distanceKm, plotWidth) {
  if (!plotWidth || plotWidth <= 0) return 0;
  const frac = Math.max(0, Math.min(x / plotWidth, 1));
  return frac * (distanceKm ?? 0);
}

/**
 * Ejer-fix 17/8 ("det ligner ikke ruteprofilen"): scrubberen skal tegnes OVEN
 * PÅ etapens ÆGTE højdeprofil-silhuet (stageRouteProfile.buildProfileSeries),
 * ikke en flad linje. Denne funktion interpolerer højden (meter) ved et givet
 * km-punkt fra `series.xs`/`series.ys` (samme `series`-objekt som StageProfile-
 * Graph tegner) — så event-markører og fremdrifts-punktet kan forankres PÅ
 * silhuet-linjen i stedet for at svæve frit over en flad bjælke. Binær søgning
 * (xs er allerede km-sorteret af buildProfileSeries) + lineær interpolation
 * mellem de to nærmeste samplepunkter.
 */
export function altitudeAtKm(series, km) {
  if (!series?.xs?.length || !series?.ys?.length) return null;
  const { xs, ys } = series;
  const clamped = Math.max(xs[0], Math.min(km ?? 0, xs[xs.length - 1]));
  if (clamped <= xs[0]) return ys[0];
  if (clamped >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0, hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= clamped) lo = mid; else hi = mid;
  }
  const [x0, x1, y0, y1] = [xs[lo], xs[hi], ys[lo], ys[hi]];
  return x1 === x0 ? y0 : y0 + ((y1 - y0) * (clamped - x0)) / (x1 - x0);
}

// Etapetyper hvor der ikke er noget felt at måle en afstand til. Samme tre
// værdier som backend/lib/raceStageProfileGenerator.js's TIME_TRIAL_PROFILES.
const TIME_TRIAL_PROFILES = new Set(["itt", "itt_hilly", "ttt"]);

/** Er etapen en tidskørsel? Aflæses af `stage_start` — det eneste event der bærer profile_type. */
function isTimeTrialStage(events) {
  const start = events.find((e) => e?.type === "stage_start");
  return TIME_TRIAL_PROFILES.has(start?.params?.profile_type);
}

/**
 * Strukturerer den rå events-liste (spec §2.4-kontraktens `events`) til det
 * scrubberen/feedet/kurven skal bruge: sorteret narrativ-feed (excl. gap_update),
 * stignings-markører, catch-punkt (km for `breakaway_caught`, findes ikke i alle
 * etaper) og gap-kurve-punkter.
 */
/** @param {{events?: Array<{km?: number, type: string, params?: Record<string, unknown>}>, distanceKm?: number|null, ownRiderIds?: Iterable<unknown>|null, effortByRider?: {get(id: string): unknown}|null, timelineVersion?: number|null, startlist?: readonly string[]|null}} input */
export function buildFilmTimeline({ events = [], distanceKm = null, ownRiderIds = [], effortByRider = null, timelineVersion = null, startlist = null } = {}) {
  // #6294/#6350: uden samlinger forklædt som indhentninger, og (v4-tidslinjer)
  // med ærlige km-spænd for hændelser motoren stemplede ved et tjekpunkt.
  // #6469: årsagslinjer (og egne "Alt ud"-linjer) lige efter det udfald de forklarer.
  const sorted = withNarrativeCauses(labelBreakawayEvents(honestTimelineEvents(events, { timelineVersion, startlist }), events), { ownRiderIds, effortByRider });
  const feedEvents = groupRepeatedFeedEvents(sorted.filter((e) => !NON_FEED_TYPES.has(e?.type) && !(e?.type === "finale_attack" && e.params?.kind === "stage_decided")), { ownRiderIds });
  const climbMarkers = sorted
    .filter((e) => e?.type === "kom_passage")
    .map((e) => ({ km: e.km, category: e.params?.category ?? null, name: e.params?.name ?? null }));
  // M13 (#3463): på en tidskørsel findes der ingen "afstand til feltet" at
  // tegne. På en holdtidskørsel er hvert `gap_update` desuden ét HOLDS afstand
  // til det hurtigste hold — tyve hold flettet ind i én kurve er en zigzag der
  // ikke beskriver noget. Kurven udelades derfor på tidskørsler (GapCurveLayer
  // renderer ingenting på en tom liste); tallene bliver stående i tidslinjen.
  const formation = sorted.find((e) => e?.type === "breakaway_formed");
  // Projektionen læser den rå tidslinje (rækkefølge-følsom); kurven og
  // catch-mærket står ved tjekpunktet, hvor motoren målte hullet lukket.
  const caughtEvent = findMorningCatch(events, startlist);
  // Et præcist kontakt-km (exact_km) står samme sted som filmens linje.
  const catchKm = caughtEvent ? (exactEventKm(caughtEvent) ?? caughtEvent.km ?? null) : null;
  const namedGroups = sorted.some((e) => e?.type === "gap_update" && typeof e.params?.group_id === "string");
  let gapCurve = [];
  if (!isTimeTrialStage(sorted)) {
    if (!namedGroups) {
      gapCurve = sorted.filter((e) => e?.type === "gap_update").map((e) => ({ km: e.km, gapSeconds: e.params?.gap_seconds ?? 0 }));
    } else if (formation?.params?.group_id) {
      // Sparse absolute group gaps cannot prove distance to the actual pursuer.
      // Only an explicit pursuit relationship may supply the native break-lead curve.
      const escapeId = formation.params.group_id;
      const explicitPoints = (groupId, fromKm, toKm) => sorted.filter(event => event.type === "gap_update"
        && event.params?.group_id === groupId
        && typeof event.params?.chase_group_id === "string"
        && Number.isFinite(event.params?.separation_seconds)
        && Number(event.params?.separation_seconds) >= 0
        && (fromKm == null || event.km >= fromKm)
        && (toKm == null || event.km <= toKm))
        .map(event => ({ km: event.km, gapSeconds: Number(event.params.separation_seconds) }));
      gapCurve = explicitPoints(escapeId, null, catchKm);
      if (gapCurve.length && catchKm != null) pushCaughtAt(gapCurve, catchKm);
      // #6803: S5's nye udbrud efter en tidlig indhentning (#6369) har sit eget
      // gruppe-id og sin egen indhentning; kurven følger det samme sted, med nul
      // mellem de to udbrud. Uden nyt udbrud er løkken tom: etapen er uændret.
      if (catchKm != null) {
        for (const { formed, caught } of findReformationCatches(events, startlist)) {
          const newKm = formed.km;
          const newCatchKm = caught ? (exactEventKm(caught) ?? caught.km ?? null) : null;
          if (typeof formed.params?.group_id !== "string" || !Number.isFinite(newKm)) continue;
          const points = explicitPoints(formed.params.group_id, newKm, newCatchKm);
          if (!points.length) continue;
          const lastKm = gapCurve.length ? gapCurve[gapCurve.length - 1].km : null;
          // Nul ved det nye udbruds start, ogsaa naar der ingen kurve var foer
          // (Codex #6809): ellers starter filmens markoer paa foerste positive hul.
          if (lastKm == null ? points[0].km > newKm : newKm > lastKm) gapCurve.push({ km: newKm, gapSeconds: 0 });
          gapCurve.push(...points);
          if (newCatchKm != null) pushCaughtAt(gapCurve, newCatchKm);
        }
      }
    }
  }
  const finishEvent = sorted.find((e) => e?.type === "finish");
  const maxKm = distanceKm ?? finishEvent?.km ?? (sorted.length ? sorted[sorted.length - 1].km : 0);

  return {
    events: sorted,
    feedEvents,
    climbMarkers,
    gapCurve,
    catchKm,
    distanceKm: maxKm,
  };
}

/**
 * Hvilke feed-events er "afspillet" ved en given scrub-position (km) — nyeste
 * øverst (samme rækkefølge-konvention som LIVE-tilstandens feed, spec's mockup-
 * kontrakt). km monotont ikke-faldende (spec §2.3.4) → simpelt filter+reverse.
 */
export function eventsPlayedUpTo(feedEvents, scrubKm) {
  const played = (feedEvents || []).filter((e) => (e?.km ?? 0) <= scrubKm);
  return played.slice().reverse();
}

const NARRATIVE_TYPES = new Set(["breakaway_cause", "order_impact"]);

/**
 * #6469: etapehistoriens udvalgte hændelser (selectStoryEvents) med årsagslinjerne
 * til de udfald der er med, lige efter dem. `allEvents` er den liste udvalget er
 * taget fra (samme objekter); årsagerne udledes af hele etapen, ikke kun udvalget.
 */
export function storyEventsWithCauses(storyEvents, allEvents, { ownRiderIds = [], effortByRider = null } = {}) {
  const picked = new Set(storyEvents || []);
  if (!picked.size) return [];
  const out = [];
  let following = false;
  for (const event of withNarrativeCauses(allEvents || [], { ownRiderIds, effortByRider })) {
    if (NARRATIVE_TYPES.has(String(event?.type ?? ""))) {
      if (following) out.push(event);
      continue;
    }
    following = picked.has(event);
    if (following) out.push(event);
  }
  return out;
}

// #6469: hold-navne som i aktør-linjen (catchActor): sidste hold for sig, så
// oversættelsen selv sætter "and"/"og" ind. null når intet navn kan slås op.
function teamListParams(teamIds, teamNameById) {
  const teams = (teamIds || []).map((id) => (id == null ? null : teamNameById?.get?.(String(id)) || null)).filter(Boolean);
  if (!teams.length) return null;
  return { teams: teams.join(", "), teamCount: teams.length, teamsHead: teams.slice(0, -1).join(", "), teamLast: teams[teams.length - 1] };
}

const TEAM_CAUSES = new Set(["own_riders_ahead", "reaction_spent", "no_free_riders", "gc_contained"]);

function describeCause(p, riderNameById, teamNameById) {
  const cause = String(p.cause ?? "");
  if (TEAM_CAUSES.has(cause)) {
    const teams = teamListParams(p.team_ids, teamNameById);
    return teams ? { key: `cause.${cause}`, params: teams } : null;
  }
  switch (cause) {
    case "unchased":
    case "no_chasers":
    case "chase_too_late":
    case "gap_never_closed":
      return { key: `cause.${cause}`, params: {} };
    case "chase_faded":
      return p.climb_name ? { key: "cause.chase_faded_climb", params: { climb: p.climb_name } } : { key: "cause.chase_faded", params: {} };
    case "closed_on_climb":
      return p.climb_name ? { key: "cause.closed_on_climb", params: { climb: p.climb_name } } : null;
    case "gc_threat": {
      const teams = teamListParams(p.team_ids, teamNameById);
      const rider = riderName(p.protected_rider_id, riderNameById);
      const threats = resolvedRiderNames(p.rider_ids, riderNameById);
      if (!teams || !rider || !threats.length) return null;
      return { key: "cause.gc_threat", params: { ...teams, rider, threats: threats.join(", "), threatCount: threats.length } };
    }
    default:
      return null;
  }
}

function describeOrderImpact(p, riderNameById) {
  const rider = riderName(p.rider_id, riderNameById);
  if (!rider) return null;
  if (p.kind === "all_out_stayed_away") return { key: "order.all_out_stayed_away", params: { rider } };
  if (p.kind === "all_out_held_on") {
    return p.climb_name ? { key: "order.all_out_held_on_climb", params: { rider, climb: p.climb_name } } : { key: "order.all_out_held_on", params: { rider } };
  }
  return null;
}

// #4373: itt_win/ttt_win er tidskørslernes EGNE win_types (backend/lib/
// raceTimeline.js) — uden dem faldt en enkeltstart tilbage på "finish" eller,
// før fixet, på "wins the bunch sprint".
const WIN_TYPE_KEY = {
  sprint_win: "sprint_win", close_win: "close_win", solo_win: "solo_win",
  itt_win: "itt_win", ttt_win: "ttt_win",
};
// #4373: tidskørsels-varianter af de linjer der ellers taler om et felt.
const TIME_TRIAL_STAGE_START_KEY = { itt: "stage_start_itt", ttt: "stage_start_ttt" };

// #4026: manglende opslag returnerer null — ALDRIG det rå id. Race Centre-live-
// kortene viste rå rytter-UUID'er ("Hui J. Feng, a2ffc9c9-… rykker væk") fordi
// den gamle String(id)-fallback lækkede igennem når navne-mappet var ufuldstændigt.
// Kontrakten er nu: describeEvent SKIPPER linjer den ikke kan navngive ærligt
// (samme regel som ukendte event-typer) — callers henter navne via collectRiderIds
// + useRiderNames, så skips kun rammer ægte huller (fx slettet rytter).
function riderName(id, riderNameById) {
  if (id == null) return null;
  return riderNameById?.get(id) || riderNameById?.get(String(id)) || null;
}

function resolvedRiderNames(ids, riderNameById) {
  return (ids || []).map((id) => riderName(id, riderNameById)).filter(Boolean);
}

// #2944 — incident-trappen. Motoren (backend/lib/engine/v4/mechanics/incidents.ts)
// emitterer nu fire udfald i stedet for ét: let styrt (tidstab), hårdt styrt
// (tidstab + skadedage), alvorligt styrt (udgår + skadedage) og mekanisk uheld
// (ALTID kun tidstab, aldrig udgåelse, aldrig skade — #4520). En hjælper tæt på
// giver et hurtigere hjulskift, altså mindre tidstab.
//
// Her vælges KUN hvilken tekstnøgle udfaldet svarer til; selve sætningen bor i
// public/locales/{en,da}/races.json (EN først, DA sekundært). Bagudkompatibelt:
// v3's incident-events (og v4-events fra før trappen) bærer hverken `severity`,
// `injury_days` eller `outcome`, og falder derfor på den oprindelige nøgle
// "incident", der stadig kun læser `kind`.
function incidentCopyKey(p) {
  // `severity` er trappens markør: v4 sætter den ALTID (null for mekaniske
  // uheld, der ikke har en alvorsakse), mens v3 og pre-trappe-v4 slet ikke har
  // nøglen. Uden markøren bruges den oprindelige, art-only sætning — v3 har
  // sit eget udfaldsvokabular ("abandon" for både styrt og mekanisk), som
  // trappens tekster ikke beskriver korrekt.
  if (!Object.prototype.hasOwnProperty.call(p, "severity")) return "incident";
  if (p.outcome === "abandoned") return "incident_crash_abandon";
  if (p.outcome === "protected_three_km_rule") return "incident_protected";
  if (p.kind === "mechanical") return p.helper_assist ? "incident_mechanical_helper" : "incident_mechanical";
  if (p.severity === "hard") return "incident_crash_hard";
  if (p.severity === "light") return "incident_crash_time_loss";
  return "incident";
}

function incidentCopyParams(p, rider) {
  return {
    rider,
    kind: p.kind === "mechanical" ? "mechanical" : "crash",
    seconds: Math.round(Number(p.time_loss_seconds) || 0),
    days: Math.round(Number(p.injury_days) || 0),
  };
}

// #4026: alle rider-ids en tidslinjes events refererer — så callers (LiveFilmLine
// på Race Centre) kan batch-hente navne FØR describeEvent kaldes. Skal dække
// præcis de param-former describeEvent læser nedenfor.
export function collectRiderIds(events) {
  const out = new Set();
  const add = (id) => { if (id != null) out.add(id); };
  for (const event of events || []) {
    const p = event?.params || {};
    for (const id of p.rider_ids || []) add(id);
    add(p.rider_id);
    // #4879: v4's sprint_decided navngiver vinderen her. Uden nøglen ville
    // navnet ikke være i batch-opslaget, og describeEvent ville skippe linjen
    // som "kunne ikke navngives" — netop den tavse fejl #4026 lukkede.
    add(p.winner_rider_id);
    add(p.new_leader_id);
    add(p.previous_leader_id);
    add(p.protected_rider_id); // #6067: gc_reaction navngiver holdets GC-rytter
    for (const t of p.top || []) add(t?.rider_id);
  }
  return [...out];
}

/**
 * Broadcast-tekst for ét event — returnerer { key, params } (SAMME mønster som
 * raceRecap.js's buildRaceRecap: ren struktur, oversættelse sker i komponenten
 * via t(`detail.film.event.${key}`, params) — EN-først/DA-sekundært, ingen
 * hardkodet tekst her). Ukendt/uforstået event-type → null (feedet springer den
 * linje over i stedet for at rendere tomt — forward-kompatibelt med spec §2.2's
 * åbne taksonomi).
 *
 * #4026: samme null-regel for events hvis rytternavne IKKE kan slås op — en
 * linje med et råt UUID er værre end ingen linje. Gruppe-events (udbrud) viser
 * de navne der KAN opløses og skipper kun når ingen kan; count følger de viste
 * navne så flertalsbøjningen ({count, plural}) matcher den synlige liste.
 */
export function describeEvent(event, { riderNameById, teamNameById } = {}) {
  if (!event?.type) return null;
  if (event.grouped) {
    return describeGroupedEvent(event, (id) => riderName(id, riderNameById), (member) => describeEvent(member, { riderNameById, teamNameById }));
  }
  // #6299: en mærket udbruds-hændelse nævner kun udbrydderne, eller hedder "gruppe foran feltet".
  const copy = breakawayFilmCopy(event, event.type);
  const p = breakawayLabelOf(event) ? { ...event.params, rider_ids: copy.riderIds } : event.params || {};
  const breakawayParams = () => {
    const names = resolvedRiderNames(p.rider_ids, riderNameById);
    if (!names.length) return null;
    return { riders: names.join(", "), count: names.length };
  };
  if (copy.ahead) { const params = breakawayParams(); return params ? { key: copy.key, params } : null; }
  switch (event.type) {
    case "stage_start":
      return {
        key: TIME_TRIAL_STAGE_START_KEY[p.profile_type] ?? "stage_start",
        params: { count: p.field_count ?? 0, distance: p.distance_km ?? 0 },
      };
    case "breakaway_formed": {
      const params = breakawayParams();
      return params ? { key: "breakaway_formed", params } : null;
    }
    case "kom_passage": {
      const rider = riderName(p.top?.[0]?.rider_id, riderNameById);
      if (!rider) return null;
      return { key: "kom_passage", params: { name: p.name || "—", category: p.category || "", rider } };
    }
    case "intermediate_sprint": {
      const rider = riderName(p.top?.[0]?.rider_id, riderNameById);
      if (!rider) return null;
      return { key: "intermediate_sprint", params: { name: p.name || "—", rider } };
    }
    case "breakaway_caught": {
      const params = breakawayParams();
      if (!params) return null;
      // #6050: nævn aktøren når motoren har skrevet den; ellers den gamle linje.
      const actor = catchActor(event, { teamNameById });
      if (actor?.kind === "teams") {
        return { key: "breakaway_caught_by_teams", params: { ...params, teams: actor.teams, teamCount: actor.teamCount, teamsHead: actor.teamsHead, teamLast: actor.teamLast } };
      }
      if (actor?.kind === "peloton") return { key: "breakaway_caught_by_peloton", params };
      return { key: "breakaway_caught", params };
    }
    case "breakaway_survived": {
      const params = breakawayParams();
      return params ? { key: "breakaway_survived", params } : null;
    }
    case "breakaway_dropped": { // #6185 del 2 (orders_gc_v3): motoren melder selv hvor det skete
      const params = breakawayParams();
      return params ? { key: "breakaway_dropped", params } : null;
    }
    case "incident": {
      const rider = riderName(p.rider_id, riderNameById);
      if (!rider) return null;
      return { key: incidentCopyKey(p), params: incidentCopyParams(p, rider) };
    }
    case "favorite_crack": {
      const rider = riderName(p.rider_id, riderNameById);
      if (!rider) return null;
      // #4373: på en tidskørsel er der ingen front at miste kontakten til.
      return {
        key: p.discipline === "time_trial" ? "favorite_crack_tt" : "favorite_crack",
        params: { rider, reason: p.reason || "unexplained" },
      };
    }
    case "group_merged": {
      const params = breakawayParams();
      return params ? { key: params.count > 4 ? "group_merged_many" : "group_merged", params } : null;
    }
    case "peloton_splits": {
      const params = breakawayParams();
      return params ? { key: params.count > 4 ? "group_split_many" : "peloton_split", params } : null;
    }
    case "finale_attack": {
      if (p.kind === "stage_decided") return null;
      if (p.direction === "descent" && Array.isArray(p.rider_ids)) {
        const params = breakawayParams();
        return params ? { key: params.count > 4 ? "descent_attack_many" : "descent_attack", params } : null;
      }
      const rider = riderName(p.rider_id, riderNameById);
      if (!rider) return null;
      return { key: "finale_attack", params: { rider } };
    }
    // M13 (#3463, holdtidskørslen). Det ENESTE dramatiske øjeblik undervejs i
    // en TTT er at et hold mister en mand — holdet må køre videre med færre til
    // at tage tørnene. Ingen tal ud over km (fog of war): hverken tempo,
    // rotation eller hvor tæt holdet er på at miste den næste.
    case "ttt_rider_dropped": {
      const rider = riderName(p.rider_id, riderNameById);
      if (!rider) return null;
      return { key: "ttt_rider_dropped", params: { rider } };
    }
    case "sprint_decided": {
      // #4879: v4's finale (backend/lib/engine/v4/finale.ts) navngiver vinderen
      // direkte i `winner_rider_id`; v3's tidslinje bærer en `rider_ids`-liste
      // hvor vinderen står først. Uden begge former blev HVER eneste v4-etapes
      // spurt-linje tavst sprunget over af feedet.
      const rider = riderName(p.winner_rider_id ?? (p.rider_ids || [])[0], riderNameById);
      if (!rider) return null;
      return { key: p.photo_finish ? "sprint_decided_photo" : "sprint_decided", params: { rider } };
    }
    // #2582 (tidsgrænsen, v4's M15). Fog of war: hverken procenten eller
    // sekundgrænsen må vises — kun at nogen kom uden for tidsgrænsen, og at
    // grupettoen blev reddet. Derfor et TÆLLETAL og ingen navneliste: et
    // grupetto-event kan bære 40 ryttere, og en linje med 40 navne er ikke en
    // broadcast-linje.
    case "outside_time_limit": {
      const count = Number(p.rider_count ?? (p.rider_ids || []).length) || 0;
      if (count <= 0) return null;
      return { key: "outside_time_limit", params: { count } };
    }
    case "grupetto_saved": {
      const count = Number(p.rider_count ?? (p.rider_ids || []).length) || 0;
      if (count <= 0) return null;
      return { key: "grupetto_saved", params: { count } };
    }
    case "finish": {
      const rider = riderName(p.top?.[0]?.rider_id, riderNameById);
      if (!rider) return null;
      return {
        key: WIN_TYPE_KEY[p.win_type] ? `finish_${WIN_TYPE_KEY[p.win_type]}` : "finish",
        params: { rider },
      };
    }
    case "gc_change": {
      const rider = riderName(p.new_leader_id, riderNameById);
      const previousLeader = riderName(p.previous_leader_id, riderNameById);
      if (!rider || !previousLeader) return null;
      return { key: "gc_change", params: { rider, previousLeader } };
    }
    // #6067: orders_gc_v1's ærlige kvitteringer, uden tal.
    case "gc_reaction":
    case "gc_context":
    case "own_riders_ahead": // #6187 (orders_gc_v3)
      return describeGcReactionEvent(event, (id) => riderName(id, riderNameById));
    case "breakaway_cause": // #6469: afledt af tidslinjen (narrativeCauses6469.ts), aldrig tal
      return describeCause(p, riderNameById, teamNameById);
    case "order_impact": // #6469: kun spillerens egne ryttere og egen ordre
      return describeOrderImpact(p, riderNameById);
    default:
      return null;
  }
}
