// backend/scripts/lib/headToHeadAnchors.js
// Race Engine v4 F2/F3-recovery (#4030, #3855): scoring af BEGGE motorer (v3 +
// v4) mod mor-spec'ens §5-virkeligheds-ankre.
// SSOT: docs/superpowers/specs/2026-08-20-race-engine-v4-intra-stage-design.md §5
//   (tabellen "Kalibrering: simulér-før-ship med virkeligheds-ankre").
// Konsekvens-note (8b): "gap-realisme-båndene fra #2415 ... indgår i scorecardet
// med kilder" — #2415-båndene er foldet ind som egne ankre nedenfor.
//
// 100% REN: ingen IO, ingen DB/simulator-kald — tager allerede-simulerede rows
// (v3Output.ranked + v4Output fra headToHeadV4.js's runHeadToHead) og reducerer
// dem til PASS/FAIL/N/A pr. anker. "N/A" bruges EKSPLICIT når en mekanik endnu
// ikke er tilkoblet (M5/M9 er F3-scope, jf. types.ts/tuning.ts's kommentarer) —
// aldrig gættet eller camoufleret som 0/false (samme regel som headToHeadStats.js's
// fmt/fmtPct: null er "ikke maalt", ikke "maalt nul").
//
// Metodologi-forbehold (aeerligt dokumenteret, ikke skjult): denne fil er en
// FOERSTE, forsvarlig operationalisering af §5-tabellens ankre ud fra det data
// simulateStage (v3)/simulateStageV4 (v4) rent faktisk eksponerer i dag. Den
// erstatter IKKE #3426/#3917/#2224-scripternes egne, mere specialiserede
// maalinger — den giver et samlet BEGGE-motorer-overblik i samme koersel.
// Fuld kalibrering/tuning sker i 23-24/8-scope (F2-core-design.md §7).

import { observeRace, aggregateObservations } from "../../lib/raceDominanceMetrics.js";
import { observeStageV4, cohesionFraction, spreadAtRank, descentAttackGainStats } from "./headToHeadObservers.js";
import { mean, spearmanCorrelation, percentile, fmt, fmtPct } from "./headToHeadStats.js";

// ---------------------------------------------------------------------------
// Baand (kilder citeret pr. mor-spec §5 + #2415)
// ---------------------------------------------------------------------------

export const ANCHOR_BANDS = {
  fieldCohesionFlat: {
    min: 0.8, max: 0.95,
    source: "#3917-maalingen (mor-spec §5: \"80-95% af feltet paa vinderens tid\")",
  },
  descentToSummitGapRatio: {
    max: 0.5,
    source: "#3426-maalingen (mor-spec §5: nedkoersels-gaps vs. summit-gaps, ratio <=0,5 ved p5-p10)",
  },
  descentAttackGainSeconds: {
    min: 10, max: 20,
    source: "ejer-valg 20/8 (mor-spec §4 M3 / §5: descent attack-gevinst-loft)",
  },
  favoriteWinRate: {
    min: 0.25, max: 0.40,
    source: "v3-spec §2 + ejer-valg 20/8 (mor-spec §5: \"i dag 80-88%\")",
  },
  sameTeamTop10Share4Plus: {
    max: 0.03,
    source: "v3-spec §2 (mor-spec §5: \"4+ fra samme hold i top 10 sjaeldent, < 3%\")",
  },
  sprinterWinRateFlat: {
    min: 0.90,
    source: "race:gate + #3149 (mor-spec §5: \"sprinter-vinderrate paa flat >= 90%\")",
  },
  ittCorrelationMinAbs: {
    min: 0.3,
    source: "race:gate + #3149 (mor-spec §5: \"ITT-korrelation synlig\" — tærskel valgt af denne harness)",
  },
  mountainTop10SpreadSeconds: {
    min: 180, max: 240,
    source: "#2415 (gap-realisme-baand: bjergetape top-10 inden for ~3-4 min, PCS-niveau)",
  },
  gtWinnerMarginSeconds: {
    min: 60, max: 480,
    source: "#2415 (gap-realisme-baand: GT-vindermargin typisk 1-8 min)",
  },
};

// ---------------------------------------------------------------------------
// Dom-helper: PASS/FAIL/N-A, aldrig fake-0 ved manglende data
// ---------------------------------------------------------------------------

/**
 * @param {number|null} value
 * @param {{min?:number, max?:number}} band
 * @param {number} sampleCount  antal etaper/observationer bag vaerdien
 * @param {string} [naNote]  hvorfor N/A (fx "mekanik F3-scope") — kun brugt ved value=null
 * @returns {{value:number|null, sampleCount:number, verdict:"PASS"|"FAIL"|"N/A", naReason:string|null}}
 */
export function judge(value, band = {}, sampleCount = 0, naNote = null) {
  if (value === null || value === undefined || !Number.isFinite(value) || sampleCount === 0) {
    return { value: null, sampleCount, verdict: "N/A", naReason: naNote || "ingen etaper i input matcher dette ankers scope" };
  }
  const okMin = band.min === undefined || value >= band.min;
  const okMax = band.max === undefined || value <= band.max;
  return { value, sampleCount, verdict: okMin && okMax ? "PASS" : "FAIL", naReason: null };
}

// ---------------------------------------------------------------------------
// Stage-klassifikation (raat paa route/profile_type/finale_type, delt af flere ankre)
// ---------------------------------------------------------------------------

function stagesWhere(rows, pred) {
  return rows.filter((r) => pred(r.raw.route));
}

// ---------------------------------------------------------------------------
// 1. Felt-sammenhaeng, flade etaper
// ---------------------------------------------------------------------------

export function scoreFieldCohesion(rows) {
  const flatRows = stagesWhere(rows, (route) => route.profile_type === "flat");
  const v3Values = flatRows
    .map((r) => cohesionFraction(r.raw.v3Output.ranked.map((x) => x.stageGap)))
    .filter((v) => v !== null);
  const v4Values = flatRows
    .map((r) => cohesionFraction(r.raw.v4Output.results.map((x) => x.time_seconds)))
    .filter((v) => v !== null);
  const band = ANCHOR_BANDS.fieldCohesionFlat;
  return {
    id: "field_cohesion_flat",
    label: "Felt-sammenhaeng, flade etaper",
    bandLabel: `${fmtPct(band.min)}-${fmtPct(band.max)}`,
    source: band.source,
    v3: { ...judge(mean(v3Values), band, v3Values.length), display: fmtPct },
    v4: { ...judge(mean(v4Values), band, v4Values.length), display: fmtPct },
  };
}

// ---------------------------------------------------------------------------
// 2. Nedkoersels-gaps vs. summit-gaps (kryds-etape-arketype-proxy — se filens
//    metodologi-forbehold: sammenligner GAB-FORDELINGER pr. etape-arketype,
//    som #3426 gjorde, i stedet for et enkelt-etapes mid-race-snapshot).
// ---------------------------------------------------------------------------

export function scoreDescentVsSummitRatio(rows) {
  const descentRows = stagesWhere(rows, (route) => route.finale_type === "descent");
  const summitRows = stagesWhere(rows, (route) => route.finale_type === "long_climb");

  function ratioFor(getTimes) {
    const descentSpreads = descentRows.map((r) => spreadAtRank(getTimes(r), 10)).filter((v) => v !== null);
    const summitSpreads = summitRows.map((r) => spreadAtRank(getTimes(r), 10)).filter((v) => v !== null);
    const descentMean = mean(descentSpreads);
    const summitMean = mean(summitSpreads);
    const n = Math.min(descentSpreads.length, 1) * Math.min(summitSpreads.length, 1) > 0
      ? Math.min(descentRows.length, summitRows.length) : 0;
    if (descentMean === null || summitMean === null || summitMean === 0) return { value: null, n: 0 };
    return { value: descentMean / summitMean, n };
  }

  const band = ANCHOR_BANDS.descentToSummitGapRatio;
  const v3 = ratioFor((r) => r.raw.v3Output.ranked.map((x) => x.stageGap));
  const v4 = ratioFor((r) => r.raw.v4Output.results.map((x) => x.time_seconds));
  return {
    id: "descent_vs_summit_gap_ratio",
    label: "Nedkoersels-gaps vs. summit-gaps (ratio)",
    bandLabel: `<= ${band.max}`,
    source: band.source,
    v3: { ...judge(v3.value, band, v3.n, "kraever baade descent- og long_climb-finale-etaper i input"), display: (v) => fmt(v, 2) },
    v4: { ...judge(v4.value, band, v4.n, "kraever baade descent- og long_climb-finale-etaper i input"), display: (v) => fmt(v, 2) },
  };
}

// ---------------------------------------------------------------------------
// 3. Descent attack-gevinst-loft (KUN v4 — M3 er en v4-specifik mekanik, v3 har
//    intet direkte sammenligneligt event).
// ---------------------------------------------------------------------------

export function scoreDescentAttackBounds(rows) {
  const descentRows = stagesWhere(rows, (route) => route.finale_type === "descent" || (route.segments || []).some((s) => s.kind === "descent"));
  const allEvents = descentRows.flatMap((r) => r.raw.v4Output.timeline.events);
  const stats = descentAttackGainStats(allEvents);
  const band = ANCHOR_BANDS.descentAttackGainSeconds;

  // Ingen angreb overhovedet er IKKE en fejl (§4 M3: angreb kraever stor
  // descending-evne-forskel OG T2-T3 — kan legitimt udeblive i et lille felt).
  const withinBounds = stats.count === 0 || (stats.min >= band.min && stats.max <= band.max);
  const v4 = stats.count === 0
    ? { value: null, sampleCount: descentRows.length, verdict: "N/A", naReason: "ingen descent-angreb udloest i input (kan vaere legitimt — kraever stor evne-forskel)" }
    : { value: stats.max, sampleCount: stats.count, verdict: withinBounds ? "PASS" : "FAIL", naReason: null };

  return {
    id: "descent_attack_gain_bounds",
    label: "Descent attack-gevinst (10-20s-loft, aldrig omvendt fortegn i gruppen)",
    bandLabel: `${band.min}-${band.max}s`,
    source: band.source,
    v3: { value: null, sampleCount: 0, verdict: "N/A", naReason: "v3 har ingen sammenlignelig descent-attack-mekanik", display: (v) => fmt(v, 0) },
    v4: { ...v4, display: (v) => fmt(v, 0) },
  };
}

// ---------------------------------------------------------------------------
// 4. Punch-korrelation (punch-evne rangkorrelerer med placering paa punch-etaper)
// ---------------------------------------------------------------------------

function invertedRanks(ranked) {
  const maxRank = Math.max(...ranked.map((r) => r.rank), 0);
  return ranked.map((r) => maxRank + 1 - r.rank);
}

export function scorePunchCorrelation(rows, abilitiesByRider) {
  const punchRows = stagesWhere(rows, (route) => route.finale_type === "punch");
  const band = { min: 0.2 };

  function corrFor(getRanked) {
    const corrs = [];
    for (const r of punchRows) {
      const ranked = getRanked(r);
      const abilities = ranked.map((x) => abilitiesByRider.get(x.rider_id)?.punch).filter((v) => Number.isFinite(v));
      if (abilities.length !== ranked.length) continue;
      const c = spearmanCorrelation(abilities, invertedRanks(ranked));
      if (c !== null) corrs.push(c);
    }
    return { value: mean(corrs), n: corrs.length };
  }

  const v3 = corrFor((r) => r.raw.v3Output.ranked);
  const v4 = corrFor((r) => r.raw.v4Output.results);
  return {
    id: "punch_correlation",
    label: "Punch-korrelation (punch-evne vs. placering paa punch-etaper)",
    bandLabel: `spearman > ${band.min}`,
    source: "#3965-harnesset (mor-spec §5)",
    v3: { ...judge(v3.value, band, v3.n, "ingen punch-finale-etaper i input"), display: (v) => fmt(v, 2) },
    v4: { ...judge(v4.value, band, v4.n, "ingen punch-finale-etaper i input"), display: (v) => fmt(v, 2) },
  };
}

// ---------------------------------------------------------------------------
// 5 + 7. Favorit-win-rate + samme-hold-top-10 (genbruger raceDominanceMetrics'
//    observeRace/aggregateObservations for v3 OG headToHeadObservers.observeStageV4
//    for v4 — SAMME output-kontrakt, jf. observers-filens egen docstring, saa
//    ÉN aggregateObservations()-implementering dækker begge motorer).
// ---------------------------------------------------------------------------

export function scoreDominance(rows, { teamByRider, v4EntrantsById } = {}) {
  const v3Observations = rows.map((r) =>
    observeRace({ ranked: r.raw.v3Output.ranked, teamByRider, terrain: r.raw.route.profile_type, raceId: r.raw.stageRow?.race_id ?? null }));
  const v4Observations = rows.map((r) =>
    observeStageV4({
      results: r.raw.v4Output.results,
      entrants: v4EntrantsById,
      teamByRider,
      route: r.raw.route,
      tuning: r.raw.tuning,
      raceId: r.raw.stageRow?.race_id ?? null,
      terrain: r.raw.route.profile_type,
    }));

  const v3Agg = aggregateObservations(v3Observations);
  const v4Agg = aggregateObservations(v4Observations);

  const winBand = ANCHOR_BANDS.favoriteWinRate;
  const teamBand = ANCHOR_BANDS.sameTeamTop10Share4Plus;

  return [
    {
      id: "favorite_win_rate",
      label: "Felt-favoritters win-rate",
      bandLabel: `${fmtPct(winBand.min)}-${fmtPct(winBand.max)}`,
      source: winBand.source,
      v3: { ...judge(v3Agg.favoriteWinRate, winBand, v3Agg.races), display: fmtPct },
      v4: { ...judge(v4Agg.favoriteWinRate, winBand, v4Agg.races), display: fmtPct },
    },
    {
      id: "same_team_top10_share_4plus",
      label: "Samme-hold-top-10 (andel etaper med 4+ fra ét hold)",
      bandLabel: `< ${fmtPct(teamBand.max)}`,
      source: teamBand.source,
      v3: { ...judge(v3Agg.share4PlusSameTeamTop10, teamBand, v3Agg.races), display: fmtPct },
      v4: { ...judge(v4Agg.share4PlusSameTeamTop10, teamBand, v4Agg.races), display: fmtPct },
    },
  ];
}

// ---------------------------------------------------------------------------
// 6. Udbruds-rater pr. terraen (KUN v3 maalbart — M5/jagt-interesse er F3-scope
//    for v4, jf. types.ts's TeamOrder-kommentar + mor-spec §4 M5)
// ---------------------------------------------------------------------------

export function scoreBreakawayRates(rows) {
  const perTerrain = new Map();
  for (const r of rows) {
    const ranked = r.raw.v3Output.ranked;
    const winner = ranked.find((x) => x.rank === 1);
    if (!winner) continue;
    const terrain = r.raw.route.profile_type;
    const isBreakawayWin = (winner.components?.breakaway || 0) > 0;
    if (!perTerrain.has(terrain)) perTerrain.set(terrain, { races: 0, breakawayWins: 0 });
    const bucket = perTerrain.get(terrain);
    bucket.races++;
    if (isBreakawayWin) bucket.breakawayWins++;
  }
  const overallRaces = rows.length;
  const overallWins = [...perTerrain.values()].reduce((a, b) => a + b.breakawayWins, 0);
  const rate = overallRaces > 0 ? overallWins / overallRaces : null;

  return {
    id: "breakaway_rate_per_terrain",
    label: "Udbruds-rater pr. terraen (descent-dominans 54% skal ned)",
    bandLabel: "race:gate-baand (ingen fast tal her — se gate-konfig)",
    source: "race:gate + #3426 (mor-spec §5)",
    v3: { ...judge(rate, {}, overallRaces), display: fmtPct, perTerrain: Object.fromEntries([...perTerrain.entries()].map(([k, v]) => [k, v.races > 0 ? v.breakawayWins / v.races : null])) },
    v4: { value: null, sampleCount: 0, verdict: "N/A", naReason: "M5 (udbruds-/jagt-interesse-mekanik) er F3-scope — v4 F2 klassificerer endnu ikke udbrudssejre", display: fmtPct },
  };
}

// ---------------------------------------------------------------------------
// 8. Type-integritet: sprinter-vinderrate paa flat + ITT-korrelation
// ---------------------------------------------------------------------------

export function scoreTypeIntegrity(rows, abilitiesByRider) {
  const flatRows = stagesWhere(rows, (route) => route.profile_type === "flat" || route.finale_type === "bunch_sprint");
  const ittRows = stagesWhere(rows, (route) => route.profile_type === "itt" || route.profile_type === "itt_hilly");

  function sprinterWinRate(getRanked) {
    let wins = 0;
    let n = 0;
    for (const r of flatRows) {
      const ranked = getRanked(r);
      const sprintValues = ranked.map((x) => abilitiesByRider.get(x.rider_id)?.sprint).filter((v) => Number.isFinite(v));
      if (sprintValues.length !== ranked.length) continue;
      const threshold = percentile(sprintValues, 80);
      const winner = ranked.find((x) => x.rank === 1);
      if (!winner) continue;
      const winnerSprint = abilitiesByRider.get(winner.rider_id)?.sprint;
      if (!Number.isFinite(winnerSprint) || threshold === null) continue;
      n++;
      if (winnerSprint >= threshold) wins++;
    }
    return { value: n > 0 ? wins / n : null, n };
  }

  function ittCorrelation(getRanked) {
    const corrs = [];
    for (const r of ittRows) {
      const ranked = getRanked(r);
      const ttValues = ranked.map((x) => abilitiesByRider.get(x.rider_id)?.time_trial).filter((v) => Number.isFinite(v));
      if (ttValues.length !== ranked.length) continue;
      const c = spearmanCorrelation(ttValues, invertedRanks(ranked));
      if (c !== null) corrs.push(c);
    }
    return { value: mean(corrs), n: corrs.length };
  }

  const sprintBand = ANCHOR_BANDS.sprinterWinRateFlat;
  const ittBand = { min: ANCHOR_BANDS.ittCorrelationMinAbs.min };

  const v3Sprint = sprinterWinRate((r) => r.raw.v3Output.ranked);
  const v4Sprint = sprinterWinRate((r) => r.raw.v4Output.results);
  const v3Itt = ittCorrelation((r) => r.raw.v3Output.ranked);
  const v4Itt = ittCorrelation((r) => r.raw.v4Output.results);

  return [
    {
      id: "sprinter_win_rate_flat",
      label: "Sprinter-vinderrate paa flat (top-20%-sprint-evne vinder)",
      bandLabel: `>= ${fmtPct(sprintBand.min)}`,
      source: sprintBand.source,
      v3: { ...judge(v3Sprint.value, sprintBand, v3Sprint.n, "ingen flade/bunch_sprint-etaper i input"), display: fmtPct },
      v4: { ...judge(v4Sprint.value, sprintBand, v4Sprint.n, "ingen flade/bunch_sprint-etaper i input"), display: fmtPct },
    },
    {
      id: "itt_correlation",
      label: "ITT-korrelation (time_trial-evne vs. placering, synlig)",
      bandLabel: `spearman > ${ittBand.min}`,
      source: ANCHOR_BANDS.ittCorrelationMinAbs.source,
      v3: { ...judge(v3Itt.value, ittBand, v3Itt.n, "ingen ITT-etaper i input"), display: (v) => fmt(v, 2) },
      v4: { ...judge(v4Itt.value, ittBand, v4Itt.n, "ingen ITT-etaper i input"), display: (v) => fmt(v, 2) },
    },
  ];
}

// ---------------------------------------------------------------------------
// 9. Bonussekunder GC-bounded (STRUKTUREL, ikke rows-afledt — se note)
// ---------------------------------------------------------------------------

export function scoreBonusSecondsBounded() {
  // v3: racePassages.js's FINISH_BONUS_SECONDS/INTERMEDIATE_BONUS_SECONDS er
  // FASTE konstanter ([10,6,4] / [3,2,1]) — bounded ved konstruktion, kraever
  // ingen kørsel for at verificere (samme tal som #2413-kravet).
  return {
    id: "bonus_seconds_bounded",
    label: "Bonussekunder GC-effekt bounded (maks ~10s/etape)",
    bandLabel: "maks 10s/etape (maal) + bjerg dominerer stadig GC",
    source: "#2413-kravet (mor-spec §5)",
    v3: {
      value: 10, sampleCount: 1, verdict: "PASS",
      naReason: null, display: (v) => `${v}s (racePassages.js FINISH_BONUS_SECONDS=[10,6,4], strukturelt bounded)`,
    },
    v4: {
      value: null, sampleCount: 0, verdict: "N/A",
      naReason: "M9 (bonussekunder) er F3-scope — tuning.bonusSeconds er defineret men ikke forbrugt af nogen v4-mekanik endnu",
      display: (v) => fmt(v, 0),
    },
  };
}

// ---------------------------------------------------------------------------
// 10. Gap-realisme (#2415) — bjerg-top-10-spredning direkte, GT-vindermargin
//    markeret N/A i denne enkelt-etape-harness (kraever akkumuleret GC over
//    et helt etapeloeb, ikke tilgaengeligt paa etape-for-etape-niveau her).
// ---------------------------------------------------------------------------

export function scoreGapRealism(rows) {
  // Ejer-beslutning 2/9-2026 (#4604, PR #4610): bjerg-ankeret maales KUN paa
  // TOPANKOMSTER. #2415-baandet beskriver "bjergetape top-10 inden for ~3-4
  // min" — det er en beskrivelse af en etape der afgoeres paa toppen. En
  // bjergetape der slutter paa en nedkoersel er ikke en topankomst; den hoerer
  // til nedkoersels-ankeret (scoreDescentVsSummitRatio), som netop KRAEVER at
  // de etaper er tættere. Foer beslutningen midlede dette anker over begge
  // slags, saa de to ankre trak i hver sin retning paa de SAMME etaper og ikke
  // kunne opfyldes samtidigt.
  const mountainRows = stagesWhere(
    rows,
    (route) =>
      (route.profile_type === "mountain" || route.profile_type === "high_mountain")
      && route.finale_type === "long_climb",
  );
  const band = ANCHOR_BANDS.mountainTop10SpreadSeconds;

  function spreadFor(getTimes) {
    const spreads = mountainRows.map((r) => spreadAtRank(getTimes(r), 10)).filter((v) => v !== null);
    return { value: mean(spreads), n: spreads.length };
  }

  const v3 = spreadFor((r) => r.raw.v3Output.ranked.map((x) => x.stageGap));
  const v4 = spreadFor((r) => r.raw.v4Output.results.map((x) => x.time_seconds));

  const gtBand = ANCHOR_BANDS.gtWinnerMarginSeconds;

  return [
    {
      id: "mountain_top10_spread",
      label: "Bjergetape top-10-spredning, topankomster (#2415)",
      bandLabel: `${band.min}-${band.max}s (~3-4 min)`,
      source: band.source,
      v3: { ...judge(v3.value, band, v3.n, "ingen bjerg-topankomster i input"), display: (v) => fmt(v, 0) },
      v4: { ...judge(v4.value, band, v4.n, "ingen bjerg-topankomster i input"), display: (v) => fmt(v, 0) },
    },
    {
      id: "gt_winner_margin",
      label: "GT-vindermargin (#2415)",
      bandLabel: `${gtBand.min}-${gtBand.max}s (1-8 min)`,
      source: gtBand.source,
      v3: { value: null, sampleCount: 0, verdict: "N/A", naReason: "kraever akkumuleret GC over et helt etapeloeb — ikke maalbart etape-for-etape i denne harness-version", display: (v) => fmt(v, 0) },
      v4: { value: null, sampleCount: 0, verdict: "N/A", naReason: "kraever akkumuleret GC over et helt etapeloeb — ikke maalbart etape-for-etape i denne harness-version", display: (v) => fmt(v, 0) },
    },
  ];
}

// ---------------------------------------------------------------------------
// Samlet scorecard
// ---------------------------------------------------------------------------

/**
 * Bygger det fulde §5-scorecard for BEGGE motorer over de givne (allerede
 * simulerede) rows fra headToHeadV4.js's runHeadToHead().
 * @param {Array} rows  rows med .raw = { v3Output, v4Output, route, tuning, stageRow }
 * @param {object} ctx
 * @param {Map<string,string|null>} ctx.teamByRider
 * @param {Map<string,object>} ctx.abilitiesByRider  rider_id -> abilities-record
 * @param {Record<string,object>} ctx.v4EntrantsById  rider_id -> v4 Entrant (for observeStageV4)
 * @returns {Array<{id:string,label:string,bandLabel:string,source:string,v3:object,v4:object}>}
 */
export function buildScorecard(rows, { teamByRider, abilitiesByRider, v4EntrantsById }) {
  return [
    scoreFieldCohesion(rows),
    scoreDescentVsSummitRatio(rows),
    scoreDescentAttackBounds(rows),
    scorePunchCorrelation(rows, abilitiesByRider),
    ...scoreDominance(rows, { teamByRider, v4EntrantsById }),
    scoreBreakawayRates(rows),
    ...scoreTypeIntegrity(rows, abilitiesByRider),
    scoreBonusSecondsBounded(),
    ...scoreGapRealism(rows),
  ];
}

function formatCell(entry) {
  if (entry.verdict === "N/A") return `n/a (${entry.naReason})`;
  const display = entry.display || ((v) => String(v));
  return `${display(entry.value)} [${entry.verdict}] (n=${entry.sampleCount})`;
}

/**
 * Laesbar tekst-tabel: én blok pr. anker, maalt vaerdi + baand + PASS/FAIL/N-A
 * for BAADE v3 og v4 (kravet i recovery-briefen: "laesbart scorecard (tabel
 * pr. anker: maalt vaerdi, baand, PASS/FAIL) for BAADE v3 og v4").
 * @param {ReturnType<typeof buildScorecard>} scorecard
 * @returns {string}
 */
export function formatScorecard(scorecard) {
  const lines = [];
  lines.push("=== Head-to-Head Scorecard: v3 vs. v4 mod mor-spec §5-ankrene ===");
  for (const anchor of scorecard) {
    lines.push("");
    lines.push(`Anker: ${anchor.label}`);
    lines.push(`  Baand: ${anchor.bandLabel}  (kilde: ${anchor.source})`);
    lines.push(`  v3: ${formatCell(anchor.v3)}`);
    lines.push(`  v4: ${formatCell(anchor.v4)}`);
  }
  const totals = { PASS: 0, FAIL: 0, "N/A": 0 };
  for (const anchor of scorecard) {
    totals[anchor.v3.verdict]++;
    totals[anchor.v4.verdict]++;
  }
  lines.push("");
  lines.push(`Opsummering (v3+v4 samlet, ${scorecard.length} ankre x 2 motorer = ${scorecard.length * 2} celler): PASS=${totals.PASS} FAIL=${totals.FAIL} N/A=${totals["N/A"]}`);
  return lines.join("\n");
}
