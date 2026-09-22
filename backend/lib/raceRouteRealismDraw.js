// backend/lib/raceRouteRealismDraw.js
// #3347: deterministisk RE-DRAW af en sæsons parcours-træk, pr. tier.
//
// PROBLEMET (målt, ikke gættet): realisme-gaten (#2755/#2769) måler AGGREGATER over en
// hel tier — antal summit-finaler, andel bjerg-etaper med nedkørsels-finale, GT'ernes
// total-km/stigninger/HC. Hvert enkelt træk er en uafhængig terning pr. etape, så
// aggregatet er en stikprøve med ægte spredning. Tier 3's katalog leverer i gennemsnit
// 9,9 summits (bånd ≥ 8) og 43 % M-Down (bånd ≤ 55 %) — båndene er altså ramt med
// margin i MIDDEL, men spredningen (sd ≈ 2,0 summits / ≈ 9,8 procentpoint) er stor nok
// til at ~16 % af trækkene lander udenfor. Det er ikke et kalibreringsproblem; det er
// et for-lille-stikprøve-problem: tier 3 har kun 11 etapeløb / ~22 bjerg-etaper.
//
// LØSNINGEN: når en tiers træk bryder et bånd, trækkes tieren om med en AFLEDT seed
// (`<løb-identitet>::<season_id>:retry:<n>`) — op til MAX_REALISM_DRAW_ATTEMPTS gange.
// Determinismen er intakt: n er den mindste attempt hvor tieren består, og n er en ren
// funktion af (tierens løbssæt, season_id). Samme season_id → samme n → samme kalender.
//
// GATEN FORBLIVER HÅRD: er alle forsøg brugt, returneres attempt 0 (det kanoniske træk)
// med exhausted=true, og scorecardet melder NO-GO på præcis de bånd der brød. Re-draw
// skjuler altså intet — det fjerner kun terningkastet fra en generering der ellers kunne
// blokere en deadline på ren tilfældighed.
//
// HVORFOR PR. TIER (og ikke pr. sæson): båndene ER pr. tier, tiers deler ikke løb
// (cross-tier-dedup, #2276), og alle puljer i en tier kører identisk løbssæt (#2276).
// Et re-draw af tier 3 rører derfor aldrig tier 1's parcours — og en tier hvis træk
// består i første forsøg får attempt 0, dvs. bit-identisk output med før #3347.
//
// #3469 (runde 6, ejer-fund 8/8): #3326 (etaperækkefølge — "bjerg i første halvdel" m.fl.)
// er PRÆCIS samme klasse problem som #2755/#2769 — et sæson-aggregat over uafhængige
// pr.-etape rækkefølge-terninger — men stod FØR denne ændring uden for re-draw-søgningen:
// drawTierAttempt scorede kun scoreSeason (#2755/#2769-båndene), og buildSeasonCalendar.js
// gatePlan() checkede detectStageOrderViolations SEPARAT, EFTER re-draw havde låst variant.
// Konsekvens: en tier kunne lande på en variant der bestod #2755/#2769 men brød #3326,
// og INTET forsøg 1-11 blev nogensinde afprøvet mod det bånd — re-draw-mekanismen var
// blind for netop den fejlklasse den var bygget til at absorbere. Fundet konkret da
// klasse-bevidst nedstrøms-beskyttelse (samme runde) korrekt ændrede tier 2's stage-udvalg
// og trak dens attempt-0-træk under #3326's bjerg-i-første-halvdel-minimum (7,1 % af 10 %).
// FIX: failures i drawTierAttempt inkluderer nu OGSÅ detectStageOrderViolations, så
// resolveTierDraw søger den mindste attempt der består BEGGE kriterie-familier samtidig —
// ingen ny mekanisme, kun den eksisterende terning kastet med ét ekstra øje på den.
// Nulrisiko for tiers der allerede bestod attempt 0 på begge fronter (uændret variant=0).

import { generateRaceStageProfiles } from "./raceStageProfileGenerator.js";
import { scoreSeason } from "./raceRouteRealismMetrics.js";
import { computeStageOrderStats, detectStageOrderViolations } from "./stageOrderMetrics.js";

// 12 forsøg. Målt pr.-forsøg-fejlrate: tier 1 ≈ 44 % (GT-bånd), tier 3 ≈ 16 %,
// tier 4 ≈ 3 %. Værste tier giver 0,44^12 ≈ 6·10⁻⁵ restrisiko — langt under
// accept-kravet på 1 %, og 12 in-memory-genereringer af én tier koster millisekunder.
export const MAX_REALISM_DRAW_ATTEMPTS = 12;

/**
 * Generér én tiers løb ved ét bestemt forsøg (attempt) og score det.
 * Ren funktion. En løbs-generering der kaster bogføres som "kunne ikke vurderes"
 * (samme kontrakt som scorecardet, #2854) — den forsvinder aldrig tavst.
 *
 * @param {{tier:number, seedRaces:Array<object>, errors?:string[], attempt:number,
 *          generateProfiles?:Function}} args
 * @returns {{entry:{tier,races,errors}, failures:string[]}}
 */
export function drawTierAttempt({ tier, seedRaces = [], errors = [], attempt = 0, generateProfiles = generateRaceStageProfiles }) {
  const races = [];
  const drawErrors = [...errors];
  for (const seedRace of seedRaces) {
    let stages;
    try {
      stages = generateProfiles({ ...seedRace, season_variant: attempt });
    } catch (e) {
      // best-effort: fejlen SLUGES IKKE — den bogføres i entry.errors og bliver til
      // "kunne ikke vurderes" i scorecardet (#2854-kontrakten), hvor den blokerer GO.
      // En rethrow her ville vælte hele rapporten på ét dårligt løb, og et
      // captureException hører til i den kaldende CLI/materializer, ikke i en ren funktion.
      drawErrors.push(`profil-generering fejlede for «${seedRace.name ?? seedRace.external_id ?? seedRace.id}»: ${e.message || e}`);
      continue;
    }
    races.push({ name: seedRace.name ?? null, race_type: seedRace.race_type, terrain_archetype: seedRace.terrain_archetype ?? null, stages });
  }
  const entry = { tier, races, errors: drawErrors };
  // scoreSeason på ÉN tier: failures indeholder både tier-båndene og tierens GT-bånd.
  // unassessed (manglende datagrundlag) tæller IKKE som båndbrud — et re-draw kan ikke
  // fremtrylle løb der ikke findes, så det ville blot brænde alle forsøg af.
  const { failures } = scoreSeason([entry]);
  // #3469 (runde 6): #3326-rækkefølgebåndene er SAMME slags aggregat-over-tilfældighed
  // som #2755/#2769 — tag dem med i samme søgning (se fil-docstringen ovenfor). 0
  // etapeløb er "kan ikke vurderes", ikke et brud (#2854-kontrakten, jf. detectStageOrderViolations).
  const stageOrderStats = computeStageOrderStats(races);
  const stageOrderFailures = stageOrderStats.stageRaces > 0
    ? detectStageOrderViolations({ stats: stageOrderStats, label: `tier ${tier}` })
    : [];
  return { entry, failures: [...failures, ...stageOrderFailures] };
}

/**
 * Find den mindste attempt hvor tieren består alle sine bånd.
 *
 * @returns {{tier:number, attempt:number, exhausted:boolean, attemptsTried:number,
 *            entry:object, failures:string[], firstDrawFailures:string[]}}
 *   attempt            = den valgte re-draw-variant (0 = kanonisk træk)
 *   exhausted          = true hvis INTET forsøg bestod → attempt 0 returneres og
 *                        failures er attempt 0's brud (gaten skal melde NO-GO)
 *   firstDrawFailures  = attempt 0's brud (tomt hvis det kanoniske træk bestod) —
 *                        rapporterings-materiale, så et re-draw aldrig sker i tavshed
 */
export function resolveTierDraw({ tier, seedRaces = [], errors = [], generateProfiles = generateRaceStageProfiles, maxAttempts = MAX_REALISM_DRAW_ATTEMPTS } = {}) {
  const attempts = Math.max(1, Number(maxAttempts) || 1);
  let firstDraw = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const drawn = drawTierAttempt({ tier, seedRaces, errors, attempt, generateProfiles });
    if (attempt === 0) firstDraw = drawn;
    if (drawn.failures.length === 0) {
      return {
        tier, attempt, exhausted: false, attemptsTried: attempt + 1,
        entry: drawn.entry, failures: [], firstDrawFailures: firstDraw.failures,
      };
    }
  }
  // Alle forsøg brugt: fald tilbage til det KANONISKE træk. Gaten ser dermed præcis de
  // brud den ville have set uden #3347 — ingen "bedste af N"-pynt.
  return {
    tier, attempt: 0, exhausted: true, attemptsTried: attempts,
    entry: firstDraw.entry, failures: firstDraw.failures, firstDrawFailures: firstDraw.failures,
  };
}

/**
 * Løs re-draw-varianten for HELE sæsonen (alle tiers).
 * @param {{tierSeedRaces:Array<{tier:number, seedRaces:Array<object>, errors?:string[]}>}} args
 * @returns {Array<ReturnType<typeof resolveTierDraw>>} sorteret efter tier
 */
export function resolveSeasonDraw({ tierSeedRaces = [], generateProfiles = generateRaceStageProfiles, maxAttempts = MAX_REALISM_DRAW_ATTEMPTS } = {}) {
  return [...tierSeedRaces]
    .sort((a, b) => a.tier - b.tier)
    .map((t) => resolveTierDraw({ ...t, generateProfiles, maxAttempts }));
}

/**
 * Bekvemmeligheds-wrapper for skrive-stierne (materializer/backfill), der kun har brug
 * for "hvilken variant skal tier N generere med?".
 * @returns {Map<number, number>} tier → season_variant
 */
export function resolveSeasonDrawVariants(args) {
  return new Map(resolveSeasonDraw(args).map((d) => [d.tier, d.attempt]));
}

/**
 * Løs re-draw-varianten pr. LØBS-ID for en vilkårlig samling `races`-rækker — den form
 * backfill-scripterne har data i. Ren funktion (ingen DB): kalderen leverer opslagene.
 *
 * Variantet hører til (season_id, tier), og alle puljer i en tier kører identisk løbssæt
 * (#2276), så det løses ÉN gang pr. gruppe på den LAVESTE puljes løbssæt — præcis samme
 * repræsentative pulje som realisme-scorecardet og materializeren bruger. Løb uden
 * season_id eller uden kendt division falder på variant 0 (uændret adfærd).
 *
 * @param {{races:Array<object>, tierByDivision:Map<any,number>,
 *          catalogMeta:Map<any,{external_id?:string, terrain_archetype?:string}>,
 *          onDraw?:(d:{seasonId:any, tier:number, draw:object})=>void}} args
 * @returns {Map<any, number>} race.id → season_variant
 */
export function resolveVariantByRaceId({ races = [], tierByDivision = new Map(), catalogMeta = new Map(), onDraw = () => {}, generateProfiles = generateRaceStageProfiles, maxAttempts = MAX_REALISM_DRAW_ATTEMPTS } = {}) {
  const groupKey = (r) => {
    const tier = tierByDivision.get(r.league_division_id);
    return tier == null || !r.season_id ? null : `${r.season_id}|${tier}`;
  };

  const lowestDivByGroup = new Map();
  for (const r of races) {
    const key = groupKey(r);
    if (!key) continue;
    const cur = lowestDivByGroup.get(key);
    if (cur == null || r.league_division_id < cur) lowestDivByGroup.set(key, r.league_division_id);
  }

  const seedRacesByGroup = new Map();
  for (const r of races) {
    const key = groupKey(r);
    if (!key || lowestDivByGroup.get(key) !== r.league_division_id) continue;
    const meta = catalogMeta.get(r.pool_race_id) || {};
    if (!seedRacesByGroup.has(key)) seedRacesByGroup.set(key, []);
    seedRacesByGroup.get(key).push({ ...r, external_id: meta.external_id ?? null, terrain_archetype: meta.terrain_archetype ?? null });
  }

  const variantByGroup = new Map();
  for (const [key, seedRaces] of seedRacesByGroup) {
    const [seasonId, tierStr] = key.split("|");
    const tier = Number(tierStr);
    const draw = resolveTierDraw({ tier, seedRaces, generateProfiles, maxAttempts });
    variantByGroup.set(key, draw.attempt);
    if (draw.attempt > 0 || draw.exhausted) onDraw({ seasonId, tier, draw });
  }

  const byRaceId = new Map();
  for (const r of races) {
    const key = groupKey(r);
    byRaceId.set(r.id, key ? (variantByGroup.get(key) ?? 0) : 0);
  }
  return byRaceId;
}
