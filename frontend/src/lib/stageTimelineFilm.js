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
    add(p.new_leader_id);
    add(p.previous_leader_id);
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
export function describeEvent(event, { riderNameById } = {}) {
  if (!event?.type) return null;
  const p = event.params || {};
  const breakawayParams = () => {
    const names = resolvedRiderNames(p.rider_ids, riderNameById);
    if (!names.length) return null;
    return { riders: names.join(", "), count: names.length };
  };
  switch (event.type) {
    case "stage_start":
      return { key: "stage_start", params: { count: p.field_count ?? 0, distance: p.distance_km ?? 0 } };
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
      return params ? { key: "breakaway_caught", params } : null;
    }
    case "breakaway_survived": {
      const params = breakawayParams();
      return params ? { key: "breakaway_survived", params } : null;
    }
    case "incident": {
      const rider = riderName(p.rider_id, riderNameById);
      if (!rider) return null;
      return { key: "incident", params: { rider, kind: p.kind === "mechanical" ? "mechanical" : "crash" } };
    }
    case "favorite_crack": {
      const rider = riderName(p.rider_id, riderNameById);
      if (!rider) return null;
      return { key: "favorite_crack", params: { rider, reason: p.reason || "unexplained" } };
    }
    case "finale_attack": {
      const rider = riderName(p.rider_id, riderNameById);
      if (!rider) return null;
      return { key: "finale_attack", params: { rider } };
    }
    case "sprint_decided": {
      const rider = riderName((p.rider_ids || [])[0], riderNameById);
      if (!rider) return null;
      return { key: p.photo_finish ? "sprint_decided_photo" : "sprint_decided", params: { rider } };
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
    default:
      return null;
  }
}
