// #8604 Trend-prognosen: "hvis du fortsætter med at træne i den fart, du har trænet i i
// løbet af din karriere, så ender du her, når du peaker" (ejer 27/11, spec v1-v3 på #8604).
//
// ═══ HVAD TALLET ER ══════════════════════════════════════════════════════════
//   - Farten måles i XP, ikke i rating: rytterens afregnede XP pr. dato
//     (training_rider_ticks.report.xp, kun afregnede felter), løbsdage med, fordi løb
//     tæller som træning. Hele karrieren på XP-systemet tæller, de seneste dage mest.
//     Datoer, hvor han var skadet eller syg, tæller ikke.
//   - Gamle holds datoer tæller i farten (ejer 27/11). Trænere og faciliteter ligger i den
//     målte XP og korrigeres ikke.
//   - Uden nok XP-data (A+C, ejer 27/11): har rytteren mindst én hel sæson med
//     ratingudvikling, bruges hans egen historik omregnet til XP; ellers normal træning for
//     hans potentiale, målt på alle ryttere. Den ægte trend vejer mere dag for dag og er
//     helt hans egen efter en måneds datoer.
//   - Fremtiden simuleres dato for dato med motorens egen pris pr. næste evnetrin
//     (developmentXp.ts buyPoints). Prisen stiger med evnetrinnet, ikke med alderen.
//     Alderens andel af XP følger motorens kurve.
//   - Aldringen regnes løbende: sæsonskiftets forventede fald fordeles over sæsonens
//     datoer, også den del af den igangværende sæson, der allerede er gået. Spillets år er
//     en sæson, og alderen tælles i sæsonens fremdrift, aldrig i hele års-trin. Derfor
//     intet hop på en fødselsdag eller ved skiftet.
//   - Prognosen er toppen, før faldet: den bedste rating i simuleringen. Aldringen trækker
//     den ikke ned før toppen; den afgør kun, hvornår toppen nås.
//   - Efter toppen: forventet rating om et år med det løbende fald. Fra den dag, aldringen
//     begynder, vokser horisonten glidende fra toppen til et helt år, så overgangen aldrig
//     er et spring.
//   - Ingen bånd. Mens prognosen læres (for få datoer på eget hold), sendes kun et
//     `learning`-mærke, og fladen viser en kort tekst om, at tallet er usikkert.
//   - Aldrig under ratingen nu, før toppen.
//
// ═══ HVEM SER DET ════════════════════════════════════════════════════════════
// Kun holdets egne ryttere (nøglen er (rytter, hold)). Modstandere får ingen prognose.
// Batchen kører uden for anmodningen; kun det afrundede tal og to mærker forlader serveren.
//
// Bag kontakten prognosis_trend_8604 (seedet "off"). Slukket læses tabellen aldrig, og
// prognosen er bit for bit den nuværende (frossen golden i prognosisTrend8604.test.js).
//
// Hard rule 17: konstanterne her er runtime-værdier; begrundelser og målinger ligger i
// balance-internals/ (8604-trend-prognose.md).

import { buyPoints, xpAgeShare, xpPerDate, xpPriceForNextPoint } from "./developmentXp.ts";
import { STANDARD_CAREER, expectedTopRating, standardCareerRotation, standardCareerShares } from "./developmentXpExpectedTop.ts";
import {
  AGING_V2_CONFIG, AGING_V2_DECLINING_ABILITIES, agingBrake, agingV2BaseDrop, signatureFactor, xpAgingConfig,
} from "./riderProgression.js";
import { agingRateAt } from "./riderWear6110.js";
import { abilityMeta } from "./abilityRegistry.js";
import { VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { DISPLAY_RECIPE_KEYS, abilityValue, roleOutputRaw } from "./weights/displayRecipes.js";
import { ageForSeason } from "./riderSeasonAge.js";
import { fetchAllRowsChunkedIn } from "./supabasePagination.js";
import { PROGNOSIS_TREND_FLAG_KEY, isPrognosisTrendEnabled } from "./prognosisTrendFlag.js";

export { PROGNOSIS_TREND_FLAG_KEY, isPrognosisTrendEnabled };
export const PROGNOSIS_TREND_TABLE = "rider_prognosis_trend";
// Hæves ved enhver ændring af beregningen: hashen ændrer sig, og alle rækker skrives om.
export const PROGNOSIS_TREND_VERSION = "8604-trend-v1";

// Vinduet for "de seneste dage" og hvor meget en dato i det vejer mod en ældre dato.
export const TREND_RECENT_DAYS = 30;
export const TREND_RECENT_WEIGHT = 3;
// Karrieredatoer, hvorefter farten er helt rytterens egen (A+C glider ud).
export const TREND_OWN_AFTER_DATES = 30;
// Datoer på eget hold, før prognosen regnes som lært.
export const TREND_LEARNED_DATES = 30;
// "Normal træning målt på alle ryttere": ryttere med mindst så mange datoer i vinduet
// indgår i målingen, og målingens faktor holdes inden for et rimeligt spænd.
export const PRIOR_FACTOR_MIN_DATES = 5;
export const PRIOR_FACTOR_MIN = 0.5;
export const PRIOR_FACTOR_MAX = 1.5;
// En sæson tæller som hel, når rytterens billeder dækker den til så mange dage fra kanterne.
export const SEASON_EDGE_DAYS = 7;
// Halveringer, når det synlige skøn omregnes til potentiale (2^-14 af skalaen er langt under ét ratingpoint).
export const PRIOR_BISECT_STEPS = 14;

const MENTAL = new Set(VISIBLE_ABILITIES.filter((ability) => abilityMeta(ability)?.category === "mental"));
const DECLINING = new Set(AGING_V2_DECLINING_ABILITIES);
const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const DAY_MS = 24 * 60 * 60 * 1000;
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// ── Rating ───────────────────────────────────────────────────────────────────────

/** Rytterens bedste rolle-rating, urundet, så små skridt i simuleringen ikke rundes væk. */
export function bestRatingRaw(abilities) {
  let best = null;
  for (const role of DISPLAY_RECIPE_KEYS) {
    const raw = roleOutputRaw(abilities, role);
    if (isNum(raw) && (best === null || raw > best)) best = raw;
  }
  return best;
}

const shareFor = (ability, seasonAge, params) => xpAgeShare(seasonAge, params, { mental: MENTAL.has(ability) });

// ── Farten ───────────────────────────────────────────────────────────────────────

/**
 * Afregnede felter → én post pr. dato: XP pr. evne summeret over datoens felter, de hold
 * datoen blev trænet på og sæson-alderen. Felter uden XP (før XP-systemet) tæller ikke; en
 * dato med skade eller sygdom tæller ikke i farten.
 */
export function settledXpDates(ticks, { seasonNumberById, birthdate }) {
  const byDate = new Map();
  for (const tick of ticks ?? []) {
    if (!tick?.tick_date) continue;
    const entry = byDate.get(tick.tick_date) ?? { date: tick.tick_date, xp: {}, teams: new Set(), sick: false, seasonId: tick.season_id, hasXp: false };
    byDate.set(tick.tick_date, entry);
    if (tick.injured === true || tick.injured === "true" || Number(tick.illness) > 0) entry.sick = true;
    const xp = typeof tick.xp === "string" ? safeJson(tick.xp) : tick.xp;
    if (!xp || typeof xp !== "object") continue;
    entry.hasXp = true;
    if (tick.team_id) entry.teams.add(tick.team_id);
    for (const [ability, value] of Object.entries(xp)) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0 && VISIBLE_ABILITIES.includes(ability)) entry.xp[ability] = (entry.xp[ability] ?? 0) + n;
    }
  }
  const out = [];
  for (const entry of byDate.values()) {
    if (!entry.hasXp || entry.sick) continue;
    const seasonAge = ageForSeason(birthdate, Number(seasonNumberById?.get?.(entry.seasonId)));
    out.push({ date: entry.date, xp: entry.xp, teams: [...entry.teams].sort(), seasonAge });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // best-effort: en ulæselig rapport er en dato uden XP, ikke en fejl i kørslen.
    return null;
  }
}

/**
 * Trend-farten: vægtet gennemsnit af datoernes XP pr. evne, renset for alderens andel, så et
 * sæsonskifte ikke flytter farten. De seneste dage vejer mest. null uden datoer.
 */
export function trendPace(dates, { today, params }) {
  let weights = 0;
  const sum = {};
  for (const entry of dates ?? []) {
    const age = daysBetween(entry.date, today);
    const weight = age < TREND_RECENT_DAYS ? TREND_RECENT_WEIGHT : 1;
    weights += weight;
    for (const [ability, xp] of Object.entries(entry.xp)) {
      const share = shareFor(ability, entry.seasonAge, params);
      if (share > 0) sum[ability] = (sum[ability] ?? 0) + (weight * xp) / share;
    }
  }
  if (!(weights > 0)) return null;
  return Object.fromEntries(Object.entries(sum).map(([ability, xp]) => [ability, xp / weights]));
}

const paceTotal = (pace) => Object.values(pace ?? {}).reduce((s, v) => s + (isNum(v) ? v : 0), 0);

/**
 * Ejer 28/11: startfarten (A) bygger på det SYNLIGE potentiale-skøn, aldrig det skjulte, så
 * prognosen ikke kan afsløre det. Skønnet er rytterens forventede top (samme sande tal som
 * potentialEstimateWriter: expectedTopRating). Her findes det potentiale på motorens skala,
 * der giver netop den top, ved halvering: toppen stiger med potentialet. Deterministisk.
 * null uden skøn eller uden evner: så bruges laveste potentiale (aldrig det skjulte).
 *   rider  { id, abilities, seasonAge, primaryType, secondaryType }
 */
export function priorPotentialFromEstimate(rider, estimate, params) {
  if (!params || !isNum(estimate) || !rider?.abilities || !isNum(rider.seasonAge)) return null;
  const curve = params.potentialXp;
  let lo = curve[0].at;
  let hi = curve[curve.length - 1].at;
  const topAt = (potentiale) => expectedTopRating({
    id: rider.id, abilities: rider.abilities, age: rider.seasonAge, potentiale,
    primaryType: rider.primaryType ?? null, secondaryType: rider.secondaryType ?? null,
  }, params);
  const low = topAt(lo);
  if (low == null) return null;
  if (estimate <= low) return lo;
  if (estimate >= (topAt(hi) ?? -Infinity)) return hi;
  // Toppen er et heltal, så et helt spænd af potentialer giver samme skøn. Fable 28/11: brug
  // midten af spændet (første P, der når skønnet, og første P, der når skønnet + 1), ikke
  // den nedre kant, som systematisk gav for lavt P.
  const firstReaching = (target) => {
    let a = lo;
    let b = hi;
    for (let i = 0; i < PRIOR_BISECT_STEPS; i++) {
      const mid = (a + b) / 2;
      if ((topAt(mid) ?? -Infinity) < target) a = mid; else b = mid;
    }
    return b;
  };
  return (firstReaching(estimate) + firstReaching(estimate + 1)) / 2;
}

/** Normal træning for potentialet (A): standardkarrierens fordeling, renset for alder. */
export function standardPriorPace({ potentiale, primaryType = null, secondaryType = null }, params, factor = 1) {
  if (!params) return null;
  const top = xpPerDate({ potentiale, age: null }, params);
  const rotation = standardCareerRotation(primaryType);
  if (!rotation.length || !(top > 0)) return null;
  const out = {};
  for (const program of rotation) {
    for (const [ability, share] of Object.entries(standardCareerShares(primaryType, secondaryType, params, program))) {
      out[ability] = (out[ability] ?? 0) + (share * top * factor) / rotation.length;
    }
  }
  return out;
}

/** XP-prisen fra ét trin til et andet med motorens egen trinpris. */
function xpBetween(from, to, params) {
  let xp = 0;
  for (let level = Math.round(from); level < Math.round(to); level++) xp += xpPriceForNextPoint(level, params);
  return xp;
}

/**
 * Egen historik (C): den seneste hele sæson med evne-billeder, omregnet til XP pr. dato med
 * motorens trinpris og renset for alderens andel. null uden en hel sæson.
 *   snapshots  [{ snapshot_date, season_number, abilities }]
 *   seasons    [{ number, start_date, end_date, status }]
 */
export function seasonHistoryPace({ snapshots, seasons, birthdate, currentSeasonNumber }, params, career = STANDARD_CAREER) {
  if (!params || !snapshots?.length) return null;
  const complete = (seasons ?? [])
    .filter((season) => Number(season.number) < Number(currentSeasonNumber) && season.start_date && season.end_date)
    .sort((a, b) => Number(b.number) - Number(a.number));
  for (const season of complete) {
    const rows = snapshots.filter((row) => Number(row.season_number) === Number(season.number))
      .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
    if (rows.length < 2) continue;
    const first = rows[0];
    const last = rows.at(-1);
    if (daysBetween(season.start_date, first.snapshot_date) > SEASON_EDGE_DAYS) continue;
    if (daysBetween(last.snapshot_date, season.end_date) > SEASON_EDGE_DAYS) continue;
    const seasonAge = ageForSeason(birthdate, Number(season.number));
    const out = {};
    for (const ability of VISIBLE_ABILITIES) {
      const a = abilityValue(first.abilities?.[ability]);
      const b = abilityValue(last.abilities?.[ability]);
      if (a === null || b === null) continue;
      const share = shareFor(ability, seasonAge, params);
      out[ability] = b > a && share > 0 ? xpBetween(a, b, params) / career.datesPerSeason / share : 0;
    }
    return out;
  }
  return null;
}

/** Den ægte trend vejer mere dato for dato og er helt hans egen efter TREND_OWN_AFTER_DATES. */
export function blendPace(trend, prior, careerDates) {
  if (!trend && !prior) return null;
  const w = trend ? (prior ? clamp((Number(careerDates) || 0) / TREND_OWN_AFTER_DATES, 0, 1) : 1) : 0;
  const out = {};
  for (const ability of new Set([...Object.keys(trend ?? {}), ...Object.keys(prior ?? {})])) {
    out[ability] = w * (trend?.[ability] ?? 0) + (1 - w) * (prior?.[ability] ?? 0);
  }
  return out;
}

/**
 * "Normal træning målt på alle ryttere": medianen af forholdet mellem rytternes målte fart og
 * standardkarrierens, for ryttere med nok datoer i vinduet. 1 uden målinger.
 *   samples  [{ trend, standard, recentDates }]
 */
export function priorFactorFromSamples(samples) {
  const ratios = (samples ?? [])
    .filter((s) => s && s.recentDates >= PRIOR_FACTOR_MIN_DATES && paceTotal(s.standard) > 0)
    .map((s) => paceTotal(s.trend) / paceTotal(s.standard))
    .filter(isNum)
    .sort((a, b) => a - b);
  if (!ratios.length) return 1;
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  return clamp(median, PRIOR_FACTOR_MIN, PRIOR_FACTOR_MAX);
}

// ── Aldringen ────────────────────────────────────────────────────────────────────

const agingCfgOf = (params) => (params ? xpAgingConfig(params) : null) ?? AGING_V2_CONFIG;

/**
 * Sæsonskiftets forventede fald pr. evne ved sæson-alderen `newAge` (alderen i den NYE
 * sæson, som motoren): den rå brøk, motorens afrunding har som forventning
 * (developRiderSeasonV2). Begge aldrings-former og det sene fald.
 */
export function expectedSeasonDrops(state, primaryType, newAge, cfg = AGING_V2_CONFIG, load = STANDARD_CAREER.declineLoad) {
  const brake = agingBrake(load, cfg);
  const out = {};
  if (!(brake > 0)) return out;
  if (cfg.percent) {
    const physical = agingRateAt(cfg.percent.physical, newAge);
    const mental = agingRateAt(cfg.percent.mental, newAge);
    for (const [ability, value] of Object.entries(state)) {
      const rate = DECLINING.has(ability) ? physical : mental;
      if (rate > 0 && value > 0) out[ability] = value * rate * brake;
    }
    return out;
  }
  const base = agingV2BaseDrop(newAge, cfg);
  for (const ability of Object.keys(state)) {
    if (DECLINING.has(ability)) {
      if (base > 0) out[ability] = base * (signatureFactor(primaryType, ability) >= 1 ? 1 : cfg.offTypeDeclineFactor) * brake;
    } else if (cfg.late && newAge >= cfg.late.fromAge) {
      out[ability] = cfg.late.drop * brake;
    }
  }
  return out;
}

const REFERENCE_STATE = Object.freeze(Object.fromEntries(VISIBLE_ABILITIES.map((ability) => [ability, 50])));

/** Den første sæson-alder (i den nye sæson), hvor skiftet trækker ned. */
export function declineStartNewAge(primaryType, cfg) {
  for (let age = 15; age <= 60; age++) {
    const drops = expectedSeasonDrops(REFERENCE_STATE, primaryType, age, cfg);
    if (Object.values(drops).some((d) => d > 0)) return age;
  }
  return Infinity;
}

// ── Simuleringen ─────────────────────────────────────────────────────────────────

/**
 * Rytterens fremtid dato for dato med farten `pace` (XP pr. dato, renset for alder).
 *   rider  { abilities, bars, primaryType, secondaryType, seasonAge, seasonProgress }
 * `seasonProgress` (0-1) er, hvor langt den igangværende sæson er: den del af skiftets fald,
 * der hører til de gåede dage, er allerede trukket fra, så tallet ikke hopper ved skiftet.
 * Returnerer { ratings, ratingNow, declineDays } eller null. Deterministisk.
 */
export function simulateTrend(rider, pace, params, career = STANDARD_CAREER) {
  if (!rider?.abilities || !isNum(rider.seasonAge) || !params) return null;
  const primaryType = rider.primaryType ?? null;
  const state = {};
  for (const ability of VISIBLE_ABILITIES) {
    const value = abilityValue(rider.abilities[ability]);
    if (value !== null) state[ability] = value;
  }
  if (!Object.keys(state).length) return null;
  const ratingNow = bestRatingRaw(state);
  if (ratingNow == null) return null;
  const bars = {};
  for (const [ability, bar] of Object.entries(rider.bars ?? {})) {
    const n = Number(bar);
    if (Number.isFinite(n) && n > 0 && ability in state) bars[ability] = n;
  }
  const cfg = agingCfgOf(params);
  const perSeason = career.datesPerSeason;
  const progress = clamp(Number(rider.seasonProgress) || 0, 0, 1);
  const age0 = Math.round(rider.seasonAge);
  const declineSeasonAge = declineStartNewAge(primaryType, cfg) - 1;
  const declineDays = age0 >= declineSeasonAge ? (age0 - declineSeasonAge + progress) * perSeason : -Infinity;
  const horizonIndex = Math.round(clamp(declineDays, 0, perSeason));

  // Skiftets fald regnes ÉN gang pr. sæson og fordeles over sæsonens datoer. Regnet dato for
  // dato fra de allerede sænkede evner ville procent-aldring forrente sig, og faldet blev for
  // lille (Codex #8876 P2). Kendt tilnærmelse: motoren regner procent-faldet fra værdien VED
  // skiftet (inkl. sæsonens træning); her regnes det fra værdien ved sæsonstart, så faldet er
  // lidt for lille (ca. sats x sæsonens gevinst, under et halvt point). Trin-aldring er eksakt.
  const seasonDrops = (newAge) => (newAge - 1 < declineSeasonAge
    ? null
    : expectedSeasonDrops(state, primaryType, newAge, cfg, career.declineLoad));
  const applyDrops = (drops, share) => {
    if (!drops || !(share > 0)) return;
    for (const [ability, drop] of Object.entries(drops)) {
      state[ability] = Math.max(0, state[ability] - drop * share);
    }
  };
  // Den del af sæsonens fald, der hører til de dage, der allerede er gået.
  const firstSeasonDrops = seasonDrops(age0 + 1);
  applyDrops(firstSeasonDrops, progress);

  const entries = Object.entries(pace ?? {}).filter(([ability, xp]) => ability in state && xp > 0);
  const ratings = [bestRatingRaw(state)];
  let topIndex = 0;
  // Mindst et år frem, også for en rytter forbi karrierens sidste sæson, så "om et år" altid kan regnes.
  const lastAge = Math.max(career.endAge, age0 + 1);
  for (let age = age0; age <= lastAge; age++) {
    const dates = age === age0 ? Math.round((1 - progress) * perSeason) : perSeason;
    const shares = entries.map(([ability, xp]) => [ability, xp * shareFor(ability, age, params)]);
    const drops = age === age0 ? firstSeasonDrops : seasonDrops(age + 1);
    for (let d = 0; d < dates; d++) {
      for (const [ability, xp] of shares) {
        const out = buyPoints({ level: state[ability], bar: bars[ability] ?? 0, xp }, params);
        bars[ability] = out.bar;
        state[ability] = out.level;
      }
      applyDrops(drops, 1 / perSeason);
      const rating = bestRatingRaw(state);
      ratings.push(rating);
      if (rating > ratings[topIndex]) topIndex = ratings.length - 1;
    }
    // Forbi faldets start, et år forbi toppen og horisonten kommer ingen ny top: farten falder
    // med alderen, mens faldet vokser.
    if (age >= declineSeasonAge && ratings.length - 1 > topIndex + perSeason && ratings.length - 1 > horizonIndex) break;
  }
  return { ratings, ratingNow, topIndex, declineDays, horizonIndex };
}

/**
 * Det viste punkt på simuleringen: toppen, eller "om et år", når faldet er begyndt.
 * Horisonten vokser glidende fra faldets start, så tallet aldrig springer.
 */
export function prognosisPoint(sim) {
  if (!sim?.ratings?.length) return null;
  const index = Math.min(sim.ratings.length - 1, Math.max(sim.topIndex, sim.horizonIndex));
  return { raw: sim.ratings[index], horizon: index === sim.topIndex ? "top" : "year" };
}

/**
 * Trend-prognosen for én rytter. Ren funktion.
 *   rider    { id, abilities, bars, potentiale, primaryType, secondaryType, birthdate }
 *   dates    settledXpDates(...) for hele karrieren
 *   teamId   holdet, prognosen er til ("lært" kræver datoer på eget hold)
 *   history  egen historik (C), seasonHistoryPace, eller null
 * Returnerer { value, horizon, learning, careerDates, ownDates } eller null.
 */
export function computeTrendPrognosis({
  rider, dates = [], teamId, history = null, factor = 1, today, seasonAge, seasonProgress,
}, params, career = STANDARD_CAREER) {
  if (!rider || !params || !isNum(seasonAge)) return null;
  const trend = dates.length ? trendPace(dates, { today, params }) : null;
  const prior = history ?? standardPriorPace(rider, params, factor);
  const pace = blendPace(trend, prior, dates.length);
  const sim = simulateTrend({ ...rider, seasonAge, seasonProgress }, pace ?? {}, params, career);
  const point = prognosisPoint(sim);
  if (!point || !isNum(point.raw)) return null;
  const now = Math.round(sim.ratingNow);
  const raw = Math.round(point.raw);
  const value = clamp(point.horizon === "top" ? Math.max(raw, now) : raw, 1, 99);
  const ownDates = dates.filter((entry) => entry.teams.includes(teamId)).length;
  return { value, horizon: point.horizon, learning: ownDates < TREND_LEARNED_DATES, careerDates: dates.length, ownDates };
}

// ── Læsning ──────────────────────────────────────────────────────────────────────

/** Ren funktion: den viste trend-prognose for én række og ratingen nu. */
export function trendView(row, { currentRating = null } = {}) {
  if (!row || !isNum(Number(row.value))) return null;
  const top = row.horizon !== "year";
  const floor = top && isNum(currentRating) ? Math.round(currentRating) : 1;
  const value = clamp(Math.max(Math.round(Number(row.value)), floor), 1, 99);
  return {
    hidden: false,
    value,
    basis: "trend",
    ...(row.learning === true ? { learning: true } : {}),
    ...(top ? {} : { horizon: "year" }),
  };
}

/**
 * Trend-prognoserne for holdets egne ryttere. Kontakten læses først; slukket (også "beta",
 * manglende og fejl) returneres et tomt kort uden at tabellen læses. Ryttere uden række er
 * ikke med, så de beholder den nuværende prognose.
 */
export async function loadTrendPrognosisViews(supabase, { teamId, riderIds, ratings = new Map() }) {
  const ids = [...new Set((riderIds ?? []).filter(Boolean))];
  if (!ids.length || !(await isPrognosisTrendEnabled(supabase))) return new Map();
  const rows = await fetchAllRowsChunkedIn(ids, (chunk) => supabase.from(PROGNOSIS_TREND_TABLE)
    .select("rider_id, value, learning, horizon").eq("team_id", teamId).in("rider_id", chunk).order("rider_id"));
  const out = new Map();
  for (const row of rows) {
    const view = trendView(row, { currentRating: ratings.get(row.rider_id) ?? null });
    if (view) out.set(row.rider_id, view);
  }
  return out;
}
