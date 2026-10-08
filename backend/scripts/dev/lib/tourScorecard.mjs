// #6285: scorecard for en hel Grand Tour-gennemkoersel i v4 (Tour-gennemtesten).
//
// REN: ingen IO og ingen DB. Tager et datasaet i dryRunUpcomingStage-formen
// ({race, profiles, entries, orders, teams, abilities}) og en v4-adapter
// (raceEngineV4Bridge.loadRaceEngineV4()), koerer alle etaper i raekkefoelge
// med akkumuleret klassement pr. seed og reducerer hver etape til spiller-
// vendte maalinger, der sammenlignes med et benchmark mod virkelig cykelsport.
//
// Detektorerne (fx clampedAtCap, labelContradictions) er eksporteret enkeltvis,
// saa motor-testene i backend/test/engine/playerFacingRegressions6285.test.ts
// bruger PRAECIS samme definition som scorecardet.
//
// Repoet er offentligt: maalte tal skrives aldrig her, kun til
// balance-internals/ (gitignoreret) af tourDryRun.mjs.
import { ANCHOR_BANDS } from "../../lib/headToHeadAnchors.js";
import { mean, median, spearmanCorrelation } from "../../lib/headToHeadStats.js";
import { ownChaseViolations } from "../ownRiderAhead6187.mjs";

/** Samme loft som raceEngineV4Bridge.MAX_STAGE_GAP_SECONDS (30:00). */
export const STAGE_GAP_CAP_SECONDS = 1800;
const TIME_TRIAL_PROFILES = new Set(["itt", "itt_hilly", "ttt"]);

// ── Benchmark mod virkelig cykelsport ────────────────────────────────────────
//
// Status pr. baand:
//  - "ejer": ejer-godkendt anker, genbrugt fra headToHeadAnchors.ANCHOR_BANDS.
//  - "kandidat": eksisterende kandidat-baand fra ANCHOR_BANDS (ikke ejer-godkendt).
//  - "forslag": nyt i #6285, omtrentligt baand fra kendte Grand Tour-resultater
//    (Tour/Giro/Vuelta 2019-2024, ProCyclingStats' resultatlister), afrundet og
//    IKKE beregnet fra et datasaet. Ejeren justerer; tallene er ikke en dom.
// PASS = inden for baandet. WARN = uden for, men inden for tolerancen
// (min * WARN_LOW, max * WARN_HIGH). FAIL = laengere ude.
export const WARN_LOW = 0.67;
export const WARN_HIGH = 1.5;

const PCS_NOTE = "omtrentligt fra Grand Tour-resultater 2019-2024 (ProCyclingStats), afrundet, ikke beregnet";

export const TOUR_BENCHMARKS = Object.freeze({
  gapTo10: {
    unit: "s",
    byClass: {
      flat: { max: 5, status: "forslag", source: `flad massespurt: top 10 paa vinderens tid (${PCS_NOTE}); jf. ANCHOR_BANDS.fieldCohesionFlat` },
      hilly: { max: 60, status: "forslag", source: `kuperet/rullende: top 10 inden for ca. 1 min (${PCS_NOTE})` },
      mountain: { min: ANCHOR_BANDS.mountainTop10SpreadSeconds.min, max: ANCHOR_BANDS.mountainTop10SpreadSeconds.max, status: "ejer", source: ANCHOR_BANDS.mountainTop10SpreadSeconds.source },
    },
  },
  gapTo30: {
    unit: "s",
    byClass: {
      flat: { max: 15, status: "forslag", source: `flad massespurt: nr. 30 paa eller taet paa vinderens tid (${PCS_NOTE})` },
      hilly: { max: 240, status: "forslag", source: `kuperet/rullende: nr. 30 inden for ca. 4 min (${PCS_NOTE})` },
      mountain: { min: 180, max: 600, status: "forslag", source: `bjerg: nr. 30 ca. 3-10 min efter vinderen (${PCS_NOTE})` },
    },
  },
  ittGapTo10Per40Km: {
    unit: "s/40km",
    byClass: {
      itt: { min: ANCHOR_BANDS.ittTop10SpreadPer40KmSeconds.min, max: ANCHOR_BANDS.ittTop10SpreadPer40KmSeconds.max, status: "ejer", source: ANCHOR_BANDS.ittTop10SpreadPer40KmSeconds.source },
      itt_hilly: { min: ANCHOR_BANDS.ittTop10SpreadPer40KmSeconds.min, max: 240, status: "forslag", source: `kuperet enkeltstart: lidt stoerre spredning end flad (${PCS_NOTE})` },
    },
  },
  breakawaySize: {
    unit: "ryttere",
    byClass: {
      flat: { min: 1, max: 6, status: "forslag", source: `flad etape: 2-5 mands udbrud er normen (${PCS_NOTE})` },
      hilly: { min: 3, max: 15, status: "forslag", source: `kuperet/rullende: 4-15 ryttere (${PCS_NOTE})` },
      mountain: { min: 5, max: 30, status: "forslag", source: `bjerg: store udbrud paa 10-30 ryttere er almindelige (${PCS_NOTE})` },
    },
  },
  breakawayWinShare: {
    unit: "andel",
    byClass: {
      flat: { ...ANCHOR_BANDS.breakawayRatePerTerrainCandidate.byTerrain.flat, status: "kandidat", source: ANCHOR_BANDS.breakawayRatePerTerrainCandidate.source },
      hilly: { ...ANCHOR_BANDS.breakawayRatePerTerrainCandidate.byTerrain.hilly, status: "kandidat", source: ANCHOR_BANDS.breakawayRatePerTerrainCandidate.source },
      mountain: { ...ANCHOR_BANDS.breakawayRatePerTerrainCandidate.byTerrain.mountain, status: "kandidat", source: ANCHOR_BANDS.breakawayRatePerTerrainCandidate.source },
    },
  },
  gcTo10AfterWeek1: {
    unit: "s",
    byClass: { race: { min: 45, max: 360, status: "forslag", source: `klassementet efter foerste uge: nr. 10 ca. 1-6 min efter foereren (${PCS_NOTE})` } },
  },
  gcTo10Final: {
    unit: "s",
    byClass: { race: { min: 300, max: 1800, status: "forslag", source: `slutklassement: nr. 10 ca. 5-30 min efter vinderen (${PCS_NOTE})` } },
  },
  gcWinnerMargin: {
    unit: "s",
    byClass: { race: { min: ANCHOR_BANDS.gtWinnerMarginSeconds.min, max: ANCHOR_BANDS.gtWinnerMarginSeconds.max, status: "ejer", source: ANCHOR_BANDS.gtWinnerMarginSeconds.source } },
  },
  // Spillervendte fejl: virkeligheden har nul af dem (eller saa faa at et
  // enkelt tilfaelde paa en hel Tour er en advarsel).
  gcTop10InBreakOver5Min: { unit: "pr. Tour", byClass: { race: { max: 0, warnMax: 1, status: "forslag", source: "en top-10 i klassementet faar aldrig 5 min i et udbrud uden at feltet jagter (#5978)" } } },
  ownTeamChasesOwn: { unit: "pr. Tour", byClass: { race: { max: 0, warnMax: 0, status: "ejer", source: "RACE_ENGINE_RULES: et hold jagter aldrig sine egne (#6187)" } } },
  clampedAtCap: { unit: "ryttere pr. Tour", byClass: { race: { max: 0, warnMax: 3, status: "forslag", source: "+30:00-muren: ingen rigtig resultatliste har en klump paa praecis loftet (#6199/#6284)" } } },
  minuteLossAtZeroKm: { unit: "ryttere pr. Tour", byClass: { race: { max: 0, warnMax: 0, status: "forslag", source: "ingen taber tid foer starten er gaaet (loebsfilmens km 0)" } } },
  labelContradictions: { unit: "pr. Tour", byClass: { race: { max: 0, warnMax: 0, status: "forslag", source: "maerkning skal stemme med resultatet (#6294, #6185, #6234)" } } },
  flatBreakawayWinMinutes: { unit: "pr. Tour", byClass: { race: { max: 0, warnMax: 1, status: "forslag", source: `flad udbrudssejr vindes med sekunder, ikke minutter (${PCS_NOTE})` } } },
  // #6349: paa kuperet enkeltstart afgoer tempo-evnen stadig mest.
  ittHillyTempoMinusClimb: { unit: "rho-forskel", byClass: { itt_hilly: { min: 0, warnMin: -0.05, status: "forslag", source: "#6349: paa kuperet enkeltstart vejer tempo-evnen mindst lige saa meget som klatre-evnen" } } },
  // #6352: et godt lead-out er placeringer vaerd i de sidste 1-2 km.
  leadoutRankGain: { unit: "placeringer", byClass: { flat: { min: 0.5, warnMin: 0, status: "forslag", source: "#6352: et godt lead-out giver sprint-kaptajnen placeringer i finalen" } } },
});

/** Etapens benchmark-klasse. */
export function profileClass(profileType) {
  if (profileType === "flat") return "flat";
  if (profileType === "hilly" || profileType === "rolling" || profileType === "cobbles" || profileType === "gravel" || profileType === "classic") return "hilly";
  if (profileType === "mountain" || profileType === "high_mountain") return "mountain";
  if (profileType === "itt" || profileType === "itt_hilly" || profileType === "ttt") return profileType;
  return "hilly";
}

/** PASS/WARN/FAIL/N/A for en vaerdi mod et baand. */
export function verdict(value, band) {
  if (!band) return "N/A";
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  const okMin = band.min === undefined || value >= band.min;
  const okMax = band.max === undefined || value <= band.max;
  if (okMin && okMax) return "PASS";
  const warnMin = band.warnMin ?? (band.min === undefined ? undefined : band.min * WARN_LOW);
  const warnMax = band.warnMax ?? (band.max === undefined ? undefined : band.max === 0 ? 0 : band.max * WARN_HIGH);
  const okWarnMin = warnMin === undefined || value >= warnMin;
  const okWarnMax = warnMax === undefined || value <= warnMax;
  return okWarnMin && okWarnMax ? "WARN" : "FAIL";
}

// ── Detektorer (delt med motor-testene) ──────────────────────────────────────

function finishedSorted(out) {
  return (out?.results ?? []).filter((r) => r.status === "finished").sort((a, b) => a.time_seconds - b.time_seconds || a.rank - b.rank);
}

/** Tidsgab til vinderen for nr. n (raa tider, ikke clampede). */
export function gapAtRank(out, n) {
  const fin = finishedSorted(out);
  return fin.length >= n ? fin[n - 1].time_seconds - fin[0].time_seconds : null;
}

/** Morgenudbruddets ryttere (breakaway_formed) og de indhentede. */
export function breakawaySets(out) {
  const events = out?.timeline?.events ?? [];
  const formed = new Set(events.filter((e) => e.type === "breakaway_formed").flatMap((e) => e.params?.rider_ids ?? []));
  const caught = new Set(events.filter((e) => e.type === "breakaway_caught").flatMap((e) => e.params?.rider_ids ?? []));
  return { formed, caught };
}

/**
 * Vandt udbruddet, og med hvor meget foran den foerste rytter uden for
 * morgenudbruddet (favoritternes gruppe)? margin = null naar udbruddet ikke vandt.
 */
export function breakawayWin(out) {
  const { formed, caught } = breakawaySets(out);
  const fin = finishedSorted(out);
  const winner = fin[0];
  const won = Boolean(winner && formed.has(winner.rider_id) && !caught.has(winner.rider_id));
  if (!won) return { won: false, margin: null };
  const firstOther = fin.find((r) => !formed.has(r.rider_id));
  return { won: true, margin: firstOther ? firstOther.time_seconds - winner.time_seconds : null };
}

/**
 * +30:00-muren: ryttere hvis raa tid er over loftet, men hvis resultatraekke
 * (broens `stageGap`) staar paa praecis loftet. Under official_times_v1 er der
 * intet loft, og taelleren er 0 per definition.
 */
export function clampedAtCap(ranked, out) {
  const fin = finishedSorted(out);
  if (!fin.length) return 0;
  const rawGap = new Map(fin.map((r) => [r.rider_id, r.time_seconds - fin[0].time_seconds]));
  return (ranked ?? []).filter((r) => r.stageGap === STAGE_GAP_CAP_SECONDS && (rawGap.get(r.rider_id) ?? 0) > STAGE_GAP_CAP_SECONDS + 0.5).length;
}

/** Stoerste klump af ryttere med praecis samme resultat-gab paa loftet (til rapporten). */
export function largestCapClump(ranked) {
  return (ranked ?? []).filter((r) => r.stageGap === STAGE_GAP_CAP_SECONDS).length;
}

/**
 * Minuttab "paa 0 km": ryttere der i loebsfilmen allerede staar mindst
 * `thresholdSeconds` efter teten ved km <= `maxKm` (foer der er koert en meter).
 * Tidskoersler er undtaget: dér er snapshottet ved maal.
 */
export function minuteLossAtZeroKm(out, { maxKm = 0.5, thresholdSeconds = 60 } = {}) {
  const hit = new Set();
  for (const s of out?.groupSnapshots ?? []) {
    if (!(s.km <= maxKm)) continue;
    for (const g of s.groups ?? []) if ((g.gap_seconds ?? 0) >= thresholdSeconds) for (const id of g.rider_ids ?? []) hit.add(id);
  }
  return hit.size;
}

/**
 * Maerker der modsiger resultatet (#6294-klassen), paa vinderens raekke:
 *  - vinderen staar som "i udbrud og indhentet", men vandt med mere end
 *    `soloMarginSeconds` til nr. 2 (indhentet og alligevel alene foran);
 *  - motorens dom (breakaway_win) og maerket (in_breakaway + ikke indhentet) er uenige.
 */
export function labelContradictions(ranked, out, { soloMarginSeconds = 60 } = {}) {
  const issues = [];
  const w = ranked?.[0];
  if (!w) return issues;
  const st = w.breakaway_status;
  const fin = finishedSorted(out);
  const margin = fin.length >= 2 ? fin[1].time_seconds - fin[0].time_seconds : 0;
  if (st?.in_breakaway === true && st?.breakaway_caught === true && margin > soloMarginSeconds) {
    issues.push({ kind: "caught_but_solo", margin });
  }
  if (typeof w.breakaway_win === "boolean" && st) {
    const survived = st.in_breakaway === true && st.breakaway_caught !== true;
    if (w.breakaway_win !== survived) issues.push({ kind: "win_flag_vs_label", breakaway_win: w.breakaway_win, in_breakaway: st.in_breakaway, caught: st.breakaway_caught });
  }
  return issues;
}

/**
 * Top-10 i klassementet foer etapen, der sad i morgenudbruddet og paa et
 * tidspunkt havde mindst `thresholdSeconds` til feltet (stoerste gruppe).
 */
export function gcTop10InBreakOverThreshold(out, gcBefore, { thresholdSeconds = 300, topN = 10 } = {}) {
  if (!gcBefore?.length) return [];
  const top = new Set(gcBefore.slice(0, topN).map((s) => s.rider_id));
  const { formed } = breakawaySets(out);
  const suspects = [...formed].filter((id) => top.has(id));
  if (!suspects.length) return [];
  const best = new Map();
  for (const s of out?.groupSnapshots ?? []) {
    const groups = s.groups ?? [];
    if (!groups.length) continue;
    const peloton = groups.reduce((a, b) => ((b.rider_ids?.length ?? 0) > (a.rider_ids?.length ?? 0) ? b : a));
    for (const g of groups) {
      const adv = (peloton.gap_seconds ?? 0) - (g.gap_seconds ?? 0);
      for (const id of g.rider_ids ?? []) if (suspects.includes(id)) best.set(id, Math.max(best.get(id) ?? -Infinity, adv));
    }
  }
  return suspects.filter((id) => (best.get(id) ?? 0) >= thresholdSeconds);
}

/** Rang-korrelation mellem en evne og tiden (positiv = evnen goer rytteren hurtigere). */
export function abilityTimeCorrelation(out, abilitiesById, key) {
  const fin = finishedSorted(out).filter((r) => abilitiesById.has(r.rider_id));
  const xs = fin.map((r) => Number(abilitiesById.get(r.rider_id)[key] ?? 0));
  const ys = fin.map((r) => -r.time_seconds);
  return spearmanCorrelation(xs, ys);
}

/** Klassementsgab (foereren til nr. n). */
export function gcGapAt(standings, n) {
  return standings.length >= n ? standings[n - 1].time - standings[0].time : null;
}

/** Fjern holdordrernes leadout paa én etape (parret maaling af sprinttoget, #6352). */
export function ordersWithoutLeadout(orders, stageNumber) {
  return orders.map((o) => (o.stage_number !== stageNumber ? o : { ...o, riders: (o.riders ?? []).map((r) => ({ ...r, leadout: false })) }));
}

/** Hold med mindst én leadout-rytter i etapens gemte ordrer. */
export function leadoutTeams(orders, stageNumber) {
  return new Set(orders.filter((o) => o.stage_number === stageNumber && (o.riders ?? []).some((r) => r.leadout === true)).map((o) => o.team_id));
}

export function isBunchSprintStage(profile) {
  return profile.profile_type === "flat" || /sprint/.test(String(profile.finale_type ?? ""));
}

// ── Koersel ──────────────────────────────────────────────────────────────────

export function entrantsFromData(data) {
  const aiByTeam = new Map(data.teams.map((t) => [t.id, t.is_ai === true]));
  const abilitiesById = new Map(data.abilities.map((a) => [a.rider_id, a]));
  return data.entries.filter((e) => abilitiesById.has(e.rider_id)).map((e) => {
    const { rider_id: _r, ...abilities } = abilitiesById.get(e.rider_id);
    return { rider_id: e.rider_id, team_id: e.team_id ?? null, team_is_ai: aiByTeam.get(e.team_id) === true, race_role: e.race_role ?? null, effort: "normal", abilities };
  });
}

function simulate({ v4, data, stages, profile, entrants, revision, gcStandings, seedTag, orders }) {
  return v4.simulateStage({
    entrants, stageProfile: profile, seedString: `${data.race.id}:${profile.stage_number}:${seedTag}`, stageNumber: profile.stage_number,
    teamOrderRows: orders ?? data.orders, isStageRace: stages.length > 1, raceStages: stages, squad: data.race.squad ?? null,
    rulesRevision: revision, gcStandings,
  });
}

/** Etapens maalinger for ét seed. */
export function stageMetrics({ res, profile, gcBefore, abilitiesById, teamByRider }) {
  const out = res.v4Output;
  const ranked = res.ranked;
  const cls = profileClass(profile.profile_type);
  const tt = TIME_TRIAL_PROFILES.has(profile.profile_type);
  const { formed } = breakawaySets(out);
  const bw = tt ? { won: false, margin: null } : breakawayWin(out);
  const km = Number(profile.distance_km) || null;
  const g10 = gapAtRank(out, 10);
  const m = {
    stage: profile.stage_number, profile_type: profile.profile_type, finale_type: profile.finale_type ?? null, cls,
    gapTo10: g10, gapTo30: gapAtRank(out, 30),
    ittGapTo10Per40Km: tt && km && g10 !== null ? (g10 / km) * 40 : null,
    breakawaySize: tt ? null : formed.size,
    breakawayWon: tt ? null : bw.won,
    breakawayWinMargin: bw.margin,
    flatBreakawayWinMinutes: cls === "flat" && bw.won && (bw.margin ?? 0) >= 60 ? 1 : 0,
    gcTop10InBreakOver5Min: tt ? 0 : gcTop10InBreakOverThreshold(out, gcBefore).length,
    ownTeamChasesOwn: tt ? 0 : ownChaseViolations(out.timeline?.events ?? [], teamByRider).length,
    clampedAtCap: clampedAtCap(ranked, out),
    capClump: largestCapClump(ranked),
    over30Raw: finishedSorted(out).filter((r, _i, a) => r.time_seconds - a[0].time_seconds > STAGE_GAP_CAP_SECONDS).length,
    minuteLossAtZeroKm: tt ? 0 : minuteLossAtZeroKm(out),
    labelContradictions: labelContradictions(ranked, out).length,
    winType: ranked?.[0]?.win_type ?? null,
  };
  if (tt) {
    m.rhoTempo = abilityTimeCorrelation(out, abilitiesById, "time_trial");
    m.rhoClimb = abilityTimeCorrelation(out, abilitiesById, "climbing");
    m.ittHillyTempoMinusClimb = m.rhoTempo !== null && m.rhoClimb !== null ? m.rhoTempo - m.rhoClimb : null;
  }
  return m;
}

/**
 * Sprinttogets effekt paa én etape (#6352): samme seed og felt med og uden
 * holdordrernes leadout. Maaler sprint-kaptajnerne paa hold der HAR leadout i
 * ordrerne: gennemsnitlig placering uden tog minus med tog (positiv = toget hjaelper).
 */
export function leadoutEffect({ withRes, withoutRes, entrants, teams }) {
  const caps = entrants.filter((e) => e.race_role === "sprint_captain" && teams.has(e.team_id)).map((e) => e.rider_id);
  if (!caps.length) return null;
  const rankIn = (res) => new Map((res.ranked ?? []).map((r) => [r.rider_id, r.rank]));
  const a = rankIn(withRes);
  const b = rankIn(withoutRes);
  const gains = caps.filter((id) => a.has(id) && b.has(id)).map((id) => b.get(id) - a.get(id));
  if (!gains.length) return null;
  return { captains: gains.length, meanRankGain: mean(gains), winsWith: caps.filter((id) => a.get(id) === 1).length, winsWithout: caps.filter((id) => b.get(id) === 1).length };
}

/**
 * Hele loebet under én revision over `seeds` seeds. Klassementet akkumuleres
 * pr. seed (tid minus bonussekunder), og ryttere uden "finished" udgaar.
 */
export function runTour({ v4, data, revision, seeds = 5, leadoutPair = true, seedPrefix = "tour6285" }) {
  const stages = data.profiles.slice().sort((a, b) => a.stage_number - b.stage_number);
  const all = entrantsFromData(data);
  const abilitiesById = new Map(data.abilities.map((a) => [a.rider_id, a]));
  const teamByRider = new Map(all.map((e) => [e.rider_id, e.team_id]));
  const week1Stage = stages[Math.max(0, Math.round(stages.length * (9 / 21)) - 1)]?.stage_number ?? null;
  const perSeed = [];
  for (let s = 1; s <= seeds; s++) {
    let inRace = new Set(all.map((e) => e.rider_id));
    const gc = new Map([...inRace].map((id) => [id, 0]));
    const rows = [];
    let gcWeek1 = null;
    for (const profile of stages) {
      const entrants = all.filter((e) => inRace.has(e.rider_id));
      const gcBefore = profile === stages[0] ? [] : [...gc.entries()].map(([rider_id, time]) => ({ rider_id, time })).sort((a, b) => a.time - b.time || a.rider_id.localeCompare(b.rider_id));
      const seedTag = `${seedPrefix}-${s}`;
      const res = simulate({ v4, data, stages, profile, entrants, revision, gcStandings: gcBefore, seedTag });
      const m = stageMetrics({ res, profile, gcBefore, abilitiesById, teamByRider });
      if (leadoutPair && isBunchSprintStage(profile)) {
        const teams = leadoutTeams(data.orders, profile.stage_number);
        if (teams.size) {
          const withoutRes = simulate({ v4, data, stages, profile, entrants, revision, gcStandings: gcBefore, seedTag, orders: ordersWithoutLeadout(data.orders, profile.stage_number) });
          const eff = leadoutEffect({ withRes: res, withoutRes, entrants, teams });
          if (eff) m.leadout = eff;
        }
      }
      const out = res.v4Output;
      const fin = out.results.filter((r) => r.status === "finished");
      const bonus = new Map((out.passage_totals ?? []).map((t) => [t.rider_id, t.bonus_seconds ?? 0]));
      for (const r of fin) gc.set(r.rider_id, (gc.get(r.rider_id) ?? 0) + r.time_seconds - (bonus.get(r.rider_id) ?? 0));
      const finIds = new Set(fin.map((r) => r.rider_id));
      for (const id of [...gc.keys()]) if (!finIds.has(id)) gc.delete(id);
      inRace = finIds;
      const standings = [...gc.entries()].map(([rider_id, time]) => ({ rider_id, time })).sort((a, b) => a.time - b.time || a.rider_id.localeCompare(b.rider_id));
      m.gcTo10After = gcGapAt(standings, 10);
      m.gcTo30After = gcGapAt(standings, 30);
      m.gcLeaderAfter = standings[0]?.rider_id ?? null;
      m.finishers = fin.length;
      if (profile.stage_number === week1Stage) gcWeek1 = m.gcTo10After;
      rows.push(m);
    }
    const final = [...gc.entries()].map(([rider_id, time]) => ({ rider_id, time })).sort((a, b) => a.time - b.time || a.rider_id.localeCompare(b.rider_id));
    perSeed.push({ seed: s, rows, gcWeek1, gcFinalTo10: gcGapAt(final, 10), gcWinnerMargin: gcGapAt(final, 2), gcWinner: final[0]?.rider_id ?? null, finishers: final.length });
  }
  return { revision, seeds, week1Stage, perSeed, summary: summarizeTour(perSeed, stages) };
}

const sum = (xs) => xs.reduce((a, b) => a + (Number(b) || 0), 0);

/** Etape- og loebsoversigt over seeds, med benchmark-dom. */
export function summarizeTour(perSeed, stages) {
  const stageRows = stages.map((p) => {
    const ms = perSeed.map((s) => s.rows.find((r) => r.stage === p.stage_number)).filter(Boolean);
    const med = (k) => median(ms.map((m) => m[k]).filter((v) => v !== null && v !== undefined));
    const cls = profileClass(p.profile_type);
    const lo = ms.map((m) => m.leadout).filter(Boolean);
    const row = {
      stage: p.stage_number, profile_type: p.profile_type, finale_type: p.finale_type ?? null, cls,
      gapTo10: med("gapTo10"), gapTo30: med("gapTo30"), ittGapTo10Per40Km: med("ittGapTo10Per40Km"),
      breakawaySize: med("breakawaySize"),
      breakawayWins: ms.filter((m) => m.breakawayWon === true).length,
      breakawayWinMarginMedian: median(ms.map((m) => m.breakawayWinMargin).filter((v) => v !== null)),
      gcTo10After: med("gcTo10After"), gcTo30After: med("gcTo30After"),
      gcTop10InBreakOver5Min: sum(ms.map((m) => m.gcTop10InBreakOver5Min)),
      ownTeamChasesOwn: sum(ms.map((m) => m.ownTeamChasesOwn)),
      clampedAtCap: sum(ms.map((m) => m.clampedAtCap)),
      capClumpMax: Math.max(0, ...ms.map((m) => m.capClump)),
      over30RawMedian: med("over30Raw"),
      minuteLossAtZeroKm: sum(ms.map((m) => m.minuteLossAtZeroKm)),
      labelContradictions: sum(ms.map((m) => m.labelContradictions)),
      flatBreakawayWinMinutes: sum(ms.map((m) => m.flatBreakawayWinMinutes)),
      rhoTempo: med("rhoTempo"), rhoClimb: med("rhoClimb"), ittHillyTempoMinusClimb: med("ittHillyTempoMinusClimb"),
      leadoutRankGain: lo.length ? mean(lo.map((l) => l.meanRankGain)) : null,
      leadoutWinsWith: lo.length ? sum(lo.map((l) => l.winsWith)) : null,
      leadoutWinsWithout: lo.length ? sum(lo.map((l) => l.winsWithout)) : null,
      seeds: ms.length,
    };
    row.verdicts = {};
    for (const key of ["gapTo10", "gapTo30", "ittGapTo10Per40Km", "breakawaySize", "ittHillyTempoMinusClimb", "leadoutRankGain"]) {
      const band = TOUR_BENCHMARKS[key]?.byClass?.[cls];
      if (band) row.verdicts[key] = verdict(row[key], band);
    }
    return row;
  });

  // Udbrudssucces pr. profilklasse (vejetaper).
  const byClass = {};
  for (const r of stageRows) {
    if (TIME_TRIAL_PROFILES.has(r.profile_type)) continue;
    const c = (byClass[r.cls] ??= { stages: 0, wins: 0, trials: 0, sizes: [] });
    c.stages += 1;
    c.wins += r.breakawayWins;
    c.trials += r.seeds;
    if (r.breakawaySize !== null) c.sizes.push(r.breakawaySize);
  }
  const classRows = Object.entries(byClass).map(([cls, c]) => {
    const share = c.trials ? c.wins / c.trials : null;
    return { cls, stages: c.stages, breakawayWinShare: share, breakawaySizeMedian: median(c.sizes), verdicts: { breakawayWinShare: verdict(share, TOUR_BENCHMARKS.breakawayWinShare.byClass[cls]), breakawaySize: verdict(median(c.sizes), TOUR_BENCHMARKS.breakawaySize.byClass[cls]) } };
  });

  const perTour = (k) => median(perSeed.map((s) => sum(s.rows.map((r) => r[k]))));
  const race = {
    gcTo10AfterWeek1: median(perSeed.map((s) => s.gcWeek1).filter((v) => v !== null)),
    gcTo10Final: median(perSeed.map((s) => s.gcFinalTo10).filter((v) => v !== null)),
    gcWinnerMargin: median(perSeed.map((s) => s.gcWinnerMargin).filter((v) => v !== null)),
    gcTop10InBreakOver5Min: perTour("gcTop10InBreakOver5Min"),
    ownTeamChasesOwn: perTour("ownTeamChasesOwn"),
    clampedAtCap: perTour("clampedAtCap"),
    minuteLossAtZeroKm: perTour("minuteLossAtZeroKm"),
    labelContradictions: perTour("labelContradictions"),
    flatBreakawayWinMinutes: perTour("flatBreakawayWinMinutes"),
    distinctGcWinners: new Set(perSeed.map((s) => s.gcWinner)).size,
  };
  race.verdicts = {
    gcTo10AfterWeek1: verdict(race.gcTo10AfterWeek1, TOUR_BENCHMARKS.gcTo10AfterWeek1.byClass.race),
    gcTo10Final: verdict(race.gcTo10Final, TOUR_BENCHMARKS.gcTo10Final.byClass.race),
    gcWinnerMargin: verdict(race.gcWinnerMargin, TOUR_BENCHMARKS.gcWinnerMargin.byClass.race),
  };
  for (const k of ["gcTop10InBreakOver5Min", "ownTeamChasesOwn", "clampedAtCap", "minuteLossAtZeroKm", "labelContradictions", "flatBreakawayWinMinutes"]) {
    race.verdicts[k] = verdict(race[k], TOUR_BENCHMARKS[k].byClass.race);
  }
  const all = [...stageRows.flatMap((r) => Object.values(r.verdicts)), ...classRows.flatMap((r) => Object.values(r.verdicts)), ...Object.values(race.verdicts)];
  const counts = { PASS: 0, WARN: 0, FAIL: 0, "N/A": 0 };
  for (const v of all) counts[v] += 1;
  return { stages: stageRows, classes: classRows, race, counts };
}

// ── Rapport ──────────────────────────────────────────────────────────────────

const fmtS = (v) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "-";
  const s = Math.round(v);
  const sign = s < 0 ? "-" : "";
  const a = Math.abs(s);
  return `${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
};
const fmtN = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "-" : String(Math.round(v * 10 ** d) / 10 ** d));
const cell = (v, verdictText) => (verdictText ? `${v} ${verdictText}` : v);

/** Markdown-rapport: en blok pr. revision og en sammenligning side om side. */
export function renderTourMarkdown({ raceLabel, runs, generatedAt }) {
  const lines = [`# Tour-gennemtest (#6285): ${raceLabel}`, "", `Genereret ${generatedAt}. Seeds pr. revision: ${runs.map((r) => `${r.revision}=${r.seeds}`).join(", ")}.`, ""];
  lines.push("Benchmark-status: ejer = ejer-godkendt anker, kandidat = eksisterende kandidat, forslag = nyt omtrentligt baand (ejeren justerer).", "");
  if (runs.length > 1) {
    lines.push("## Side om side", "", `| Maaling | ${runs.map((r) => r.revision).join(" | ")} |`, `|---|${runs.map(() => "---").join("|")}|`);
    const raceKeys = [["gcTo10AfterWeek1", fmtS], ["gcTo10Final", fmtS], ["gcWinnerMargin", fmtS], ["gcTop10InBreakOver5Min", fmtN], ["ownTeamChasesOwn", fmtN], ["clampedAtCap", fmtN], ["minuteLossAtZeroKm", fmtN], ["labelContradictions", fmtN], ["flatBreakawayWinMinutes", fmtN], ["distinctGcWinners", fmtN]];
    for (const [k, f] of raceKeys) lines.push(`| ${k} | ${runs.map((r) => cell(f(r.summary.race[k]), r.summary.race.verdicts[k])).join(" | ")} |`);
    for (const c of runs[0].summary.classes.map((x) => x.cls)) {
      lines.push(`| udbrudssejre ${c} | ${runs.map((r) => { const x = r.summary.classes.find((y) => y.cls === c); return x ? cell(fmtN(x.breakawayWinShare), x.verdicts.breakawayWinShare) : "-"; }).join(" | ")} |`);
      lines.push(`| udbrudsstoerrelse ${c} | ${runs.map((r) => { const x = r.summary.classes.find((y) => y.cls === c); return x ? cell(fmtN(x.breakawaySizeMedian, 1), x.verdicts.breakawaySize) : "-"; }).join(" | ")} |`);
    }
    lines.push(`| PASS/WARN/FAIL | ${runs.map((r) => `${r.summary.counts.PASS}/${r.summary.counts.WARN}/${r.summary.counts.FAIL}`).join(" | ")} |`, "");
    lines.push("### Etaper side om side (nr. 10 / nr. 30 til vinderen)", "", `| Etape | Profil | ${runs.map((r) => r.revision).join(" | ")} |`, `|---|---|${runs.map(() => "---").join("|")}|`);
    for (const st of runs[0].summary.stages) {
      lines.push(`| ${st.stage} | ${st.profile_type}/${st.finale_type ?? "-"} | ${runs.map((r) => { const x = r.summary.stages.find((y) => y.stage === st.stage); return x ? `${cell(fmtS(x.gapTo10), x.verdicts.gapTo10)} / ${cell(fmtS(x.gapTo30), x.verdicts.gapTo30)}` : "-"; }).join(" | ")} |`);
    }
    lines.push("");
  }
  for (const run of runs) {
    const s = run.summary;
    lines.push(`## ${run.revision}`, "", `PASS ${s.counts.PASS} · WARN ${s.counts.WARN} · FAIL ${s.counts.FAIL} · N/A ${s.counts["N/A"]}. Uge 1 = efter etape ${run.week1Stage}.`, "");
    lines.push("| Etape | Profil | Nr. 10 | Nr. 30 | ITT nr. 10/40 km | Udbrud (median) | Udbrudssejre | Sejrsmargin udbrud | GC nr. 10 efter | Top-10 GC i udbrud >5 min | Jagter egne | Paa 30:00-loftet | Over 30 min (raa) | Minuttab km 0 | Maerke-modsigelser | rho tempo / klatring | Tog: placeringer (sejre med/uden) |");
    lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const r of s.stages) {
      lines.push(`| ${r.stage} | ${r.profile_type}/${r.finale_type ?? "-"} | ${cell(fmtS(r.gapTo10), r.verdicts.gapTo10)} | ${cell(fmtS(r.gapTo30), r.verdicts.gapTo30)} | ${cell(fmtS(r.ittGapTo10Per40Km), r.verdicts.ittGapTo10Per40Km)} | ${cell(fmtN(r.breakawaySize, 1), r.verdicts.breakawaySize)} | ${r.breakawayWins}/${r.seeds} | ${fmtS(r.breakawayWinMarginMedian)} | ${fmtS(r.gcTo10After)} | ${r.gcTop10InBreakOver5Min} | ${r.ownTeamChasesOwn} | ${r.clampedAtCap} (klump ${r.capClumpMax}) | ${fmtN(r.over30RawMedian, 0)} | ${r.minuteLossAtZeroKm} | ${r.labelContradictions} | ${r.rhoTempo === null ? "-" : `${fmtN(r.rhoTempo)} / ${fmtN(r.rhoClimb)}${r.verdicts.ittHillyTempoMinusClimb ? ` ${r.verdicts.ittHillyTempoMinusClimb}` : ""}`} | ${r.leadoutRankGain === null ? "-" : `${cell(fmtN(r.leadoutRankGain, 1), r.verdicts.leadoutRankGain)} (${r.leadoutWinsWith}/${r.leadoutWinsWithout})`} |`);
    }
    lines.push("", "| Loebet | Vaerdi | Dom |", "|---|---|---|");
    for (const [k, v] of Object.entries(s.race)) if (k !== "verdicts") lines.push(`| ${k} | ${/gc/.test(k) && !/InBreak/.test(k) && k !== "distinctGcWinners" ? fmtS(v) : fmtN(v)} | ${s.race.verdicts[k] ?? "-"} |`);
    lines.push("");
  }
  lines.push("## Benchmark-kilder", "", "| Maaling | Klasse | Baand | Status | Kilde |", "|---|---|---|---|---|");
  for (const [k, b] of Object.entries(TOUR_BENCHMARKS)) {
    for (const [c, band] of Object.entries(b.byClass)) lines.push(`| ${k} (${b.unit}) | ${c} | ${band.min ?? "-"}..${band.max ?? "-"} | ${band.status} | ${band.source} |`);
  }
  return `${lines.join("\n")}\n`;
}
