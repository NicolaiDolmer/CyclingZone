// backend/lib/tierCalendarMaterializer.js
// Kalender-rebuild (2026-06-27, prestige/spredning-spec + ejer-billede): bind den rene pipeline
// sammen til en MATERIALISERINGS-PLAN pr. division (tier) og fan-out den IDENTISKE kalender til
// hver LIVE pulje ("Division 3 kører samme løb, parallelt i sine 4 puljer").
//
// Form (ejer-låst): hver division fylder en PRÆCIS game-day-kvote (140/112/84/56) med DE STØRSTE
// løb (prestige), pakket så HVER IRL-dag rammer præcis density (5/4/3/2) stage-events: Grand Tours
// komprimeret som spredt rygrad MED overlap, klassikere fylder op. Hver etape kører i sin banes
// faste tids-slot (div 3 = 12/15/18). Monumenter binding-fri (game_day i højt bånd).
//
// buildTierMaterializationPlan er REN (ingen DB) → testbar. materializeTierCalendars = I/O-wrapper.

import { poolHasCalendar } from "./divisionCalendarGenerator.js";
import { selectTierRaceSet, TIER_GAME_DAY_QUOTA, GRAND_TOUR_MIN_STAGES, TIER_CLASS_WHITELIST } from "./tierRaceSelection.js";
import { packLaneCalendar, reshapeCobblesFractionToTwoWindows } from "./raceCalendarLanePacker.js";
import { buildScheduleRows } from "./raceCalendarScheduling.js";
import { generateRaceStageProfiles, toStageProfileRow } from "./raceStageProfileGenerator.js";
import { applyUniformTierTilt } from "./tierUniformFillerTilt.js";
import { resolveTierDraw } from "./raceRouteRealismDraw.js";
import { fetchAllRows } from "./supabasePagination.js";
import {
  TIER_ONE_DAY_SHARE_TARGET, TIER_ONE_DAY_SHARE_MIN, CLASS_STAGE_LENGTH_BAND,
  SCARCE_TERRAIN_ARCHETYPES, TIER_TERRAIN_FAMILY_MIN, TIER_MOUNTAIN_FREE_STAGE_RACE_MIN,
  TIER_ARCHETYPE_RESERVATIONS,
  computeTierCoverageStats, detectCoverageViolations,
} from "./tierCalendarGuarantees.js";
import { computeCompositionStats } from "./calendarCompositionTargets.js";
import { computeStageOrderStats } from "./stageOrderMetrics.js";
import { computeSeasonSpan, parseRaceDateText, seasonFraction } from "./seasonPhaseProfiles.js";
import { grandTourRestDayCount } from "./grandTourRestDays.js";
import { recomputeSeasonRaceDays } from "./seasonRaceDays.js";
import { captureException } from "./sentry.js";
import { loadSingleActiveSeason } from "./activeSeasonLookup.js";

export { TIER_CLASS_WHITELIST };

const INSERT_BATCH = 500;

// #4161: TIER_DENSITY + TIER_OVERLAP_CAP bor nu i calendarTierCaps.js, saa verifikations-
// siden kan laese dem uden materializerens DB-/Sentry-afhaengigheder. Re-eksporteres her,
// saa alle eksisterende importstier (regenSeason3Calendar, repair-scripts, scorecards)
// virker uaendret. Vaerdierne er ejer-laaste - aendr dem i calendarTierCaps.js.
// (import + re-export, ikke ren re-export: konstanterne bruges ogsaa lokalt herunder.)
import { TIER_DENSITY, TIER_OVERLAP_CAP } from "./calendarTierCaps.js";
export { TIER_DENSITY, TIER_OVERLAP_CAP };

// Etape-tids-slots pr. division: bane k → slots[k] (ejer-låst: div 3 = 12/15/18). Antal slots =
// density, så en dag aldrig har flere etaper end slots.
// #4270 (ejer-beslutning 3/9): D4 2 -> 3 slots, samme klokkeslaet som D3 (12/15/18).
// Antal slots skal FOELGE TIER_DENSITY - en dag maa aldrig have flere etaper end slots.
export const TIER_STAGE_SLOTS = Object.freeze({
  1: ["11:00", "13:00", "15:00", "17:00", "19:00"],
  2: ["12:00", "14:00", "16:00", "18:00"],
  3: ["12:00", "15:00", "18:00"],
  4: ["12:00", "15:00", "18:00"],
});

function isRealManagerRow(t) {
  return t.is_ai === false && !t.is_bank && !t.is_frozen && !t.is_test_account;
}
function editionYearFrom(startDate) {
  if (!startDate) return null;
  const y = Number.parseInt(String(startDate).slice(0, 4), 10);
  return Number.isFinite(y) && y >= 2000 && y <= 2099 ? y : null;
}

// #3327/#3328: generér etape-profiler (REN, ingen DB — samme funktion prod-inserten
// bruger) for ét udvalg af raceRows, KUN til dækningsverifikation. Kaldes for én
// repræsentativ pulje pr. tier (alle puljer i en tier deler identisk kalender, #2276),
// i BÅDE dry-run og apply, så dry-run-rapporten viser de tal apply ville håndhæve.
// #3347: seedRace-formen for én planlagt løbsrække — ÉT sted, så dæknings-verifikationen,
// realisme-re-drawet og selve insert'et beviseligt seeder ens.
function seedRaceFor(r, { externalIdByPoolRace, archetypeByPoolRace, seasonId, seasonVariant = 0 }) {
  return {
    id: r.pool_race_id, name: r.name, race_type: r.race_type, stages: r.stages,
    external_id: externalIdByPoolRace.get(r.pool_race_id) ?? null,
    terrain_archetype: archetypeByPoolRace.get(r.pool_race_id) ?? null,
    // #4104: race_class SKAL med. Uden den prissaetter daeknings-verifikationen
    // monumenterne paa terraen-baandet, mens skrive-stien bruger klasse-baandet -
    // altsaa verificerer man andre ruter end dem der persisteres.
    race_class: r.race_class ?? null,
    season_id: seasonId, season_variant: seasonVariant,
  };
}

// ctx.archetypeProfiles (#4103, opt-in): tier-tiltet ARCHETYPE_PROFILES-tabel, hvis
// materializeTierCalendars({ useUniformTierTilt: true }) er slået til for dette kald —
// ellers undefined, og generateRaceStageProfiles falder tilbage til sin egen default
// (bit-identisk med før #4103).
function coverageProfilesFor(raceRows, ctx) {
  const map = new Map();
  for (const r of raceRows) map.set(r.pool_race_id, generateRaceStageProfiles(seedRaceFor(r, ctx), { archetypeProfiles: ctx.archetypeProfiles }));
  return map;
}

// #3295/#3326/#3371: form de allerede-genererede profiler som den {race_type,
// terrain_archetype, stages}-liste måle-lagene tager. Genbruger PRÆCIS de profiler
// dæknings-verifikationen (og dermed insert'et) bruger — så kompositions- og
// rækkefølgetallene i dry-run-rapporten beskriver det parcours der ville blive skrevet,
// ikke et nyt træk.
function measurableRacesFrom(raceRows, profilesByPoolRaceId, archetypeByPoolRace) {
  return raceRows.map((r) => ({
    name: r.name,
    race_type: r.race_type,
    terrain_archetype: archetypeByPoolRace.get(r.pool_race_id) ?? null,
    stages: profilesByPoolRaceId.get(r.pool_race_id) ?? [],
  }));
}

// #2251 kalender-invarianter (defense-in-depth oven på selectTierRaceSet's GT-gate):
// (1) GT'er (≥ minStages etaper) må ALDRIG optræde i tier > 1 — spec'ens GT-rygrad hører
//     til Division 1 (to samtidige 21-etapers GT'er i tier 4 kollapsede lav-divisionernes
//     startfelter 5-10/7).
// (2) GT-rygraden må ikke overlappe sig selv (spec: "GT'er lægges spredt og IKKE
//     overlappende hinanden") — målt på game-day-spans.
// Ren + deterministisk; materializeTierCalendars nægter at APPLY'e en tier med brud.
export function detectCalendarViolations({
  tier, placements = [], minStages = GRAND_TOUR_MIN_STAGES,
  catalogById = new Map(), classWhitelist = TIER_CLASS_WHITELIST, usedRaceNamesBeforeTier = new Set(),
} = {}) {
  const violations = [];
  const gtSpans = placements
    .filter((pl) => (pl.stages ?? 1) >= minStages && pl.stagesPlaced?.length)
    .map((pl) => ({
      id: pl.id,
      start: Math.min(...pl.stagesPlaced.map((s) => s.game_day)),
      end: Math.max(...pl.stagesPlaced.map((s) => s.game_day)),
    }));
  if (tier > 1 && gtSpans.length) {
    violations.push(`tier ${tier}: ${gtSpans.length} grand tour(s) in plan — grand tours are only allowed in tier 1 (#2251)`);
  }
  for (let i = 0; i < gtSpans.length; i++) {
    for (let j = i + 1; j < gtSpans.length; j++) {
      const a = gtSpans[i], b = gtSpans[j];
      if (a.start <= b.end && b.start <= a.end) {
        violations.push(`tier ${tier}: grand tour overlap ${a.id} (gd ${a.start}-${a.end}) x ${b.id} (gd ${b.start}-${b.end})`);
      }
    }
  }

  // #2276 invariant 1: klasse-whitelist pr. tier (kaskade) — tier 2+ må ALDRIG få
  // Monuments/GrandTour/OtherWorldTourA, kun de næste klasser nedad.
  const allowed = classWhitelist?.[tier];
  if (Array.isArray(allowed)) {
    const allowedSet = new Set(allowed);
    for (const pl of placements) {
      const cat = catalogById.get(pl.id) || {};
      const raceClass = cat.race_class ?? pl.race_class ?? null;
      if (raceClass != null && !allowedSet.has(raceClass)) {
        violations.push(`tier ${tier}: race ${pl.id} (${cat.name ?? "?"}) has class "${raceClass}" outside whitelist [${allowed.join(", ")}] (#2276)`);
      }
    }
  }

  // #2276 invariant 2: cross-tier dedup — samme løbsnavn må ikke optræde i to tiers i
  // samme sæson. usedRaceNamesBeforeTier = navne allerede brugt af HØJERE tiers i samme plan.
  for (const pl of placements) {
    const cat = catalogById.get(pl.id) || {};
    const name = cat.name ?? pl.name ?? null;
    if (name != null && usedRaceNamesBeforeTier.has(name)) {
      violations.push(`tier ${tier}: race name "${name}" (${pl.id}) already used in a higher tier this season (#2276 cross-tier dedup)`);
    }
  }

  // #4075 invariant 4: within-tier dedup — samme løbsnavn må heller ikke optræde to gange
  // i SAMME tier. Rod-årsag 20/8: kataloget indeholdt både gamle og nye versioner af de 3
  // GT'er (external_id ændrede sig ved seed uden --prune), og selektionen valgte begge —
  // alle 3 GT'er lå dobbelt i D1's live S3-kalender.
  const namesSeenInTier = new Map();
  for (const pl of placements) {
    const cat = catalogById.get(pl.id) || {};
    const name = cat.name ?? pl.name ?? null;
    if (name == null) continue;
    if (namesSeenInTier.has(name)) {
      violations.push(`tier ${tier}: race name "${name}" selected twice in the same tier (${namesSeenInTier.get(name)} + ${pl.id}) (#4075 within-tier dedup)`);
    } else {
      namesSeenInTier.set(name, pl.id);
    }
  }

  // #4075/#4176 invariant 6: et MONUMENT har sin egen, EKSKLUSIVE løbsdag (ejer-låst 21/8)
  // — ingen modløb på samme game_day, så alle ryttere kan stille op. Kalender-DATOEN deles
  // fortsat: de øvrige løb ligger i datoens andre tidsslots. Pakkeren bygger reglen ind
  // (layoutStream, B2), men indtil nu var det kun pakkerens egen hensigt: #4161-akse-
  // reparationen udledte game_day af datoerne alene og klappede D1's fem monumenter sammen
  // med naboløbene i live S3. Reglen gates nu på alle tre niveauer (CI, denne preflight,
  // verify-invariants mod prod).
  // #4236 (ejer-beslutning 25/8): monument-eksklusiviteten er OPHAEVET, og gaten er derfor
  // fjernet her. Reglen sagde at et monument ejer sin loebsdag alene, saa alle ryttere kunne
  // stille op. Den holdt op med at levere da #4217 gjorde bindingen spaend-baseret 24 timer
  // foer: rytteren er bundet hele etapeloebets spaend, ogsaa henover monumentets loebsdag.
  // Maalt mod prod: 0 delte ryttere i alle 9 monument/etapeloeb-kombinationer - gevinsten
  // var vaek. Prisen blev betalt alligevel: det eksklusive indskud rev hul i loebsdagene hos
  // fem D1-etapeloeb og var eneste aarsag til at kronologi-reglen var brudt.
  //
  // Det der stadig gaelder for monumenter - at de ligger spredt over saesonen - maales i
  // raceCalendarLanePackerInvariants.test.js. Se CALENDAR_RULES.md §4.

  // #4075 invariant 5: GT-klasser SKAL bære grand_tour-arketypen — ellers genereres deres
  // etapeprofiler som almindelige etapeløb (ingen åbnings-ITT, ingen GT-finale-regel).
  // Rod-årsag 20/8: race_pool_archetypes.json pegede på de GAMLE external_ids, så de nye
  // korte GT-rækker stod med terrain_archetype=NULL i prod.
  for (const pl of placements) {
    const cat = catalogById.get(pl.id) || {};
    const raceClass = cat.race_class ?? pl.race_class ?? null;
    if ((raceClass === "TourFrance" || raceClass === "GiroVuelta") && cat.terrain_archetype !== "grand_tour") {
      violations.push(`tier ${tier}: race ${pl.id} (${cat.name ?? "?"}) has class "${raceClass}" but terrain_archetype "${cat.terrain_archetype ?? "NULL"}" — grand tours must carry the grand_tour archetype (#4075)`);
    }
  }

  return violations;
}

// #2276 invariant 3: alle puljer i en division skal få IDENTISK kalender (navn, game_day,
// stages)-signatur. Ren assertion-helper — kastes af buildTierMaterializationPlan hvis en
// tier-plans puljer nogensinde afviger (defense-in-depth: poolPlans deles i dag fra samme
// `packed.placements`, så dette bør altid holde — regressions-fanger).
export function detectPoolSignatureMismatch({ tier, pools = [] } = {}) {
  if (pools.length < 2) return [];
  const signatureOf = (pool) => pool.raceRows
    .map((r) => `${r.pool_race_id}:${r.name}:${r.game_day_start}:${r.stages}`)
    .sort()
    .join("|");
  const base = signatureOf(pools[0]);
  const violations = [];
  for (const pool of pools.slice(1)) {
    if (signatureOf(pool) !== base) {
      violations.push(`tier ${tier}: pool ${pool.leagueDivisionId} calendar signature diverges from pool ${pools[0].leagueDivisionId} (#2276 identical-pools invariant)`);
    }
  }
  return violations;
}

/**
 * @param {{ pools, catalog, from?, realDays?, quotas?, density?, slots?, baseSeed? }} args
 * @returns {{ tierPlans: Array<object> }}
 */
export function buildTierMaterializationPlan({
  pools = [],
  catalog = [],
  from = new Date(),
  realDays = 28,
  quotas = TIER_GAME_DAY_QUOTA,
  density = TIER_DENSITY,
  overlapCaps = TIER_OVERLAP_CAP,
  slots = TIER_STAGE_SLOTS,
  baseSeed = 1,
  forceTiers = [],
  classWhitelist = TIER_CLASS_WHITELIST,
  // #3327/#3328 (2026-08-04): data-drevne dækningsmål — se tierCalendarGuarantees.js.
  // Sendes videre til selectTierRaceSet, som selv falder tilbage til FØR-#3327-adfærd
  // hvis en tier's oneDayShareTarget er null/undefined eller classStageLengthBand=null —
  // bagudkompatibelt for kald der eksplicit overstyrer dem (fx ældre test-fixtures).
  oneDayShareTargets = TIER_ONE_DAY_SHARE_TARGET,
  classStageLengthBand = CLASS_STAGE_LENGTH_BAND,
  priorityArchetypes = SCARCE_TERRAIN_ARCHETYPES,
  archetypeReservations = TIER_ARCHETYPE_RESERVATIONS,
  // #2276: navne allerede brugt af ANDRE tiers før dette kald (fx allerede-materialiserede
  // races i DB for tier 1-3, når tier 4 aktiveres i et separat reconcile-kald der ikke ser
  // de andre tiers' selection i hukommelsen). Seedes af materializeTierCalendars.
  usedRaceNames = new Set(),
} = {}) {
  const catalogById = new Map(catalog.map((c) => [c.id, c]));
  const forced = new Set(forceTiers);

  // #3469: sæson-spændet beregnes ÉN GANG af det FULDE katalog (før tier-filtrering/dedup),
  // så seasonFraction-normaliseringen er ens på tværs af tiers (jf. computeSeasonSpan-
  // kontrakten i seasonPhaseProfiles.js). Løb uden parsebar date_text får fraction=null —
  // packLaneCalendar falder tilbage til sin fraction-frie algoritme for enhver liste der
  // indeholder ét eller flere sådanne løb (bit-identisk med før #3469).
  const seasonSpan = computeSeasonSpan(catalog);
  const seasonFractionOf = (raceId) => {
    const cat = catalogById.get(raceId);
    const parsed = cat ? parseRaceDateText(cat.date_text) : null;
    return parsed ? seasonFraction(parsed.startDoy, seasonSpan) : null;
  };
  const withSeasonFraction = (races) => races.map((r) => ({ ...r, seasonFraction: seasonFractionOf(r.id) }));

  // #3470: hviledags-antal pr. GT (≥15 etaper), udledt af SAMME date_text-kilde som
  // seasonFraction. 0 for alt der ikke er en GT eller mangler date_text — harmløst felt
  // på ikke-GT'er, og packLaneCalendar bruger det KUN i STREAM's fase-ankrede GT-gren
  // (bit-identisk uden). Rører ALDRIG hvilke løb der er valgt (kun rækkefølge/placering).
  const grandTourRestDaysOf = (raceId) => {
    const cat = catalogById.get(raceId);
    return cat ? grandTourRestDayCount({ dateText: cat.date_text, stages: cat.stages }) : 0;
  };
  const withGrandTourRestDays = (races) => races.map((r) => ({ ...r, restDays: grandTourRestDaysOf(r.id) }));

  const liveByTier = new Map();
  for (const p of pools) {
    if (!poolHasCalendar(p.tier, p.realManagerCount) && !forced.has(p.tier)) continue;
    if (!liveByTier.has(p.tier)) liveByTier.set(p.tier, []);
    liveByTier.get(p.tier).push(p);
  }

  // #3469 (ejer-fund 8/8, klasse-bevidst — runde 6): forudberegn, pr. arketype, den
  // SORTEREDE liste af tiers der reserverer den (want > 0) — bruges nedenfor til (a) at
  // afgøre om DENNE tier er den SIDSTE til at reservere en given arketype (intet
  // nedstrøms at beskytte, fri walk) og (b) hvilke KLASSER der skal beskyttes for den
  // (kun klasser en senere reserverende tier faktisk kan vælge fra — se
  // selectTierRaceSet's downstreamProtectedArchetypes-docstring for rod-årsagen: D2
  // sultede D4's cobbled_tour; en første, klasse-BLIND udgave af fixet ville have beskåret
  // D1/D2's egen OWTB/OWTC/Monuments-brosten for at beskytte D3's urelaterede
  // ProSeries/Class1-forsyning).
  const reservationTiersByArchetype = new Map();
  for (const [tierKey, cfg] of Object.entries(archetypeReservations ?? {})) {
    const t = Number(tierKey);
    if (!Number.isFinite(t)) continue;
    for (const [arch, want] of Object.entries(cfg ?? {})) {
      if (Math.max(0, Number(want) || 0) <= 0) continue;
      if (!reservationTiersByArchetype.has(arch)) reservationTiersByArchetype.set(arch, []);
      reservationTiersByArchetype.get(arch).push(t);
    }
  }
  for (const arr of reservationTiersByArchetype.values()) arr.sort((a, b) => a - b);

  // Cross-tier dedup: øverste tier vælger først (de største løb), lavere fra resten.
  // usedRaceIds/usedRaceNamesRunning seedes med input (fx allerede-materialiserede tiers i DB)
  // så et enkelt-tier-kald (reconcilePoolCalendarOnActivation) ikke kan gense en navn/id der
  // allerede kører i en anden tier den samme sæson (#2276).
  const usedRaceIds = new Set();
  const usedRaceNamesRunning = new Set(usedRaceNames);
  const tierPlans = [];
  for (const [tier, tierPools] of [...liveByTier.entries()].sort((a, b) => a[0] - b[0])) {
    let availableCatalog = usedRaceIds.size ? catalog.filter((c) => !usedRaceIds.has(c.id)) : catalog;
    if (usedRaceNamesRunning.size) {
      availableCatalog = availableCatalog.filter((c) => !usedRaceNamesRunning.has(c.name));
    }
    const quota = quotas[tier] ?? 0;
    const dens = density[tier] ?? 1;
    const cap = overlapCaps[tier] ?? 2;
    const tierSlots = slots[tier] ?? slots[3];
    const usedRaceNamesBeforeTier = new Set(usedRaceNamesRunning);

    // #2251: GT'er (≥15 etaper) er KUN tilladt i tier 1 (spec'ens GT-rygrad).
    // #2276: klasse-whitelist pr. tier (Monuments/GrandTour/OtherWorldTourA kun tier 1).
    // #3327: oneDayShareTarget styrer endagsløb/etapeløb-mixet mod tierens data-mål.
    // #3328: classStageLengthBand ekskluderer etapeløb uden for klassens etapeantal-bånd.
    // priorityArchetypes giver knappe specialist-arketyper (brosten/ITT/mountain-free)
    // forrang ved uafgjort prestige+størrelse.
    // #3469 (klasse-bevidst udgave, ejer-fund runde 6): arketyper hvor en SENERE tier
    // (højere tier-nummer) reserverer dem — kun DISSE må ikke dobbelt-dyppes af DENNE
    // tiers almindelige walk ud over hvad SENERE tier(s) selv skal bruge. VIGTIGT: dette
    // gælder UANSET om denne tier selv har en reservation for arketypen (rettet 8/8, runde
    // 6 — v1's `tiersList.includes(tier)`-guard fejlede stille for D3's cobbled_classic:
    // KUN tier 3 reserverer den, så tier 1/2 (som slet ikke selv reserverer den) fik ALDRIG
    // en beskyttelses-post og forblev fuldstændig ubegrænsede). PR. ARKETYPE begrænses
    // beskyttelsen til klasserne de(n) SENERE tier(s) reelt kan vælge fra (unionen af
    // deres class-whitelists) — ikke arketypen som helhed. Rod-årsag for klasse-skelnen:
    // uden den ville D1/D2's EGEN brostens-komposition (OWTB/OWTC/Monuments — klasser D3
    // slet ikke kan vælge fra) blive beskåret for at beskytte D3's ProSeries/Class1-
    // forsyning, som D1/D2 aldrig rørte ved i første omgang.
    const downstreamProtectedArchetypes = {};
    for (const [arch, tiersList] of reservationTiersByArchetype.entries()) {
      const laterTiers = tiersList.filter((t) => t > tier);
      if (!laterTiers.length) continue; // ingen SENERE tier reserverer denne arketype — intet at beskytte
      let unionClasses = new Set();
      let unrestricted = false;
      for (const t2 of laterTiers) {
        const wl = classWhitelist?.[t2];
        if (!Array.isArray(wl)) { unrestricted = true; break; } // en senere klasse-ubegrænset tier → beskyt alle klasser
        for (const c of wl) unionClasses.add(c);
      }
      downstreamProtectedArchetypes[arch] = unrestricted ? null : [...unionClasses];
    }

    const sel = selectTierRaceSet({
      catalog: availableCatalog, quota, seed: (baseSeed ^ tier) >>> 0,
      allowGrandTours: tier === 1, allowedClasses: classWhitelist?.[tier] ?? null,
      classStageLengthBand, oneDayShareTarget: oneDayShareTargets?.[tier] ?? null, priorityArchetypes,
      archetypeReservations: archetypeReservations?.[tier] ?? null,
      downstreamProtectedArchetypes,
    });
    for (const r of sel.stageRaces) { usedRaceIds.add(r.id); if (r.name != null) usedRaceNamesRunning.add(r.name); }
    for (const r of sel.oneDayRaces) { usedRaceIds.add(r.id); if (r.name != null) usedRaceNamesRunning.add(r.name); }

    // #3469/#3470: berig FØRST NU (umiddelbart før packing) — usedRaceIds/usedRaceNamesRunning
    // ovenfor arbejder stadig på de urørte sel.*-arrays, selectionen selv rører #3469/#3470 aldrig.
    // restDays er kun meningsfuld på stageRaces (kun etapeløb kan være GT'er), men beriges
    // harmløst med 0 på oneDayRaces også for et ensartet enrich-mønster.
    const enrichedStageRaces = withGrandTourRestDays(withSeasonFraction(sel.stageRaces));
    // #3546 F: brostens-endagsløbenes (cobbled_classic) fraction omformes til to vinduer
    // (tidligt + sent i sæsonen) i stedet for deres rå, monotont-faldende date_text-
    // fordeling: se reshapeCobblesFractionToTwoWindows' docstring. isCobbles kigger op i
    // catalogById (denne funktions egen scope), så den rene shaping-funktion i
    // raceCalendarLanePacker.js forbliver katalog-uafhængig.
    const isCobbledClassic = (r) => catalogById.get(r.id)?.terrain_archetype === "cobbled_classic";
    const enrichedOneDayRaces = reshapeCobblesFractionToTwoWindows(withSeasonFraction(sel.oneDayRaces), isCobbledClassic);
    const packed = packLaneCalendar({
      stageRaces: enrichedStageRaces, oneDayRaces: enrichedOneDayRaces,
      density: dens, days: realDays, overlapCap: cap, spineMinStages: GRAND_TOUR_MIN_STAGES,
    });
    const { raceUpdates, stageRows } = buildScheduleRows({ placements: packed.placements, from, slots: tierSlots });

    const scheduledForById = new Map(raceUpdates.map((u) => [u.id, u.scheduled_for]));
    // game_day_start = løbets første IRL-dag (real_day), IKKE binding-nøglen (game_day).
    const gameDayStartById = new Map();
    for (const pl of packed.placements) gameDayStartById.set(pl.id, Math.min(...pl.stagesPlaced.map((s) => s.real_day)));

    // #3469: fractionByRaceId + chronologyRaces — REN rapporterings-data til
    // calendarCompositionScorecard.js' "Kronologi"-sektion (fase-tabel + klumpning).
    // Rører aldrig apply-stien; billigt at beregne (samme størrelsesorden som packed.load).
    const fractionByRaceId = new Map([...enrichedStageRaces, ...enrichedOneDayRaces].map((r) => [r.id, r.seasonFraction]));
    const chronologyRaces = packed.placements.map((pl) => {
      const cat = catalogById.get(pl.id) || {};
      return {
        id: pl.id,
        race_class: cat.race_class ?? pl.race_class ?? null,
        terrain_archetype: cat.terrain_archetype ?? null,
        stages: pl.stages,
        game_day_start: gameDayStartById.get(pl.id),
        real_day_end: Math.max(...pl.stagesPlaced.map((s) => s.real_day)), // #3472 v3: til GT-real-day-spredning i rapportering
        seasonFraction: fractionByRaceId.get(pl.id) ?? null,
      };
    });

    const poolPlans = tierPools.slice().sort((a, b) => a.id - b.id).map((pool) => {
      const raceRows = packed.placements.map((pl) => {
        const cat = catalogById.get(pl.id) || {};
        return {
          pool_race_id: pl.id,
          name: cat.name ?? null,
          race_class: cat.race_class ?? pl.race_class ?? null,
          race_type: cat.race_type ?? (pl.type === "single" ? "single" : "stage_race"),
          stages: pl.stages,
          game_day_start: gameDayStartById.get(pl.id),
          scheduled_for: scheduledForById.get(pl.id) ?? null,
        };
      });
      const poolStageRows = stageRows.map((s) => ({ pool_race_id: s.race_id, stage_number: s.stage_number, scheduled_at: s.scheduled_at, game_day: s.game_day }));
      return { leagueDivisionId: pool.id, tier, raceRows, stageRows: poolStageRows };
    });

    const calendarViolations = [
      ...detectCalendarViolations({ tier, placements: packed.placements, catalogById, classWhitelist, usedRaceNamesBeforeTier }),
      ...detectPoolSignatureMismatch({ tier, pools: poolPlans }),
    ];

    tierPlans.push({
      tier, quota, density: dens, realDays, overlapCap: cap, calendarViolations,
      totalGameDays: sel.totalGameDays, quotaHit: sel.quotaHit, shortfall: sel.shortfall,
      raceCount: packed.placements.length,
      load: packed.load, emptyDays: packed.emptyDays, underfilledDays: packed.underfilledDays,
      overlapDays: packed.overlapDays, maxOverlap: packed.maxOverlap,
      overlapHistogram: packed.overlapHistogram, timelineLength: packed.timelineLength,
      straddleGameDays: packed.straddleGameDays,
      gtRealDaySeparationViolations: packed.gtRealDaySeparationViolations ?? [], // #3472 v3
      // #3546 C: dage uden afgørelse: forward fra packLaneCalendar's diagnostik, samme
      // "rapportér, gater ikke her"-princip som de øvrige dry-run-tal ovenfor.
      daysWithoutDecision: packed.daysWithoutDecision ?? [],
      daysWithoutDecisionCount: packed.daysWithoutDecisionCount ?? 0,
      unplacedStages: packed.unplaced.length, unplacedSingles: packed.leftoverSingles.length,
      chronologyRaces, // #3469: se docstring ved fractionByRaceId ovenfor.
      grandTourRestDays: packed.grandTourRestDays, // #3470: dry-run-diagnostik, se packLaneCalendar's docstring.
      pools: poolPlans,
    });
  }

  return { tierPlans };
}

/**
 * I/O-wrapper: byg planen mod live data og (apply) skriv den pr. pulje. dryRun=true → ingen writes.
 * Kræver at season-løb er ryddet først for en ren rebuild.
 */
export async function materializeTierCalendars({
  supabase, seasonId, seasonStartDate = null, from = new Date(),
  baseSeed = 1, tiers = null, forceTiers = [], dryRun = true, log = () => {},
  // realDays + quotas definerer VINDUET (from..from+realDays) og kvoten pr. tier
  // (design-default: 140/112/84/56 = TIER_DENSITY × 28 dage). #2276 rest-af-sæson-reparation
  // (ejer-beslutning 10/7) overstyrer BEGGE eksplicit for ét tier (fx tier 4: tæthed 3,
  // forkortet vindue) — se repair2276Div4Cascade.js. density overstyrer KUN når eksplicit
  // angivet; default TIER_DENSITY bruges ellers uændret (design-tæthederne må ikke røres).
  realDays = 28, quotas = TIER_GAME_DAY_QUOTA, density = TIER_DENSITY,
  // #3327/#3328 pass-through til buildTierMaterializationPlan + dækningsverifikationen.
  // Defaults = de skarpe produktions-garantier. Tests af FØR-#3327-mekanik (GT-gate,
  // overlap-cap, kronologi, dedup) med små syntetiske katalog-fixtures kan sende tomme
  // objekter for eksplicit at opt-out'e — se LEGACY_MIX i tierCalendarMaterializer.test.js.
  oneDayShareTargets = TIER_ONE_DAY_SHARE_TARGET,
  classStageLengthBand = CLASS_STAGE_LENGTH_BAND,
  priorityArchetypes = SCARCE_TERRAIN_ARCHETYPES,
  archetypeReservations = TIER_ARCHETYPE_RESERVATIONS,
  oneDayShareMin = TIER_ONE_DAY_SHARE_MIN,
  terrainFamilyMin = TIER_TERRAIN_FAMILY_MIN,
  mountainFreeMin = TIER_MOUNTAIN_FREE_STAGE_RACE_MIN,
  // #3295: hypotetiske race_pool-rækker lagt oven på det rigtige katalog. KUN dry-run —
  // se gaten nedenfor. Bruges af katalog-udvidelses-analysen til at måle effekten af
  // foreslåede løb før nogen af dem eksisterer.
  extraCatalogRows = [],
  // #4103 (ejer-beslutning 31/8): slå §6b's pr.-tier filler-tilt til (se
  // tierUniformFillerTilt.js). Default FRA — S3 er allerede materialiseret og må ikke
  // røres; en fremtidig S4-generering skal eksplicit sætte den til true. Sand betyder
  // at HVER tiers stage-profiler genereres med den tier-specifikke tiltede
  // ARCHETYPE_PROFILES-tabel i stedet for den globale default, i BÅDE
  // dæknings-verifikationen og selve skrive-stien (samme parcours måles og persisteres).
  useUniformTierTilt = false,
} = {}) {
  const editionYear = editionYearFrom(seasonStartDate);

  const { data: divisions, error: dErr } = await supabase.from("league_divisions").select("id, tier, pool_index, label");
  if (dErr) throw new Error(`league_divisions: ${dErr.message}`);
  // #2962: helt ufiltreret teams-select (369 rækker 25/7, samme #2951-klasse) —
  // pagineret via fetchAllRows; .order("id") som stabilt tiebreak.
  let teams;
  try {
    teams = await fetchAllRows(() => (
      supabase
        .from("teams")
        .select("league_division_id, is_ai, is_bank, is_frozen, is_test_account")
        .order("id", { ascending: true })
    ));
  } catch (tErr) {
    throw new Error(`teams: ${tErr.message}`, { cause: tErr });
  }
  const realByDiv = new Map();
  for (const t of teams || []) if (isRealManagerRow(t) && t.league_division_id != null) realByDiv.set(t.league_division_id, (realByDiv.get(t.league_division_id) || 0) + 1);
  const pools = (divisions || []).map((d) => ({ id: d.id, tier: d.tier, label: d.label, realManagerCount: realByDiv.get(d.id) || 0 }));

  // #3469: date_text tilføjet — race_pool's VIRKELIGE dato, kilden til seasonFraction
  // (se buildTierMaterializationPlan). READ-ONLY overalt: external_id = sha256(name|date_text)
  // er parcours-identitet, mutation ville ændre alle parcours (racePoolImport.js).
  // #4075: pensionerede katalog-rækker (retired_at sat af seedRacePool --prune, når en
  // række er ude af CSV'en men stadig FK-refereret af historiske sæsoners races) må
  // ALDRIG kunne vælges til nye kalendere — det var rod-årsagen til dublet-GT'erne i S3.
  const { data: dbCatalog, error: cErr } = await supabase.from("race_pool").select("id, external_id, terrain_archetype, name, race_class, race_type, stages, date_text").is("retired_at", null);
  if (cErr) throw new Error(`race_pool: ${cErr.message}`);
  // #3295: HYPOTETISKE katalog-rækker til "hvad nu hvis vi tilføjede disse løb?"-analyse
  // (scripts/proposeCatalogExpansion.js). De findes ikke i race_pool, så de kan aldrig
  // materialiseres — apply afvises højlydt hvis nogen prøver. Analyse-stien kører altid
  // dryRun, og gaten her er defense-in-depth mod en fremtidig kalder der glemmer det.
  if (extraCatalogRows.length && !dryRun) {
    throw new Error("extraCatalogRows er KUN til dry-run-analyse — de findes ikke i race_pool og kan ikke materialiseres");
  }
  const catalog = extraCatalogRows.length ? [...(dbCatalog || []), ...extraCatalogRows] : dbCatalog;
  // Seed-nøgle pr. katalog-løb: external_id binder parcours til løbets VIRKELIGE
  // identitet (identisk parcours i en divisions puljer); terrain_archetype driver
  // terrænfordelingen (jf. raceStageProfileGenerator.js).
  const externalIdByPoolRace = new Map((catalog || []).map((c) => [c.id, c.external_id ?? null]));
  const archetypeByPoolRace = new Map((catalog || []).map((c) => [c.id, c.terrain_archetype ?? null]));
  // #4104: race_class laeses fra KATALOGET, ikke fra races-insertets .select(). Foerste
  // forsoeg hentede den fra den indsatte raekke - men selectet paa linjen nedenfor tager
  // kun (id, pool_race_id, name, race_type, stages) med, saa race_class var undefined og
  // monument-baandet faldt tavst tilbage til terraen-baandet. Praecis #3620-fejlklassen:
  // "kolonnen blev ikke selectet" forvekslet med "kolonnen er NULL". Katalog-opslaget er
  // immunt over for at nogen aendrer selectet senere.
  const raceClassByPoolRace = new Map((catalog || []).map((c) => [c.id, c.race_class ?? null]));

  const { data: existing, error: exErr } = await supabase.from("races").select("league_division_id, pool_race_id, name").eq("season_id", seasonId);
  if (exErr) throw new Error(`races (existing): ${exErr.message}`);
  const existingKey = new Set((existing || []).map((r) => `${r.league_division_id}:${r.pool_race_id}`));

  // #2276: navne allerede materialiseret i ANDRE tiers denne sæson — sikrer cross-tier
  // dedup selv når kun ÉN tier materialiseres i dette kald (reconcilePoolCalendarOnActivation
  // aktiverer typisk kun én pulje/tier ad gangen, uden de andre tiers' selection i hukommelsen).
  const tierByDivisionId = new Map(pools.map((p) => [p.id, p.tier]));
  const targetTiers = new Set(tiers && tiers.length ? tiers : pools.map((p) => p.tier));
  const usedRaceNames = new Set(
    (existing || [])
      .filter((r) => r.name != null && !targetTiers.has(tierByDivisionId.get(r.league_division_id)))
      .map((r) => r.name)
  );

  // Planlæg KUN mål-tiers: ikke-mål-tiers må ikke re-selektere i hukommelsen — deres egne
  // navne er dedup-blokeret (usedRaceNames), så de ville kannibalisere kataloget med NYE valg
  // og efterlade mål-tier'en med 0 løb (#2276-genkørsel: tier 4 fik selected=0 fordi tier 3's
  // in-memory-genvalg åd alle ledige Class1). Cross-tier-dedup er allerede dækket af
  // usedRaceNames-seedingen fra DB ovenfor.
  const plannedPools = tiers && tiers.length ? pools.filter((p) => targetTiers.has(p.tier)) : pools;
  const { tierPlans } = buildTierMaterializationPlan({
    pools: plannedPools, catalog: catalog || [], from, baseSeed, forceTiers, realDays, quotas, density, usedRaceNames,
    oneDayShareTargets, classStageLengthBand, priorityArchetypes, archetypeReservations,
  });
  const summary = { dryRun, editionYear, racesInserted: 0, stageProfiles: 0, stageSchedules: 0, tiers: [] };

  for (const tierPlan of tierPlans) {
    if (tiers && !tiers.includes(tierPlan.tier)) continue;

    // #4103: ÉN gang pr. tier, genbrugt af BÅDE dæknings-verifikationen og skrive-stien
    // nedenfor — undefined (default-adfærd) medmindre useUniformTierTilt er slået til.
    const archetypeProfilesForTier = useUniformTierTilt ? applyUniformTierTilt({ tier: tierPlan.tier }) : undefined;

    // #3327/#3328: dækningsverifikation EFTER selection/packing men FØR apply-gaten —
    // beregnet fra ÉN repræsentativ pulje (identisk kalender pr. tier, #2276). Fejl her
    // slutter sig til calendarViolations, så de rammer SAMME "nægt apply"-gate som
    // #2251/#2276-invarianterne nedenfor — ingen stille underdækning.
    const repPool = tierPlan.pools[0];
    // #3347: løs tierens realisme-re-draw FØR dæknings-verifikationen, så dækningstal,
    // gate-scorecard og de rækker der faktisk INSERTES alle beskriver det SAMME parcours.
    // attempt 0 (det kanoniske træk) er det normale svar og er bit-identisk med før #3347.
    let seasonVariant = 0;
    if (repPool) {
      const seedRaces = repPool.raceRows.map((r) => seedRaceFor(r, { externalIdByPoolRace, archetypeByPoolRace, seasonId }));
      const draw = resolveTierDraw({ tier: tierPlan.tier, seedRaces });
      seasonVariant = draw.attempt;
      tierPlan.realismDraw = { attempt: draw.attempt, exhausted: draw.exhausted, firstDrawFailures: draw.firstDrawFailures };
      if (draw.attempt > 0) log(`  tier ${tierPlan.tier}: kanonisk parcours-træk brød realisme-båndene (${draw.firstDrawFailures.join(" · ")}) → deterministisk gen-træk ${draw.attempt} (#3347)`);
      if (draw.exhausted) log(`  ⚠ tier ${tierPlan.tier}: alle ${draw.attemptsTried} gen-træk brød realisme-båndene — bruger det kanoniske træk; realisme-scorecardet vil melde NO-GO (#3347)`);

      const profiles = coverageProfilesFor(repPool.raceRows, { externalIdByPoolRace, archetypeByPoolRace, seasonId, seasonVariant, archetypeProfiles: archetypeProfilesForTier });
      const coverageStats = computeTierCoverageStats({ raceRows: repPool.raceRows, profilesByPoolRaceId: profiles, classStageLengthBand });
      const coverageViolations = detectCoverageViolations({
        tier: tierPlan.tier, stats: coverageStats, oneDayShareMin, terrainFamilyMin, mountainFreeMin,
      });
      tierPlan.coverageStats = coverageStats;
      tierPlan.calendarViolations = [...(tierPlan.calendarViolations ?? []), ...coverageViolations];

      // #3295 (K-B-komposition) + #3326/#3371 (rækkefølge + arketype-variation):
      // RAPPORTERES, gater IKKE. Kalibreringen mod K-B er ikke i mål endnu (målt
      // baseline 6/8: flad +3,3 pp, bjerg +4,9 pp), så en hård gate her ville blokere
      // S3-materialiseringen på et krav vi bevidst er på vej mod. Tallene skal derimod
      // være synlige i HVER dry-run, så scorecardet og apply-stien aldrig kan komme til
      // at måle hver sit parcours. Gaten strammes når kalibreringen lander (#3295).
      const measurable = measurableRacesFrom(repPool.raceRows, profiles, archetypeByPoolRace);
      tierPlan.compositionStats = computeCompositionStats(measurable);
      tierPlan.stageOrderStats = computeStageOrderStats(measurable);

      // #3295: den repræsentative puljes seedRaces, så en kalibrering kan køre mod den
      // PLANLAGTE sæsons løbssæt frem for en tidligere sæsons. De to er ikke ens —
      // selectTierRaceSet vælger forfra hver sæson (prestige-sortering + cross-tier-dedup),
      // så vægte kalibreret mod S2's udvalg overfitter til netop det udvalg. Kun i dry-run:
      // apply-stien har ingen brug for det, og summary'en skal ikke bære unødig vægt.
      if (dryRun) {
        tierPlan.seedRaces = repPool.raceRows.map((r) => seedRaceFor(r, { externalIdByPoolRace, archetypeByPoolRace, seasonId, seasonVariant }));
        // #4270: de PRÆCIS samme profiler dæknings-verifikationen (og dermed insert'et)
        // bruger — så kalender-scorecardet i buildSeasonCalendar.js's dry-run måler det
        // parcours der ville blive skrevet, med tilt og re-draw indregnet, og ikke et nyt
        // træk. Kun dry-run: apply-stien har ingen brug for dem.
        tierPlan.profilesByPoolRaceId = profiles;
      }
    }

    // #2251: nægt at APPLY'e en plan med kalender-invariant-brud (GT i tier >1 /
    // GT-rygrad-overlap / #3327-#3328-dækningsbrud). dryRun må gerne rapportere planen,
    // så bruddene kan inspiceres.
    if (!dryRun && tierPlan.calendarViolations?.length) {
      throw new Error(`calendar invariant violated (apply refused): ${tierPlan.calendarViolations.join(" · ")}`);
    }
    const tLine = {
      tier: tierPlan.tier, quota: tierPlan.quota, density: tierPlan.density, realDays: tierPlan.realDays, totalGameDays: tierPlan.totalGameDays, quotaHit: tierPlan.quotaHit,
      shortfall: tierPlan.shortfall, emptyDays: tierPlan.emptyDays, overlapDays: tierPlan.overlapDays,
      unplacedStages: tierPlan.unplacedStages, unplacedSingles: tierPlan.unplacedSingles,
      calendarViolations: tierPlan.calendarViolations ?? [], coverageStats: tierPlan.coverageStats ?? null,
      compositionStats: tierPlan.compositionStats ?? null, stageOrderStats: tierPlan.stageOrderStats ?? null,
      seedRaces: tierPlan.seedRaces ?? null,
      realismDraw: tierPlan.realismDraw ?? null,
      chronologyRaces: tierPlan.chronologyRaces ?? null, // #3469: dry-run-rapportering (Kronologi-sektionen)
      grandTourRestDays: tierPlan.grandTourRestDays ?? [], // #3470: dry-run-rapportering (hviledage + fillere)
      pools: [],
    };
    for (const poolPlan of tierPlan.pools) {
      const fresh = poolPlan.raceRows.filter((r) => !existingKey.has(`${poolPlan.leagueDivisionId}:${r.pool_race_id}`));
      const pLine = { pool_id: poolPlan.leagueDivisionId, selected: poolPlan.raceRows.length, fresh: fresh.length, inserted: 0 };
      if (dryRun || fresh.length === 0) { tLine.pools.push(pLine); continue; }

      const toInsert = fresh.map((r) => ({
        season_id: seasonId, league_division_id: poolPlan.leagueDivisionId, pool_race_id: r.pool_race_id,
        name: r.name, race_class: r.race_class, race_type: r.race_type, stages: r.stages,
        edition_year: editionYear, status: "scheduled", game_day_start: r.game_day_start, scheduled_for: r.scheduled_for,
      }));
      const inserted = [];
      for (let i = 0; i < toInsert.length; i += INSERT_BATCH) {
        const { data, error } = await supabase.from("races").insert(toInsert.slice(i, i + INSERT_BATCH)).select("id, pool_race_id, name, race_type, stages");
        if (error) throw new Error(`races insert (pulje ${poolPlan.leagueDivisionId}): ${error.message}`);
        inserted.push(...(data || []));
      }
      summary.racesInserted += inserted.length;
      const idByPoolRace = new Map(inserted.map((x) => [x.pool_race_id, x.id]));

      const profileRows = [];
      for (const race of inserted) {
        // external_id (samme parcours i alle puljer) + terrain_archetype (terrænkarakter)
        // + season_id (variation pr. sæson) fra konteksten.
        // season_variant (#3347) er tierens resolverede re-draw — SAMME tal som
        // dæknings-verifikationen og realisme-scorecardet bruger.
        const seedRace = { ...race, external_id: externalIdByPoolRace.get(race.pool_race_id) ?? null, terrain_archetype: archetypeByPoolRace.get(race.pool_race_id) ?? null, race_class: raceClassByPoolRace.get(race.pool_race_id) ?? race.race_class ?? null, season_id: seasonId, season_variant: seasonVariant };
        for (const p of generateRaceStageProfiles(seedRace, { archetypeProfiles: archetypeProfilesForTier })) {
          profileRows.push(toStageProfileRow(race.id, p));
        }
      }
      for (let i = 0; i < profileRows.length; i += INSERT_BATCH) {
        const { error } = await supabase.from("race_stage_profiles").insert(profileRows.slice(i, i + INSERT_BATCH));
        if (error) throw new Error(`race_stage_profiles insert (pulje ${poolPlan.leagueDivisionId}): ${error.message}`);
      }
      summary.stageProfiles += profileRows.length;

      const schedRows = poolPlan.stageRows
        .filter((s) => idByPoolRace.has(s.pool_race_id))
        .map((s) => ({ race_id: idByPoolRace.get(s.pool_race_id), stage_number: s.stage_number, scheduled_at: s.scheduled_at, game_day: s.game_day }));
      for (let i = 0; i < schedRows.length; i += INSERT_BATCH) {
        const { error } = await supabase.from("race_stage_schedule").insert(schedRows.slice(i, i + INSERT_BATCH));
        if (error) throw new Error(`race_stage_schedule insert (pulje ${poolPlan.leagueDivisionId}): ${error.message}`);
      }
      summary.stageSchedules += schedRows.length;

      pLine.inserted = inserted.length;
      tLine.pools.push(pLine);
      log(`  pulje ${poolPlan.leagueDivisionId} (tier ${tierPlan.tier}): +${inserted.length} løb · ${profileRows.length} profiler · ${schedRows.length} etape-tider`);
    }
    summary.tiers.push(tLine);
  }

  // #4270: den RÅ plan (pulje-rækker, etape-tider, profiler) videregives KUN i dry-run,
  // så kalender-scorecardet (lib/calendarScorecardReport.js) kan score den kalender der
  // faktisk ville blive skrevet. Apply-stiens summary er uændret — seasonTransition.js
  // logger `applied`-summary'en i admin-loggen, og den må ikke vokse med hele planen.
  if (dryRun) {
    summary.planTiers = tierPlans;
    summary.archetypeByPoolRace = archetypeByPoolRace;
  }

  // #3990: materialisér seasons.race_days_total fra den FAKTISKE kalender så snart
  // den er skrevet. Uden dette står en frisk sæson med schema-defaulten (60) indtil
  // recomputeSeasonRaceDays rammes REAKTIVT af det første resultat-import
  // (raceRunner.js/pcmResultsImport.js) — og wageDeductionSweep, der beregner
  // dagslønnen som salary / race_days_total, ville i mellemtiden opkræve ~47 % af
  // den tiltænkte dagsløn (målt i prod 20/8: sæson 3 stod med 60 mod kalenderens 28).
  //
  // Ét sted dækker ALLE materialiserings-stier: seasonTransition, manuel
  // buildSeasonCalendar.js, relaunch og reconcilePoolCalendarOnActivation.
  // recomputeSeasonRaceDays er idempotent + selv-helende (tæller distinkte
  // game_day_start på tværs af ALLE løb for sæsonen, ikke kun de netop indsatte),
  // så et redundant kald — fx en no-op-materialisering eller en aktivering der kun
  // rammer ÉN pulje — er harmløst og retter drift over tid.
  //
  // FAIL-SAFE: en fejlende recompute (fx netværk) må ALDRIG vælte selve
  // kalender-materialiseringen. Fejlen logges på summary + Sentry, og næste
  // materialisering retter sig selv. dryRun skriver intet og springes helt over.
  if (!dryRun) {
    try {
      // Returværdien er race_days_completed (skalar-kontrakten fra seasonRaceDays.js);
      // race_days_total skrives til seasons-rækken af selve kaldet.
      summary.raceDaysCompletedAfterRecompute = await recomputeSeasonRaceDays({ supabase, seasonId });
    } catch (err) {
      summary.raceDaysTotalError = err.message;
      captureException(err, {
        tags: { phase: "season_calendar_race_days" },
        extra: { seasonId },
      });
    }
  }

  return summary;
}

/**
 * Forward-guard (#2149, jf. .claude/learnings/2026-07-03-ghost-tier4-calendar-cleanup.md):
 * når signup-allokeringen aktiverer en SOVENDE pulje (første ægte manager i en tier 3/4-pulje),
 * bliver poolHasCalendar true — men intet materialiserede historisk kalenderen (kun manuel/
 * seasonTransition-kørsel). Denne reconcile lukker hullet idempotent:
 * - No-op hvis puljen allerede har løb i den aktive sæson (det normale for tier 1/2 + allerede
 *   aktive puljer) — billigt precheck før den tunge materialisering.
 * - Ellers materialiseres KUN den ramte puljes tier (tiers=[tier], ALDRIG forceTiers), fra
 *   næste dags UTC-midnat, så dagens allerede-planlagte afvikling ikke forstyrres.
 * - materializeTierCalendars gater selv på poolHasCalendar + dedup'er mod eksisterende løb,
 *   så et dobbelt-kald (samtidige signups) er harmløst.
 * - Horisonten AFKORTES til de-facto sæson-slut (sidste planlagte etape i den aktive sæson),
 *   så en midt-sæson-aktiveret pulje slutter sin kalender SAMME dag som alle andre divisioner
 *   (ejer-krav 4/7: div 4 — A endte 2/8 mens div 1-3 endte 26/7). Uden eksisterende løb i
 *   sæsonen (helt frisk sæson) bruges materializerens fulde default-horisont.
 */
export async function reconcilePoolCalendarOnActivation({
  supabase, poolId, now = new Date(), materialize = materializeTierCalendars, log = () => {},
  // #3327/#3328 pass-through til materialize() — se materializeTierCalendars for defaults
  // + opt-out-konvention (tests af FØR-#3327-mekanik sender tomme objekter).
  coverageOverrides = {},
  // #2743: injectable til tests, mirrorer stageScheduler.js/raceEntryGeneratorSweep.js.
  captureExceptionFn,
} = {}) {
  if (poolId == null) return { skipped: "no-pool" };

  // #2743: order+limit+maybeSingle (i stedet for et rent maybeSingle) + separat
  // fler-aktiv-alarm — se activeSeasonLookup.js.
  const season = await loadSingleActiveSeason(supabase, {
    select: "id, number, start_date",
    tag: "reconcile-pool-calendar-on-activation",
    captureExceptionFn,
  });
  if (!season) return { skipped: "no-active-season" };

  const { data: existingRaces, error: rErr } = await supabase
    .from("races").select("id").eq("season_id", season.id).eq("league_division_id", poolId);
  if (rErr) throw new Error(`races (precheck): ${rErr.message}`);
  if ((existingRaces || []).length > 0) return { skipped: "has-calendar", races: existingRaces.length };

  const { data: division, error: dErr } = await supabase
    .from("league_divisions").select("id, tier").eq("id", poolId).maybeSingle();
  if (dErr) throw new Error(`league_divisions: ${dErr.message}`);
  if (!division) return { skipped: "unknown-pool" };

  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

  // De-facto sæson-slut = sidste planlagte etape på tværs af HELE den aktive sæson.
  // Findes den, afkortes horisonten (realDays + kvote = density × dage), så puljens
  // kalender slutter samme dag som de øvrige divisioner. Etaper lægges på from+1..from+realDays.
  const horizon = {};
  const { data: seasonRaces, error: allErr } = await supabase.from("races").select("id").eq("season_id", season.id);
  if (allErr) throw new Error(`races (season horizon): ${allErr.message}`);
  const seasonRaceIds = (seasonRaces || []).map((r) => r.id);
  if (seasonRaceIds.length) {
    const { data: sched, error: schErr } = await supabase
      .from("race_stage_schedule").select("scheduled_at").in("race_id", seasonRaceIds);
    if (schErr) throw new Error(`race_stage_schedule (season horizon): ${schErr.message}`);
    let maxAt = null;
    for (const s of sched || []) {
      const t = Date.parse(s.scheduled_at);
      if (Number.isFinite(t) && (maxAt == null || t > maxAt)) maxAt = t;
    }
    if (maxAt != null) {
      const end = new Date(maxAt);
      const endDayUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
      const realDays = Math.floor((endDayUtc - from.getTime()) / 86_400_000);
      if (realDays < 1) return { skipped: "season-ending", seasonEnd: end.toISOString() };
      horizon.realDays = realDays;
      // #2251 rod-årsag: denne override erstattede HELE kvote-tabellen med kun den
      // aktiverede tiers kvote → tier 1-3 fik kvote 0 i plan-genberegningen → deres
      // selection blev tom → cross-tier dedup så INGEN optagne løb → tier 4 valgte frit
      // fra hele kataloget (prestige-først = Grand Tours). Merge oven på defaults, så
      // de højere tiers' (ikke-appliede) selections stadig optager deres løb i dedup'en.
      horizon.quotas = { ...TIER_GAME_DAY_QUOTA, [division.tier]: (TIER_DENSITY[division.tier] ?? 1) * realDays };
    }
  }

  const summary = await materialize({
    supabase, seasonId: season.id, seasonStartDate: season.start_date ?? null,
    from, tiers: [division.tier], dryRun: false, log, ...horizon, ...coverageOverrides,
  });
  return { skipped: null, poolId, tier: division.tier, from: from.toISOString(), realDays: horizon.realDays ?? null, ...summary };
}
