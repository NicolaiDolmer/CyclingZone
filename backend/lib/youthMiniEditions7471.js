// backend/lib/youthMiniEditions7471.js
// #7471 (ejer 26/11): ungdomskalenderen bliver MINI-UDGAVER af seniorloebene.
//
// Ejerens 9 beslutninger (issue #7471, kommentar 26/11), som modulet her bygger:
//   1. U23 ca. 40 og junior ca. 28 loebsdage pr. saeson.
//   2. Mini-GT'er: U23 3 a 7 etaper, junior 3 a 4 etaper.
//   3. Alle 5 monumenter faar en mini-udgave paa begge niveauer.
//   4. Mini-udgaven koerer paa SAMME dage som seniorudgaven.
//   5. Samme loebstype og signatur som seniorloebet; kortere distance.
//   6. Praecis seniorloebets navn med "U23"/"Junior" ved navnet.
//   7. Resten fyldes med de mest kendte seniorloeb efter en regel: hver ryttertype
//      (sprinter, bakke, brosten, enkeltstart, klatrer, allround) faar mindst 2 maal.
//   8. Alle ungdomsdivisioner paa samme niveau koerer de samme loeb.
//   9. Ejeren godkender listen og kalenderen foer noget koeres.
//
// Modulet er RENT (ingen I/O). Kataloget (race_pool-raekkerne) laegges af migrationen
// database/2026-11-26-7471-youth-mini-editions.sql, som er bygget af SAMME regler
// (miniEditionStages, miniEditionName, miniEditionExternalId, miniEditionId); testen
// holder SQL og JS i takt. Kalenderen bygges af packMiniEditionCalendar ud fra
// seniorens 1. division i samme saeson (GT'er og monumenter findes kun dér).
//
// Seniorkalenderen roeres ikke: alt her gaelder kun raekker hvis external_id har
// mini-praefikset, og kun ungdomstrupperne laeser dem.

import { createHash } from "node:crypto";

export const MINI_SQUADS = Object.freeze(["u23", "junior"]);

/** Hvilken seniordivision mini-udgaverne spejler: GT'er og monumenter koerer kun i D1. */
export const MINI_SOURCE_TIER = 1;

/** Senior-klasserne der kan faa en mini-udgave (D1's klasser, #2276-kaskaden). */
export const MINI_SOURCE_CLASSES = Object.freeze([
  "TourFrance", "GiroVuelta", "Monuments", "OtherWorldTourA", "OtherWorldTourB", "OtherWorldTourC",
]);

const GT_CLASSES = new Set(["TourFrance", "GiroVuelta"]);
const PRESTIGE = Object.freeze({
  TourFrance: 0, GiroVuelta: 0, Monuments: 1, OtherWorldTourA: 2, OtherWorldTourB: 3, OtherWorldTourC: 4,
});

/**
 * Ejerens tal pr. niveau (beslutning 1, 2, 5 og 7). Distance-faktoren er ejerens
 * procentsats; filler-etapeloeb forkortes med samme tanke som GT'erne (se PR-spoergsmaal).
 */
export const MINI_EDITION_RULES = Object.freeze({
  u23: Object.freeze({
    label: "U23", externalPrefix: "u23-mini-", gtStages: 7, monuments: 5, targetRaceDays: 40,
    distanceScale: 0.75, stageRaceDivisor: 2, minStageRaceStages: 3, overlapShare: Object.freeze({ min: 0.25, max: 0.35 }),
  }),
  junior: Object.freeze({
    label: "Junior", externalPrefix: "jun-mini-", gtStages: 4, monuments: 5, targetRaceDays: 28,
    distanceScale: 0.6, stageRaceDivisor: 3, minStageRaceStages: 3, overlapShare: Object.freeze({ min: 0.15, max: 0.25 }),
  }),
});

/** Ryttertyperne i beslutning 7, og hvor mange maal hver skal have. */
export const RIDER_TYPES = Object.freeze(["sprinter", "bakke", "brosten", "enkeltstart", "klatrer", "allround"]);
export const MIN_GOALS_PER_RIDER_TYPE = 2;

function rulesFor(squad) {
  const rules = MINI_EDITION_RULES[squad];
  if (!rules) throw new Error(`youthMiniEditions7471: unknown youth squad "${squad}"`);
  return rules;
}

/** Beslutning 6: praecis seniorloebets navn, med niveauet ved navnet. */
export function miniEditionName(seniorName, squad) {
  return `${String(seniorName).trim()} ${rulesFor(squad).label}`;
}

export function miniEditionExternalId(seniorExternalId, squad) {
  return `${rulesFor(squad).externalPrefix}${seniorExternalId}`;
}

/** { squad, seniorExternalId } for en mini-raekke, ellers null. */
export function parseMiniEditionExternalId(externalId) {
  const id = String(externalId ?? "");
  for (const squad of MINI_SQUADS) {
    const prefix = MINI_EDITION_RULES[squad].externalPrefix;
    if (id.startsWith(prefix) && id.length > prefix.length) return { squad, seniorExternalId: id.slice(prefix.length) };
  }
  return null;
}

export function isMiniEditionRow(row) {
  return parseMiniEditionExternalId(row?.external_id) != null;
}

/**
 * Stabilt race_pool.id: md5 af "7471:<trup>:<senior-id>" formateret som uuid. Samme udtryk
 * som migrationens md5(...)::uuid, saa genkoersel rammer ON CONFLICT og aldrig dublerer.
 */
export function miniEditionId(seniorId, squad) {
  rulesFor(squad);
  const hex = createHash("md5").update(`7471:${squad}:${seniorId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isGrandTourRow(row) {
  return GT_CLASSES.has(row?.race_class) || row?.terrain_archetype === "grand_tour";
}

/** Beslutning 2 + filler-reglen: hvor mange etaper mini-udgaven har. */
export function miniEditionStages(seniorRow, squad) {
  const rules = rulesFor(squad);
  if (seniorRow?.race_type !== "stage_race") return 1;
  if (isGrandTourRow(seniorRow)) return rules.gtStages;
  const n = Math.max(2, Number(seniorRow?.stages) || 2);
  return Math.min(n, Math.max(rules.minStageRaceStages, Math.ceil(n / rules.stageRaceDivisor)));
}

/**
 * Beslutning 5: distancen. 1 for alt der ikke er en mini-udgave (seniorloeb og de gamle
 * ungdomsloeb), saa ruten for dem er uaendret.
 */
export function miniEditionDistanceScale(race) {
  const parsed = parseMiniEditionExternalId(race?.external_id);
  return parsed ? MINI_EDITION_RULES[parsed.squad].distanceScale : 1;
}

/** Et distance-baand [lo, hi] skaleret til mini-udgaven (heltal, aldrig under 1 km). */
export function scaleDistanceBand([lo, hi], race) {
  const f = miniEditionDistanceScale(race);
  if (f === 1) return [lo, hi];
  const a = Math.max(1, Math.round(lo * f));
  return [a, Math.max(a, Math.round(hi * f))];
}

const roundKm = (km) => Math.round(km * 10) / 10;

/**
 * Et monuments haandskrevne rute (authored_route) i mini-format: distancen og alle
 * positioner (toppe, spurter, sektor-starter) skaleres; stigningernes og sektorernes
 * egen laengde bevares, saa signaturen (samme mur, samme brostensafsnit) er den samme.
 * En stigning der ikke laengere kan starte efter km 0, klippes til sin top.
 */
export function scaleAuthoredRoute(route, factor) {
  if (route == null || factor === 1) return route;
  const distance = roundKm(route.distance_km * factor);
  const pos = (km) => Math.min(distance, roundKm(km * factor));
  const climbs = route.climbs.map((c) => {
    const crest = c.summit_finish ? distance : pos(c.crest_km);
    return { ...c, crest_km: crest, length_km: Math.min(c.length_km, crest) };
  });
  const sprints = route.sprints.map((s) => ({ ...s, km: s.kind === "finish" ? distance : pos(s.km) }));
  const sectors = route.sectors.map((s) => {
    const start = pos(s.start_km);
    return { ...s, start_km: start, length_km: Math.min(s.length_km, roundKm(distance - start)) };
  }).filter((s) => s.length_km > 0);
  return {
    ...route,
    distance_km: distance,
    elevation_gain_m: Math.round(route.elevation_gain_m * factor),
    climbs, sprints, sectors,
  };
}

/**
 * Kataloget som pakkeren skal se det: mini-monumenternes rute skaleres i hukommelsen
 * (raekken i race_pool er seniorens rute, saa SQL'en ikke skal regne paa JSON).
 */
export function withMiniEditionRoutes(rows) {
  return (rows || []).map((row) => {
    if (!isMiniEditionRow(row) || row.authored_route == null) return row;
    return { ...row, authored_route: scaleAuthoredRoute(row.authored_route, miniEditionDistanceScale(row)) };
  });
}

/** Mini-raekken for et seniorloeb, med praecis migrationens felter. */
export function buildMiniEditionRow(seniorRow, squad) {
  return {
    id: miniEditionId(seniorRow.id, squad),
    external_id: miniEditionExternalId(seniorRow.external_id, squad),
    name: miniEditionName(seniorRow.name, squad),
    race_class: seniorRow.race_class,
    race_type: seniorRow.race_type,
    stages: miniEditionStages(seniorRow, squad),
    date_text: seniorRow.date_text ?? null,
    country: seniorRow.country ?? null,
    terrain_archetype: seniorRow.terrain_archetype ?? null,
    race_identity_type: seniorRow.race_identity_type ?? null,
    signature: seniorRow.signature ?? null,
    authored_route: seniorRow.authored_route ?? null,
    squad,
  };
}

// ── Ryttertyper (beslutning 7) ─────────────────────────────────────────────────

const IDENTITY_TO_TYPE = Object.freeze({
  sprinters: "sprinter", climbers_gt_prelude: "klatrer", mountains_first: "klatrer", hilly: "bakke",
  cobbles_benelux: "brosten", gravel: "brosten", time_trial: "enkeltstart", allround: "allround",
});

function archetypeType(archetype) {
  const a = String(archetype ?? "");
  if (/itt/.test(a)) return "enkeltstart";
  if (/cobbl|gravel/.test(a)) return "brosten";
  if (/sprint/.test(a)) return "sprinter";
  if (/puncheur|hilly/.test(a)) return "bakke";
  if (/mountain|summit|climb/.test(a)) return "klatrer";
  if (/balanced/.test(a)) return "allround";
  return null;
}

/**
 * Hvilke ryttertyper et loeb er et maal for. Et etapeloeb har et samlet klassement og er
 * derfor ogsaa et allround-maal; en Grand Tour er klatrernes og allroundernes loeb.
 * Loebets type kommer foerst fra identiteten (#6857), ellers fra terraenet.
 */
export function riderTypeGoalsFor(row) {
  const goals = new Set();
  if (isGrandTourRow(row)) { goals.add("klatrer"); goals.add("allround"); return goals; }
  const own = IDENTITY_TO_TYPE[row?.race_identity_type] ?? archetypeType(row?.terrain_archetype);
  if (own) goals.add(own);
  if (row?.race_type === "stage_race") goals.add("allround");
  return goals;
}

export function riderTypeCoverage(rows) {
  const counts = Object.fromEntries(RIDER_TYPES.map((t) => [t, 0]));
  for (const row of rows) for (const t of riderTypeGoalsFor(row)) counts[t] += 1;
  return counts;
}

// ── Kalenderen (beslutning 4 og 8) ─────────────────────────────────────────────

/**
 * Hvilke af seniorudgavens etaper mini-udgaven koerer med: jaevnt fordelt, altid foerste
 * og sidste, saa mini-udgaven starter og slutter med seniorudgaven.
 * @returns {number[]} index i seniorens etaper (sorteret efter game_day)
 */
export function miniStageIndexes(seniorStageCount, miniStages) {
  const n = Math.max(1, Math.floor(seniorStageCount));
  const m = Math.min(n, Math.max(1, Math.floor(miniStages)));
  if (m === 1) return [n - 1];
  return Array.from({ length: m }, (_, i) => Math.round((i * (n - 1)) / (m - 1)));
}

const CPH_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" });
const CPH_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit", hour12: false });
const cphDate = (iso) => CPH_DATE.format(new Date(iso));
const cphTime = (iso) => CPH_TIME.format(new Date(iso)).replace(/^24:/, "00:");
const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
/** Kalenderens dag 0 som dansk dato: samme regel som buildScheduleRows (real_day 0 = from + 1). */
export function calendarDayZero(from) {
  const [y, m, d] = CPH_DATE.format(new Date(from)).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
const dayIndex = (fromDate, localDate) => Math.round((Date.parse(`${localDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000);

/** Ungdommens etape ligger lidt efter seniorens, saa de aldrig starter paa samme minut (#6667). */
export const MINI_SLOT_OFFSET_MINUTES = Object.freeze({ u23: 10, junior: 20 });
const SLOT_STEP = 5;
export const MINI_LATEST_SLOT = "22:00";

/**
 * Seniorens 1. division som mini-pakkeren laeser den: et loeb pr. seniorudgave med dens
 * etaper (game_day + scheduled_at). Samme form fra DB (races + race_stage_schedule) og fra
 * seniorens toerkoersels-plan.
 * @typedef {{ pool_race_id: string, external_id: string, name?: string, race_class?: string,
 *   race_type?: string, stages: Array<{ stage_number: number, game_day: number, scheduled_at: string }> }} SeniorAnchor
 */

function seniorTimesByDate(anchors) {
  const byDate = new Map();
  for (const a of anchors) for (const s of a.stages) {
    const d = cphDate(s.scheduled_at);
    if (!byDate.has(d)) byDate.set(d, new Set());
    byDate.get(d).add(toMin(cphTime(s.scheduled_at)));
  }
  return byDate;
}

function candidateFor(anchor, miniRow, squad) {
  const ordered = [...anchor.stages].sort((a, b) => a.game_day - b.game_day || a.stage_number - b.stage_number);
  const stages = Math.min(ordered.length, Number(miniRow.stages) || 1);
  const picks = miniStageIndexes(ordered.length, stages).map((i) => ordered[i]);
  return { anchor, row: miniRow, squad, stages: picks.length, picks, gameDays: picks.map((p) => p.game_day) };
}

function overlapShare(gameDayCounts) {
  const days = [...gameDayCounts.values()];
  if (!days.length) return 0;
  return days.filter((n) => n > 1).length / days.length;
}

/**
 * Udvalget (beslutning 2, 3 og 7): alle seniorens GT'er og monumenter i D1, derefter de mest
 * kendte loeb (prestige, saa seniorens kronologi) indtil loebsdags-maalet er naaet, med
 * ryttertype-daekningen foerst. Et filler-loeb springes over, hvis det ville loefte andelen
 * af loebsdage med to ungdomsloeb samtidig over ejerens loft for niveauet.
 * @param {{ squad: string, anchors?: any[], miniCatalog?: any[] }} args
 */
export function selectMiniEditions({ squad, anchors = [], miniCatalog = [] }) {
  const rules = rulesFor(squad);
  const miniBySenior = new Map();
  for (const row of miniCatalog) {
    const parsed = parseMiniEditionExternalId(row.external_id);
    if (parsed && parsed.squad === squad) miniBySenior.set(parsed.seniorExternalId, row);
  }
  const missingMini = [];
  const candidates = [];
  for (const a of anchors) {
    if (!a?.stages?.length) continue;
    const row = miniBySenior.get(a.external_id);
    // Kun D1-klasserne har en mini-udgave; et lavere klasset loeb i D1 (fx ProSeries) springes over.
    if (!row) { if (MINI_SOURCE_CLASSES.includes(a.race_class)) missingMini.push(a.name ?? a.external_id); continue; }
    candidates.push(candidateFor(a, row, squad));
  }
  const firstDay = (c) => Math.min(...c.gameDays);
  const byPrestige = (x, y) => (PRESTIGE[x.row.race_class] ?? 9) - (PRESTIGE[y.row.race_class] ?? 9) || firstDay(x) - firstDay(y)
    || String(x.row.external_id).localeCompare(String(y.row.external_id));

  const core = candidates.filter((c) => isGrandTourRow(c.row) || c.row.race_class === "Monuments").sort(byPrestige);
  const rest = candidates.filter((c) => !core.includes(c)).sort(byPrestige);
  const picked = [...core];
  const counts = new Map();
  const add = (c) => { for (const g of c.gameDays) counts.set(g, (counts.get(g) ?? 0) + 1); };
  core.forEach(add);
  const raceDays = () => counts.size;
  const wouldOverlap = (c) => {
    const next = new Map(counts);
    for (const g of c.gameDays) next.set(g, (next.get(g) ?? 0) + 1);
    return overlapShare(next);
  };
  const fits = (c) => wouldOverlap(c) <= rules.overlapShare.max
    && raceDays() + c.gameDays.filter((g) => !counts.has(g)).length <= rules.targetRaceDays;
  const take = (c) => { picked.push(c); add(c); rest.splice(rest.indexOf(c), 1); };

  // 1) Ryttertype-reglen: den mest kendte kandidat for hver type der mangler maal.
  for (const type of RIDER_TYPES) {
    let have = riderTypeCoverage(picked.map((p) => p.row))[type];
    while (have < MIN_GOALS_PER_RIDER_TYPE) {
      const next = rest.find((c) => riderTypeGoalsFor(c.row).has(type) && fits(c));
      if (!next) break;
      take(next);
      have += 1;
    }
  }
  // 2) De mest kendte loeb indtil loebsdags-maalet.
  for (const c of [...rest]) {
    if (raceDays() >= rules.targetRaceDays) break;
    if (fits(c)) take(c);
  }
  const coverage = riderTypeCoverage(picked.map((p) => p.row));
  return {
    squad, picked, missingMini,
    raceDays: raceDays(), stageCount: picked.reduce((n, c) => n + c.stages, 0),
    overlapShare: overlapShare(counts), coverage,
    gtCount: picked.filter((c) => isGrandTourRow(c.row)).length,
    monumentCount: picked.filter((c) => c.row.race_class === "Monuments").length,
  };
}

/**
 * Den faerdige trup-kalender i packSquadCalendar's form (saa materializerens skrive-sti,
 * rapport og gates er de samme), plus `slotsForDate` med ungdommens egne klokkeslaet.
 *
 * Hver ungdomsetape faar seniorudgavens game_day og dato (beslutning 4). Klokkeslaettet er
 * seniorudgavens + truppens forskydning, flyttet videre i 5-minutters skridt hvis det rammer
 * en senior-tid eller en anden ungdomsetape paa datoen.
 *
 * @param {{ squad: "u23"|"junior", anchors: SeniorAnchor[], miniCatalog: object[], from: Date,
 *   days: number, latest?: string, seasonLastRaceDay?: string|null }} args  from = materializerens anker
 *   (real_day 0 = dagen efter); seasonLastRaceDay = saesonens sidste loebsdag (dansk dato).
 */
export function packMiniEditionCalendar({ squad, anchors = [], miniCatalog = [], from, days, latest = MINI_LATEST_SLOT, seasonLastRaceDay = null }) {
  const rules = rulesFor(squad);
  const firstDate = calendarDayZero(from);
  const selection = selectMiniEditions({ squad, anchors, miniCatalog });
  const seniorTimes = seniorTimesByDate(anchors);
  const youthTimes = new Map();
  const violations = [];
  const placements = [];
  const chronological = [...selection.picked].sort((a, b) => Math.min(...a.gameDays) - Math.min(...b.gameDays)
    || String(a.row.external_id).localeCompare(String(b.row.external_id)));
  const stageTimes = [];
  for (const c of chronological) {
    const stagesPlaced = c.picks.map((s, i) => {
      const localDate = cphDate(s.scheduled_at);
      const taken = new Set([...(seniorTimes.get(localDate) ?? []), ...(youthTimes.get(localDate) ?? [])]);
      // Saesonens sidste loebsdag slutter kl. 15 (#5592): dér ligger ungdommen lige FOER seniorens etape.
      const dir = localDate === seasonLastRaceDay ? -1 : 1;
      let at = toMin(cphTime(s.scheduled_at)) + dir * MINI_SLOT_OFFSET_MINUTES[squad];
      while (taken.has(at)) at += dir * SLOT_STEP;
      if (at > toMin(latest)) violations.push(`${squad}: ${c.row.name} stage ${i + 1} would start at ${toHHMM(at)}, after ${latest} (#7471)`);
      if (!youthTimes.has(localDate)) youthTimes.set(localDate, new Set());
      youthTimes.get(localDate).add(at);
      const realDay = dayIndex(firstDate, localDate);
      if (realDay < 0 || realDay >= days) violations.push(`${squad}: ${c.row.name} stage ${i + 1} falls outside the season window (${localDate}) (#7471)`);
      const placed = { stage_number: i + 1, real_day: realDay, game_day: s.game_day, lane: 0, localDate, minute: at };
      stageTimes.push(placed);
      return placed;
    });
    placements.push({
      id: c.row.id, type: c.stages > 1 ? "stage_race" : "single", race_class: c.row.race_class ?? null,
      stages: c.stages, startRealDay: stagesPlaced[0].real_day, stagesPlaced,
      seniorPoolRaceId: c.anchor.pool_race_id,
    });
  }
  // lane = index i datoens sorterede ungdoms-tider, saa buildScheduleRows rammer praecis tiden.
  const slotsByDate = new Map([...youthTimes.entries()].map(([d, set]) => [d, [...set].sort((a, b) => a - b)]));
  for (const st of stageTimes) st.lane = (slotsByDate.get(st.localDate) ?? []).indexOf(st.minute);
  for (const p of placements) for (const st of p.stagesPlaced) { delete st.localDate; delete st.minute; }

  if (selection.gtCount < 3) violations.push(`${squad}: ${selection.gtCount} of 3 mini Grand Tours (senior D1 has fewer GTs or a mini row is missing) (#7471)`);
  if (selection.monumentCount < rules.monuments) violations.push(`${squad}: ${selection.monumentCount} of ${rules.monuments} mini monuments (#7471)`);
  for (const t of RIDER_TYPES) {
    if (selection.coverage[t] < MIN_GOALS_PER_RIDER_TYPE) violations.push(`${squad}: rider type ${t} has ${selection.coverage[t]} goal(s), below ${MIN_GOALS_PER_RIDER_TYPE} (#7471)`);
  }
  for (const name of selection.missingMini) violations.push(`${squad}: senior D1 race "${name}" has no mini row in the catalog (#7471)`);

  const usedGameDays = new Set(placements.flatMap((p) => p.stagesPlaced.map((s) => s.game_day)));
  const racingDates = new Set(placements.flatMap((p) => p.stagesPlaced.map((s) => s.real_day)));
  return {
    placements,
    selectedIds: placements.map((p) => p.id),
    totalGameDays: selection.stageCount,
    raceCount: placements.length,
    timelineLength: null,
    naturalRaceDays: usedGameDays.size,
    trainingGameDays: [],
    dateOfTrainingGameDay: [],
    raceDaysPerDate: [],
    weeklyStarts: [],
    racingDates: racingDates.size,
    violations,
    slotsForDate: (localDate) => (slotsByDate.get(localDate) ?? []).map(toHHMM),
    selection,
  };
}

/**
 * Seniorens D1-ankre fra DB-raekker: races (pool_race_id, name, race_class, race_type) +
 * race_stage_schedule (race_id, stage_number, game_day, scheduled_at) + race_pool's
 * external_id. Een representativ pulje er nok: alle D1-puljer har samme kalender (#2276).
 * @param {{ races?: any[], schedule?: any[], externalIdByPoolRace?: Map<any, any> }} args
 */
export function seniorAnchorsFromRows({ races = [], schedule = [], externalIdByPoolRace = new Map() }) {
  const byRace = new Map();
  for (const s of schedule) {
    if (!byRace.has(s.race_id)) byRace.set(s.race_id, []);
    byRace.get(s.race_id).push({ stage_number: s.stage_number, game_day: s.game_day, scheduled_at: s.scheduled_at });
  }
  const seen = new Set();
  const anchors = [];
  for (const r of races) {
    if (seen.has(r.pool_race_id)) continue;
    const stages = byRace.get(r.id) ?? [];
    if (!stages.length) continue;
    seen.add(r.pool_race_id);
    anchors.push({
      pool_race_id: r.pool_race_id, external_id: externalIdByPoolRace.get(r.pool_race_id) ?? null,
      name: r.name, race_class: r.race_class, race_type: r.race_type, stages,
    });
  }
  return anchors;
}

/**
 * Seniorens D1-ankre fra en (toerkoersels-)plan: tier-planens foerste pulje (raceRows +
 * stageRows, materializerens form) og kataloget til external_id.
 */
export function seniorAnchorsFromPlan({ tierPlan, catalog = [] }) {
  const pool = tierPlan?.pools?.[0];
  if (!pool) return [];
  const extById = new Map(catalog.map((c) => [c.id, c.external_id ?? null]));
  const races = pool.raceRows.map((r) => ({ ...r, id: r.pool_race_id }));
  const schedule = pool.stageRows.map((s) => ({ ...s, race_id: s.pool_race_id }));
  return seniorAnchorsFromRows({ races, schedule, externalIdByPoolRace: extById });
}

/**
 * Den eneste I/O i modulet (kun SELECT): seniorens D1 for saesonen. Bruges af ungdommens
 * materialisering, som koerer EFTER seniorkalenderen (buildSeasonCalendar --squad).
 */
export async function loadSeniorMiniAnchors({ supabase, seasonId }) {
  const { data: pools, error: pErr } = await supabase.from("league_divisions").select("id, tier, squad, retired_at")
    .eq("tier", MINI_SOURCE_TIER).is("retired_at", null).or("squad.is.null,squad.eq.senior").order("id");
  if (pErr) throw new Error(`#7471 senior D1 pools: ${pErr.message}`);
  const poolId = pools?.[0]?.id;
  if (poolId == null) return [];
  const { data: races, error: rErr } = await supabase.from("races")
    .select("id, pool_race_id, name, race_class, race_type, stages")
    .eq("season_id", seasonId).eq("league_division_id", poolId).or("squad.is.null,squad.eq.senior");
  if (rErr) throw new Error(`#7471 senior D1 races: ${rErr.message}`);
  const raceIds = (races ?? []).map((r) => r.id);
  const poolRaceIds = [...new Set((races ?? []).map((r) => r.pool_race_id).filter(Boolean))];
  const schedule = [];
  for (let i = 0; i < raceIds.length; i += 100) {
    const { data, error } = await supabase.from("race_stage_schedule")
      .select("race_id, stage_number, game_day, scheduled_at").in("race_id", raceIds.slice(i, i + 100));
    if (error) throw new Error(`#7471 senior D1 schedule: ${error.message}`);
    schedule.push(...(data ?? []));
  }
  const { data: pool, error: cErr } = poolRaceIds.length
    ? await supabase.from("race_pool").select("id, external_id").in("id", poolRaceIds)
    : { data: [], error: null };
  if (cErr) throw new Error(`#7471 senior D1 catalog: ${cErr.message}`);
  const externalIdByPoolRace = new Map((pool ?? []).map((c) => [c.id, c.external_id]));
  return seniorAnchorsFromRows({ races: races ?? [], schedule, externalIdByPoolRace });
}
