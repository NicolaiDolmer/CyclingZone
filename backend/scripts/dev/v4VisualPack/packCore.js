// backend/scripts/dev/v4VisualPack/packCore.js
// #5804: REN kerne for den visuelle v4-testpakke (ingen DB, intet netvaerk, ingen
// filer). Tre ting:
//   1. udvaelg de S4-loeb der daekker hver terraentype i foerste uge,
//   2. analysér én etape (v4 mod v3 paa SAMME felt og SAMME seed),
//   3. saml et resumé paa tvaers af etaperne.
//
// OFFENTLIGHEDSPOLITIK (hard rule 17): repoet er offentligt. Denne fil indeholder
// ingen balance-tal fra motoren eller generatoren. Anomali-reglerne er LOGISKE
// konsistens-tjek (fx "tidslinjen siger at udbruddet holdt, men vinderen var ikke i
// udbruddet"), ikke realisme-baand. Tallene de producerer lander kun i den private
// HTML-side uden for repoet.

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Terraen
// ---------------------------------------------------------------------------

/** Etapetype -> terraen-familie (dansk etiket). De seks ejeren bad om + resten. */
export const TERRAIN_FAMILY = Object.freeze({
  flat: "flad",
  rolling: "bakket",
  hilly: "kuperet",
  classic: "kuperet",
  mountain: "bjerg",
  high_mountain: "hoejfjeld",
  cobbles: "brosten",
  gravel: "grus",
  itt: "enkeltstart",
  itt_hilly: "enkeltstart",
  ttt: "holdtidskoersel",
});

/** De terraen-familier ejeren kraevede mindst én etape af (issue #5804). */
export const REQUIRED_FAMILIES = Object.freeze(["flad", "kuperet", "bjerg", "hoejfjeld", "brosten", "enkeltstart"]);

export const FAMILY_LABEL = Object.freeze({
  flad: "Flad",
  bakket: "Bakket",
  kuperet: "Kuperet",
  bjerg: "Bjerg",
  hoejfjeld: "Højfjeld",
  brosten: "Brosten",
  grus: "Grus",
  enkeltstart: "Enkeltstart",
  holdtidskoersel: "Holdtidskørsel",
});

export function terrainFamily(profileType) {
  return TERRAIN_FAMILY[profileType] ?? String(profileType ?? "ukendt");
}

const MOUNTAIN_FAMILIES = new Set(["bjerg", "hoejfjeld"]);
const TIME_TRIAL_FAMILIES = new Set(["enkeltstart", "holdtidskoersel"]);

// ---------------------------------------------------------------------------
// Id'er og datoer
// ---------------------------------------------------------------------------

/**
 * Deterministisk UUID af en streng. Planens loeb findes ikke i databasen endnu;
 * de faar et stabilt id saa seedet (raceSeedInput(race.id, etape)) er det samme
 * hver koersel, og saa enhver SELECT paa id'et er gyldig og bare giver 0 raekker.
 */
export function syntheticRaceId(key) {
  const h = createHash("sha1").update(`v4-visual-5804:${key}`).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** ISO-instant -> dansk kalenderdato "YYYY-MM-DD" (Europe/Copenhagen). */
export function copenhagenDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen" }).format(d);
}

/** ISO-instant -> "man 28/9 19:30" (dansk lokaltid). */
export function copenhagenLabel(iso) {
  if (!iso) return "uden tid";
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("da-DK", {
    timeZone: "Europe/Copenhagen", weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit",
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday").replace(".", "")} ${get("day")}/${get("month")} ${get("hour")}:${get("minute")}`;
}

export function stageInWindow(stage, { from, to }) {
  const day = copenhagenDate(stage?.scheduled_at);
  return day != null && day >= from && day <= to;
}

// ---------------------------------------------------------------------------
// 1. Udvaelgelse: daek hver terraen-familie i foerste uge, billigst muligt
// ---------------------------------------------------------------------------

/**
 * Graadig daekning pr. (trup, tier): tag loebet der daekker flest endnu-udaekkede
 * terraen-familier blandt sine uge-1-etaper, pr. etape der skal simuleres (et
 * etapeloeb koeres fra etape 1, saa en etape 5 koster fem etaper). Uafgjort:
 * faerrest etaper, saa id. Stopper naar alle familier i ugen er daekket eller
 * `maxRacesPerGroup` er naaet.
 *
 * @param {{races: Array<object>, window: {from: string, to: string}, maxRacesPerGroup?: number,
 *   youthMaxRaces?: number, groups?: Array<{squad: string, tier: number|null}>}} args
 * @returns {Array<object>} de valgte loeb med `week1Stages` (etape-numre i ugen) og `simulateThrough`
 */
export function selectRacesForCoverage({ races, window, maxRacesPerGroup = 6, youthMaxRaces = 2, groups = null }) {
  const byGroup = new Map();
  for (const race of races) {
    const week1 = (race.stages ?? []).filter((s) => stageInWindow(s, window));
    if (week1.length === 0) continue;
    const groupKey = race.squad === "senior" ? `senior:${race.tier}` : `${race.squad}:*`;
    if (groups && !groups.some((g) => (g.squad === race.squad) && (g.tier == null || g.tier === race.tier))) continue;
    if (!byGroup.has(groupKey)) byGroup.set(groupKey, []);
    const through = Math.max(...week1.map((s) => Number(s.stage_number) || 1));
    byGroup.get(groupKey).push({
      ...race,
      week1Stages: week1.map((s) => Number(s.stage_number) || 1).sort((a, b) => a - b),
      simulateThrough: through,
      families: new Set(week1.map((s) => terrainFamily(s.profile_type))),
    });
  }
  const picked = [];
  for (const [groupKey, candidates] of [...byGroup.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const isYouth = !groupKey.startsWith("senior:");
    const limit = isYouth ? youthMaxRaces : maxRacesPerGroup;
    const allFamilies = new Set(candidates.flatMap((c) => [...c.families]));
    const covered = new Set();
    const pool = [...candidates];
    while (picked.filter((p) => p.groupKey === groupKey).length < limit && pool.length) {
      let best = null;
      for (const c of pool) {
        const gain = [...c.families].filter((f) => !covered.has(f)).length;
        const score = gain / Math.max(1, c.simulateThrough);
        if (
          !best || score > best.score
          || (score === best.score && c.simulateThrough < best.c.simulateThrough)
          || (score === best.score && c.simulateThrough === best.c.simulateThrough && String(c.id) < String(best.c.id))
        ) best = { c, score, gain };
      }
      if (!best || (best.gain === 0 && !isYouth)) break;
      if (isYouth && best.gain === 0 && picked.some((p) => p.groupKey === groupKey)) break;
      for (const f of best.c.families) covered.add(f);
      pool.splice(pool.indexOf(best.c), 1);
      const { families, ...rest } = best.c;
      picked.push({ ...rest, groupKey, families: [...families] });
      if ([...allFamilies].every((f) => covered.has(f))) break;
    }
  }
  return picked;
}

/** Hvilke kraevede familier findes slet ikke i ugen for en gruppe (kan ikke daekkes)? */
export function coverageReport({ races, picked, window }) {
  const groups = new Map();
  for (const race of races) {
    const key = race.squad === "senior" ? `senior:${race.tier}` : `${race.squad}:*`;
    if (!groups.has(key)) groups.set(key, { available: new Set(), covered: new Set() });
    for (const s of race.stages ?? []) if (stageInWindow(s, window)) groups.get(key).available.add(terrainFamily(s.profile_type));
  }
  for (const p of picked) {
    const g = groups.get(p.groupKey);
    if (!g) continue;
    for (const s of p.stages ?? []) if (p.week1Stages.includes(Number(s.stage_number) || 1)) g.covered.add(terrainFamily(s.profile_type));
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, g]) => ({
    key,
    available: [...g.available].sort(),
    covered: [...g.covered].sort(),
    missingRequired: REQUIRED_FAMILIES.filter((f) => !g.covered.has(f)),
    notInWeek: REQUIRED_FAMILIES.filter((f) => !g.available.has(f)),
  }));
}

// ---------------------------------------------------------------------------
// 2. Én etape: v4 mod v3
// ---------------------------------------------------------------------------

/** "+M:SS" -> sekunder (samme form som raceClassifications.formatGap). */
export function parseGap(text) {
  const m = /^\+?(\d+):(\d{2})$/u.exec(String(text ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/** v3's sejrstype af tidsgabet til nr. 2 (samme offentlige graenser som raceTimeline.js). */
export function v3WinTypeFromGap(gapToSecond, family) {
  if (family === "enkeltstart") return "itt_win";
  if (family === "holdtidskoersel") return "ttt_win";
  if (gapToSecond == null) return "solo_win";
  if (gapToSecond < 3) return "sprint_win";
  if (gapToSecond < 10) return "close_win";
  return "solo_win";
}

export const WIN_TYPE_LABEL = Object.freeze({
  sprint_win: "massespurt",
  close_win: "lille gruppe",
  solo_win: "solo",
  itt_win: "enkeltstart",
  ttt_win: "holdtidskørsel",
});

function riderIdsOfEvent(ev) {
  const p = ev?.params ?? {};
  if (Array.isArray(p.rider_ids)) return p.rider_ids.map(String);
  if (p.rider_id != null) return [String(p.rider_id)];
  return [];
}

/**
 * Udbruddets medlemmer: det foerste gruppe-snapshot med en gruppe af art
 * "breakaway" (tidslinjens breakaway_formed viser kun de tre foerste id'er).
 */
export function breakawayMembers(groupSnapshots = []) {
  for (const snap of groupSnapshots) {
    const g = (snap.groups ?? []).find((x) => x.kind === "breakaway");
    if (g) return new Set((g.rider_ids ?? []).map(String));
  }
  return new Set();
}

/** Komprimér gruppe-snapshots til tegning: [km, [[art, antal, gab, id]]]. */
export function compactSnapshots(groupSnapshots = []) {
  return groupSnapshots.map((s) => [
    Math.round(Number(s.km) * 10) / 10,
    (s.groups ?? []).map((g) => [g.kind, (g.rider_ids ?? []).length, Math.round(Number(g.gap_seconds) || 0), String(g.group_id)]),
  ]);
}

const TIMELINE_EVENT_LABEL = Object.freeze({
  stage_start: "Start",
  breakaway_formed: "Udbrud går",
  breakaway_caught: "Udbrud hentet",
  breakaway_survived: "Udbrud holder",
  peloton_splits: "Feltet splittes",
  group_merged: "Grupper samles",
  incident: "Uheld",
  favorite_crack: "Favorit knækker",
  finale_attack: "Angreb",
  sprint_decided: "Spurt afgjort",
  finish: "Mål",
  gc_change: "Ny førende",
  kom_passage: "Bjergpassage",
  intermediate_sprint: "Indlagt spurt",
  outside_time_limit: "Uden for tidsgrænsen",
  grupetto_saved: "Grupetto reddet",
  gap_update: "Tidsgab",
});

export function eventLabel(type) {
  return TIMELINE_EVENT_LABEL[type] ?? type;
}

/** Tidslinje-events til visning (gap_update tyndes ud; de fylder og siger lidt). */
export function displayEvents(events = []) {
  const out = [];
  let lastGapKm = -Infinity;
  for (const ev of events) {
    if (ev.type === "gap_update") {
      if (ev.km - lastGapKm < 15) continue;
      lastGapKm = ev.km;
    }
    out.push({ km: Math.round(Number(ev.km) * 10) / 10, type: ev.type, params: ev.params ?? {} });
  }
  return out;
}

/**
 * Analysér én etape. `rec` er collectorens raa etape-post:
 *   { family, isStageRace, favorites:[{rider_id}], riderTeam:{id:team_id},
 *     v4: { results, events, groupSnapshots, incidents, trace, timelineValid },
 *     v3: { rows:[{rider_id, rank, gap, in_breakaway, breakaway_caught}], events, incidents } }
 */
export function analyzeStage(rec) {
  const family = rec.family;
  const v4Results = [...(rec.v4?.results ?? [])].sort((a, b) => a.rank - b.rank);
  const v4Finishers = v4Results.filter((r) => r.status === "finished" || r.reinstated_by);
  const winnerTime = v4Finishers[0]?.time_seconds ?? 0;
  const v4Rows = v4Results.map((r) => ({
    rider_id: String(r.rider_id),
    rank: r.rank,
    gap: Math.round((Number(r.time_seconds) || 0) - winnerTime),
    status: r.status,
    reinstated: r.reinstated_by ?? null,
    group_id: r.group_id,
  }));
  const v3Rows = [...(rec.v3?.rows ?? [])].sort((a, b) => a.rank - b.rank).map((r) => ({ ...r, rider_id: String(r.rider_id) }));

  const v4RankOf = new Map(v4Rows.map((r) => [r.rider_id, r]));
  const v3RankOf = new Map(v3Rows.map((r) => [r.rider_id, r]));

  const events = rec.v4?.events ?? [];
  const v4WinTypeEvent = [...events].reverse().find((e) => e.params?.win_type)?.params?.win_type ?? null;
  const v4Second = v4Rows.find((r) => r.rank === 2);
  const v4WinType = v4WinTypeEvent ?? v3WinTypeFromGap(v4Second ? v4Second.gap : null, family);
  const v3Second = v3Rows.find((r) => r.rank === 2);
  const v3WinType = v3WinTypeFromGap(v3Second ? v3Second.gap : null, family);

  const bwMembers = breakawayMembers(rec.v4?.groupSnapshots ?? []);
  const has = (type) => events.some((e) => e.type === type);
  const v4Winner = v4Rows[0]?.rider_id ?? null;
  const winnerInBreakaway = v4Winner != null && bwMembers.has(v4Winner);
  const breakaway = {
    formed: has("breakaway_formed"),
    caught: has("breakaway_caught"),
    survived: has("breakaway_survived"),
    size: bwMembers.size,
    winnerFromBreakaway: winnerInBreakaway,
    engineSaysBreakawayWin: rec.v4?.trace?.breakaway_win ?? null,
  };

  const otl = v4Rows.filter((r) => r.status === "otl").length;
  const abandoned = v4Rows.filter((r) => r.status === "abandoned").length;
  const rescued = v4Rows.filter((r) => r.reinstated === "grupetto").length;
  const incidents = rec.v4?.incidents ?? [];
  const v3Incidents = rec.v3?.incidents ?? [];

  const favorite = rec.favorites?.[0]?.rider_id != null ? String(rec.favorites[0].rider_id) : null;
  const fav = favorite == null ? null : {
    rider_id: favorite,
    v4Rank: v4RankOf.get(favorite)?.rank ?? null,
    v4Status: v4RankOf.get(favorite)?.status ?? "ikke i feltet",
    v3Rank: v3RankOf.get(favorite)?.rank ?? null,
  };

  // Afsluttende grupper: distinkte group_id blandt dem der kom i maal (v4).
  const finishGroups = new Set(v4Finishers.map((r) => r.group_id)).size;
  const teamOf = (id) => rec.riderTeam?.[id] ?? null;
  const top10TeamMax = (rows) => {
    const c = new Map();
    for (const r of rows.slice(0, 10)) {
      const t = teamOf(r.rider_id);
      if (t != null) c.set(t, (c.get(t) ?? 0) + 1);
    }
    return Math.max(0, ...c.values());
  };

  const anomalies = [];
  const flag = (severity, code, text) => anomalies.push({ severity, code, text });
  if (rec.v4?.timelineValid === false) {
    flag("hoej", "timeline_invalid", "Motorens egen validator afviste tidslinjen; broen ville ikke gemme filmen.");
  }
  if (breakaway.survived && !winnerInBreakaway && !TIME_TRIAL_FAMILIES.has(family)) {
    flag("hoej", "survived_but_not_won", "Tidslinjen siger 'udbrud holdt', men vinderen var ikke i udbruddet.");
  }
  if (breakaway.caught && breakaway.survived) {
    flag("middel", "caught_and_survived", "Udbruddet står både som hentet og som holdt i samme etape.");
  }
  if (breakaway.engineSaysBreakawayWin === true && !winnerInBreakaway) {
    flag("hoej", "trace_breakaway_mismatch", "Motorens dom siger udbrudssejr, men vinderen var ikke i udbruddets første snapshot.");
  }
  if (breakaway.caught && winnerInBreakaway && breakaway.engineSaysBreakawayWin === false && v4WinType === "solo_win") {
    flag("lav", "caught_then_solo", "Udbruddet blev hentet, og en udbrydder vandt alligevel solo (kontra-angreb eller forsinket hentning).");
  }
  if (otl > 0 && !MOUNTAIN_FAMILIES.has(family)) {
    flag("middel", "otl_non_mountain", `${otl} rytter(e) uden for tidsgrænsen på en ${FAMILY_LABEL[family] ?? family}-etape.`);
  }
  if (otl > 0 && MOUNTAIN_FAMILIES.has(family)) {
    flag("lav", "otl_mountain", `${otl} rytter(e) uden for tidsgrænsen (bjergetape; ${rescued} reddet af grupettoen).`);
  }
  if (abandoned > 0) {
    flag("lav", "abandoned", `${abandoned} udgået efter uheld.`);
  }
  if (MOUNTAIN_FAMILIES.has(family) && finishGroups <= 1 && v4Finishers.length > 10) {
    flag("hoej", "no_selection_mountain", "Bjergetape uden selektion: hele feltet kom i mål i én gruppe.");
  }
  if (family === "flad" && v4WinType === "solo_win" && v3WinType === "sprint_win") {
    flag("middel", "flat_solo_vs_sprint", "Flad etape: v4 endte solo, v3 i massespurt.");
  }
  if (fav && fav.v3Rank != null && fav.v3Rank <= 3 && (fav.v4Rank == null || fav.v4Rank > 10)) {
    flag("middel", "favorite_diverges", `Favoritten blev nr. ${fav.v3Rank} i v3, men ${fav.v4Rank ? `nr. ${fav.v4Rank}` : fav.v4Status} i v4.`);
  }
  if (top10TeamMax(v4Rows) >= 4) {
    flag("lav", "team_dominance_v4", `Ét hold har ${top10TeamMax(v4Rows)} ryttere i v4's top 10.`);
  }

  return {
    family,
    v4: {
      top10: v4Rows.slice(0, 10),
      winType: v4WinType,
      winner: v4Winner,
      finishGroups,
      otl,
      abandoned,
      rescued,
      incidents: incidents.length,
      top10Spread: v4Rows[Math.min(9, v4Rows.length - 1)]?.gap ?? 0,
      lastGap: v4Finishers.length ? v4Rows.find((r) => r.rider_id === v4Finishers[v4Finishers.length - 1].rider_id)?.gap ?? 0 : 0,
    },
    v3: {
      top10: v3Rows.slice(0, 10),
      winType: v3WinType,
      winner: v3Rows[0]?.rider_id ?? null,
      incidents: v3Incidents.length,
      top10Spread: v3Rows[Math.min(9, v3Rows.length - 1)]?.gap ?? 0,
      lastGap: v3Rows[v3Rows.length - 1]?.gap ?? 0,
    },
    sameWinner: v4Winner != null && v4Winner === (v3Rows[0]?.rider_id ?? null),
    top10Overlap: v4Rows.slice(0, 10).filter((r) => v3Rows.slice(0, 10).some((x) => x.rider_id === r.rider_id)).length,
    breakaway,
    favorite: fav,
    anomalies,
    field: v4Rows.length,
  };
}

// ---------------------------------------------------------------------------
// 3. Resumé
// ---------------------------------------------------------------------------

function share(part, whole) {
  return whole > 0 ? part / whole : null;
}

/** Aggreger analyser (én pr. etape) til resuméets tal. */
export function summarizeAnalyses(analyses) {
  const n = analyses.length;
  const byFamily = new Map();
  for (const a of analyses) {
    if (!byFamily.has(a.family)) byFamily.set(a.family, []);
    byFamily.get(a.family).push(a);
  }
  const withFav = analyses.filter((a) => a.favorite && a.favorite.v4Rank !== undefined);
  const favWinV4 = withFav.filter((a) => a.favorite.v4Rank === 1).length;
  const favWinV3 = withFav.filter((a) => a.favorite.v3Rank === 1).length;
  const favTop10V4 = withFav.filter((a) => a.favorite.v4Rank != null && a.favorite.v4Rank <= 10).length;
  const favTop10V3 = withFav.filter((a) => a.favorite.v3Rank != null && a.favorite.v3Rank <= 10).length;
  const roads = analyses.filter((a) => !TIME_TRIAL_FAMILIES.has(a.family));
  const bwFormed = roads.filter((a) => a.breakaway.formed).length;
  const bwWon = roads.filter((a) => a.breakaway.winnerFromBreakaway).length;
  const sevCount = (sev) => analyses.reduce((s, a) => s + a.anomalies.filter((x) => x.severity === sev).length, 0);
  const winTypes = (engine) => {
    const c = {};
    for (const a of analyses) c[a[engine].winType] = (c[a[engine].winType] ?? 0) + 1;
    return c;
  };
  return {
    stages: n,
    families: [...byFamily.keys()],
    familyCounts: Object.fromEntries([...byFamily.entries()].map(([k, v]) => [k, v.length])),
    sameWinner: analyses.filter((a) => a.sameWinner).length,
    meanTop10Overlap: n ? analyses.reduce((s, a) => s + a.top10Overlap, 0) / n : null,
    favorites: {
      stages: withFav.length,
      winV4: favWinV4, winV3: favWinV3,
      top10V4: favTop10V4, top10V3: favTop10V3,
      winShareV4: share(favWinV4, withFav.length), winShareV3: share(favWinV3, withFav.length),
    },
    breakaway: { roadStages: roads.length, formed: bwFormed, won: bwWon, winShare: share(bwWon, roads.length) },
    otl: analyses.reduce((s, a) => s + a.v4.otl, 0),
    stagesWithOtl: analyses.filter((a) => a.v4.otl > 0).length,
    rescued: analyses.reduce((s, a) => s + a.v4.rescued, 0),
    abandoned: analyses.reduce((s, a) => s + a.v4.abandoned, 0),
    incidentsV4: analyses.reduce((s, a) => s + a.v4.incidents, 0),
    incidentsV3: analyses.reduce((s, a) => s + a.v3.incidents, 0),
    riderStarts: analyses.reduce((s, a) => s + a.field, 0),
    winTypesV4: winTypes("v4"),
    winTypesV3: winTypes("v3"),
    anomalies: { hoej: sevCount("hoej"), middel: sevCount("middel"), lav: sevCount("lav") },
    anomalyCodes: analyses.flatMap((a) => a.anomalies.map((x) => x.code)).reduce((m, c) => ({ ...m, [c]: (m[c] ?? 0) + 1 }), {}),
    byFamily: Object.fromEntries([...byFamily.entries()].map(([k, list]) => [k, {
      stages: list.length,
      meanFinishGroupsV4: list.reduce((s, a) => s + a.v4.finishGroups, 0) / list.length,
      meanTop10SpreadV4: list.reduce((s, a) => s + a.v4.top10Spread, 0) / list.length,
      meanTop10SpreadV3: list.reduce((s, a) => s + a.v3.top10Spread, 0) / list.length,
      winTypesV4: list.reduce((m, a) => ({ ...m, [a.v4.winType]: (m[a.v4.winType] ?? 0) + 1 }), {}),
      winTypesV3: list.reduce((m, a) => ({ ...m, [a.v3.winType]: (m[a.v3.winType] ?? 0) + 1 }), {}),
    }])),
  };
}

export { riderIdsOfEvent };
