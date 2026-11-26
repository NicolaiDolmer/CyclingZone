// backend/lib/calendarPlacementGates.js
// #4270 (ejer-beslutninger 3/9): de tre PLACERINGS-regler der indtil nu kun var maalinger
// eller slet ikke fandtes. Alle tre doemmer paa den PLANLAGTE kalender, foer den skrives:
//
//   §1b  Kvote-opfyldelse: EKSAKT 100 % pr. division (#4270, lukker §11 punkt 4)
//   §4   Monument maa ikke ligge inde i et Grand Tours loebsdags-spaend (#4203)
//   §1   Mindste-overlap pr. division: en loebsdag skal have noget at vaelge imellem (#3329)
//   §3   (tilfoejet 26/9, #5802) Grand Tours starter i rigtig raekkefoelge: Giro -> Tour -> Vuelta
//   §3   (tilfoejet 26/9, #5802) ingen Grand Tour starter paa saesonens foerste dag
//
// REN FUNKTION: ingen DB, ingen fs, ingen vaegur-tid (hard rule 16). Alle taerskler kommer
// fra deres SSOT-moduler (calendarTierCaps.js, grandTourRestDays.js, og for GT-startens
// tidligste dato raceCalendarLanePacker.js ved siden af de andre GT-lofter) - denne fil
// definerer INGEN egne tal.
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
import { GRAND_TOUR_EARLIEST_START_DATE_INDEX } from "./raceCalendarLanePacker.js";

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
 * @param {{tier?:number, raceRows?:Array<any>, stageRows?:Array<any>, minGrandTourStages?:number}} [args]
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
 * §3/#5802: Grand Tours skal STARTE i deres rigtige kalenderraekkefoelge (Giro -> Tour ->
 * Vuelta), ejer 26/9.
 *
 * Hvorfor reglen findes: S4-toerkoerslen 26/9 lagde GT'erne som Tour -> Giro -> Vuelta,
 * fordi pakkeren valgte den laengste GT foerst. Ingen gate maalte raekkefoelgen, saa den
 * ville vaere blevet skrevet. Pakkeren holder nu reglen som binding (R14); denne gate er
 * dommen, der stopper --apply hvis en fremtidig aendring braekker den igen.
 *
 * "Rigtig raekkefoelge" er GT'ernes VIRKELIGE startdato fra kataloget (race_pool.date_text,
 * baaret som `seasonFraction` i planens `chronologyRaces`) - ingen haardkodede navne, saa
 * reglen virker for ethvert katalog. En GT uden kendt virkelig dato kan ikke doemmes og
 * springes over; er der faerre end to doembare GT'er, er der intet at maale.
 *
 * Maalt paa `game_day` (loebsdags-aksen), samme akse som monument-gaten ovenfor. Overlap
 * mellem en GT og et andet etapeloeb er TILLADT (ejer 26/9) og maales ikke her.
 *
 * @param {{tier?:number, raceRows?:Array<any>, stageRows?:Array<any>,
 *   realOrderByPoolRace?:Map<string,number>, minGrandTourStages?:number}} [args]
 *   realOrderByPoolRace: pool_race_id -> virkelig raekkefoelge-noegle (seasonFraction)
 * @returns {string[]} violation-strings
 */
export function detectGrandTourOrderViolations({
  tier, raceRows = [], stageRows = [], realOrderByPoolRace = new Map(),
  minGrandTourStages = GRAND_TOUR_MIN_STAGES,
} = {}) {
  const order = listGrandTourStarts({ raceRows, stageRows, realOrderByPoolRace, minGrandTourStages })
    .filter((gt) => gt.realOrder != null);
  if (order.length < 2) return [];

  // Kun en STRENG ombytning er et brud: to GT'er med samme virkelige noegle (samme dato) har
  // ingen rigtig indbyrdes raekkefoelge, saa gaten tager ikke stilling til dem. Ellers ville
  // en tie-breaker her (id) kunne doemme en placering som pakkerens R14 (anden tie-breaker)
  // lovligt valgte - fanget af CodeRabbit 26/9.
  if (order.every((gt, i) => i === 0 || Number(order[i - 1].realOrder) <= Number(gt.realOrder))) return [];
  const planlagt = order.map((gt) => gt.name).join(" → ");
  const rigtig = [...order]
    .sort((a, b) => Number(a.realOrder) - Number(b.realOrder) || String(a.id).localeCompare(String(b.id)))
    .map((gt) => gt.name).join(" → ");
  return [
    `tier ${tier}: Grand Tours starter i rækkefølgen ${planlagt}, men den rigtige kalenderrækkefølge er ${rigtig} (#5802)`,
  ];
}

/** Hele kalenderdage fra `fra` til `til` ("YYYY-MM-DD"), eller null hvis en af dem mangler. */
function calendarDaysBetween(fra, til) {
  const parse = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? ""));
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  };
  const a = parse(fra), b = parse(til);
  return a == null || b == null ? null : Math.round((b - a) / 86400000);
}

/**
 * §3/#5802 (ejer 26/9 kl. 22:40): en Grand Tour maa ALDRIG starte paa saesonens foerste
 * kalenderdato - og tidligst paa dato-indeks GRAND_TOUR_EARLIEST_START_DATE_INDEX (0 = dag 1).
 *
 * Hvorfor reglen findes: S3 aabnede med en GT paa dag 1, og spillerne klagede (sweep 20/8).
 * S4-toerkoerslen 26/9 gjorde det samme igen (Giroen paa foerste dag), fordi ingen regel
 * forbød det. Pakkeren holder nu reglen som binding (R15); denne gate er dommen, der stopper
 * --apply hvis en fremtidig aendring braekker den igen.
 *
 * Maalt i KALENDERDAGE (ikke loebsdage): klagen handler om hvornaar i rigtig tid saesonen
 * aabner med en GT. GT'ens foerste dato kommer fra `listGrandTourStarts` (tidligste
 * `scheduled_at` blandt dens etaper). En GT uden dato kan ikke doemmes og springes over;
 * mangler saesonens foerste dag, er der intet at maale op imod.
 *
 * @param {{tier?:number, grandTourStarts?:Array<any>, seasonFirstDay?:string|null,
 *   earliestStartDateIndex?:number}} [args]
 * @returns {string[]} violation-strings
 */
export function detectGrandTourEarlyStartViolations({
  tier, grandTourStarts = [], seasonFirstDay = null,
  earliestStartDateIndex = GRAND_TOUR_EARLIEST_START_DATE_INDEX,
} = {}) {
  if (!seasonFirstDay) return [];
  const brud = [];
  for (const gt of grandTourStarts) {
    const idx = calendarDaysBetween(seasonFirstDay, gt.firstDate);
    if (idx == null || idx >= earliestStartDateIndex) continue;
    brud.push(
      `tier ${tier}: ${gt.name} starter ${gt.firstDate} (dag ${idx + 1} i sæsonen) — en Grand Tour må tidligst starte på dag ${earliestStartDateIndex + 1} (#5802)`,
    );
  }
  return brud;
}

/**
 * GT'erne i en division i START-raekkefoelge (loebsdags-aksen), med foerste kalenderdato og
 * virkelig raekkefoelge-noegle. Bruges af gaten ovenfor og af dry-runnets GT-linje, saa
 * ejeren ser raekkefoelgen med navne og datoer.
 *
 * @returns {Array<{id:string, name:string, firstGameDay:number, firstDate:string|null,
 *   realOrder:number|null}>}
 * @param {{raceRows?:Array<any>, stageRows?:Array<any>, realOrderByPoolRace?:Map<string,number>, minGrandTourStages?:number}} [args]
 */
export function listGrandTourStarts({
  raceRows = [], stageRows = [], realOrderByPoolRace = new Map(),
  minGrandTourStages = GRAND_TOUR_MIN_STAGES,
} = {}) {
  const spans = gameDaySpansByRace(stageRows);
  const firstDate = new Map();
  for (const s of stageRows) {
    const id = s.pool_race_id ?? s.race_id;
    const d = s.scheduled_at == null ? null : String(s.scheduled_at).slice(0, 10);
    if (id == null || d == null) continue;
    if (!firstDate.has(id) || d < firstDate.get(id)) firstDate.set(id, d);
  }
  return raceRows
    .filter((r) => {
      const span = spans.get(r.pool_race_id);
      const stages = Number(r.stages) || span?.stages || 1;
      return r.race_type === "stage_race" && stages >= minGrandTourStages && span;
    })
    .map((r) => {
      const ro = realOrderByPoolRace.get(r.pool_race_id);
      return {
        id: r.pool_race_id,
        name: r.name ?? r.pool_race_id,
        firstGameDay: spans.get(r.pool_race_id).first,
        firstDate: firstDate.get(r.pool_race_id) ?? null,
        realOrder: typeof ro === "number" && Number.isFinite(ro) ? ro : null,
      };
    })
    .sort((a, b) => a.firstGameDay - b.firstGameDay || String(a.id).localeCompare(String(b.id)));
}

/**
 * §1/#3329: overlap pr. loebsdag - baade bunden og toppen.
 *
 * TIER_OVERLAP_CAP har vogtet toppen siden 28/6. Bunden har aldrig vaeret maalt: i S2 havde
 * D1 6 af 28 loebsdage med kun ET loeb, altsaa dage hvor manageren ikke havde noget at
 * vaelge imellem. Et loft uden et gulv er en halv regel.
 *
 * @returns {{minOverlap:number|null, maxOverlap:number, gameDays:number, histogram:object,
 *   lowDays:number[], multiRaceDays:number, multiRaceShare:number}}
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
 * `overlapMin[tier] == null` = ingen bund sat for den division (ikke "groen").
 * @param {{tier?:any, overlap?:any, overlapMin?:any, multiRaceShareMin?:any, maxListed?:number}} [args]
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
 * @param {{tier?:number, quota?:number|null, totalGameDays?:number|null}} [args]
 */
export function detectQuotaViolations({ tier, quota, totalGameDays } = {}) {
  if (quota == null || totalGameDays == null) return [];
  if (Number(totalGameDays) === Number(quota)) return [];
  const diff = Number(totalGameDays) - Number(quota);
  return [
    `tier ${tier}: kvote-opfyldelse ${totalGameDays} af ${quota} løbsdage (${diff > 0 ? "+" : ""}${diff}) — §1b kræver EKSAKT 100 % (#4270)`,
  ];
}

/**
 * #5841 (ejerbeslutninger 26/11): S6-placeringsreglerne doemt paa den PLANLAGTE kalender.
 * Pakkeren holder dem som bindinger (R18-R22 i raceCalendarLanePacker.js); denne gate er
 * dommen, der stopper --apply hvis pakkeren maatte falde tilbage til en kalender uden dem.
 *
 * `rules` er calendarPlacementRulesForSeason(saeson, tier). null = kalenderen er bygget
 * efter de gamle regler (foer S6), og der er intet at doemme (samme disciplin som §1d).
 *
 * Reglerne og deres akse (CALENDAR_RULES.md §0 - de maa aldrig blandes):
 *   §4 monument-afstand og -spredning   KALENDERDAGE (scheduled_at)
 *   §4 virkelig monument-raekkefoelge    loebsdags-aksen (game_day)
 *   §4 monumenter efter sidste GT        loebsdags-aksen
 *   §2 saesonen slutter med endagsloeb   sidste loebsdag med loeb
 *   §3 etapeloeb vs. GT-start            loebsdags-aksen
 *   §1 overlap-baand                     loebsdage med loeb (computeGameDayOverlap)
 *
 * @param {{tier?:number, rules?:any, raceRows?:Array<any>, stageRows?:Array<any>,
 *   realOrderByPoolRace?:Map<string,number>, minGrandTourStages?:number}} [args]
 * @returns {string[]} violation-strings
 */
export function detectSeasonPlacementRuleViolations({
  tier, rules = null, raceRows = [], stageRows = [], realOrderByPoolRace = new Map(),
  minGrandTourStages = GRAND_TOUR_MIN_STAGES,
} = {}) {
  if (!rules) return [];
  const brud = [];
  const spans = gameDaySpansByRace(stageRows);
  const foersteDato = new Map();
  for (const s of stageRows) {
    const id = s.pool_race_id ?? s.race_id;
    const d = s.scheduled_at == null ? null : String(s.scheduled_at).slice(0, 10);
    if (id == null || d == null) continue;
    if (!foersteDato.has(id) || d < foersteDato.get(id)) foersteDato.set(id, d);
  }
  const navn = (r) => r.name ?? r.pool_race_id;
  const ro = (id) => {
    const v = realOrderByPoolRace.get(id);
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  // Kun kaldt paa loeb der allerede er filtreret til en kendt raekkefoelge.
  const roN = (id) => /** @type {number} */ (ro(id));
  const erGt = (r) => {
    const span = spans.get(r.pool_race_id);
    const stages = Number(r.stages) || span?.stages || 1;
    return r.race_type === "stage_race" && stages >= minGrandTourStages && Boolean(span);
  };
  const gts = raceRows.filter(erGt);

  // §4: monumenterne i kalender-raekkefoelge (loebsdags-aksen).
  const mons = raceRows
    .filter((r) => r.race_class === "Monuments" && spans.get(r.pool_race_id))
    .sort((a, b) => spans.get(a.pool_race_id).first - spans.get(b.pool_race_id).first);
  for (let i = 1; i < mons.length; i++) {
    const gap = calendarDaysBetween(foersteDato.get(mons[i - 1].pool_race_id), foersteDato.get(mons[i].pool_race_id));
    if (gap != null && gap < rules.monumentMinGapDays) {
      brud.push(`tier ${tier}: monumenterne «${navn(mons[i - 1])}» og «${navn(mons[i])}» ligger ${gap} kalenderdag(e) fra hinanden, mindst ${rules.monumentMinGapDays} (§4/#5841)`);
    }
  }
  if (mons.length >= 2) {
    const spread = calendarDaysBetween(foersteDato.get(mons[0].pool_race_id), foersteDato.get(mons[mons.length - 1].pool_race_id));
    if (spread != null && spread < rules.monumentMinSpreadDays) {
      brud.push(`tier ${tier}: der er ${spread} kalenderdage fra første til sidste monument, mindst ${rules.monumentMinSpreadDays} (§4/#5841)`);
    }
  }
  const doembare = mons.filter((m) => ro(m.pool_race_id) != null);
  if (!doembare.every((m, i) => i === 0 || roN(doembare[i - 1].pool_race_id) <= roN(m.pool_race_id))) {
    brud.push(`tier ${tier}: monumenterne ligger i rækkefølgen ${doembare.map(navn).join(" → ")}, ikke i deres virkelige rækkefølge (§4/#5841)`);
  }
  if (rules.lastMonumentAfterGrandTours && gts.length && gts.every((g) => ro(g.pool_race_id) != null)) {
    const sidsteGtRo = Math.max(...gts.map((g) => roN(g.pool_race_id)));
    const sidsteGtSlut = Math.max(...gts.map((g) => spans.get(g.pool_race_id).last));
    for (const m of doembare) {
      if (roN(m.pool_race_id) > sidsteGtRo && spans.get(m.pool_race_id).first <= sidsteGtSlut) {
        brud.push(`tier ${tier}: monumentet «${navn(m)}» ligger i virkeligheden efter den sidste Grand Tour, men ligger før den er slut i kalenderen (løbsdag ${spans.get(m.pool_race_id).first}, sidste GT slutter ${sidsteGtSlut}) (§4/#5841)`);
      }
    }
  }

  // §2: saesonens sidste loebsdag med loeb baerer kun endagsloeb.
  if (rules.seasonEndsWithOneDayRace && stageRows.length) {
    const typeAf = new Map(raceRows.map((r) => [r.pool_race_id, r]));
    const sidste = Math.max(...stageRows.map((s) => Number(s.game_day)).filter(Number.isFinite));
    const paaSidste = [...new Set(stageRows.filter((s) => Number(s.game_day) === sidste).map((s) => s.pool_race_id ?? s.race_id))];
    const etapeloeb = paaSidste.map((id) => typeAf.get(id)).filter((r) => r && r.race_type !== "single");
    if (etapeloeb.length) {
      brud.push(`tier ${tier}: sæsonens sidste løbsdag (${sidste}) har etapeløbet ${etapeloeb.map(navn).join(", ")}; sæsonen skal slutte med endagsløb (§2/#5841)`);
    }
  }

  // §3: et andet etapeloeb der overlapper en GT, slutter senest paa GT'ens foerste loebsdag.
  if (rules.stageRaceEndsByGrandTourStart && gts.length) {
    const gtIds = new Set(gts.map((g) => g.pool_race_id));
    for (const r of raceRows) {
      if (r.race_type === "single" || gtIds.has(r.pool_race_id)) continue;
      const s = spans.get(r.pool_race_id);
      if (!s) continue;
      for (const g of gts) {
        const gs = spans.get(g.pool_race_id);
        if (s.first <= gs.last && s.last >= gs.first && s.last > gs.first) {
          brud.push(`tier ${tier}: etapeløbet «${navn(r)}» (løbsdag ${s.first}-${s.last}) overlapper «${navn(g)}» (løbsdag ${gs.first}-${gs.last}) og slutter efter GT'ens start (§3/#5841)`);
        }
      }
    }
  }

  // §1: overlap-baandet - gulv OG loft.
  const band = rules.multiRaceShareBand;
  if (band) {
    const o = computeGameDayOverlap(/** @type {any} */ ({ stageRows }));
    const share = o.multiRaceShare ?? 0;
    if (o.gameDays && (share < band.min - 1e-9 || share > band.max + 1e-9)) {
      brud.push(`tier ${tier}: ${(100 * share).toFixed(1)} % af løbsdagene har 2+ samtidige løb (${o.multiRaceDays}/${o.gameDays}), skal ligge i ${(100 * band.min).toFixed(0)}-${(100 * band.max).toFixed(0)} % (§1/#5841)`);
    }
  }
  return brud;
}

export { TIER_OVERLAP_CAP, TIER_OVERLAP_MIN, TIER_MULTI_RACE_DAY_MIN_SHARE };
