// backend/lib/raceRouteRealismMetrics.js
// Sub-1 (#2769) scorecard: mål en (regenereret) kalender mod WT-realisme + #2755-tier-bånd.
// Ren funktion — ingen DB. Input = allerede-genererede etaper (profile_type/finale_type/rute).
// GATEN: raceRouteRealismScorecard.js regenererer S2 in-memory og kalder scoreTier pr. tier.

const MOUNTAIN = new Set(["mountain", "high_mountain"]);
const isSummit = (s) => s.finale_type === "long_climb" && MOUNTAIN.has(s.profile_type);

// #2755-mål pr. tier. null = intet krav.
//
// ER BÅNDENE KALIBRERET MOD TIERENS FAKTISKE KATALOG? (#3347, målt 2026-08-05 over 3.000
// trækvarianter af S2-kalenderen — reproducér med
// `node scripts/raceRouteRealismDrawHarness.js --catalog --tier 3`):
//
//   tier 3 (46 løb): loft 22,1 bjerg-familie-etaper (min 18 over 3.000 træk) · faktiske
//     summits middel 9,91 (sd 2,04) · M-Down middel 43,4 % (sd 9,8)
//   tier 4 (24 løb): loft 21,1 · summits middel 9,71 (sd 1,98) · M-Down 42,5 % (sd 10,0)
//
// Konklusion: båndene er OPNÅELIGE MED MARGIN i middel (tier 3 leverer 24 % flere summits
// end kravet, og 11,6 procentpoint M-Down-luft) — de er IKKE fejlkalibreret mod kataloget.
// Men marginen er kun ~0,9-1,2 standardafvigelser, fordi stikprøven er lille (tier 3 har
// blot 11 etapeløb / ~22 bjerg-etaper), så ~16 % af enkelttræk lander alligevel udenfor.
// Det er derfor #3347 løser problemet i TRÆKKET (deterministisk re-draw,
// raceRouteRealismDraw.js) og ikke i båndene. Skal båndene hæves mod #1293's fulde mål,
// skal katalogets summit-forsyning op FØRST: 78 % af tier 3's summits kommer fra kun 4
// summit_tour-løb.
//
// ── #3469 HÆRDNINGS-PAKKEN (ejer-beslutning 7/8: "Alle divisioner skal have
// realisme-bånd") — D1/D2 udfyldt, samme form som D3/D4 ────────────────────────────────
//
// METODE: samme harness som ovenfor (`node scripts/raceRouteRealismDrawHarness.js
// --catalog --tier N`), 2.000 trækvarianter × 2 base-seeds (S2's ægte katalog-snapshot +
// et re-refresh mod nuværende race_pool) pr. tier, 2026-08-07. Værdierne er MÅLT, ikke
// gættet — samme disciplin som D3/D4 ovenfor:
//
//   tier 1 (25 løb, katalog): loft 46,1 bjerg-familie-etaper (min 31) · faktiske summits
//     middel 18,1 (sd 3,4, min 9) · M-Down middel 47,2 % (sd 7,0) · finale-tælling (samme
//     snapshot, 500 træk): bunch_sprint middel 22,2 (min 12) · descent-finale middel 21,8
//     (min 12) · solo_tt-slutfinale-løb middel 2,4 (min 0)
//   tier 2 (27 løb, katalog): loft 21,1 (min 15 — TYND margin) · faktiske summits middel
//     5,16 (sd 2,1, min 0 — UNDER det valgte mål 6) · M-Down middel 57,1 % (sd 10,8) ·
//     bunch_sprint middel 22,1 (min 12) · descent-finale middel 12,1 (min 6) ·
//     solo_tt-slutfinale-løb middel 3,5 (min 0)
//
// D1's bånd (summit ≥ 12, M-Down ≤ 55 %, itt ≥ 1, cobbles ≥ 1) ligger komfortabelt under
// det målte middel — samme "margin i middel, spredning løses af #3347-re-draw"-mønster
// som D3/D4.
//
// D2's summit_min/mdown_max_pct/itt_min startede (samme commit-serie, samme dag) som
// BEVIDST INTERIM 6/65/0: katalogets daværende middel (5,16 summits, 0 pålidelig
// fritstående ITT) lå under et D3/D4-niveau bånd. Ejeren godkendte 7/8 tre nye
// katalog-løb der lukkede PRÆCIS de to huller (Chrono Champenois Majeur, OWTB
// itt_classic — D2's første pålidelige fritstående ITT — samt Vuelta a los Pirineos og
// Tour des Grandes Alpes, begge OWTC summit_tour). TIER_ARCHETYPE_RESERVATIONS[2]
// .summit_tour hævet 1→2 (tierCalendarGuarantees.js) samme commit, så BEGGE nye
// summit_tour-løb garanteres valgt, ikke kun ét af dem tilfældigt via prestige-walket.
//
// OPGRADERINGS-MÅLING (2026-08-07, EFTER de 3 løb er seedet i prod): 2.000 trækvarianter
// af tier 2's FAKTISKE S3-udvalg (33 løb, dry-run-planens seedRaces — ikke en syntetisk
// fixture) mod kandidat-båndet summit≥8/mdown≤60%/itt≥1/cobbles≥1:
//   summit_finishes: middel 9,84 (sd 2,51, p20=8, min 3) — op fra 5,16 FØR de nye løb.
//   mdown_pct:       middel 50,1 % (sd 9,1) — ned fra 57,1 %.
//   standalone_itt:  middel 1,00, MIN 1 — 100 % af trækkene har nu mindst 1 fritstående
//                    ITT (itt_classic-reservationen holder pålideligt, hvor den før
//                    manglede forsyning helt).
//   attempt-0 pass-rate mod kandidatbåndet: 76,9 % · re-draw-succes op til 12 forsøg:
//                    100,0 % (0 exhausted) — langt over #3469's 80 %-accept-kriterium.
// Konklusion: opgraderet til summit_min 8 / mdown_max_pct 60 / itt_min 1 (samme
// summit/itt-niveau som D3, mdown 5pp løsere — D2's spredning er stadig større, færre
// løb end D3). Finale-gulvene (bunch_sprint/descent_finale/solo_tt_final, uændrede fra
// første udkast) re-verificeret mod samme 33-løbs-udvalg og holder fortsat med margin.
//
// VERIFICERET (2026-08-07): nuværende S3-plan består under de opgraderede bånd (re-draw
// absorberer spredningen, samme mekanisme som D1/D3/D4); D2's tidligere observerede
// skred (summit 4, M-Down 53 %) fanges stadig som rødt, nu af det HÆVEDE summit_min=8
// (regressionstest i raceRouteRealismMetrics.test.js).
// ── #4272 (26/8): descent_finale_min RE-DERIVERET mod ejerens nye finale-bånd ────
//
// De gamle gulve (D1 8 · D2 10 · D3 4 · D4 4) blev kalibreret 8/8 mod en generator hvor
// `mountain` sluttede NEDAD i 60 % af tilfældene. #4272 vender det bevidst om
// (TERRAIN_FINALE_BANDS: mountain nedad 20-35 %, high_mountain nedad 0-15 %, SAMLET nedad
// højst 10 %) — og så bliver D2's gulv på 10 MATEMATISK UOPNÅELIGT, ikke bare stramt:
//
//   D2 har 23 mountain- + 7 high_mountain-etaper. Bånd-LOFTET giver
//   23 × 0,35 + 7 × 0,15 = 9,1 nedkørsels-finaler — under gulvets 10.
//
// MÅLT konsekvens af at lade gulvet stå (400 sæsoners re-draw-søgning mod
// __fixtures__/seasonTierCalendarSnapshot.json): 0 → 20 sæsoner (5 %) UDTØMTE alle 12
// gen-træk, og S3's eget træk gik fra attempt 0 til attempt 9 af 12 i D2. Et gulv der
// tvinger re-drawet til at lede efter en fordeling båndet forbyder, er ikke en vagt —
// det er en deadlock med 5 % fejlrate.
//
// Gulvene er derfor sat til det båndene faktisk kan levere, med margin (målt på S3:
// D1 10 · D2 7 · D3 4 · D4 3). De vogter stadig det #3469 satte dem til at vogte —
// at nedkørsels-finalen findes som løbstype — bare mod den nye, ejer-besluttede skala.
// Efter re-deriveringen: 0 af 400 sæsoner udtømmer gen-trækket igen.
export const TIER_TARGETS = Object.freeze({
  1: {
    summit_min: 12, mdown_max_pct: 55, itt_min: 1, cobbles_min: 1,
    bunch_sprint_min: 15, descent_finale_min: 8, solo_tt_final_min: 2,
  },
  2: {
    summit_min: 8, mdown_max_pct: 60, itt_min: 1, cobbles_min: 1,
    bunch_sprint_min: 15, descent_finale_min: 5, solo_tt_final_min: 1,
  },
  3: {
    summit_min: 8, mdown_max_pct: 55, itt_min: 1, cobbles_min: 1,
    bunch_sprint_min: 10, descent_finale_min: 4, solo_tt_final_min: 1,
  },
  4: {
    summit_min: 4, mdown_max_pct: 60, itt_min: 1, cobbles_min: 1,
    bunch_sprint_min: 7, descent_finale_min: 3, solo_tt_final_min: 1,
  },
});

// WT-realisme-bånd (spec §6), pr. etape-type. [min,max] km.
export const WT_DISTANCE_BANDS = Object.freeze({
  flat: [150, 200], rolling: [150, 190], hilly: [160, 210],
  mountain: [140, 190], high_mountain: [140, 190],
  cobbles: [150, 170], classic: [200, 260], itt: [15, 40], ttt: [25, 45],
});

// #4104: monumenter prissaettes paa KLASSE, ikke terraen (se CLASS_DISTANCE_BANDS i
// raceRouteGenerator.js). Uden dette spejl ville de fem monumenter taelle som
// distance-outliers i scorecardet, praecis fordi de nu har den laengde de skal have.
const WT_CLASS_DISTANCE_BANDS = Object.freeze({ Monuments: [250, 290] });

// Flad-ud alle etaper i en race-liste. En stage_race har `stages` som array; en single ligeså.
function allStages(races) {
  const out = [];
  for (const r of races) for (const s of (Array.isArray(r.stages) ? r.stages : [])) out.push({ ...s, _race_type: r.race_type, _race_class: r.race_class ?? null });
  return out;
}

/**
 * Scorer én tier mod #2755-målene (+ #3469's finale-gulve).
 * @param {number} tier
 * @param {Array<{race_type:string, stages:Array<{profile_type,finale_type,distance_km,sectors}>}>} races
 * @returns {{tier,summit_finishes,mountain_stages,mdown_pct,standalone_itt,cobbles_in_stagerace,
 *   bunch_sprint_stage_days,descent_finale_stage_days,solo_tt_final_races,pass,failures,distanceOutliers}}
 */
export function scoreTier(tier, races) {
  const stages = allStages(races);
  const mountainStages = stages.filter((s) => MOUNTAIN.has(s.profile_type));
  const mdown = mountainStages.filter((s) => s.finale_type === "descent");
  const summit = stages.filter(isSummit).length;
  const standaloneItt = races.filter((r) => r.race_type === "single" && (r.stages || []).some((s) => s.profile_type === "itt")).length;
  const cobblesInStageRace = races.filter((r) => r.race_type === "stage_race" && (r.stages || []).some((s) => s.profile_type === "cobbles")).length;
  const mdownPct = mountainStages.length ? Math.round((mdown.length / mountainStages.length) * 100) : 0;

  // #3469 finale-gulve (leverance 2): "etapedage" = rå optælling af stages med den givne
  // finale_type (tværs af alle profile_type), ikke en andel. descent-finale-etapedage
  // GENBRUGER mdown-tælleren — det er PRÆCIS samme tal, blot udtrykt som et minimums-gulv
  // i stedet for et procent-loft (mdown_max_pct), fordi kun mountain/high_mountain-profiler
  // kan få finale_type "descent" (raceStageProfileGenerator.js's FINALE_WEIGHTS_BY_PROFILE).
  const bunchSprintStageDays = stages.filter((s) => s.finale_type === "bunch_sprint").length;
  const descentFinaleStageDays = mdown.length;
  const soloTtFinalRaces = races.filter((r) => {
    const rs = Array.isArray(r.stages) ? r.stages : [];
    return rs.length > 0 && rs[rs.length - 1]?.finale_type === "solo_tt";
  }).length;

  const distanceOutliers = stages.filter((s) => {
    const band = WT_CLASS_DISTANCE_BANDS[s._race_class] ?? WT_DISTANCE_BANDS[s.profile_type];
    return band && (s.distance_km < band[0] || s.distance_km > band[1]);
  }).length;

  const t = TIER_TARGETS[tier] ?? {};
  const failures = [];
  if (t.summit_min != null && summit < t.summit_min) failures.push(`summit ${summit} < ${t.summit_min}`);
  if (t.mdown_max_pct != null && mdownPct > t.mdown_max_pct) failures.push(`M-Down ${mdownPct}% > ${t.mdown_max_pct}%`);
  if (t.itt_min != null && standaloneItt < t.itt_min) failures.push(`fritstående ITT ${standaloneItt} < ${t.itt_min}`);
  if (t.cobbles_min != null && cobblesInStageRace < t.cobbles_min) failures.push(`brosten-i-etapeløb ${cobblesInStageRace} < ${t.cobbles_min}`);
  if (t.bunch_sprint_min != null && bunchSprintStageDays < t.bunch_sprint_min) failures.push(`bunch-sprint-etapedage ${bunchSprintStageDays} < ${t.bunch_sprint_min} (#3469)`);
  if (t.descent_finale_min != null && descentFinaleStageDays < t.descent_finale_min) failures.push(`nedkørsels-finale-etapedage ${descentFinaleStageDays} < ${t.descent_finale_min} (#3469)`);
  if (t.solo_tt_final_min != null && soloTtFinalRaces < t.solo_tt_final_min) failures.push(`løb med enkeltstart-slutfinale ${soloTtFinalRaces} < ${t.solo_tt_final_min} (#3469)`);

  return {
    tier, summit_finishes: summit, mountain_stages: mountainStages.length, mdown_pct: mdownPct,
    standalone_itt: standaloneItt, cobbles_in_stagerace: cobblesInStageRace,
    bunch_sprint_stage_days: bunchSprintStageDays, descent_finale_stage_days: descentFinaleStageDays,
    solo_tt_final_races: soloTtFinalRaces,
    distanceOutliers, pass: failures.length === 0, failures,
  };
}

// GT-realisme (spec §6): tjek et 21-etapers løb. total-km-bånd + kategoriserede stigninger.
export function scoreGrandTour(stages) {
  const totalKm = stages.reduce((s, x) => s + (x.distance_km || 0), 0);
  const categorizedClimbs = stages.reduce((s, x) => s + ((x.climbs || []).length), 0);
  const hcClimbs = stages.reduce((s, x) => s + (x.climbs || []).filter((c) => c.category === "HC").length, 0);
  const failures = [];
  if (totalKm < 3200 || totalKm > 3500) failures.push(`total ${totalKm} km udenfor 3200–3500`);
  if (categorizedClimbs < 25) failures.push(`kategoriserede stigninger ${categorizedClimbs} < 25`);
  if (hcClimbs < 3 || hcClimbs > 8) failures.push(`HC-stigninger ${hcClimbs} udenfor 3–8`);
  return { totalKm, categorizedClimbs, hcClimbs, pass: failures.length === 0, failures };
}

// Et løb med mindst så mange etaper scores mod GT-båndet.
export const GRAND_TOUR_MIN_STAGES = 21;

// Tre udfald — "kunne ikke vurderes" er BEVIDST forskelligt fra både GO og NO-GO.
// Et scorecard der siger GO på et grundlag det ikke har målt er værre end intet
// scorecard (#2854), så tavs mangel på evidens må aldrig kollapse til GO.
export const VERDICT = Object.freeze({ GO: "GO", NO_GO: "NO-GO", UNKNOWN: "UKENDT" });
export const EXIT_CODE = Object.freeze({ [VERDICT.GO]: 0, [VERDICT.NO_GO]: 1, [VERDICT.UNKNOWN]: 2 });

// En tier er GATET når #2755 faktisk sætter mindst ét mål for den. Tier 1-2 står
// eksplicit med lutter null (bevidst u-gated) → "ikke gatet", ikke "grøn".
// En tier der slet IKKE står i TIER_TARGETS er noget ingen har taget stilling til
// → ikke-vurderet (ikke tavst grøn).
export function tierGateState(tier) {
  const targets = TIER_TARGETS[tier];
  if (!targets) return "undefined";
  return Object.values(targets).some((v) => v != null) ? "gated" : "advisory";
}

// GT-detektion: arketypen er sandheden, etape-antallet er kun signalet. Et løb
// med grand_tour-arketype og < 21 genererede etaper er derfor IKKE "ingen GT" —
// det er en GT vi ikke kan måle, og skal rapporteres som sådan.
const isGrandTourArchetype = (race) => race?.terrain_archetype === "grand_tour";

/**
 * Sæson-aggregat: samler tier-scores + GT-scores til ét resultat + én verdict.
 * Ren funktion — scorecard-scriptet leverer de (regenererede) løb pr. tier.
 *
 * GO kræver at hver gatet delscore KØRTE og bestod. En delscore der fejlede →
 * NO-GO. En delscore der ikke kunne beregnes (ingen løb, ukendt tier, en GT der
 * ikke kan måles, en generator-fejl) → UKENDT. Et konkret båndbrud vinder over
 * UKENDT, fordi det er det mere specifikke og handlebare signal — men begge
 * lister printes altid.
 *
 * @param {Array<{tier:number, races:Array<{race_type,stages,name?,terrain_archetype?}>, errors?:string[]}>} tierEntries
 */
export function scoreSeason(tierEntries = []) {
  const tiers = [];
  const failures = [];
  const unassessed = [];
  const advisories = [];
  let gatedTiersEvaluated = 0;
  let grandToursEvaluated = 0;

  for (const { tier, races = [], errors = [] } of tierEntries) {
    for (const e of errors) unassessed.push(`tier ${tier}: ${e}`);

    const gateState = tierGateState(tier);
    if (gateState === "undefined") unassessed.push(`tier ${tier}: ingen mål defineret i TIER_TARGETS — tieren er aldrig blevet vurderet`);

    const score = scoreTier(tier, races);
    if (races.length === 0) {
      // 0 løb er ikke et båndbrud — det er fravær af evidens.
      unassessed.push(`tier ${tier}: 0 løb at score`);
    } else if (gateState === "gated") {
      gatedTiersEvaluated += 1;
      for (const f of score.failures) failures.push(`tier ${tier}: ${f}`);
    }
    if (score.distanceOutliers > 0) advisories.push(`tier ${tier}: ${score.distanceOutliers} etape(r) udenfor WT-distancebåndet (advisory — gater ikke)`);

    const grandTours = [];
    for (const r of races) {
      const stages = Array.isArray(r.stages) ? r.stages : [];
      const label = r.name ? `«${r.name}»` : "(uden navn)";
      if (stages.length < GRAND_TOUR_MIN_STAGES) {
        if (isGrandTourArchetype(r)) unassessed.push(`tier ${tier}: GT ${label} har kun ${stages.length} etaper — GT-båndet kan ikke vurderes`);
        continue;
      }
      const gt = { name: r.name ?? null, stageCount: stages.length, ...scoreGrandTour(stages) };
      grandTours.push(gt);
      grandToursEvaluated += 1;
      // GT-båndet gater uanset tier: de 3 S2-GT'er ligger i den u-gatede tier 1.
      for (const f of gt.failures) failures.push(`tier ${tier}: GT ${label}: ${f}`);
    }

    tiers.push({ tier, gateState, raceCount: races.length, score, grandTours });
  }

  if (tierEntries.length === 0) unassessed.push("ingen tiers at score — kalenderen gav 0 løb");
  else if (gatedTiersEvaluated === 0) unassessed.push("ingen gatet tier blev evalueret — gaten målte reelt intet");

  const verdict = failures.length ? VERDICT.NO_GO : unassessed.length ? VERDICT.UNKNOWN : VERDICT.GO;
  return {
    tiers, failures, unassessed, advisories,
    gatedTiersEvaluated, grandToursEvaluated,
    verdict, exitCode: EXIT_CODE[verdict],
  };
}
