#!/usr/bin/env node
// #6110 byggetrin 23 (S25) · 10-SÆSONERS-SIMULERING FØR TÆNDING.
//
// 100 % READ-ONLY mod prod. Scriptet SELECT'er et øjebliksbillede af verden (eller
// læser et gemt billede med --snapshot) og simulerer det 10 sæsoner frem i
// hukommelsen. Der findes ingen kode i denne fil der kan skrive til prod: klienten
// bruges kun til SELECT'erne i loadProdSnapshot. Al output er lokale filer.
//
// Testverdenen (ejer S25, 23/10): kopi af prod, ASSISTENTEN STYRER ALLE HOLD.
//   · Alle ryttere på et hold træner hver løbsdag med assistentens standardplan
//     (resolveProgram(null, type): typens standardfokus, normal intensitet) og
//     udvikler sig (også AI-hold; D6's "AI vokser ikke" gælder ikke her, fordi
//     assistenten er træner overalt).
//   · Løbsdage: rytteren kører samme andel af sæsonens løbsdage som han målt
//     kørte i den aktive sæson (nye ryttere: medianen for deres aldersgruppe).
//     Hvilke løbsdage og hvilken profil er seedet. Løbsdagen bruger løbsdags-
//     programmet (raceDayYield.raceDayProgram) og +1-loftet pr. løbsdag.
//   · Sæsonskiftet bruger Udvikling 2.0's aldring (#6499, developRiderSeasonV2)
//     med sæsonens løbsdage som bremse, og samme pensionsregel som skiftet.
//   · Pensionerede ryttere erstattes holdvis af nye unge fra produktionens egen
//     generator (generateAcademyCandidates), så truppernes størrelse holdes.
//   · Ryttere uden hold (frie, bank/test) træner ikke; de ældes og pensioneres.
//
// VARIANTER (samme verden, samme seeds):
//   nu        dagens udvikling (applyDailyTick med træningsscore-koblingen),
//             +1 pr. evne pr. løbsdag, ingen dato-loft.
//   nu_maks1  som nu + maks +1 pr. evne pr. DATO (#7075-reglen, flag
//             ability_cap_per_date_enabled; PR #7075 er ikke merget, så reglen
//             er gengivet her i capGainsPerDate: klippet point bæres videre).
//   B@x       Udviklingsscore B-proxy (byggetrin 7 er ikke bygget endnu): dagens
//             udvikling følger én score uden ungdomsfaktor, uden form/træthed
//             (S29) og uden alders-turbo (vækstfraktionen er fast), med bredere
//             dagsstøj, + maks +1 pr. dato. x er tempo-skalaen på devMult
//             (normaliseringen i det tekniske design §3): 1 = samme gennemsnitlige
//             dagsudbytte som "nu" for startbestanden. Flere x giver en kurve, så
//             ejeren kan se hvilket tempo der rammer D1-milepælene.
//   Når developmentScore (byggetrin 7) findes, skal B-proxyen erstattes af den.
//
// MÅLINGER pr. variant: D1-milepælene (andel af karrierens top ved 22 og 25,
// topalder), ratingfordeling pr. sæson, pension, talent-spredning, aldersfordeling
// i top 50 og store mod små hold (division). Alle tal er PRIVATE (hard rule 17).
//
// Kør fra backend/ (prod-billede, kun SELECT):
//   infisical run --env=prod --silent -- node scripts/dev/tenSeasonSim6110.mjs
// Genkør på gemt billede (ingen prod-kald):
//   node scripts/dev/tenSeasonSim6110.mjs --snapshot <fil>
// Flag: --seasons 10 --race-days 160 --b-scales 0.75,1,1.25 --variants nu,nu_maks1,B
//       --b-noise <bredde> --b-ref-age <alder> --render-only (kortet af koerte varianter)
//       --out-dir <mappe> (default <repo>/balance-internals/6110/s25) --limit-teams N
//
// Output (gitignoreret, må aldrig committes):
//   <out-dir>/ten-season-sim-<dato>.md    ÉT privat kort med alle tal
//   <out-dir>/ten-season-sim-<dato>.json  rå tal
//   <out-dir>/snapshot-<dato>.json        øjebliksbilledet (kun ved prod-kørsel)

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";
import {
  DAILY_TRAINING_CONFIG, applyDailyTick, dailyAbilityDelta, growthFractionForAge, resolveProgram,
} from "../../lib/dailyTraining.js";
import {
  buildCapsForRider, developRiderSeasonV2, seededUnitMixed, youthRateForPotential,
} from "../../lib/riderProgression.js";
import { youthMultiplier } from "../../lib/academyFlag.js";
import { facilityTrainingMultiplier } from "../../lib/staffTrainingBonus.js";
import { riderLevelBand, normalizeLevelBands } from "../../lib/staffAbilityConstants.js";
import { deriveStaffAbilities } from "../../lib/staffAbilityDerivation.js";
import { raceDayProgram } from "../../lib/raceDayYield.js";
import { RACE_PROFILE_ABILITY_MAP } from "../../lib/dailyTraining.js";
import { TRAINING_RACE_DAY_CONFIG, raceDayBudgetDivisor } from "../../lib/trainingRaceDayTick.js";
import { generateAcademyCandidates } from "../../lib/academyGenerator.js";
import { makeRng } from "../../lib/fictionalRiderGenerator.js";
import { DISPLAY_RECIPE_KEYS, ratingForRole } from "../../lib/weights/displayRecipes.js";
import { ageForSeason, LAUNCH_REFERENCE_YEAR } from "../../lib/riderSeasonAge.js";
import { RETIREMENT_NOTICE_COLUMNS, frozenNoticeFor } from "../../lib/retirementNotice.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "../../..");

// ── Parametre (strukturelle; ingen balance-tal fra motoren gentages her) ─────────
export const SIM_DEFAULTS = Object.freeze({
  seasons: 10,
  raceDaysPerSeason: 160, // S5's kalendermål (calendarRaceDayTargets.js)
  raceDaysPerDate: TRAINING_RACE_DAY_CONFIG.raceDaysPerDate,
  abilityCapPerRaceDay: TRAINING_RACE_DAY_CONFIG.abilityGainCapPerRaceDay,
  abilityCapPerDate: 1, // #7075-reglen
  bScales: Object.freeze([0.75, 1, 1.25]),
  // B-proxy: dagsstøjens bredde. Default = dagens bredde; B's bredere støj
  // sættes med --b-noise (værdien er privat og står på kortet; den endelige
  // bredde kalibreres mod H6b i byggetrin 7). Fast vækstfraktion = fraktionen
  // ved referencealderen (--b-ref-age), så alder ikke er en turbo (D-058).
  bNoiseSpan: DAILY_TRAINING_CONFIG.noiseSpan,
  bReferenceAge: 23,
  inflowAgeBand: Object.freeze({ min: 17, max: 19 }),
  variants: Object.freeze(["nu", "nu_maks1", "B"]),
});

// Løbsprofiler en løbsdag trækkes fra (ligeligt; kalenderens faktiske mix er ikke modelleret).
export const RACE_PROFILES = Object.freeze(Object.keys(RACE_PROFILE_ABILITY_MAP));

// ── Små rene hjælpere (eksporteret til test) ─────────────────────────────────────

export function bestRating(abilities) {
  let best = null;
  for (const role of DISPLAY_RECIPE_KEYS) {
    const r = ratingForRole(abilities, role);
    if (r !== null && (best === null || r > best)) best = r;
  }
  return best;
}

export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function median(values) {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  return quantile(s, 0.5);
}

const round = (x, d = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);

/**
 * #7075-reglen: klip et ticks gevinster så evnen højst stiger `cap` på datoen.
 * Et klippet point lægges tilbage på fremdriftsbaren (bæres til næste dato).
 * Muterer ikke input. Gengivet fra PR #7075 (ikke merget endnu).
 */
export function capGainsPerDate({ tickResult, abilities, usedGains = {}, cap = 1 }) {
  if (!tickResult?.gains) return tickResult;
  let next = null;
  for (const [ability, n] of Object.entries(tickResult.gains)) {
    const gained = Number(n) || 0;
    const allowance = Math.max(0, cap - (Number(usedGains[ability]) || 0));
    if (gained <= allowance) continue;
    next ??= {
      ...tickResult,
      abilities: { ...tickResult.abilities },
      progress: { ...tickResult.progress },
      gains: { ...tickResult.gains },
    };
    const excess = gained - allowance;
    next.abilities[ability] = Number(abilities?.[ability] ?? 0) + allowance;
    next.progress[ability] = Number(next.progress[ability] ?? 0) + excess;
    if (allowance > 0) next.gains[ability] = allowance;
    else delete next.gains[ability];
  }
  return next ?? tickResult;
}

/**
 * B-proxy-tick: samme bar-løkke og +1-loft som applyDailyTick, men rytter-leddet
 * er scorens devMult = scale × talent × støj × facilitet (ingen ungdom, ingen
 * form/træthed) og vækstfraktionen er fast (alder er ikke en turbo).
 */
export function applyTickB({
  riderId, seedKey, abilities, caps, progress, program, potentiale,
  staff, facilityTier, riderLevel, primaryType, secondaryType,
  budgetDivisor, hardDailyCap, scale, noiseSpan, referenceAge,
}) {
  const nextAbilities = { ...abilities };
  const nextProgress = { ...(progress ?? {}) };
  const gains = {};
  if (program.intensity === "rest") return { abilities: nextAbilities, progress: nextProgress, gains };
  const noise = 1 - noiseSpan + 2 * noiseSpan * seededUnitMixed(`btick:${riderId}:${seedKey}`);
  const quality = scale * youthRateForPotential(potentiale) * noise * facilityTrainingMultiplier({ facilityTier, staff });
  const ceiling = Number.isFinite(hardDailyCap) ? hardDailyCap : Infinity;
  for (const ability of VISIBLE_ABILITIES) {
    const current = Number(nextAbilities[ability] ?? 0);
    if (!Number.isFinite(current)) continue;
    const delta = dailyAbilityDelta({
      ability, current, cap: caps?.[ability], age: referenceAge, program, conditionMult: 1, noise, potentiale,
      staff, facilityTier, riderLevel, primaryType, secondaryType, budgetDivisor, riderQualityMult: quality,
    });
    if (delta <= 0) continue;
    let bar = Number(nextProgress[ability] ?? 0) + delta;
    const top = Math.min(99, caps?.[ability] ?? 99);
    let got = 0;
    while (bar >= 1 && got < ceiling && current + got < top) { bar -= 1; got += 1; }
    if (got) { gains[ability] = got; nextAbilities[ability] = current + got; }
    // Samme regel som settleProgressBar (#4750): kun et bindende dagsloft gemmer resten.
    const ceilingBound = bar >= 1 && got >= ceiling && current + got < top;
    nextProgress[ability] = ceilingBound ? bar : Math.min(bar, 0.999);
  }
  return { abilities: nextAbilities, progress: nextProgress, gains };
}

/** Normaliseringen for B@1: startbestandens snit af dagens alders-led delt med B's faste led. */
export function bNormalizer(ages, referenceAge) {
  const valid = ages.filter(Number.isFinite);
  if (!valid.length) return 1;
  const now = valid.reduce((s, a) => s + growthFractionForAge(a) * youthMultiplier(a), 0) / valid.length;
  return now / growthFractionForAge(referenceAge);
}

/** Seedet: kører rytteren på denne løbsdag, og hvilken profil? */
export function raceSlot(riderId, seasonNumber, gameDay, share) {
  if (!(share > 0)) return null;
  if (seededUnitMixed(`s25race:${riderId}:${seasonNumber}:${gameDay}`) >= share) return null;
  const i = Math.floor(seededUnitMixed(`s25prof:${riderId}:${seasonNumber}:${gameDay}`) * RACE_PROFILES.length);
  return RACE_PROFILES[Math.min(i, RACE_PROFILES.length - 1)];
}

export function birthdateForAge(age, seasonNumber) {
  const year = LAUNCH_REFERENCE_YEAR + (seasonNumber - 1) - age;
  return `${year}-06-15`;
}

// ── Verden ───────────────────────────────────────────────────────────────────────

/** Bygger den muterbare verden fra et øjebliksbillede (rene data). */
export function buildWorld(snapshot) {
  const teams = new Map();
  for (const t of snapshot.teams) {
    const active = !t.is_bank && !t.is_test_account;
    teams.set(t.id, { id: t.id, division: t.division ?? null, active, isAi: !!t.is_ai,
      facilityTier: snapshot.staffByTeam?.[t.id]?.facilityTier ?? 0, staff: snapshot.staffByTeam?.[t.id]?.staff ?? null });
  }
  const abilityByRider = new Map(snapshot.abilities.map((a) => [a.rider_id, a]));
  // Belastningen er hentet for hele sæsonen: en rytter der mangler i den, kørte 0
  // løbsdage (computeSeasonLoad laver kun rækker for ryttere med resultater).
  // Mangler belastningen helt (ukendt dækning), udfyldes med medianen senere.
  const loadKnown = snapshot.load != null && typeof snapshot.load === "object";
  const load = snapshot.load ?? {};
  // seasons.race_days_* tæller kalenderdatoer; hver dato bærer raceDaysPerDate løbsdage.
  const done = (Number(snapshot.season?.race_days_completed) || 0) * TRAINING_RACE_DAY_CONFIG.raceDaysPerDate;
  const scale = done > 0 ? 1 / done : 0;
  const shareFor = (measured) => {
    if (!loadKnown || !(scale > 0)) return null;
    return Math.min(1, (Number(measured?.raceDays) || 0) * scale);
  };
  const riders = [];
  for (const r of snapshot.riders) {
    const ab = abilityByRider.get(r.id);
    if (!ab || !r.primary_type || r.potentiale == null) continue;
    const abilities = {};
    for (const k of VISIBLE_ABILITIES) if (ab[k] != null) abilities[k] = Number(ab[k]);
    const team = r.team_id != null ? teams.get(r.team_id) : null;
    const measured = load[r.id];
    riders.push({
      id: r.id, birthdate: r.birthdate, potentiale: Number(r.potentiale),
      primary_type: r.primary_type, secondary_type: r.secondary_type ?? null,
      teamId: team?.active ? team.id : null,
      division: team?.active ? team.division : null,
      abilities, progress: { ...(ab.ability_progress ?? {}) },
      // andel af løbsdagene: målt (kørte dage / kørte løbsdage i sæsonen; 0 hvis han
      // ikke kørte), eller null ved ukendt dækning (udfyldes med medianen senere)
      raceShare: shareFor(measured),
      frozenRow: { retirement_notice_season: r.retirement_notice_season ?? null,
        retirement_notice_after_season: r.retirement_notice_after_season ?? null },
      inflow: false, retired: false, trajectory: [], seasonRaceDays: 0,
    });
  }
  return { teams, riders, startSeason: Number(snapshot.season.number) };
}

function fillMissingRaceShares(riders, seasonNumber) {
  const young = [];
  const old = [];
  for (const r of riders) {
    if (r.teamId == null || r.raceShare == null) continue;
    const age = ageForSeason(r.birthdate, seasonNumber);
    (age <= 21 ? young : old).push(r.raceShare);
  }
  const my = median(young) ?? 0;
  const mo = median(old) ?? 0;
  for (const r of riders) {
    if (r.raceShare != null) continue;
    r.raceShare = r.teamId == null ? 0 : (ageForSeason(r.birthdate, seasonNumber) <= 21 ? my : mo);
  }
  return { youngMedian: my, oldMedian: mo };
}

// ── Én sæson ─────────────────────────────────────────────────────────────────────

function simulateSeason(world, seasonNumber, variant, opts) {
  const dates = Math.ceil(opts.raceDaysPerSeason / opts.raceDaysPerDate);
  const divisor = raceDayBudgetDivisor();
  const seasonKey = `s25-${seasonNumber}`;
  for (const r of world.riders) {
    if (r.retired) continue;
    r.seasonRaceDays = 0;
    if (r.teamId == null) continue; // ingen træner: ingen daglig udvikling
    const team = world.teams.get(r.teamId);
    const age = ageForSeason(r.birthdate, seasonNumber);
    const riderLevel = riderLevelBand({ age });
    const program = resolveProgram(null, r.primary_type);
    let gameDay = 0;
    let caps = buildCapsForRider(r.abilities, { potentiale: r.potentiale, age }, r.primary_type, r.secondary_type);
    for (let d = 0; d < dates; d++) {
      const usedToday = {};
      let anyGain = false;
      for (let slot = 0; slot < opts.raceDaysPerDate; slot++) {
        gameDay += 1;
        if (gameDay > opts.raceDaysPerSeason) break;
        const profile = raceSlot(r.id, seasonNumber, gameDay, r.raceShare);
        if (profile) r.seasonRaceDays += 1;
        const tickProgram = profile ? raceDayProgram(profile) : program;
        const seedKey = `${seasonKey}#gd${gameDay}`;
        let res;
        if (variant.kind === "B") {
          res = applyTickB({
            riderId: r.id, seedKey, abilities: r.abilities, caps, progress: r.progress, program: tickProgram,
            potentiale: r.potentiale, staff: team.staff, facilityTier: team.facilityTier, riderLevel,
            primaryType: r.primary_type, secondaryType: r.secondary_type, budgetDivisor: divisor,
            hardDailyCap: opts.abilityCapPerRaceDay, scale: variant.scale * world.bNorm,
            noiseSpan: opts.bNoiseSpan, referenceAge: opts.bReferenceAge,
          });
        } else {
          res = applyDailyTick({
            riderId: r.id, dateStr: null, tickSeedKey: seedKey, age, abilities: r.abilities, caps,
            progress: r.progress, program: tickProgram, conditionMult: 1, potentiale: r.potentiale,
            hardDailyCap: opts.abilityCapPerRaceDay, staff: team.staff, facilityTier: team.facilityTier,
            riderLevel, primaryType: r.primary_type, secondaryType: r.secondary_type, budgetDivisor: divisor,
          });
        }
        if (variant.capPerDate) {
          const uncapped = res;
          res = capGainsPerDate({ tickResult: res, abilities: r.abilities, usedGains: usedToday, cap: opts.abilityCapPerDate });
          if (res !== uncapped) {
            for (const [k, n] of Object.entries(uncapped.gains)) world.dateCap.clipped += n - (res.gains[k] ?? 0);
          }
        }
        for (const [k, n] of Object.entries(res.gains ?? {})) {
          if (n > 0) { usedToday[k] = (usedToday[k] ?? 0) + n; anyGain = true; }
        }
        r.abilities = res.abilities;
        r.progress = res.progress;
      }
      // Hvor tit ville datoen give mere end +1 i en evne (uden dato-loftet)?
      for (const n of Object.values(usedToday)) if (n > opts.abilityCapPerDate) world.dateCap.over += n - opts.abilityCapPerDate;
      if (anyGain) {
        caps = buildCapsForRider(r.abilities, { potentiale: r.potentiale, age }, r.primary_type, r.secondary_type);
      }
    }
  }
}

// ── Sæsonskiftet: aldring (#6499), pension, nye unge ────────────────────────────

function transition(world, endingSeason, opts, { firstTransition = false, loadOverride = null } = {}) {
  const newSeason = endingSeason + 1;
  const retiredByTeam = new Map();
  const out = { season: newSeason, retired: 0, retireAges: [], ratingDrops: 0, inflow: 0, agingPoints: 0 };
  for (const r of world.riders) {
    if (r.retired) continue;
    const age = ageForSeason(r.birthdate, newSeason);
    const raceDays = loadOverride ? (loadOverride.get(r.id) ?? 0) : r.seasonRaceDays;
    const frozen = firstTransition ? frozenNoticeFor(r.frozenRow, endingSeason) : null;
    const before = bestRating(r.abilities);
    const dev = developRiderSeasonV2(
      { id: r.id, primary_type: r.primary_type, potentiale: r.potentiale, age, frozenRetirementNotice: frozen },
      r.abilities, newSeason, { load: { raceDays, hardDays: 0 } },
    );
    r.abilities = { ...r.abilities, ...dev.next };
    out.agingPoints += dev.aging.totalDrop;
    const after = bestRating(r.abilities);
    if (before != null && after != null && after < before) out.ratingDrops += 1;
    if (dev.retirement.retire) {
      r.retired = true;
      r.retiredAge = age - 1;
      out.retired += 1;
      out.retireAges.push(age - 1);
      if (r.teamId != null) retiredByTeam.set(r.teamId, (retiredByTeam.get(r.teamId) ?? 0) + 1);
    }
  }
  // Nye unge: hvert hold erstatter sine pensionister (produktionens generator).
  for (const [teamId, n] of retiredByTeam) {
    const team = world.teams.get(teamId);
    const rng = makeRng(Math.floor(seededUnitMixed(`s25inflow:${teamId}:${newSeason}`) * 2 ** 31));
    const kuld = generateAcademyCandidates({
      rng, referenceYear: LAUNCH_REFERENCE_YEAR + newSeason - 1, existingNames: new Set(),
      countOverride: n, ageBand: opts.inflowAgeBand,
    });
    kuld.forEach((c, i) => {
      const age = c.archetypeDraw?.birth?.age ?? opts.inflowAgeBand.min;
      const abilities = {};
      for (const k of VISIBLE_ABILITIES) if (c.birthAbilities?.[k] != null) abilities[k] = Number(c.birthAbilities[k]);
      world.riders.push({
        id: `s25-${teamId}-${newSeason}-${i}`, birthdate: birthdateForAge(age, newSeason),
        potentiale: Number(c.rider.potentiale), primary_type: c.archetypeDraw.primary,
        secondary_type: c.archetypeDraw.secondary ?? null, teamId, division: team?.division ?? null,
        abilities, progress: {}, raceShare: world.youngRaceShare ?? 0, frozenRow: {},
        inflow: true, inflowSeason: newSeason, retired: false, trajectory: [], seasonRaceDays: 0,
      });
      out.inflow += 1;
    });
  }
  return out;
}

// ── Målinger ─────────────────────────────────────────────────────────────────────

function seasonStats(world, seasonNumber, label) {
  const active = world.riders.filter((r) => !r.retired);
  const onTeam = active.filter((r) => r.teamId != null);
  const rated = onTeam.map((r) => ({ r, rating: bestRating(r.abilities), age: ageForSeason(r.birthdate, seasonNumber) }))
    .filter((x) => x.rating != null);
  const ratings = rated.map((x) => x.rating).sort((a, b) => a - b);
  const mean = ratings.reduce((s, x) => s + x, 0) / (ratings.length || 1);
  const sd = Math.sqrt(ratings.reduce((s, x) => s + (x - mean) ** 2, 0) / (ratings.length || 1));
  const top50 = [...rated].sort((a, b) => b.rating - a.rating).slice(0, 50);
  const top100 = [...rated].sort((a, b) => b.rating - a.rating).slice(0, 100);
  // Store mod små hold: holdets top-8 snit pr. division.
  const byTeam = new Map();
  for (const x of rated) {
    if (!byTeam.has(x.r.teamId)) byTeam.set(x.r.teamId, []);
    byTeam.get(x.r.teamId).push(x.rating);
  }
  const divTop8 = {};
  for (const [teamId, list] of byTeam) {
    const div = world.teams.get(teamId)?.division ?? "?";
    const top8 = list.sort((a, b) => b - a).slice(0, 8);
    const avg = top8.reduce((s, x) => s + x, 0) / top8.length;
    (divTop8[div] ??= []).push(avg);
  }
  const top100ByDiv = {};
  for (const x of top100) {
    const div = world.teams.get(x.r.teamId)?.division ?? "?";
    top100ByDiv[div] = (top100ByDiv[div] ?? 0) + 1;
  }
  const potBand = (p) => (p >= 5 ? "pot5+" : p >= 3.5 ? "pot3.5-4.5" : "pot<3.5");
  const byPot = {};
  for (const x of rated) (byPot[potBand(x.r.potentiale)] ??= []).push(x.rating);
  return {
    label, season: seasonNumber, activeRiders: active.length, onTeam: onTeam.length,
    rating: {
      n: ratings.length, mean: round(mean), sd: round(sd),
      p10: round(quantile(ratings, 0.1)), p50: round(quantile(ratings, 0.5)), p90: round(quantile(ratings, 0.9)),
      p99: round(quantile(ratings, 0.99)), max: ratings.at(-1) ?? null,
      ge70: ratings.filter((x) => x >= 70).length, ge80: ratings.filter((x) => x >= 80).length,
      ge85: ratings.filter((x) => x >= 85).length, ge90: ratings.filter((x) => x >= 90).length,
    },
    top50: {
      medianAge: median(top50.map((x) => x.age)), le23: top50.filter((x) => x.age <= 23).length,
      ge31: top50.filter((x) => x.age >= 31).length, cutoff: top50.at(-1)?.rating ?? null,
    },
    divisionTop8: Object.fromEntries(Object.entries(divTop8).sort().map(([d, l]) => [d, { teams: l.length, mean: round(l.reduce((s, x) => s + x, 0) / l.length) }])),
    top100ByDivision: top100ByDiv,
    meanByPotential: Object.fromEntries(Object.entries(byPot).sort().map(([k, l]) => [k, { n: l.length, mean: round(l.reduce((s, x) => s + x, 0) / l.length), p90: round(quantile(l.sort((a, b) => a - b), 0.9)) }])),
  };
}

/** Sæsonslut-rating pr. alder for hver rytter (efter dagenes udvikling, før aldringen). */
function recordTrajectories(world, seasonNumber) {
  for (const r of world.riders) {
    if (r.retired || r.teamId == null) continue;
    const rating = bestRating(r.abilities);
    if (rating != null) r.trajectory.push({ season: seasonNumber, age: ageForSeason(r.birthdate, seasonNumber), rating });
  }
}

/**
 * D1-milepælene (D-058): andel af karrierens observerede top ved 22 og 25, og
 * topalderen. Kun ryttere hvis bane dækker 22 til mindst 27 (ellers kan toppen
 * ligge uden for vinduet).
 */
export function milestoneStats(riders) {
  const band = (p) => (p >= 5 ? "pot5+" : p >= 3.5 ? "pot3.5-4.5" : "pot<3.5");
  const groups = {};
  for (const r of riders) {
    const t = r.trajectory;
    if (!t?.length) continue;
    const at = (age) => t.find((x) => x.age === age)?.rating ?? null;
    const minAge = Math.min(...t.map((x) => x.age));
    const maxAge = Math.max(...t.map((x) => x.age));
    if (minAge > 22 || maxAge < 27) continue;
    const peak = t.reduce((b, x) => (x.rating > b.rating || (x.rating === b.rating && x.age < b.age) ? x : b));
    if (!(peak.rating > 0)) continue;
    const r22 = at(22);
    const r25 = at(25);
    for (const key of ["alle", band(r.potentiale)]) {
      const g = (groups[key] ??= { n: 0, pct22: [], pct25: [], peakAge: [], peak: [] });
      g.n += 1;
      if (r22 != null) g.pct22.push((100 * r22) / peak.rating);
      if (r25 != null) g.pct25.push((100 * r25) / peak.rating);
      g.peakAge.push(peak.age);
      g.peak.push(peak.rating);
    }
  }
  const out = {};
  for (const [k, g] of Object.entries(groups)) {
    out[k] = {
      n: g.n, pct22: round(median(g.pct22)), pct25: round(median(g.pct25)),
      peakAgeMedian: median(g.peakAge),
      peakAt27to28: round((100 * g.peakAge.filter((a) => a >= 27 && a <= 28).length) / g.n),
      peakAtOrBefore24: round((100 * g.peakAge.filter((a) => a <= 24).length) / g.n),
      peakMedian: round(median(g.peak)),
    };
  }
  return out;
}

/** Stort talent: rating efter 9 sæsoner for pot ≥ 5.5 der startede ≤ 19 (Discord-pejlemærke 2/10). */
export function bigTalentAfterNine(riders, startSeason) {
  const list = [];
  for (const r of riders) {
    if (r.inflow || r.potentiale < 5.5) continue;
    const t0 = r.trajectory.find((x) => x.season === startSeason + 1);
    const t9 = r.trajectory.find((x) => x.season === startSeason + 9);
    if (!t0 || !t9 || t0.age > 19) continue;
    list.push(t9.rating);
  }
  const s = list.sort((a, b) => a - b);
  return { n: s.length, median: round(quantile(s, 0.5)), p90: round(quantile(s, 0.9)), max: s.at(-1) ?? null, ge90: s.filter((x) => x >= 90).length };
}

// ── Kørsel af én variant ─────────────────────────────────────────────────────────

export function runVariant(snapshot, variant, opts = SIM_DEFAULTS) {
  const world = buildWorld(snapshot);
  const s0 = world.startSeason;
  const shares = fillMissingRaceShares(world.riders, s0);
  world.youngRaceShare = shares.youngMedian;
  world.bNorm = bNormalizer(world.riders.filter((r) => r.teamId != null).map((r) => ageForSeason(r.birthdate, s0)), opts.bReferenceAge);
  world.dateCap = { over: 0, clipped: 0 };
  const result = { variant: variant.name, start: seasonStats(world, s0, "start"), seasons: [], transitions: [] };
  // Første skifte: den aktive sæsons målte løbsdage (fremskrevet til hel sæson).
  const measuredSeasonRaceDays = (Number(snapshot.season.race_days_total) || 0) * opts.raceDaysPerDate || opts.raceDaysPerSeason;
  const firstLoad = new Map(world.riders.map((r) => [r.id, Math.round((r.raceShare ?? 0) * measuredSeasonRaceDays)]));
  result.transitions.push(transition(world, s0, opts, { firstTransition: true, loadOverride: firstLoad }));
  for (let i = 1; i <= opts.seasons; i++) {
    const season = s0 + i;
    simulateSeason(world, season, variant, opts);
    recordTrajectories(world, season);
    result.seasons.push(seasonStats(world, season, `S${season} slut`));
    // De nye unge måles på samme tidspunkt som resten af slut-tallene: før det
    // sidste skifte (ellers ville pensioner, aldring og nye erstatninger tælle med).
    if (i === opts.seasons) {
      result.inflowEnd = seasonStats({ ...world, riders: world.riders.filter((r) => r.inflow) }, season, "nye unge ved slut").rating;
    }
    result.transitions.push(transition(world, season, opts));
  }
  result.milestones = milestoneStats(world.riders);
  result.bigTalent = bigTalentAfterNine(world.riders, s0);
  result.bNorm = world.bNorm;
  result.dateCap = world.dateCap;
  result.params = { raceDaysPerSeason: opts.raceDaysPerSeason, bNoiseSpan: opts.bNoiseSpan, bReferenceAge: opts.bReferenceAge };
  result.fingerprint = runFingerprint(snapshot, opts);
  result.raceShares = { young: round(shares.youngMedian, 3), old: round(shares.oldMedian, 3) };
  return result;
}

export function variantList(opts = SIM_DEFAULTS) {
  const list = [];
  for (const v of opts.variants) {
    if (v === "nu") list.push({ name: "nu", kind: "nu", capPerDate: false });
    else if (v === "nu_maks1") list.push({ name: "nu_maks1", kind: "nu", capPerDate: true });
    else if (v === "B") for (const s of opts.bScales) list.push({ name: `B@${s}`, kind: "B", capPerDate: true, scale: s });
  }
  return list;
}

// ── Prod-billede (KUN SELECT) ────────────────────────────────────────────────────

async function loadProdSnapshot() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY mangler (kør via infisical run --env=prod), eller brug --snapshot");
  }
  const { createClient } = await import("@supabase/supabase-js");
  const { fetchAllRows } = await import("../../lib/supabasePagination.js");
  const { loadSeasonDevelopmentLoad } = await import("../../lib/seasonDevelopmentLoad.js");
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: season, error: seasonErr } = await sb
    .from("seasons").select("id, number, race_days_total, race_days_completed")
    .eq("status", "active").order("number", { ascending: false }).limit(1).maybeSingle();
  if (seasonErr || !season) throw new Error(`aktiv sæson: ${seasonErr?.message ?? "ingen"}`);

  const [riders, abilities, teams, facilities, staffRows, load] = await Promise.all([
    fetchAllRows(() => sb.from("riders")
      .select(`id, birthdate, potentiale, primary_type, secondary_type, team_id, is_academy, ${RETIREMENT_NOTICE_COLUMNS}`)
      .eq("is_retired", false).order("id")),
    fetchAllRows(() => sb.from("rider_derived_abilities")
      .select(`rider_id, ${VISIBLE_ABILITIES.join(", ")}, ability_progress`).order("rider_id")),
    fetchAllRows(() => sb.from("teams").select("id, is_ai, is_bank, is_frozen, is_test_account, division").order("id")),
    fetchAllRows(() => sb.from("team_facilities").select("id, team_id, track, tier").eq("track", "training").order("id")),
    fetchAllRows(() => sb.from("team_staff").select("id, team_id, name, role, tier, status")
      .eq("role", "training").eq("status", "active").order("id")),
    loadSeasonDevelopmentLoad({ supabase: sb, seasonId: season.id }),
  ]);
  const staffIds = staffRows.map((s) => s.id);
  const staffAbilities = [];
  for (let i = 0; i < staffIds.length; i += 200) {
    const { data, error } = await sb.from("staff_derived_abilities")
      .select("staff_id, overall, dimensions, levels").in("staff_id", staffIds.slice(i, i + 200));
    if (error) throw new Error(`staff_derived_abilities: ${error.message}`);
    staffAbilities.push(...(data ?? []));
  }
  // Samme valg som trainingStaffContext.loadTrainingStaffContext: facilitetens tier,
  // og den STÆRKESTE aktive træner (højeste overall).
  const abilityByStaff = new Map(staffAbilities.map((a) => [a.staff_id, a]));
  const staffByTeam = {};
  for (const f of facilities) (staffByTeam[f.team_id] ??= { facilityTier: 0, staff: null }).facilityTier = f.tier ?? 0;
  const profilesByTeam = new Map();
  for (const s of staffRows) {
    const p = abilityByStaff.get(s.id) ?? deriveStaffAbilities({ role: s.role, tier: s.tier, name: s.name });
    if (!profilesByTeam.has(s.team_id)) profilesByTeam.set(s.team_id, []);
    profilesByTeam.get(s.team_id).push(p);
  }
  for (const [teamId, profiles] of profilesByTeam) {
    const ab = profiles.reduce((best, p) => ((p.overall ?? 0) > (best.overall ?? 0) ? p : best));
    (staffByTeam[teamId] ??= { facilityTier: 0, staff: null }).staff = {
      overall: ab.overall, dimensions: ab.dimensions ?? {}, levels: normalizeLevelBands(ab.levels ?? {}),
    };
  }
  return {
    takenAt: new Date().toISOString(), season, riders, abilities, teams, staffByTeam,
    load: Object.fromEntries([...load.byRider].map(([id, l]) => [id, { raceDays: l.raceDays, hardDays: l.hardDays }])),
  };
}

// ── Kortet (privat) ──────────────────────────────────────────────────────────────

function renderCard(snapshot, results, opts, date) {
  const L = [];
  const v = results.map((r) => r.variant);
  L.push(`# S25 · 10-sæsoners-simulering før tænding (${date}) · PRIVAT (hard rule 17)`);
  L.push("");
  L.push(`Øjebliksbillede: aktiv sæson ${snapshot.season.number}, taget ${snapshot.takenAt}. Simuleret: S${Number(snapshot.season.number) + 1} til S${Number(snapshot.season.number) + opts.seasons}, ${opts.raceDaysPerSeason} løbsdage pr. sæson (${opts.raceDaysPerDate} pr. dato). Assistenten styrer alle hold. Aldring = Udvikling 2.0 (#6499).`);
  L.push(`Varianter: ${v.join(" · ")}. B-normalisering (B@1): ${round(results.find((r) => r.variant.startsWith("B"))?.bNorm ?? NaN, 3) ?? "-"}. Løbsdags-andel uden måling (ung/ældre): ${results[0].raceShares.young} / ${results[0].raceShares.old}.`);
  for (const r of results.filter((x) => x.variant.startsWith("B") && x.params)) {
    L.push(`${r.variant}: dagsstøj ±${r.params.bNoiseSpan}, fast vækstfraktion fra alder ${r.params.bReferenceAge}.`);
  }
  L.push("");
  L.push("## Overblik");
  L.push("");
  L.push("| Variant | % ved 22 | % ved 25 | Topalder | Max-rating slut | P99 slut | Top 50 ≤ 23 år slut | Pensioneret i alt | Nye unge i alt |");
  L.push("|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    const m = r.milestones.alle ?? {};
    const end = r.seasons.at(-1);
    const sum = (k) => r.transitions.reduce((s, t) => s + (t[k] ?? 0), 0);
    L.push(`| ${r.variant} | ${m.pct22 ?? "-"} | ${m.pct25 ?? "-"} | ${m.peakAgeMedian ?? "-"} | ${end?.rating.max ?? "-"} | ${end?.rating.p99 ?? "-"} | ${end?.top50.le23 ?? "-"} | ${sum("retired")} | ${sum("inflow")} |`);
  }
  L.push("");
  L.push("## D1-milepæle (målene står i D-058, spec 2026-10-03-udvikling-2-design.md)");
  L.push("Median af rytterens rating ved alderen i % af hans observerede karrieretop. Kun ryttere hvis bane dækker 22 til mindst 27.");
  L.push("");
  L.push("| Variant | Gruppe | N | % ved 22 | % ved 25 | Topalder (median) | Top 27-28 (%) | Top ≤ 24 (%) | Top-rating (median) |");
  L.push("|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    for (const [g, m] of Object.entries(r.milestones).sort()) {
      L.push(`| ${r.variant} | ${g} | ${m.n} | ${m.pct22} | ${m.pct25} | ${m.peakAgeMedian} | ${m.peakAt27to28} | ${m.peakAtOrBefore24} | ${m.peakMedian} |`);
    }
  }
  L.push("");
  L.push("## Stort talent efter 9 sæsoner (pot ≥ 5,5, startede ≤ 19; jeppeks Discord-pejlemærke 2/10)");
  L.push("");
  L.push("| Variant | N | Median | P90 | Max | ≥ 90 |");
  L.push("|---|---|---|---|---|---|");
  for (const r of results) L.push(`| ${r.variant} | ${r.bigTalent.n} | ${r.bigTalent.median} | ${r.bigTalent.p90} | ${r.bigTalent.max} | ${r.bigTalent.ge90} |`);
  L.push("");
  L.push("## Ratingfordeling pr. sæson (ryttere på hold, bedste rolle)");
  L.push("");
  L.push("| Variant | Tidspunkt | N | Snit | SD | P10 | P50 | P90 | P99 | Max | ≥70 | ≥80 | ≥85 | ≥90 |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    for (const s of [r.start, ...r.seasons]) {
      const x = s.rating;
      L.push(`| ${r.variant} | ${s.label} | ${x.n} | ${x.mean} | ${x.sd} | ${x.p10} | ${x.p50} | ${x.p90} | ${x.p99} | ${x.max} | ${x.ge70} | ${x.ge80} | ${x.ge85} | ${x.ge90} |`);
    }
  }
  L.push("");
  L.push("## Top 50: alder");
  L.push("");
  L.push("| Variant | Tidspunkt | Median-alder | ≤ 23 år | ≥ 31 år | Rating nr. 50 |");
  L.push("|---|---|---|---|---|---|");
  for (const r of results) for (const s of [r.start, ...r.seasons]) L.push(`| ${r.variant} | ${s.label} | ${s.top50.medianAge} | ${s.top50.le23} | ${s.top50.ge31} | ${s.top50.cutoff} |`);
  L.push("");
  L.push("## Pension, nye unge og aldring pr. skifte");
  L.push("");
  L.push("| Variant | Til sæson | Pensioneret | Pensionsalder (median) | Nye unge | Aldrings-point i alt | Synligt ratingfald (ryttere) |");
  L.push("|---|---|---|---|---|---|---|");
  for (const r of results) for (const t of r.transitions) L.push(`| ${r.variant} | S${t.season} | ${t.retired} | ${median(t.retireAges)} | ${t.inflow} | ${t.agingPoints} | ${t.ratingDrops} |`);
  L.push("");
  L.push("## Talent-spredning: snit og P90 pr. potentiale-bånd");
  L.push("");
  L.push("| Variant | Tidspunkt | Bånd | N | Snit | P90 |");
  L.push("|---|---|---|---|---|---|");
  for (const r of results) for (const s of [r.start, r.seasons.at(4), r.seasons.at(-1)].filter(Boolean)) {
    for (const [b, m] of Object.entries(s.meanByPotential)) L.push(`| ${r.variant} | ${s.label} | ${b} | ${m.n} | ${m.mean} | ${m.p90} |`);
  }
  L.push("");
  L.push("## Store mod små hold: holdets top-8-snit pr. division, og top 100 fordelt på division");
  L.push("");
  L.push("| Variant | Tidspunkt | Top-8-snit pr. division (hold) | Top 100 pr. division |");
  L.push("|---|---|---|---|");
  for (const r of results) for (const s of [r.start, r.seasons.at(4), r.seasons.at(-1)].filter(Boolean)) {
    const d = Object.entries(s.divisionTop8).map(([k, m]) => `D${k}: ${m.mean} (${m.teams})`).join(" · ");
    const t = Object.entries(s.top100ByDivision).sort().map(([k, n]) => `D${k}: ${n}`).join(" · ");
    L.push(`| ${r.variant} | ${s.label} | ${d} | ${t} |`);
  }
  L.push("");
  L.push("## Maks +1 pr. dato (#7075): hvor tit binder det?");
  L.push("Uden loft: evne-point ud over +1 på samme dato (summeret over 10 sæsoner). Med loft: point skubbet til en senere dato.");
  L.push("");
  L.push("| Variant | Point over +1 pr. dato (uden loft) | Point skubbet af loftet |");
  L.push("|---|---|---|");
  for (const r of results) L.push(`| ${r.variant} | ${r.dateCap?.over ?? "-"} | ${r.dateCap?.clipped ?? "-"} |`);
  L.push("");
  L.push("## Nye unge (kom ind via generatoren) ved slut");
  L.push("");
  L.push("| Variant | N | Snit | P50 | P90 | Max |");
  L.push("|---|---|---|---|---|---|");
  for (const r of results) L.push(`| ${r.variant} | ${r.inflowEnd.n} | ${r.inflowEnd.mean} | ${r.inflowEnd.p50} | ${r.inflowEnd.p90} | ${r.inflowEnd.max} |`);
  L.push("");
  L.push("## Hvad simuleringen IKKE dækker");
  L.push("- Ingen løbsmotor: løbsdage er seedede ud fra målt andel; profil-mixet er ligeligt, ikke kalenderens.");
  L.push("- Form og træthed er neutrale (conditionMult 1); ingen skader; assistenten træner normal intensitet hver dag (0 hårde dage i aldrings-bremsen).");
  L.push("- Ingen transfers, kontrakter, akademi-gradueringer eller oprykning; trupperne holdes ved at hvert hold erstatter sine pensionister med generatorens unge.");
  L.push("- B er en proxy (byggetrin 7 er ikke bygget): ingen ny niveau-kurve (D1), ingen belastningsevne for de helt unge, ingen løbsdags-score (S14). Udskiftes når developmentScore findes.");
  L.push("- Det bløde loft pr. evne (byggetrin 14), fart pr. klasse (15) og træningskatalog v3 (16) er ikke med; lofterne er dagens buildCapsForRider.");
  L.push("- #7075-reglen er gengivet i scriptet (PR'en er ikke merget).");
  return L.join("\n") + "\n";
}

function parseArgs(argv) {
  const opts = { ...SIM_DEFAULTS };
  const get = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (get("--seasons")) opts.seasons = Number(get("--seasons"));
  if (get("--race-days")) opts.raceDaysPerSeason = Number(get("--race-days"));
  if (get("--b-scales")) opts.bScales = get("--b-scales").split(",").map(Number).filter(Number.isFinite);
  if (get("--variants")) opts.variants = get("--variants").split(",");
  if (get("--b-noise")) opts.bNoiseSpan = Number(get("--b-noise"));
  if (get("--b-ref-age")) opts.bReferenceAge = Number(get("--b-ref-age"));
  return { opts, snapshotPath: get("--snapshot"), outDir: get("--out-dir"), limitTeams: Number(get("--limit-teams")) || null };
}

/** Til hurtige prøvekørsler: kun de første N aktive hold (og deres ryttere). */
export function limitSnapshotTeams(snapshot, n) {
  const keep = new Set(snapshot.teams.filter((t) => !t.is_bank && !t.is_test_account).slice(0, n).map((t) => t.id));
  const riders = snapshot.riders.filter((r) => keep.has(r.team_id));
  const ids = new Set(riders.map((r) => r.id));
  return { ...snapshot, teams: snapshot.teams.filter((t) => keep.has(t.id)), riders, abilities: snapshot.abilities.filter((a) => ids.has(a.rider_id)) };
}

async function main() {
  const { opts, snapshotPath, outDir: outArg, limitTeams } = parseArgs(process.argv.slice(2));
  const date = new Date().toISOString().slice(0, 10);
  const outDir = outArg ? resolve(outArg) : join(REPO, "balance-internals", "6110", "s25");
  mkdirSync(outDir, { recursive: true });
  let snapshot;
  if (snapshotPath) {
    snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  } else {
    snapshot = await loadProdSnapshot();
    writeFileSync(join(outDir, `snapshot-${date}.json`), JSON.stringify(snapshot) + "\n");
    console.log(`[s25] øjebliksbillede gemt privat: ${join(outDir, `snapshot-${date}.json`)}`);
  }
  if (limitTeams) snapshot = limitSnapshotTeams(snapshot, limitTeams);
  // Hver variant gemmes for sig i runs-<dato>/, og kortet bygges af ALLE varianter
  // dér. Så kan varianterne køres i hver sin proces (ca. 8 min pr. stk.) og ende
  // på ét kort.
  const suffix = limitTeams ? `-hold${limitTeams}` : "";
  const runsDir = join(outDir, `runs-${date}${suffix}`);
  mkdirSync(runsDir, { recursive: true });
  for (const variant of process.argv.includes("--render-only") ? [] : variantList(opts)) {
    const t0 = Date.now();
    const result = runVariant(snapshot, variant, opts);
    writeFileSync(join(runsDir, `${variant.name}.json`), JSON.stringify(result, null, 2) + "\n");
    console.log(`[s25] ${variant.name} færdig (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
  // Kun kørsler på samme billede og samme sæson-parametre kommer på samme kort.
  const fingerprint = runFingerprint(snapshot, opts);
  const all = readdirSync(runsDir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(runsDir, f), "utf8")));
  const results = orderResults(all.filter((r) => r.fingerprint === fingerprint));
  const skipped = all.filter((r) => r.fingerprint !== fingerprint).map((r) => r.variant);
  if (skipped.length) console.warn(`[s25] springer varianter over fra et andet billede eller andre parametre: ${skipped.join(", ")}`);
  writeFileSync(join(outDir, `ten-season-sim-${date}${suffix}.md`), renderCard(snapshot, results, opts, date));
  writeFileSync(join(outDir, `ten-season-sim-${date}${suffix}.json`), JSON.stringify({ date, opts, results }, null, 2) + "\n");
  console.log(`[s25] privat kort (${results.length} varianter): ${join(outDir, `ten-season-sim-${date}${suffix}.md`)}`);
}

/**
 * Fingeraftryk for en kørsel: samme billede og samme sæson-parametre. B's egne
 * parametre (støj, referencealder) står pr. variant i `params` og på kortet.
 */
export function runFingerprint(snapshot, opts) {
  return [snapshot?.takenAt ?? "?", snapshot?.season?.number ?? "?", snapshot?.riders?.length ?? 0,
    opts.seasons, opts.raceDaysPerSeason, opts.raceDaysPerDate].join("|");
}

/** Fast rækkefølge på kortet: nu, nu_maks1, derefter B efter stigende skala. */
export function orderResults(results) {
  const rank = (name) => (name === "nu" ? -2 : name === "nu_maks1" ? -1 : Number(name.split("@")[1]) || 0);
  return [...results].sort((a, b) => rank(a.variant) - rank(b.variant));
}

const isMain = process.argv[1]
  && resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase();
if (isMain) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
