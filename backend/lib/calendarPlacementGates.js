// backend/lib/calendarPlacementGates.js
// #4270 (ejer-beslutninger 3/9): de tre PLACERINGS-regler der indtil nu kun var maalinger
// eller slet ikke fandtes. Alle tre doemmer paa den PLANLAGTE kalender, foer den skrives:
//
//   §1b  Kvote-opfyldelse: EKSAKT 100 % pr. division (#4270, lukker §11 punkt 4)
//   §4   Monument maa ikke ligge inde i et Grand Tours loebsdags-spaend (#4203)
//   §1   Mindste-overlap pr. division: en loebsdag skal have noget at vaelge imellem (#3329)
//
// REN FUNKTION: ingen DB, ingen fs, ingen vaegur-tid (hard rule 16). Alle taerskler kommer
// fra deres SSOT-moduler (calendarTierCaps.js, grandTourRestDays.js) - denne fil definerer
// INGEN egne tal.
//
// HVORFOR EN EGEN FIL OG IKKE I PAKKEREN: de tre regler maales paa den samme to-akse-form
// (raceRows + stageRows med baade `scheduled_at` og `game_day`) som scorecardet i forvejen
// har, og de skal kunne koeres BEGGE steder - i CI mod en fixture og i
// buildSeasonCalendar.js's dry-run mod prods katalog - uden at traekke pakkerens tilstand
// med. Samme begrundelse som calendarScorecardReport.js's egen ekstraktion.
//
// AKSE-ADVARSEL (CALENDAR_RULES.md §0, den hyppigste fejlkilde i dette domaene): monument-
// gaten maaler paa LOEBSDAGS-aksen (`game_day`), fordi det er den akse der binder rytteren.
// Monument-SPREDNINGEN maales fortsat i kalenderdage (§11 punkt 5 = B, ejer 3/9) og hoerer
// ikke til her. De to maa aldrig blandes sammen.

import { TIER_OVERLAP_CAP, TIER_OVERLAP_MIN, TIER_MULTI_RACE_DAY_MIN_SHARE } from "./calendarTierCaps.js";
import { GRAND_TOUR_MIN_STAGES } from "./grandTourRestDays.js";

/** Loebsdags-spaend pr. loeb: pool_race_id -> {first, last, stages}. */
export function gameDaySpansByRace(stageRows = []) {
  const spans = new Map();
  for (const s of stageRows) {
    const id = s.pool_race_id ?? s.race_id;
    const gd = Number(s.game_day);
    if (id == null || !Number.isFinite(gd)) continue;
    const cur = spans.get(id);
    if (!cur) spans.set(id, { first: gd, last: gd, stages: 1 });
    else {
      if (gd < cur.first) cur.first = gd;
      if (gd > cur.last) cur.last = gd;
      cur.stages += 1;
    }
  }
  return spans;
}

/**
 * §4/#4203: et monument maa ikke ligge INDE i et Grand Tours loebsdags-spaend.
 *
 * Hvorfor reglen findes: en Grand Tour binder rytteren hele sit spaend (#4217's
 * spaend-binding, CALENDAR_RULES.md §2b), inklusive hviledagene. Ligger et monument inde i
 * det spaend, kan ingen af de hold der koerer GT'en stille deres bedste rytter op i
 * saesonens stoerste endagsloeb - monumentet bliver et B-loeb uden at nogen har besluttet
 * det. Maalt i S3 laa 4 af 5 monumenter inde i et GT-vindue, og GT'erne fyldte 70 % af D1's
 * saeson.
 *
 * MAALT PAA `game_day`, ikke paa datoer: en kalenderdag i D1 baerer 3-5 loebsdage, saa to
 * loeb kan dele dato uden at dele loebsdag. Datoerne ville baade give falske positiver og
 * misse aegte overlap.
 *
 * @param {{tier:number, raceRows:Array, stageRows:Array, minGrandTourStages?:number}} args
 * @returns {string[]} violation-strings (samme moenster som detectCoverageViolations)
 */
export function detectMonumentsInsideGrandTours({
  tier, raceRows = [], stageRows = [], minGrandTourStages = GRAND_TOUR_MIN_STAGES,
} = {}) {
  const spans = gameDaySpansByRace(stageRows);
  const violations = [];

  const grandTours = raceRows.filter((r) => {
    const span = spans.get(r.pool_race_id);
    const stages = Number(r.stages) || span?.stages || 1;
    return r.race_type === "stage_race" && stages >= minGrandTourStages && span;
  });
  if (!grandTours.length) return violations;

  const monuments = raceRows.filter((r) => r.race_class === "Monuments" && spans.get(r.pool_race_id));

  for (const m of monuments) {
    const mSpan = spans.get(m.pool_race_id);
    for (const gt of grandTours) {
      const g = spans.get(gt.pool_race_id);
      // Monumentet er ET loebsdags-punkt (1 etape), men vi maaler alligevel paa spaend-
      // overlap: et monument med flere etaper findes ikke i dag, og en regel der kun
      // virker paa 1-etapers loeb ville gaa tavst i stykker hvis det aendrede sig.
      if (mSpan.first <= g.last && mSpan.last >= g.first) {
        violations.push(
          `tier ${tier}: monument "${m.name ?? m.pool_race_id}" ligger på løbsdag ${mSpan.first}${mSpan.first === mSpan.last ? "" : `-${mSpan.last}`} inde i «${gt.name ?? gt.pool_race_id}»s Grand Tour-spænd (løbsdag ${g.first}-${g.last}) — GT-rytterne er bundet og kan ikke stille op (#4203)`,
        );
      }
    }
  }
  return violations;
}

/**
 * §1/#3329: overlap pr. loebsdag - baade bunden og toppen.
 *
 * TIER_OVERLAP_CAP har vogtet toppen siden 28/6. Bunden har aldrig vaeret maalt: i S2 havde
 * D1 6 af 28 loebsdage med kun ET loeb, altsaa dage hvor manageren ikke havde noget at
 * vaelge imellem. Et loft uden et gulv er en halv regel.
 *
 * @returns {{minOverlap:number|null, maxOverlap:number, gameDays:number, histogram:object,
 *   lowDays:number[]}}
 */
export function computeGameDayOverlap({ stageRows = [], overlapMin = null, multiRaceMin = 2 } = {}) {
  const racesByGameDay = new Map();
  for (const s of stageRows) {
    const gd = Number(s.game_day);
    const id = s.pool_race_id ?? s.race_id;
    if (!Number.isFinite(gd) || id == null) continue;
    if (!racesByGameDay.has(gd)) racesByGameDay.set(gd, new Set());
    racesByGameDay.get(gd).add(id);
  }

  const histogram = {};
  let minOverlap = null, maxOverlap = 0, multiRaceDays = 0;
  const lowDays = [];
  for (const [gd, set] of racesByGameDay) {
    const n = set.size;
    histogram[n] = (histogram[n] || 0) + 1;
    if (n > maxOverlap) maxOverlap = n;
    if (minOverlap == null || n < minOverlap) minOverlap = n;
    if (n >= multiRaceMin) multiRaceDays += 1;
    if (overlapMin != null && n < overlapMin) lowDays.push(gd);
  }
  lowDays.sort((a, b) => a - b);
  const gameDays = racesByGameDay.size;
  return {
    minOverlap, maxOverlap, gameDays, histogram, lowDays,
    multiRaceDays, multiRaceShare: gameDays ? multiRaceDays / gameDays : 0,
  };
}

/**
 * §1/#3329: fejl hvis en division har loebsdage under sit mindste-overlap.
 * `overlapMin[tier] == null` = ingen bund sat for den division (ikke "groen").
 */
export function detectMinOverlapViolations({
  tier, overlap, overlapMin = TIER_OVERLAP_MIN, multiRaceShareMin = TIER_MULTI_RACE_DAY_MIN_SHARE,
  maxListed = 8,
} = {}) {
  if (!overlap) return [];
  const violations = [];

  const min = overlapMin?.[tier];
  const low = overlap.lowDays ?? [];
  if (min != null && low.length) {
    const vist = low.slice(0, maxListed).join(", ");
    violations.push(
      `tier ${tier}: ${low.length} løbsdag(e) med færre end ${min} samtidige løb (løbsdag ${vist}${low.length > maxListed ? ", …" : ""}) (#3329)`,
    );
  }

  const shareMin = multiRaceShareMin?.[tier];
  if (shareMin != null && (overlap.multiRaceShare ?? 0) < shareMin) {
    violations.push(
      `tier ${tier}: kun ${(100 * (overlap.multiRaceShare ?? 0)).toFixed(1)} % af løbsdagene har mindst 2 samtidige løb (${overlap.multiRaceDays}/${overlap.gameDays}), gulv ${(100 * shareMin).toFixed(0)} % — manageren har for få dage med noget at vælge imellem (#3329)`,
    );
  }
  return violations;
}

/**
 * §1b/#4270: kvoten skal rammes EKSAKT.
 *
 * EJER-BESLUTNING 3/9, som lukker CALENDAR_RULES.md §11 punkt 4: "eksakt 100 % pr. division
 * er et haardt krav (hverken 99 eller 101)". Kvoten er density x loebsdatoer og er dermed
 * praecis det antal loebsdage divisionens tidsplan HAR - leverer en division faerre, staar
 * der tomme slots; leverer den flere, er tae­theden broedt. Et interval ville vaere en
 * indroemmelse af at vi ikke ved hvad tallet skal vaere. Vi ved det.
 */
export function detectQuotaViolations({ tier, quota, totalGameDays } = {}) {
  if (quota == null || totalGameDays == null) return [];
  if (Number(totalGameDays) === Number(quota)) return [];
  const diff = Number(totalGameDays) - Number(quota);
  return [
    `tier ${tier}: kvote-opfyldelse ${totalGameDays} af ${quota} løbsdage (${diff > 0 ? "+" : ""}${diff}) — §1b kræver EKSAKT 100 % (#4270)`,
  ];
}

export { TIER_OVERLAP_CAP, TIER_OVERLAP_MIN, TIER_MULTI_RACE_DAY_MIN_SHARE };
