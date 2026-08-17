// #3859 (bølge 2 — løbsfilm-afspilleren): ren afledningslogik for TimelineFilmPlayer.
// Bygger på spec §2.2's event-taksonomi (docs/superpowers/specs/2026-08-17-race-
// event-log-stage-timeline-design.md). Samme adskillelse som finalKilometre.js:
// AL data-afledning bor her (testbar uden DOM); komponenten er kun tidsstyring +
// rendering.
//
// km→pixel-mapping, "hvilke events er afspillet ved km X" og broadcast-tekst-
// nøgler/params er alle rene funktioner af (events, distanceKm) — ingen skjult
// tilstand, ingen engine-kald.

// gap_update er kurve-punkter (spec §2.2 "(S) kurvepunkter — valg 2"), ALDRIG en
// narrativ feed-linje — samme udelukkelse som stageTimelineStory.js.
const NON_FEED_TYPES = new Set(["gap_update"]);

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

export function xToKm(x, distanceKm, plotWidth) {
  if (!plotWidth || plotWidth <= 0) return 0;
  const frac = Math.max(0, Math.min(x / plotWidth, 1));
  return frac * (distanceKm ?? 0);
}

/**
 * Strukturerer den rå events-liste (spec §2.4-kontraktens `events`) til det
 * scrubberen/feedet/kurven skal bruge: sorteret narrativ-feed (excl. gap_update),
 * stignings-markører, catch-punkt (km for `breakaway_caught`, findes ikke i alle
 * etaper) og gap-kurve-punkter.
 */
export function buildFilmTimeline({ events = [], distanceKm = null } = {}) {
  const sorted = [...(events || [])].sort((a, b) => (a?.km ?? 0) - (b?.km ?? 0));
  const feedEvents = sorted.filter((e) => !NON_FEED_TYPES.has(e?.type));
  const climbMarkers = sorted
    .filter((e) => e?.type === "kom_passage")
    .map((e) => ({ km: e.km, category: e.params?.category ?? null, name: e.params?.name ?? null }));
  const gapCurve = sorted
    .filter((e) => e?.type === "gap_update")
    .map((e) => ({ km: e.km, gapSeconds: e.params?.gap_seconds ?? 0 }));
  const caughtEvent = sorted.find((e) => e?.type === "breakaway_caught");
  const finishEvent = sorted.find((e) => e?.type === "finish");
  const maxKm = distanceKm ?? finishEvent?.km ?? (sorted.length ? sorted[sorted.length - 1].km : 0);

  return {
    events: sorted,
    feedEvents,
    climbMarkers,
    gapCurve,
    catchKm: caughtEvent?.km ?? null,
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

const WIN_TYPE_KEY = { sprint_win: "sprint_win", close_win: "close_win", solo_win: "solo_win" };

function riderName(id, riderNameById) {
  if (id == null) return "—";
  return riderNameById?.get(id) || riderNameById?.get(String(id)) || String(id);
}

function riderNames(ids, riderNameById) {
  return (ids || []).map((id) => riderName(id, riderNameById)).join(", ");
}

/**
 * Broadcast-tekst for ét event — returnerer { key, params } (SAMME mønster som
 * raceRecap.js's buildRaceRecap: ren struktur, oversættelse sker i komponenten
 * via t(`detail.film.event.${key}`, params) — EN-først/DA-sekundært, ingen
 * hardkodet tekst her). Ukendt/uforstået event-type → null (feedet springer den
 * linje over i stedet for at rendere tomt — forward-kompatibelt med spec §2.2's
 * åbne taksonomi).
 */
export function describeEvent(event, { riderNameById } = {}) {
  if (!event?.type) return null;
  const p = event.params || {};
  switch (event.type) {
    case "stage_start":
      return { key: "stage_start", params: { count: p.field_count ?? 0, distance: p.distance_km ?? 0 } };
    case "breakaway_formed":
      return { key: "breakaway_formed", params: { riders: riderNames(p.rider_ids, riderNameById), count: (p.rider_ids || []).length } };
    case "kom_passage":
      return {
        key: "kom_passage",
        params: {
          name: p.name || "—",
          category: p.category || "",
          rider: riderName(p.top?.[0]?.rider_id, riderNameById),
        },
      };
    case "intermediate_sprint":
      return {
        key: "intermediate_sprint",
        params: { name: p.name || "—", rider: riderName(p.top?.[0]?.rider_id, riderNameById) },
      };
    case "breakaway_caught":
      return { key: "breakaway_caught", params: { riders: riderNames(p.rider_ids, riderNameById), count: (p.rider_ids || []).length } };
    case "breakaway_survived":
      return { key: "breakaway_survived", params: { riders: riderNames(p.rider_ids, riderNameById), count: (p.rider_ids || []).length } };
    case "incident":
      return {
        key: "incident",
        params: { rider: riderName(p.rider_id, riderNameById), kind: p.kind === "mechanical" ? "mechanical" : "crash" },
      };
    case "favorite_crack":
      return { key: "favorite_crack", params: { rider: riderName(p.rider_id, riderNameById), reason: p.reason || "unexplained" } };
    case "finale_attack":
      return { key: "finale_attack", params: { rider: riderName(p.rider_id, riderNameById) } };
    case "sprint_decided":
      return {
        key: p.photo_finish ? "sprint_decided_photo" : "sprint_decided",
        params: { rider: riderName((p.rider_ids || [])[0], riderNameById) },
      };
    case "finish": {
      const winner = p.top?.[0];
      return {
        key: WIN_TYPE_KEY[p.win_type] ? `finish_${WIN_TYPE_KEY[p.win_type]}` : "finish",
        params: { rider: riderName(winner?.rider_id, riderNameById) },
      };
    }
    case "gc_change":
      return {
        key: "gc_change",
        params: {
          rider: riderName(p.new_leader_id, riderNameById),
          previousLeader: riderName(p.previous_leader_id, riderNameById),
        },
      };
    default:
      return null;
  }
}
