// #6285: scorecard for en hel Grand Tour-gennemkoersel i v4 (Tour-gennemtesten).
//
// REN: ingen IO og ingen DB. Tager et datasaet i dryRunUpcomingStage-formen
// ({race, profiles, entries, orders, teams, abilities}) og en v4-adapter
// (raceEngineV4Bridge.loadRaceEngineV4()), koerer alle etaper i raekkefoelge
// med akkumuleret klassement pr. seed og reducerer hver etape til spiller-
// vendte maalinger, der sammenlignes med et benchmark mod virkelig cykelsport.
//
// Detektorerne (fx clampedAtCap, labelContradictions, flatBreakawayWinWithMinutes),
// klassements-akkumuleringen (runStagesInOrder) og listen over kendte, aabne
// fejl (KNOWN_OPEN_GATES) er eksporteret enkeltvis, saa motor-testene i
// backend/test/engine/playerFacingRegressions6285.test.ts bruger PRAECIS samme
// definitioner som scorecardet.
//
// Repoet er offentligt: maalte tal skrives aldrig her, kun til
// balance-internals/ (gitignoreret) af tourDryRun.mjs.
import { ANCHOR_BANDS, isShortUphillFinish } from "../../lib/headToHeadAnchors.js";
import { mean, median, spearmanCorrelation } from "../../lib/headToHeadStats.js";
import { ownChaseViolations } from "../ownRiderAhead6187.mjs";
import { rankByCumTimeAsc } from "../../../lib/raceClassifications.js";
import { isOrdersGcRulesRevision } from "../../../lib/raceEngineRulesRevision.ts";
import { breakawayMaxSizeV3 } from "../../../lib/engine/v4/mechanics/breakawayPermission.ts";
// Loebsfilmens egen afledning (samme kode som spillerne ser): "hvor tabte
// rytterne tid" og om tidslinjen overhovedet baerer v4's gruppe-gab.
import { buildOwnTimeLoss, hasGroupGaps } from "../../../../frontend/src/lib/stageSplitTimes.ts";

/** Samme loft som raceEngineV4Bridge.MAX_STAGE_GAP_SECONDS (30:00). */
export const STAGE_GAP_CAP_SECONDS = 1800;
const TIME_TRIAL_PROFILES = new Set(["itt", "itt_hilly", "ttt"]);

/**
 * "Med minutter": en flad udbrudssejr med mindst saa meget forspring paa den
 * foerste rytter uden for udbruddet. EEN definition, delt af scorecardet og
 * motor-testen (#6285-1).
 */
export const FLAT_BREAKAWAY_MINUTES_SECONDS = 120;

/** Loebsfilmens start: km <= dette er "paa 0 km" (filmen laegger events uden km paa 0). */
export const START_WINDOW_KM = 0.5;
/** Minuttab ved start: tidstab/gab paa mindst dette i startvinduet. */
export const START_LOSS_THRESHOLD_SECONDS = 60;

// ── Kendte, aabne fejl (delt med motor-testene) ──────────────────────────────
//
// Pr. motor-gate: de revisioner hvor fejlen er KENDT og aaben. Motor-testen
// koerer dem som `todo` (rapporteres, blokerer ikke CI); scorecardet taeller
// dem ALDRIG som groenne (en PASS bliver TODO). Fjern en linje naar fejlen er
// rettet i den revision, saa gaten bliver haard begge steder.
export const KNOWN_OPEN_GATES = Object.freeze({
  flatBreakawayMinutes: Object.freeze({
    orders_gc_v2: "aaben (#6285): flad udbrudssejr med minutter",
    orders_gc_v3: "aaben (#6285): flad udbrudssejr med minutter",
    official_times_v1: "aaben (#6285): flad udbrudssejr med minutter",
  }),
  capClump: Object.freeze({
    orders_gc_v2: "aaben (#6199/#6284): resultatlisten clamper til 30:00",
    orders_gc_v3: "aaben (#6199/#6284): resultatlisten clamper til 30:00",
  }),
  labelContradiction: Object.freeze({
    orders_gc_v2: "aaben (#6294): breakaway_win modsiger udbrudsmaerket",
    official_times_v1: "aaben (#6294): breakaway_win modsiger udbrudsmaerket",
  }),
});

/** Motor-gate -> scorecardets loebs-maaling. */
export const GATE_METRIC = Object.freeze({
  flatBreakawayMinutes: "flatBreakawayWinMinutes",
  capClump: "clampedAtCap",
  labelContradiction: "labelContradictions",
});

/** "gate" (haard) eller "todo" (kendt aaben) for en gate under en revision. */
export function gateStatus(check, revision) {
  return KNOWN_OPEN_GATES[check]?.[revision] ? "todo" : "gate";
}

// ── Benchmark mod virkelig cykelsport ────────────────────────────────────────
//
// Status pr. baand:
//  - "ejer": ejer-godkendt anker, genbrugt fra headToHeadAnchors.ANCHOR_BANDS.
//  - "kandidat": eksisterende kandidat-baand fra ANCHOR_BANDS (ikke ejer-godkendt).
//  - "forslag": nyt i #6285, omtrentligt baand fra kendte Grand Tour-resultater
//    (Tour/Giro/Vuelta 2019-2024, ProCyclingStats' resultatlister), afrundet og
//    IKKE beregnet fra et datasaet. Ejeren justerer; tallene er ikke en dom.
// PASS = inden for baandet. WARN = uden for, men inden for tolerancen
// (min * WARN_LOW, max * WARN_HIGH). FAIL = laengere ude. TODO = maalingen
// daekker en kendt, aaben fejl (KNOWN_OPEN_GATES) og taeller aldrig som groen.
// N/A = ingen maaling (fx minuttab ved start paa en etape uden loebsfilm).
export const WARN_LOW = 0.67;
export const WARN_HIGH = 1.5;

const PCS_NOTE = "omtrentligt fra Grand Tour-resultater 2019-2024 (ProCyclingStats), afrundet, ikke beregnet";

// Udbrudssucces doemmes pr. profile_type (ikke pr. sammenlagt klasse): et
// high_mountain-baand er et andet end et mountain-baand, og rolling et andet end
// hilly. Profiltyper uden udbrudsbaand (fx gravel) giver N/A.
const BREAKAWAY_RATE = ANCHOR_BANDS.breakawayRatePerTerrain;
const breakawayWinShareBands = Object.fromEntries(
  Object.entries(BREAKAWAY_RATE.byTerrain).map(([terrain, band]) => [terrain, { ...band, status: "ejer", source: BREAKAWAY_RATE.source }]),
);

export const TOUR_BENCHMARKS = Object.freeze({
  gapTo10: {
    unit: "s",
    byClass: {
      flat: { max: 5, status: "forslag", source: `flad massespurt: top 10 paa vinderens tid (${PCS_NOTE}); jf. ANCHOR_BANDS.fieldCohesionFlat` },
      hilly: { max: 60, status: "forslag", source: `kuperet/rullende: top 10 inden for ca. 1 min (${PCS_NOTE})` },
      mountain: { min: ANCHOR_BANDS.mountainTop10SpreadSeconds.min, max: ANCHOR_BANDS.mountainTop10SpreadSeconds.max, status: "ejer", source: ANCHOR_BANDS.mountainTop10SpreadSeconds.source },
      // #6440: en kort afslutning opad doemmes efter ejerens eget maal for netop
      // den etapetype (#6199 del 3), ikke bjerg-baandet (de to kan ikke begge holde).
      short_uphill: { max: ANCHOR_BANDS.shortUphillFinishSeconds.maxByRank[10], status: "ejer", source: ANCHOR_BANDS.shortUphillFinishSeconds.source },
    },
  },
  gapTo30: {
    unit: "s",
    byClass: {
      flat: { max: 15, status: "forslag", source: `flad massespurt: nr. 30 paa eller taet paa vinderens tid (${PCS_NOTE})` },
      hilly: { max: 240, status: "forslag", source: `kuperet/rullende: nr. 30 inden for ca. 4 min (${PCS_NOTE})` },
      mountain: { min: 180, max: 600, status: "forslag", source: `bjerg: nr. 30 ca. 3-10 min efter vinderen (${PCS_NOTE})` },
      short_uphill: { max: ANCHOR_BANDS.shortUphillFinishSeconds.maxByRank[30], status: "ejer", source: ANCHOR_BANDS.shortUphillFinishSeconds.source },
    },
  },
  ittGapTo10Per40Km: {
    unit: "s/40km",
    byClass: {
      itt: { min: ANCHOR_BANDS.ittTop10SpreadPer40KmSeconds.min, max: ANCHOR_BANDS.ittTop10SpreadPer40KmSeconds.max, status: "ejer", source: ANCHOR_BANDS.ittTop10SpreadPer40KmSeconds.source },
      itt_hilly: { min: ANCHOR_BANDS.ittTop10SpreadPer40KmSeconds.min, max: 240, status: "forslag", source: `kuperet enkeltstart: lidt stoerre spredning end flad (${PCS_NOTE})` },
    },
  },
  // #6201 R1 (ejer 5/10, udbrudstrappen): det typiske udbrud pr. profil. Doemmes
  // paa medianen; andelen paa 0-2 mand og antal forsoeg pr. etape staar ved siden af.
  breakawaySize: {
    unit: "ryttere",
    byClass: {
      flat: { min: 3, max: 6, status: "ejer", source: "#6201 ejer 5/10 (udbrudstrappen): flad typisk 3-6" },
      hilly: { min: 5, max: 9, status: "ejer", source: "#6201 ejer 5/10 (udbrudstrappen): kuperet og rullende typisk 5-9" },
      mountain: { min: 6, max: 12, status: "ejer", source: "#6201 ejer 5/10 (udbrudstrappen): bjerg og hoejfjeld typisk 6-12" },
    },
  },
  // Noeglen er profile_type (se breakawayWinShareBands), ikke benchmark-klassen.
  breakawayWinShare: { unit: "andel", byClass: breakawayWinShareBands },
  // #5578 udbrudsmaal 3 (RULES "Udbrudsmaal"): pr. profile_type holder udbruddet
  // til maal foran favoritterne paa legacy-niveau, maalt mod legacy koert paa
  // samme data og seeds (se applyLegacyHoldReference). Baandet er relativt.
  breakawayHoldVsLegacy: {
    unit: "andel minus legacy",
    // PASS: mindst legacy minus 0,1 ELLER 0,8 x legacy (den mildeste); WARN: minus 0,2 eller 0,67 x.
    byClass: { legacy: { minDelta: -0.1, minRatio: 0.8, warnMinDelta: -0.2, warnMinRatio: 0.67, status: "ejer", source: "RULES Udbrudsmaal 3 (ejer 1-2/10, #5955, #6089): ikke markant sjaeldnere i maal end legacy paa nogen vejprofil" } },
  },
  // #5578 udbrudsmaal 4: bjerg (MOUNTAIN_AHEAD_PROFILES), udbruddet foran favoritterne ca. 45 %.
  mountainBreakAheadShare: {
    unit: "andel",
    byClass: { race: { min: 0.35, max: 0.55, warnMin: 0.25, warnMax: 0.65, status: "ejer", source: "RULES Udbrudsmaal 4 (ejer 2/10, #6084): paa bjerg ender udbruddet foran favoritterne ca. 45 % af etaperne" } },
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
  clampedAtCap: { unit: "ryttere pr. Tour", byClass: { race: { max: 0, warnMax: 3, status: "forslag", source: "+30:00-muren: resultatlistens gab skal vaere den rigtige tid; ingen rigtig resultatliste har en klump paa praecis loftet (#6199/#6284)" } } },
  minuteLossAtZeroKm: { unit: "ryttere pr. Tour", byClass: { race: { max: 0, warnMax: 0, status: "forslag", source: "loebsfilmen ved start (km 0): ingen taber tid eller staar bagud foer starten er gaaet (#5951)" } } },
  labelContradictions: { unit: "pr. Tour", byClass: { race: { max: 0, warnMax: 0, status: "forslag", source: "maerkning skal stemme med resultatet (#6294, #6185, #6234)" } } },
  flatBreakawayWinMinutes: { unit: "pr. Tour", byClass: { race: { max: 0, warnMax: 1, status: "forslag", source: `flad udbrudssejr vindes med sekunder, ikke minutter (${PCS_NOTE})` } } },
  // #6349: paa kuperet enkeltstart afgoer tempo-evnen stadig mest.
  ittHillyTempoMinusClimb: { unit: "rho-forskel", byClass: { itt_hilly: { min: 0, warnMin: -0.05, status: "forslag", source: "#6349: paa kuperet enkeltstart vejer tempo-evnen mindst lige saa meget som klatre-evnen" } } },
  // #6352: et godt lead-out er placeringer vaerd i de sidste 1-2 km.
  leadoutRankGain: { unit: "placeringer", byClass: { flat: { min: 0.5, warnMin: 0, status: "forslag", source: "#6352: et godt lead-out giver sprint-kaptajnen placeringer i finalen" } } },
});

/**
 * Etapens benchmark-klasse for TIDSGAB og udbrudsSTOERRELSE. Udbrudsdommen
 * (andel sejre) bruger profile_type direkte, se summarizeTour.
 */
export function profileClass(profileType) {
  if (profileType === "flat") return "flat";
  if (profileType === "hilly" || profileType === "rolling" || profileType === "cobbles" || profileType === "gravel" || profileType === "classic") return "hilly";
  if (profileType === "mountain" || profileType === "high_mountain") return "mountain";
  if (profileType === "itt" || profileType === "itt_hilly" || profileType === "ttt") return profileType;
  return "hilly";
}

/**
 * #6440: benchmark-klassen for TIDSGABENE (nr. 10/30). En kort afslutning opad
 * (headToHeadAnchors.isShortUphillFinish, samme klassifikation som ankeret og
 * motoren) har sit eget ejer-maal (#6199 del 3); alle andre etaper profileClass.
 */
export function gapClass(profile) {
  return isShortUphillFinish(profile) ? "short_uphill" : profileClass(profile?.profile_type);
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

/** En kendt, aaben fejl maa aldrig staa som groen: PASS bliver TODO. */
export function applyKnownOpen(v, check, revision) {
  return check && gateStatus(check, revision) === "todo" && v === "PASS" ? "TODO" : v;
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

/** #6201 R1: antal ryttere der forsoegte morgenudbruddet (breakaway_attempt). */
export function breakawayAttempts(out) {
  const events = out?.timeline?.events ?? [];
  return new Set(events.filter((e) => e.type === "breakaway_attempt").flatMap((e) => e.params?.rider_ids ?? [])).size;
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
 * #5578 udbrudsmaal 3 og 4: holdt morgenudbruddet til maal foran favoritterne?
 * Favoritterne defineres som i #6084/#6089-harnessen: kaptajnerne
 * (race_role "captain") uden for morgenudbruddet. Udbruddet er foran naar dets
 * foerste rytter i maal kommer foer den foerste af dem PAA TID (mindst
 * AHEAD_MIN_GAP_SECONDS), eller ingen af dem kom i maal. Skaerpet i forhold til
 * harnessen, der kun saa paa placeringen: en indhentet udbryder der spurter
 * foran en kaptajn i samme gruppe (samme tid) har ikke holdt til maal.
 * Ingen udbrud = ikke foran (etapen taeller stadig med).
 */
export const AHEAD_MIN_GAP_SECONDS = 1;
export function breakawayAheadOfFavourites(out, roleByRider) {
  const { formed } = breakawaySets(out);
  if (!formed.size) return false;
  const fin = finishedSorted(out);
  const b = fin.findIndex((r) => formed.has(r.rider_id));
  if (b < 0) return false;
  const c = fin.findIndex((r) => roleByRider?.get(r.rider_id) === "captain" && !formed.has(r.rider_id));
  return c < 0 || (b < c && fin[c].time_seconds - fin[b].time_seconds >= AHEAD_MIN_GAP_SECONDS);
}

/**
 * Bjergetaperne i udbrudsmaal 4: profile_type "mountain", samme "bjerg" som
 * maal 2 (bjerg 15-50 % sejre, hoejfjeld 0-15 %). Med hoejfjeld i naevneren
 * kunne maal 4 (ca. 45 % foran) ikke naas uden at bryde hoejfjeldets baand.
 */
export const MOUNTAIN_AHEAD_PROFILES = Object.freeze(["mountain"]);

/**
 * #6285-1: udbrud der vinder en FLAD etape med minutter. Samme definition i
 * scorecardet og motor-testen: flad profil + udbruddet vandt + forspring paa
 * mindst FLAT_BREAKAWAY_MINUTES_SECONDS til foerste rytter uden for udbruddet.
 */
export function flatBreakawayWinWithMinutes(out, profile) {
  if (profileClass(profile?.profile_type) !== "flat") return { hit: false, margin: null };
  const bw = breakawayWin(out);
  return { hit: bw.won && (bw.margin ?? 0) >= FLAT_BREAKAWAY_MINUTES_SECONDS, margin: bw.margin };
}

/**
 * +30:00-muren (#6199/#6284): ryttere hvis raa gab er over loftet, men hvis
 * resultatliste-gab (broens `stageGap`, det spilleren ser og klassementet
 * summerer) IKKE er den raa tid. Under orders_gc_v2/v3 er det de clampede; under
 * official_times_v1 skal taelleren vaere 0, fordi listen dér baerer de rigtige
 * tider. Detektoren sammenligner liste mod motor, saa den slaar ud paa ethvert
 * loft (ogsaa et nyt et), ikke kun paa praecis 30:00.
 */
export function clampedAtCap(ranked, out) {
  const fin = finishedSorted(out);
  if (!fin.length) return 0;
  const rawGap = new Map(fin.map((r) => [r.rider_id, r.time_seconds - fin[0].time_seconds]));
  return (ranked ?? []).filter((r) => {
    const raw = rawGap.get(r.rider_id);
    return raw !== undefined && raw > STAGE_GAP_CAP_SECONDS + 0.5 && Math.abs(Number(r.stageGap) - Math.round(raw)) > 1;
  }).length;
}

/** Ryttere med raa gab over loftet (forudsaetning for at clampedAtCap kan slaa ud). */
export function overCapRaw(out) {
  const fin = finishedSorted(out);
  return fin.filter((r) => r.time_seconds - fin[0].time_seconds > STAGE_GAP_CAP_SECONDS + 0.5).length;
}

/**
 * #6285/#6201: morgenudbrud stoerre end profilens loft. Loftet laeses fra
 * motorens egen tuning (BREAKAWAY_SIZE_V3_TUNING via breakawayMaxSizeV3), aldrig
 * et tal her; det gaelder orders_gc_v3-arvelinjen (official_times_v2 inkl.).
 * Returnerer stoerrelsen paa hver breakaway_formed over loftet.
 */
export function breakawaysOverSizeCap(out, profile) {
  const cap = breakawayMaxSizeV3(profile?.profile_type);
  return (out?.timeline?.events ?? [])
    .filter((e) => e.type === "breakaway_formed")
    .map((e) => (e.params?.rider_ids ?? []).length)
    .filter((size) => size > cap);
}

/** Stoerste klump af ryttere med praecis samme resultat-gab paa loftet (til rapporten). */
export function largestCapClump(ranked) {
  return (ranked ?? []).filter((r) => r.stageGap === STAGE_GAP_CAP_SECONDS).length;
}

const MEMBERSHIP_TYPES = new Set(["breakaway_formed", "peloton_splits", "finale_attack"]);
const filmKm = (e) => (Number.isFinite(e?.km) ? e.km : 0); // filmens konvention: km ?? 0

/**
 * Minuttab "paa 0 km" (#5951), maalt paa det loebsfilmen faktisk viser ved
 * start: etapens persisterede tidslinje (det broen gemmer og frontend afspiller).
 * Motorens gruppe-snapshots kan IKKE bruges: de gemmes kun ved segment-slut,
 * det foerste typisk efter 15-20 km, saa en "km 0"-maaling paa dem kan aldrig
 * slaa ud.
 *
 * En rytter taeller naar filmen i startvinduet (km <= maxKm; events uden km
 * laegger filmen paa km 0) viser:
 *  - en linje i "hvor tabte rytterne tid" (frontendens buildOwnTimeLoss med
 *    alle ryttere som egne): et fald fra gruppen, et favoritknaek eller et
 *    uheld med tidstab paa mindst `thresholdSeconds`;
 *  - en gruppe (gap_update) mindst `thresholdSeconds` efter fronten.
 *
 * Returnerer null (N/A, ikke 0) naar filmen intet kan vise: ingen tidslinje
 * eller en tidslinje uden v4's gruppe-gab.
 */
export function minuteLossAtZeroKm(events, { riderIds = null, maxKm = START_WINDOW_KM, thresholdSeconds = START_LOSS_THRESHOLD_SECONDS } = {}) {
  if (!Array.isArray(events) || !events.length || !hasGroupGaps(events)) return null;
  const ids = riderIds ? [...riderIds] : [...new Set(events.flatMap((e) => [e?.params?.rider_id, ...(e?.params?.rider_ids ?? [])]).filter((id) => typeof id === "string"))];
  const hit = new Set();
  for (const entry of buildOwnTimeLoss(events, { ownRiderIds: ids })) {
    if (!(entry.km <= maxKm)) continue;
    if (entry.type === "drop") {
      for (const id of entry.riderIds ?? [entry.riderId]) hit.add(id);
    } else if (entry.event?.type === "favorite_crack" || Number(entry.event?.params?.time_loss_seconds ?? 0) >= thresholdSeconds) {
      hit.add(entry.riderId);
    }
  }
  const members = new Map();
  for (const e of events.filter((x) => x?.type && filmKm(x) <= maxKm).sort((a, b) => filmKm(a) - filmKm(b))) {
    const p = e.params ?? {};
    if (MEMBERSHIP_TYPES.has(e.type) && typeof p.group_id === "string") {
      if (!members.has(p.group_id)) members.set(p.group_id, new Set());
      for (const id of p.rider_ids ?? []) members.get(p.group_id).add(id);
    } else if (e.type === "gap_update" && typeof p.group_id === "string" && Number(p.gap_seconds) >= thresholdSeconds) {
      const known = members.get(p.group_id);
      if (known?.size) for (const id of known) hit.add(id);
      else hit.add(`group:${p.group_id}`);
    }
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
 * tidspunkt havde mindst `thresholdSeconds` til feltet. #5978: "feltet" er
 * klassementsgruppen, ikke den stoerste gruppe: paa bjergetaper er den stoerste
 * gruppe ofte de afhaegtede, og et forspring paa dem er ingen klassementsgevinst.
 *
 * Klassementsgruppen forankres paa foereren: gruppen med den bedst placerede
 * top-10-rytter (laveste indeks i `gcBefore`) som ikke er udbryderen selv.
 * (#6373 brugte "gruppen med flest oevrige top-10", men den kan vaere svage
 * top-10 (plads 7-10), der er sat af, mens favoritternes gruppe har faerre top-10:
 * forspringet blev maalt mod en afhaengt gruppe, hvilket gav baade falsk PASS og
 * falsk FAIL, #5978.) Ligger foereren i udbryderens egen gruppe, er der ingen
 * gevinst (samme gruppe = 0), og rytteren taeller ikke.
 */
export function gcTop10InBreakOverThreshold(out, gcBefore, { thresholdSeconds = 300, topN = 10 } = {}) {
  if (!gcBefore?.length) return [];
  const topIds = gcBefore.slice(0, topN).map((s) => s.rider_id);
  const top = new Set(topIds);
  const { formed } = breakawaySets(out);
  const suspects = [...formed].filter((id) => top.has(id));
  if (!suspects.length) return [];
  const best = new Map();
  for (const s of out?.groupSnapshots ?? []) {
    const groups = s.groups ?? [];
    for (const id of suspects) {
      const own = groups.find((g) => g.rider_ids?.includes(id));
      const leaderId = topIds.find((r) => r !== id && groups.some((g) => g.rider_ids?.includes(r)));
      const gcGroup = leaderId === undefined ? null : groups.find((g) => g.rider_ids?.includes(leaderId));
      if (!own || !gcGroup || gcGroup === own) continue;
      best.set(id, Math.max(best.get(id) ?? -Infinity, (gcGroup.gap_seconds ?? 0) - (own.gap_seconds ?? 0)));
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

/**
 * Startlisten som v4-entrants. Ryttere uden evner kan motoren ikke koere, og de
 * smides ud, men TAELLES (`droppedWithoutAbilities`), saa et hul i data aldrig
 * giver et stille mindre felt.
 */
export function splitEntrants(data) {
  const aiByTeam = new Map((data.teams ?? []).map((t) => [t.id, t.is_ai === true]));
  const abilitiesById = new Map((data.abilities ?? []).map((a) => [a.rider_id, a]));
  const entrants = [];
  const droppedRiderIds = [];
  for (const e of data.entries ?? []) {
    const ab = abilitiesById.get(e.rider_id);
    if (!ab) { droppedRiderIds.push(e.rider_id); continue; }
    const { rider_id: _r, ...abilities } = ab;
    entrants.push({ rider_id: e.rider_id, team_id: e.team_id ?? null, team_is_ai: aiByTeam.get(e.team_id) === true, race_role: e.race_role ?? null, effort: "normal", abilities });
  }
  return { entrants, droppedWithoutAbilities: droppedRiderIds.length, droppedRiderIds };
}

/** Bagudkompatibel: kun entrants, men advarer naar ryttere uden evner smides ud. */
export function entrantsFromData(data) {
  const { entrants, droppedWithoutAbilities } = splitEntrants(data);
  if (droppedWithoutAbilities > 0) console.warn(`tourScorecard: ${droppedWithoutAbilities} ryttere paa startlisten mangler evner og koeres ikke`);
  return entrants;
}

export function sortedStages(data) {
  return data.profiles.slice().sort((a, b) => a.stage_number - b.stage_number);
}

function simulate({ v4, data, stages, profile, entrants, revision, gcStandings, seedTag, orders }) {
  return v4.simulateStage({
    entrants, stageProfile: profile, seedString: `${data.race.id}:${profile.stage_number}:${seedTag}`, stageNumber: profile.stage_number,
    teamOrderRows: orders ?? data.orders, isStageRace: stages.length > 1, raceStages: stages, squad: data.race.squad ?? null,
    rulesRevision: revision, gcStandings,
  });
}

const addTo = (m, k, v) => m.set(k, (m.get(k) ?? 0) + v);

/**
 * Alle etaper i raekkefoelge under én revision og ét seed, med klassementet
 * akkumuleret PRAECIS som spillet (raceRunner): pr. etape summeres
 * resultatlistens gab (`stageGap`, dvs. den clampede tid under orders_gc_v2/v3
 * og den rigtige under official_times_v1) minus bonussekunder, countback paa
 * placeringssummen (rankByCumTimeAsc), og ryttere uden en etaperaekke
 * (udgaaet/OTL) er ude. Klassementet FOER etapen sendes til motoren fra etape 2
 * ([] paa etape 1), saa orders_gc's klassementslogik faktisk koeres.
 *
 * `onStage({profile, index, res, gcBefore, gcAfter, entrants})` kaldes pr. etape
 * (res er hele broens svar; gem kun det der skal bruges).
 * Returnerer slutklassementet.
 */
export function runStagesInOrder({ v4, data, revision, seedTag, stages = sortedStages(data), entrants = splitEntrants(data).entrants, onStage = null }) {
  const cumTime = new Map();
  const posSum = new Map();
  const passGc = isOrdersGcRulesRevision(revision) && stages.length > 1;
  let inRace = entrants;
  let gcAfter = [];
  stages.forEach((profile, index) => {
    const gcBefore = index === 0 ? [] : rankByCumTimeAsc(inRace, cumTime, posSum);
    const res = simulate({ v4, data, stages, profile, entrants: inRace, revision, gcStandings: passGc ? gcBefore : null, seedTag });
    const bonus = (id) => res.passages?.perRider?.get(id)?.bonus_seconds ?? 0;
    for (const r of res.ranked) {
      addTo(cumTime, r.rider_id, r.stageGap - bonus(r.rider_id));
      addTo(posSum, r.rider_id, r.rank);
    }
    const stageEntrants = inRace;
    const rankedIds = new Set(res.ranked.map((r) => r.rider_id));
    inRace = inRace.filter((e) => rankedIds.has(e.rider_id));
    gcAfter = rankByCumTimeAsc(inRace, cumTime, posSum);
    onStage?.({ profile, index, res, gcBefore, gcAfter, entrants: stageEntrants });
  });
  return gcAfter;
}

/** Etapens maalinger for ét seed. */
export function stageMetrics({ res, profile, gcBefore, abilitiesById, teamByRider, riderIds = null, roleByRider = null }) {
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
    // #6201 R1: forsoeg pr. etape (breakaway_attempt) - maalt, ikke doemt.
    breakawayAttempts: tt ? null : breakawayAttempts(out),
    breakawayWon: tt ? null : bw.won,
    breakawayAhead: tt ? null : breakawayAheadOfFavourites(out, roleByRider),
    breakawayWinMargin: bw.margin,
    flatBreakawayWinMinutes: !tt && flatBreakawayWinWithMinutes(out, profile).hit ? 1 : 0,
    gcTop10InBreakOver5Min: tt ? 0 : gcTop10InBreakOverThreshold(out, gcBefore).length,
    ownTeamChasesOwn: tt ? 0 : ownChaseViolations(out.timeline?.events ?? [], teamByRider).length,
    clampedAtCap: clampedAtCap(ranked, out),
    capClump: largestCapClump(ranked),
    over30Raw: overCapRaw(out),
    // Paa en tidskoersel har filmen intet felt at staa bagud i: N/A, ikke 0.
    minuteLossAtZeroKm: tt ? null : minuteLossAtZeroKm(res.timeline?.events ?? null, { riderIds }),
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
 * pr. seed som i spillet (runStagesInOrder).
 */
export function runTour({ v4, data, revision, seeds = 5, leadoutPair = true, seedPrefix = "tour6285" }) {
  const stages = sortedStages(data);
  const { entrants: all, droppedWithoutAbilities } = splitEntrants(data);
  const abilitiesById = new Map(data.abilities.map((a) => [a.rider_id, a]));
  const teamByRider = new Map(all.map((e) => [e.rider_id, e.team_id]));
  const roleByRider = new Map(all.map((e) => [e.rider_id, e.race_role]));
  const riderIds = all.map((e) => e.rider_id);
  const week1Stage = stages[Math.max(0, Math.round(stages.length * (9 / 21)) - 1)]?.stage_number ?? null;
  const perSeed = [];
  for (let s = 1; s <= seeds; s++) {
    const rows = [];
    let gcWeek1 = null;
    const seedTag = `${seedPrefix}-${s}`;
    const final = runStagesInOrder({
      v4, data, revision, seedTag, stages, entrants: all,
      onStage: ({ profile, res, gcBefore, gcAfter, entrants }) => {
        const m = stageMetrics({ res, profile, gcBefore, abilitiesById, teamByRider, riderIds, roleByRider });
        if (leadoutPair && isBunchSprintStage(profile)) {
          const teams = leadoutTeams(data.orders, profile.stage_number);
          if (teams.size) {
            const gcStandings = isOrdersGcRulesRevision(revision) && stages.length > 1 ? gcBefore : null;
            const withoutRes = simulate({ v4, data, stages, profile, entrants, revision, gcStandings, seedTag, orders: ordersWithoutLeadout(data.orders, profile.stage_number) });
            const eff = leadoutEffect({ withRes: res, withoutRes, entrants, teams });
            if (eff) m.leadout = eff;
          }
        }
        m.gcTo10After = gcGapAt(gcAfter, 10);
        m.gcTo30After = gcGapAt(gcAfter, 30);
        m.gcLeaderAfter = gcAfter[0]?.rider_id ?? null;
        m.finishers = res.ranked.length;
        if (profile.stage_number === week1Stage) gcWeek1 = m.gcTo10After;
        rows.push(m);
      },
    });
    perSeed.push({ seed: s, rows, gcWeek1, gcFinalTo10: gcGapAt(final, 10), gcWinnerMargin: gcGapAt(final, 2), gcWinner: final[0]?.rider_id ?? null, finishers: final.length });
  }
  return { revision, seeds, week1Stage, droppedWithoutAbilities, perSeed, summary: summarizeTour(perSeed, stages, revision) };
}

const sum = (xs) => xs.reduce((a, b) => a + (Number(b) || 0), 0);
const RACE_GATE_CHECK = Object.fromEntries(Object.entries(GATE_METRIC).map(([check, metric]) => [metric, check]));

/** Etape- og loebsoversigt over seeds, med benchmark-dom. */
export function summarizeTour(perSeed, stages, revision = null) {
  const stageRows = stages.map((p) => {
    const ms = perSeed.map((s) => s.rows.find((r) => r.stage === p.stage_number)).filter(Boolean);
    const med = (k) => median(ms.map((m) => m[k]).filter((v) => v !== null && v !== undefined));
    const cls = profileClass(p.profile_type);
    const lo = ms.map((m) => m.leadout).filter(Boolean);
    const zeroKm = ms.map((m) => m.minuteLossAtZeroKm).filter((v) => v !== null && v !== undefined);
    const row = {
      stage: p.stage_number, profile_type: p.profile_type, finale_type: p.finale_type ?? null, cls,
      gapTo10: med("gapTo10"), gapTo30: med("gapTo30"), ittGapTo10Per40Km: med("ittGapTo10Per40Km"),
      breakawaySize: med("breakawaySize"),
      breakawayWins: ms.filter((m) => m.breakawayWon === true).length,
      breakawayAhead: ms.filter((m) => m.breakawayAhead === true).length,
      breakawayWinMarginMedian: median(ms.map((m) => m.breakawayWinMargin).filter((v) => v !== null)),
      gcTo10After: med("gcTo10After"), gcTo30After: med("gcTo30After"),
      gcTop10InBreakOver5Min: sum(ms.map((m) => m.gcTop10InBreakOver5Min)),
      ownTeamChasesOwn: sum(ms.map((m) => m.ownTeamChasesOwn)),
      clampedAtCap: sum(ms.map((m) => m.clampedAtCap)),
      capClumpMax: Math.max(0, ...ms.map((m) => m.capClump)),
      over30RawMedian: med("over30Raw"),
      // null = filmen kunne ikke maale (N/A), aldrig 0.
      minuteLossAtZeroKm: zeroKm.length ? sum(zeroKm) : null,
      labelContradictions: sum(ms.map((m) => m.labelContradictions)),
      flatBreakawayWinMinutes: sum(ms.map((m) => m.flatBreakawayWinMinutes)),
      rhoTempo: med("rhoTempo"), rhoClimb: med("rhoClimb"), ittHillyTempoMinusClimb: med("ittHillyTempoMinusClimb"),
      leadoutRankGain: lo.length ? mean(lo.map((l) => l.meanRankGain)) : null,
      leadoutWinsWith: lo.length ? sum(lo.map((l) => l.winsWith)) : null,
      leadoutWinsWithout: lo.length ? sum(lo.map((l) => l.winsWithout)) : null,
      seeds: ms.length,
    };
    row.verdicts = {};
    const gapCls = gapClass(p); // #6440
    for (const key of ["gapTo10", "gapTo30", "ittGapTo10Per40Km", "breakawaySize", "ittHillyTempoMinusClimb", "leadoutRankGain"]) {
      const band = TOUR_BENCHMARKS[key]?.byClass?.[key === "gapTo10" || key === "gapTo30" ? gapCls : cls];
      if (band) row.verdicts[key] = verdict(row[key], band);
    }
    return row;
  });

  // Udbrudssucces pr. profile_type (vejetaper), doemt mod profiltypens eget
  // ejer-baandet (RULES Udbrudsmaal); stoerrelsen mod benchmark-klassens baand.
  const byType = {};
  for (const r of stageRows) {
    if (TIME_TRIAL_PROFILES.has(r.profile_type)) continue;
    const c = (byType[r.profile_type] ??= { cls: r.cls, stages: 0, wins: 0, ahead: 0, trials: 0, sizes: [], rawSizes: [], attempts: [] });
    c.stages += 1;
    c.wins += r.breakawayWins;
    c.ahead += r.breakawayAhead ?? 0;
    c.trials += r.seeds;
    if (r.breakawaySize !== null) c.sizes.push(r.breakawaySize);
    // #6201 R1: hver (etape, seed) for sig: andelen paa 0-2 mand og forsoegene.
    for (const m of perSeed.map((s) => s.rows.find((x) => x.stage === r.stage)).filter(Boolean)) {
      if (m.breakawaySize !== null && m.breakawaySize !== undefined) c.rawSizes.push(m.breakawaySize);
      if (m.breakawayAttempts !== null && m.breakawayAttempts !== undefined) c.attempts.push(m.breakawayAttempts);
    }
  }
  const classRows = Object.entries(byType).map(([profileType, c]) => {
    const share = c.trials ? c.wins / c.trials : null;
    const sizeMedian = median(c.sizes);
    return {
      profile_type: profileType, cls: c.cls, stages: c.stages, trials: c.trials, breakawayWinShare: share, breakawaySizeMedian: sizeMedian,
      breakawaySmallShare: c.rawSizes.length ? c.rawSizes.filter((n) => n <= 2).length / c.rawSizes.length : null,
      breakawayAttemptsMedian: median(c.attempts),
      breakawayAheadShare: c.trials ? c.ahead / c.trials : null,
      legacyAheadShare: null,
      verdicts: {
        breakawayWinShare: verdict(share, TOUR_BENCHMARKS.breakawayWinShare.byClass[profileType]),
        breakawaySize: verdict(sizeMedian, TOUR_BENCHMARKS.breakawaySize.byClass[c.cls]),
      },
    };
  });

  // Gennemsnit pr. Tour (ikke median): en fejl i ét af tre seeds skal kunne ses.
  const perTour = (k) => mean(perSeed.map((s) => sum(s.rows.map((r) => r[k]))));
  const zeroKmSeeds = perSeed.map((s) => s.rows.map((r) => r.minuteLossAtZeroKm).filter((v) => v !== null && v !== undefined)).filter((xs) => xs.length);
  const race = {
    gcTo10AfterWeek1: median(perSeed.map((s) => s.gcWeek1).filter((v) => v !== null)),
    gcTo10Final: median(perSeed.map((s) => s.gcFinalTo10).filter((v) => v !== null)),
    gcWinnerMargin: median(perSeed.map((s) => s.gcWinnerMargin).filter((v) => v !== null)),
    gcTop10InBreakOver5Min: perTour("gcTop10InBreakOver5Min"),
    ownTeamChasesOwn: perTour("ownTeamChasesOwn"),
    clampedAtCap: perTour("clampedAtCap"),
    minuteLossAtZeroKm: zeroKmSeeds.length ? mean(zeroKmSeeds.map((xs) => sum(xs))) : null,
    labelContradictions: perTour("labelContradictions"),
    flatBreakawayWinMinutes: perTour("flatBreakawayWinMinutes"),
    distinctGcWinners: new Set(perSeed.map((s) => s.gcWinner)).size,
  };
  // #5578 udbrudsmaal 4: bjergetaperne samlet (MOUNTAIN_AHEAD_PROFILES).
  const mountainRows = classRows.filter((c) => MOUNTAIN_AHEAD_PROFILES.includes(c.profile_type));
  const mountainTrials = sum(mountainRows.map((c) => c.trials));
  race.mountainBreakAheadShare = mountainTrials ? sum(mountainRows.map((c) => c.breakawayAheadShare * c.trials)) / mountainTrials : null;
  race.minuteLossMeasuredStages = stageRows.filter((r) => r.minuteLossAtZeroKm !== null).length;
  race.verdicts = {
    gcTo10AfterWeek1: verdict(race.gcTo10AfterWeek1, TOUR_BENCHMARKS.gcTo10AfterWeek1.byClass.race),
    gcTo10Final: verdict(race.gcTo10Final, TOUR_BENCHMARKS.gcTo10Final.byClass.race),
    gcWinnerMargin: verdict(race.gcWinnerMargin, TOUR_BENCHMARKS.gcWinnerMargin.byClass.race),
    mountainBreakAheadShare: verdict(race.mountainBreakAheadShare, TOUR_BENCHMARKS.mountainBreakAheadShare.byClass.race),
  };
  for (const k of ["gcTop10InBreakOver5Min", "ownTeamChasesOwn", "clampedAtCap", "minuteLossAtZeroKm", "labelContradictions", "flatBreakawayWinMinutes"]) {
    race.verdicts[k] = applyKnownOpen(verdict(race[k], TOUR_BENCHMARKS[k].byClass.race), RACE_GATE_CHECK[k], revision);
  }
  const gates = Object.keys(GATE_METRIC).map((check) => ({ check, metric: GATE_METRIC[check], status: gateStatus(check, revision), note: KNOWN_OPEN_GATES[check]?.[revision] ?? null, verdict: race.verdicts[GATE_METRIC[check]] }));
  const summary = { stages: stageRows, classes: classRows, race, gates };
  summary.counts = countVerdicts(summary);
  return summary;
}

/** PASS/WARN/FAIL/TODO/N/A over alle domme i et scorecard. */
export function countVerdicts(summary) {
  const all = [...summary.stages.flatMap((r) => Object.values(r.verdicts)), ...summary.classes.flatMap((r) => Object.values(r.verdicts)), ...Object.values(summary.race.verdicts)];
  const counts = { PASS: 0, WARN: 0, FAIL: 0, TODO: 0, "N/A": 0 };
  for (const v of all) counts[v] += 1;
  return counts;
}

/** #5578 udbrudsmaal 3: det relative baand mod legacys andel (den mildeste af differens og forhold). */
export function legacyHoldBand(legacyShare, band = TOUR_BENCHMARKS.breakawayHoldVsLegacy.byClass.legacy) {
  return {
    min: Math.min(legacyShare + band.minDelta, legacyShare * band.minRatio),
    warnMin: Math.min(legacyShare + band.warnMinDelta, legacyShare * band.warnMinRatio),
  };
}

/**
 * #5578 udbrudsmaal 3: doem hver profile_type's "foran favoritterne i maal"
 * mod legacy koert paa SAMME data og seeds (legacySummary). Muterer summary
 * (legacyAheadShare + verdicts.breakawayHoldVsLegacy) og taeller dommene om.
 * En profiltype legacy ikke har, faar N/A. Legacy doemmes ikke mod sig selv.
 */
export function applyLegacyHoldReference(summary, legacySummary) {
  const legacyByType = new Map((legacySummary?.classes ?? []).map((c) => [c.profile_type, c.breakawayAheadShare]));
  for (const c of summary.classes) {
    const ref = legacyByType.get(c.profile_type);
    c.legacyAheadShare = Number.isFinite(ref) ? ref : null;
    c.verdicts.breakawayHoldVsLegacy = c.legacyAheadShare === null
      ? "N/A"
      : verdict(c.breakawayAheadShare, legacyHoldBand(c.legacyAheadShare));
  }
  summary.counts = countVerdicts(summary);
  return summary;
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
const fmtZ = (v) => (v === null || v === undefined ? "N/A" : String(v));
const cell = (v, verdictText) => (verdictText ? `${v} ${verdictText}` : v);
const countsText = (c) => `PASS ${c.PASS} · WARN ${c.WARN} · FAIL ${c.FAIL} · TODO ${c.TODO} · N/A ${c["N/A"]}`;

const MINUTE_LOSS_NA = "Minuttab km 0 maales paa loebsfilmen (den persisterede tidslinje, samme afledning som frontend). N/A = filmen kan intet vise paa etapen (tidskoersel, ingen tidslinje eller ingen gruppe-gab) og taeller aldrig som PASS.";

/** Markdown-rapport: en blok pr. revision og en sammenligning side om side. */
export function renderTourMarkdown({ raceLabel, runs, generatedAt }) {
  const lines = [`# Tour-gennemtest (#6285): ${raceLabel}`, "", `Genereret ${generatedAt}. Seeds pr. revision: ${runs.map((r) => `${r.revision}=${r.seeds}`).join(", ")}.`, ""];
  const dropped = Math.max(0, ...runs.map((r) => r.droppedWithoutAbilities ?? 0));
  if (dropped > 0) lines.push(`**ADVARSEL:** ${dropped} ryttere paa startlisten mangler evner og er IKKE koert. Feltet er mindre end i spillet.`, "");
  lines.push("Benchmark-status: ejer = ejer-godkendt anker, kandidat = eksisterende kandidat, forslag = nyt omtrentligt baand (ejeren justerer).");
  lines.push("TODO = maalingen daekker en kendt, aaben fejl (KNOWN_OPEN_GATES) og taeller aldrig som groen. N/A = ingen maaling.", "");
  lines.push(MINUTE_LOSS_NA, "");
  if (runs.length > 1) {
    lines.push("## Side om side", "", `| Maaling | ${runs.map((r) => r.revision).join(" | ")} |`, `|---|${runs.map(() => "---").join("|")}|`);
    const raceKeys = [["gcTo10AfterWeek1", fmtS], ["gcTo10Final", fmtS], ["gcWinnerMargin", fmtS], ["gcTop10InBreakOver5Min", fmtN], ["ownTeamChasesOwn", fmtN], ["clampedAtCap", fmtN], ["minuteLossAtZeroKm", fmtN], ["labelContradictions", fmtN], ["flatBreakawayWinMinutes", fmtN], ["mountainBreakAheadShare", fmtN], ["distinctGcWinners", fmtN]];
    for (const [k, f] of raceKeys) lines.push(`| ${k} | ${runs.map((r) => cell(f(r.summary.race[k]), r.summary.race.verdicts[k])).join(" | ")} |`);
    const types = [...new Set(runs.flatMap((r) => r.summary.classes.map((x) => x.profile_type)))];
    for (const t of types) {
      lines.push(`| udbrudssejre ${t} | ${runs.map((r) => { const x = r.summary.classes.find((y) => y.profile_type === t); return x ? cell(fmtN(x.breakawayWinShare), x.verdicts.breakawayWinShare) : "-"; }).join(" | ")} |`);
      lines.push(`| udbrudsstoerrelse ${t} | ${runs.map((r) => { const x = r.summary.classes.find((y) => y.profile_type === t); return x ? cell(fmtN(x.breakawaySizeMedian, 1), x.verdicts.breakawaySize) : "-"; }).join(" | ")} |`);
      lines.push(`| udbrud foran favoritter ${t} (legacy) | ${runs.map((r) => { const x = r.summary.classes.find((y) => y.profile_type === t); return x ? cell(`${fmtN(x.breakawayAheadShare)} (${fmtN(x.legacyAheadShare)})`, x.verdicts.breakawayHoldVsLegacy) : "-"; }).join(" | ")} |`);
    }
    lines.push(`| PASS/WARN/FAIL/TODO/N/A | ${runs.map((r) => { const c = r.summary.counts; return `${c.PASS}/${c.WARN}/${c.FAIL}/${c.TODO}/${c["N/A"]}`; }).join(" | ")} |`, "");
    lines.push("### Etaper side om side (nr. 10 / nr. 30 til vinderen)", "", `| Etape | Profil | ${runs.map((r) => r.revision).join(" | ")} |`, `|---|---|${runs.map(() => "---").join("|")}|`);
    for (const st of runs[0].summary.stages) {
      lines.push(`| ${st.stage} | ${st.profile_type}/${st.finale_type ?? "-"} | ${runs.map((r) => { const x = r.summary.stages.find((y) => y.stage === st.stage); return x ? `${cell(fmtS(x.gapTo10), x.verdicts.gapTo10)} / ${cell(fmtS(x.gapTo30), x.verdicts.gapTo30)}` : "-"; }).join(" | ")} |`);
    }
    lines.push("");
  }
  for (const run of runs) {
    const s = run.summary;
    lines.push(`## ${run.revision}`, "", `${countsText(s.counts)}. Uge 1 = efter etape ${run.week1Stage}.`, "");
    lines.push("### Motor-gates (#6285)", "", "| Gate | Maaling | Status | Scorecard |", "|---|---|---|---|");
    for (const g of s.gates ?? []) lines.push(`| ${g.check} | ${g.metric} | ${g.status === "todo" ? `TODO (kendt aaben: ${g.note})` : "gate (haard)"} | ${g.verdict ?? "-"} |`);
    lines.push("");
    lines.push("| Etape | Profil | Nr. 10 | Nr. 30 | ITT nr. 10/40 km | Udbrud (median) | Udbrudssejre | Sejrsmargin udbrud | GC nr. 10 efter | Top-10 GC i udbrud >5 min | Jagter egne | Liste-gab != raa tid (over loftet) | Over 30 min (raa) | Minuttab km 0 (film) | Maerke-modsigelser | rho tempo / klatring | Tog: placeringer (sejre med/uden) |");
    lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const r of s.stages) {
      lines.push(`| ${r.stage} | ${r.profile_type}/${r.finale_type ?? "-"} | ${cell(fmtS(r.gapTo10), r.verdicts.gapTo10)} | ${cell(fmtS(r.gapTo30), r.verdicts.gapTo30)} | ${cell(fmtS(r.ittGapTo10Per40Km), r.verdicts.ittGapTo10Per40Km)} | ${cell(fmtN(r.breakawaySize, 1), r.verdicts.breakawaySize)} | ${r.breakawayWins}/${r.seeds} | ${fmtS(r.breakawayWinMarginMedian)} | ${fmtS(r.gcTo10After)} | ${r.gcTop10InBreakOver5Min} | ${r.ownTeamChasesOwn} | ${r.clampedAtCap} (klump ${r.capClumpMax}) | ${fmtN(r.over30RawMedian, 0)} | ${fmtZ(r.minuteLossAtZeroKm)} | ${r.labelContradictions} | ${r.rhoTempo === null ? "-" : `${fmtN(r.rhoTempo)} / ${fmtN(r.rhoClimb)}${r.verdicts.ittHillyTempoMinusClimb ? ` ${r.verdicts.ittHillyTempoMinusClimb}` : ""}`} | ${r.leadoutRankGain === null ? "-" : `${cell(fmtN(r.leadoutRankGain, 1), r.verdicts.leadoutRankGain)} (${r.leadoutWinsWith}/${r.leadoutWinsWithout})`} |`);
    }
    lines.push("", "| Udbrud pr. profiltype | Etaper | Udbrudssejre (andel) | Stoerrelse (median) | 0-2 mand (andel) | Forsoeg (median) | Foran favoritter i maal (andel) | Legacy samme seeds | Holder til maal vs legacy |", "|---|---|---|---|---|---|---|---|---|");
    for (const c of s.classes) lines.push(`| ${c.profile_type} | ${c.stages} | ${cell(fmtN(c.breakawayWinShare), c.verdicts.breakawayWinShare)} | ${cell(fmtN(c.breakawaySizeMedian, 1), c.verdicts.breakawaySize)} | ${fmtN(c.breakawaySmallShare)} | ${fmtN(c.breakawayAttemptsMedian, 1)} | ${fmtN(c.breakawayAheadShare)} | ${fmtN(c.legacyAheadShare)} | ${c.verdicts.breakawayHoldVsLegacy ?? "-"} |`);
    lines.push("", "| Loebet | Vaerdi | Dom |", "|---|---|---|");
    for (const [k, v] of Object.entries(s.race)) {
      if (k === "verdicts") continue;
      const isTime = /gc/.test(k) && !/InBreak/.test(k) && k !== "distinctGcWinners";
      const shown = k === "minuteLossAtZeroKm" && (v === null || v === undefined) ? "N/A (ingen etape kunne maales paa filmen)" : isTime ? fmtS(v) : fmtN(v);
      lines.push(`| ${k} | ${shown} | ${s.race.verdicts[k] ?? "-"} |`);
    }
    lines.push("");
  }
  lines.push("## Benchmark-kilder", "", "| Maaling | Klasse | Baand | Status | Kilde |", "|---|---|---|---|---|");
  for (const [k, b] of Object.entries(TOUR_BENCHMARKS)) {
    for (const [c, band] of Object.entries(b.byClass)) lines.push(`| ${k} (${b.unit}) | ${c} | ${band.minDelta !== undefined ? `legacy ${band.minDelta}..` : `${band.min ?? "-"}..${band.max ?? "-"}`} | ${band.status} | ${band.source} |`);
  }
  return `${lines.join("\n")}\n`;
}
