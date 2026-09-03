// backend/lib/calendarScorecardReport.js
// #4270/#4176: scorecard-logikken fra scripts/dev/calendarScorecard4218.mjs, ekstraheret
// til lib/ saa den kan koeres BEGGE steder mod PRAECIS samme kode:
//
//   1. scripts/dev/calendarScorecard4218.mjs --from-fixture — offline, mod fixture-kataloget
//      (CI-gaten calendar-scorecard-gate.yml + saesonskifte-preflighten + i haanden)
//   2. scripts/buildSeasonCalendar.js's DRY-RUN — mod den kalender der faktisk ville blive
//      skrevet (samme plan, samme parcours, samme tilt som apply-stien)
//   3. scripts/dev/calendarScorecard4218.mjs --from-db — mod den SKREVNE kalender i basen
//      (#4573, nat-vagten calendar-invariant-audit.yml). Samme taerskler, andet datagrundlag:
//      raekkerne pakkes til tierPlan-formen og scores af PRAECIS koden herunder.
//
// HVORFOR EN EKSTRAKTION OG IKKE EN KOPI: #4215's hele pointe er at scorecardet skal koere
// paa TRE tidspunkter (CI, saesonskifte-preflight, prod-invariant) — tre kopier af de
// samme taerskler er praecis den fejlklasse CALENDAR_RULES.md §9 beskriver ("en regel der
// kun findes som en konstant er ikke haandhaevet"). Naar der kun er EEN implementation kan
// de tre steder ikke drifte fra hinanden.
//
// REN FUNKTION: ingen DB, ingen fs, ingen vaegur-tid (hard rule 16 — datoerne injiceres).
// Alle taerskler laeses fra deres SSOT-moduler (tierCalendarGuarantees.js,
// calendarCompositionTargets.js, stageOrderMetrics.js, stageFinaleMetrics.js,
// calendarDailyCoverage.js) — denne fil definerer INGEN egne tal.
//
// Regel-daekning mod docs/CALENDAR_RULES.md:
//   §1  taethed/overlap-cap      → maxOverlap mod overlapCap (fra planen)
//   §1b kvote-opfyldelse         → quota/totalGameDays/shortfall (RAPPORTERES, §11 punkt 4
//                                   mangler ejerens gulv — derfor ingen gate)
//   §2  loeb hver kalenderdag    → detectEmptyCalendarDays
//   §3  Grand Tours              → plan-invarianterne (detectCalendarViolations)
//   §4  endagsloebs-andel        → computeTierCoverageStats/detectCoverageViolations
//   §5  terraen-gulve            → samme
//   §6  K-B-komposition          → detectCompositionViolations (BEGGE tolerancer, se nedenfor)
//   §6b uniforme maal            → computeUniformTierStats/detectUniformTierViolations
//   §7  etaperaekkefoelge        → computeStageOrderStats/detectStageOrderViolations
//   §7b finale-baand             → computeFinaleStats/detectFinaleViolations (to lag)

import {
  computeTierCoverageStats, detectCoverageViolations, detectTerrainBandViolations,
  TIER_ONE_DAY_SHARE_TARGET, TIER_ONE_DAY_SHARE_MIN,
  TIER_TERRAIN_FAMILY_MIN, TIER_TERRAIN_FAMILY_MAX,
} from "./tierCalendarGuarantees.js";
import {
  computeCompositionStats, detectCompositionViolations,
  computeUniformTierStats, detectUniformTierViolations,
  ACTIVE_TARGET, TIER_COMPOSITION_TOLERANCE_PP, COMPOSITION_TOLERANCE_PP, CATEGORY_LABELS,
  TIER_UNIFORM_TARGET_CATEGORIES, TIER_UNIFORM_TARGET_FRACTIONS, TIER_UNIFORM_TOLERANCE_PP,
} from "./calendarCompositionTargets.js";
import { computeStageOrderStats, detectStageOrderViolations, STAGE_ORDER_TARGETS } from "./stageOrderMetrics.js";
import {
  computeFinaleStats, mergeFinaleStats, detectFinaleViolations,
  TERRAIN_FINALE_BANDS, OVERALL_FINALE_BAND, FINALE_CLASSES, CLASS_LABELS, MIN_SAMPLE,
} from "./stageFinaleMetrics.js";
import { detectEmptyCalendarDays } from "./calendarDailyCoverage.js";
import {
  detectMonumentsInsideGrandTours, computeGameDayOverlap,
  detectMinOverlapViolations, detectQuotaViolations,
} from "./calendarPlacementGates.js";
import { TIER_OVERLAP_MIN, TIER_MULTI_RACE_DAY_MIN_SHARE } from "./calendarTierCaps.js";

const pct = (n) => `${(n * 100).toFixed(1)} %`;
const ok = (b) => (b ? "OK " : "FEJL");

/** "YYYY-MM-DD" + n dage → "YYYY-MM-DD". Kl. 12 UTC → entydig kalenderdag. */
export function addCalendarDays(dateStr, n) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
}

/**
 * Score EEN tier-plan (buildTierMaterializationPlan's tierPlans[i]) mod reglerne.
 *
 * @param {object} args
 * @param {object} args.plan             tierPlan fra buildTierMaterializationPlan
 * @param {Map}    args.profilesByPoolRaceId  pool_race_id → etape-profiler (SAMME profiler
 *   som skrive-stien ville persistere — kaldes med materializerens egne, saa scorecard og
 *   insert aldrig maaler hvert sit parcours, jf. #3347/#4104)
 * @param {Map}    args.archetypeByPoolRace   pool_race_id → terrain_archetype
 */
export function scoreTierPlan({ plan, profilesByPoolRaceId, archetypeByPoolRace = new Map() } = {}) {
  const pool = (plan.pools ?? [])[0] ?? { raceRows: [], stageRows: [] };
  const raceRows = pool.raceRows ?? [];
  const stageRows = pool.stageRows ?? [];

  const maalbare = raceRows.map((r) => ({
    name: r.name,
    race_type: r.race_type,
    terrain_archetype: archetypeByPoolRace.get(r.pool_race_id) ?? null,
    stages: profilesByPoolRaceId.get(r.pool_race_id) ?? [],
  }));

  const coverage = computeTierCoverageStats({ raceRows, profilesByPoolRaceId });
  const coverageViol = detectCoverageViolations({ tier: plan.tier, stats: coverage });
  // #4270: rolling-baandet (gulv + loft) doemmes for sig - roedt i scorecardet og en
  // apply-gate, men uden at aendre #4215's eksisterende CI-dom. Se TERRAIN_BAND_FAMILIES.
  const terrainBandViol = detectTerrainBandViolations({ tier: plan.tier, stats: coverage });

  const composition = computeCompositionStats(maalbare);
  // To domme paa samme kalender — CALENDAR_RULES.md §10 modsigelse 2, IKKE et valg denne
  // fil traeffer: `compositionViol` bruger de LOESE TIER_COMPOSITION_TOLERANCE_PP (7/5/8/10),
  // som gatePlan ogsaa doemmer efter; `compositionStrictViol` er §6's ejer-besluttede
  // ±2 pp. Den strenge RAPPORTERES kun (den ville i dag vaere roed paa 7 akser, §6), saa
  // modsigelsen er synlig i hver koersel i stedet for at ligge i en doc ingen laeser.
  const compositionViol = detectCompositionViolations({
    stats: composition, label: `tier ${plan.tier}`,
    tolerancePp: TIER_COMPOSITION_TOLERANCE_PP[plan.tier],
  }).violations ?? [];
  const compositionStrictViol = detectCompositionViolations({
    stats: composition, label: `tier ${plan.tier}`,
    tolerancePp: COMPOSITION_TOLERANCE_PP, applyMinRaceDayTolerance: true,
  }).violations ?? [];

  // §6b (#4103): de tre kategorier der skal ramme SAMME tal i alle divisioner.
  const uniform = computeUniformTierStats(maalbare);
  const uniformViol = detectUniformTierViolations({ stats: uniform, label: `tier ${plan.tier}` }).violations ?? [];

  const order = computeStageOrderStats(maalbare);
  const orderViol = detectStageOrderViolations({ stats: order, label: `tier ${plan.tier}` });

  let descent = 0, etaper = 0;
  const finaler = new Map();
  for (const r of maalbare) {
    for (const st of r.stages ?? []) {
      etaper += 1;
      const f = st.finale_type ?? "?";
      finaler.set(f, (finaler.get(f) ?? 0) + 1);
      if (f === "descent") descent += 1;
    }
  }
  const finale = computeFinaleStats(maalbare);
  const finaleViol = detectFinaleViolations({ stats: finale, label: `tier ${plan.tier}`, strict: false });
  const finaleRaw = detectFinaleViolations({ stats: finale, label: `tier ${plan.tier}`, strict: true });

  // #4270's tre nye placerings-gates (calendarPlacementGates.js). De doemmer paa den samme
  // to-akse-form scorecardet allerede har, og maales derfor her frem for i pakkeren.
  const overlapMinForTier = TIER_OVERLAP_MIN[plan.tier] ?? null;
  const gameDayOverlap = computeGameDayOverlap({ stageRows, overlapMin: overlapMinForTier });
  const monumentGtViol = detectMonumentsInsideGrandTours({ tier: plan.tier, raceRows, stageRows });
  const minOverlapViol = detectMinOverlapViolations({ tier: plan.tier, overlap: gameDayOverlap });
  const quotaViol = detectQuotaViolations({ tier: plan.tier, quota: plan.quota, totalGameDays: plan.totalGameDays });

  return {
    tier: plan.tier,
    løb: raceRows.length,
    etaper,
    løbsdage: new Set(stageRows.map((s) => s.game_day)).size,
    kalenderdage: new Set(stageRows.map((s) => String(s.scheduled_at).slice(0, 10))).size,
    quota: plan.quota ?? null,
    totalGameDays: plan.totalGameDays ?? null,
    quotaHit: plan.quotaHit ?? null,
    shortfall: plan.shortfall ?? 0,
    planViolations: plan.calendarViolations ?? [],
    maxOverlap: plan.maxOverlap, overlapCap: plan.overlapCap,
    tommeLøbsdage: plan.emptyDays, dageUdenAfgørelse: plan.daysWithoutDecisionCount,
    coverage, coverageViol,
    composition, compositionViol, compositionStrictViol,
    uniform, uniformViol,
    order, orderViol,
    finale, finaleViol, finaleRaw,
    descent, descentAndel: etaper ? descent / etaper : 0,
    finaler: Object.fromEntries([...finaler.entries()].sort((a, b) => b[1] - a[1])),
    terrainBandViol,
    gameDayOverlap, overlapMin: overlapMinForTier,
    multiRaceShareMin: TIER_MULTI_RACE_DAY_MIN_SHARE[plan.tier] ?? null,
    monumentGtViol, minOverlapViol, quotaViol,
  };
}

/**
 * Score en HEL planlagt kalender (alle tiers) mod docs/CALENDAR_RULES.md §1-§7.
 *
 * @param {object} args
 * @param {Array}  args.tierPlans          buildTierMaterializationPlan's tierPlans
 * @param {Map}    args.profilesByTier     tier → Map(pool_race_id → profiler)
 * @param {Map}    args.archetypeByPoolRace
 * @param {string} args.firstRaceDay       "YYYY-MM-DD"
 * @param {number} args.realDays           antal kalenderdage (loebsdatoer)
 * @param {Array}  [args.kollisioner]      navnekollisioner fra katalog-augmentering
 * @param {"plan"|"db"} [args.tilstand]    HVOR raekkerne kom fra (#4573). "plan" =
 *   pakkerens output (fixture eller dry-run) — plan-invarianterne er maalt. "db" = den
 *   SKREVNE kalender laest read-only; plan-interne invarianter findes ikke i raekkerne og
 *   maales af verify-invariants.js i stedet (docs/CALENDAR_RULES.md §9c). Feltet styrer
 *   KUN hvad rapporten paastaar den har set — aldrig hvordan en regel doemmes.
 * @param {Array}  [args.unassessed]       raekker der ikke KUNNE vurderes (fx et loeb uden
 *   race_stage_profiles). #2854: fravaer af evidens maa aldrig ligne groent, saa de
 *   taeller ikke som regelbrud, men de goer heller ikke rapporten `ok`.
 */
export function scoreCalendarPlan({
  tierPlans = [], profilesByTier = new Map(), archetypeByPoolRace = new Map(),
  firstRaceDay, realDays, kollisioner = [], tilstand = "plan", unassessed = [],
} = {}) {
  const lastRaceDay = addCalendarDays(firstRaceDay, realDays - 1);
  const rapport = {
    tilstand, første: firstRaceDay, sidste: lastRaceDay, kalenderdage: realDays,
    kollisioner, unassessed, tiers: [],
  };
  const stageDays = [];

  for (const plan of tierPlans) {
    const pool = (plan.pools ?? [])[0] ?? { stageRows: [] };
    for (const s of pool.stageRows ?? []) {
      stageDays.push({ division: plan.tier, date: String(s.scheduled_at).slice(0, 10) });
    }
    rapport.tiers.push(scoreTierPlan({
      plan,
      profilesByPoolRaceId: profilesByTier.get(plan.tier) ?? new Map(),
      archetypeByPoolRace,
    }));
  }

  const dækning = detectEmptyCalendarDays({
    stageDays, from: firstRaceDay, to: lastRaceDay, divisions: tierPlans.map((p) => p.tier),
  });
  rapport.dækning = { ok: dækning.ok, violations: dækning.violations };

  // Saeson-aggregatet gates mod de RAA baand (stor n); pr. division mod baand +
  // stikproeve-tillaeg. Se stageFinaleMetrics.js for hvorfor der er to lag.
  rapport.sæsonFinale = mergeFinaleStats(rapport.tiers.map((t) => t.finale));
  rapport.sæsonFinaleViol = detectFinaleViolations({ stats: rapport.sæsonFinale, label: "sæson", strict: true });

  rapport.regelbrud = rapport.tiers.reduce((n, t) =>
    n + t.planViolations.length + t.coverageViol.length + t.compositionViol.length
      + t.orderViol.length + t.finaleViol.length, 0) + rapport.sæsonFinaleViol.length;

  // #4270's fire nye gates (§1b eksakt kvote, #4203 monument-i-GT, #3329 mindste-overlap,
  // §5's rolling-baand) taelles FOR SIG. De er roede i rapporten og stopper --apply, men de
  // aendrer IKKE #4215's eksisterende CI-dom (`regelbrud`/`ok`) - samme afgraensning som
  // §6b's uniforme maal og §6's strenge tolerance allerede har. Ellers ville en ejer-
  // beslutning om S4's kalender vaelte en groen gate for alt andet arbejde i repoet, og
  // monument-i-GT kan foerst blive groen naar pakkeren er aendret (#4203's eget spor).
  rapport.placeringsbrud = rapport.tiers.reduce((n, t) =>
    n + (t.quotaViol?.length ?? 0) + (t.monumentGtViol?.length ?? 0)
      + (t.minOverlapViol?.length ?? 0) + (t.terrainBandViol?.length ?? 0), 0);
  rapport.ok = rapport.regelbrud === 0 && dækning.ok && kollisioner.length === 0
    && unassessed.length === 0;
  return rapport;
}

/**
 * Grupper scorecardets fund i de kategorier en APPLY-gate kan handle paa.
 *
 * AFGRAENSNING: kun det seasonCalendarGate.gatePlan IKKE allerede doemmer.
 * gatePlan daekker plan-invarianter, daekningsbrud (#3327/#3328), etaperaekkefoelge,
 * K-B-komposition (saeson + pr. tier) og realisme-baandene. Dubleret gating ville
 * kun give dobbelt-udskrift af samme brud.
 *
 *   blocking       §2's "loeb hver kalenderdag" — ejer-laast 25/8, INGEN override
 *   applyBlocking  #4270's tre placerings-gates (3/9) — roede i scorecardet i BEGGE
 *                  koersler, men stopper kun --apply. INGEN override: ejeren har kaldt dem
 *                  haarde krav, og dry-runnet skal kunne koeres til ende for at MAALE hvor
 *                  langt der er igen (§5b's katalog-lofter kan ikke lukkes af en gate).
 *   finaleDrift    §7b's finale-baand pr. division + saesons-aggregatet
 *   uniformDrift   §6b's tre uniforme maal (itt/brosten/hoejbjerg)
 *
 * finale/uniform er balance-MAAL (samme klasse som kompositions-driften), ikke
 * korrekthedsinvarianter, og har derfor hvert sit override-flag i CLI'en.
 */
export function scorecardGateGroups(rapport) {
  const blocking = [];
  const applyBlocking = [];
  const finaleDrift = [];
  const uniformDrift = [];

  for (const v of rapport.dækning?.violations ?? []) blocking.push(`løb hver kalenderdag (§2) — ${v}`);
  for (const t of rapport.tiers) {
    for (const v of t.quotaViol ?? []) applyBlocking.push(`kvote-opfyldelse (§1b) — ${v}`);
    for (const v of t.terrainBandViol ?? []) applyBlocking.push(`rolling-bånd (§5) — ${v}`);
    for (const v of t.monumentGtViol ?? []) applyBlocking.push(`monument i GT-spænd (§4/#4203) — ${v}`);
    for (const v of t.minOverlapViol ?? []) applyBlocking.push(`mindste-overlap (§1/#3329) — ${v}`);
    for (const v of t.finaleViol) finaleDrift.push(`finale-bånd (§7b) — ${v}`);
    for (const v of t.uniformViol) uniformDrift.push(`uniformt mål (§6b) — ${v}`);
  }
  for (const v of rapport.sæsonFinaleViol ?? []) finaleDrift.push(`finale-bånd, sæson-aggregat (§7b) — ${v}`);

  return { blocking, applyBlocking, finaleDrift, uniformDrift };
}

/**
 * Menneske-laesbar rapport som linjer (samme layout alle kaldere printer).
 *
 * `rapport.tilstand === "db"` (#4573) aendrer INGEN dom — kun hvad rapporten paastaar den
 * har set: navnekollisioner er et katalog-begreb der ikke findes i en skreven kalender, og
 * plan-interne invarianter (§1's overlap-cap, §3's GT-rygrad/whitelist/dedup) kan ikke
 * udledes af raekkerne. De maales af verify-invariants.js mod prod (§9c) og duplikeres
 * bevidst ikke af to regelsaet der kan drifte fra hinanden.
 */
export function formatScorecard(rapport, { heading = "KALENDER-SCORECARD", katalogLinje = null } = {}) {
  const fraDb = rapport.tilstand === "db";
  const out = [];
  out.push(`\n${heading} — ${rapport.første} til ${rapport.sidste} (${rapport.kalenderdage} kalenderdage)`);
  if (katalogLinje) out.push(katalogLinje);
  if (!fraDb) out.push(`Navnekollisioner: ${rapport.kollisioner.length ? rapport.kollisioner.join(", ") : "ingen"}`);
  // #2854: kalenderen er skrevet, profilerne er ikke — det er fravaer af evidens, ikke
  // nul etaper, og det skal staa FOER tallene saa ingen laeser dem som fuldstaendige.
  if (rapport.unassessed?.length) {
    out.push(`\n!!  KUNNE IKKE VURDERES (${rapport.unassessed.length}) — rækker uden måleligt grundlag:`);
    for (const u of rapport.unassessed) out.push(`     · ${u}`);
  }
  out.push("");

  out.push(`${ok(rapport.dækning.ok)} LØB HVER KALENDERDAG (§2, #4218)`);
  for (const v of rapport.dækning.violations) out.push(`     ${v}`);

  for (const t of rapport.tiers) {
    out.push(`\n${"─".repeat(72)}\nDIVISION ${t.tier} — ${t.løb} løb, ${t.etaper} etaper, ${t.løbsdage} løbsdage, ${t.kalenderdage}/${rapport.kalenderdage} kalenderdage`);

    // §1b: EKSAKT 100 % (ejer-beslutning 3/9, #4270 — lukker §11 punkt 4). Hverken 99
    // eller 101: kvoten ER antallet af loebsdage divisionens tidsplan har.
    if (t.quota != null) {
      out.push(`  ${ok((t.quotaViol?.length ?? 0) === 0)} Kvote (§1b, eksakt 100 %): ${t.totalGameDays ?? "?"} af ${t.quota} løbsdage${t.shortfall ? ` · mangler ${t.shortfall}` : ""}`);
      for (const v of t.quotaViol ?? []) out.push(`     ! ${v}`);
    }

    const share = t.coverage?.oneDayShare ?? 0;
    const målShare = TIER_ONE_DAY_SHARE_TARGET[t.tier], minShare = TIER_ONE_DAY_SHARE_MIN[t.tier];
    out.push(`  ${ok(share >= minShare)} Endagsløb (§4): ${t.coverage?.oneDayRaces ?? "?"} af ${t.løb} = ${pct(share)} (mål ${pct(målShare)}, min ${pct(minShare)})`);

    // §5: gulve for alle seks familier + #4270's loft paa `rolling`. classic taeller nu
    // med i hilly (#4270), saa ingen etape falder uden for taellingen laengere.
    const fam = t.coverage?.familyCounts ?? {};
    const gulve = TIER_TERRAIN_FAMILY_MIN[t.tier] ?? {};
    const lofter = TIER_TERRAIN_FAMILY_MAX[t.tier] ?? {};
    const famNavne = [...new Set([...Object.keys(gulve), ...Object.keys(lofter)])];
    const famBrud = (f) => (fam[f] ?? 0) < (gulve[f] ?? 0) || (lofter[f] != null && (fam[f] ?? 0) > lofter[f]);
    const famLinje = famNavne.map((f) => {
      const har = fam[f] ?? 0, skal = gulve[f], loft = lofter[f];
      const krav = loft != null ? `${skal ?? 0}-${loft}` : `${skal}`;
      return `${f} ${har}/${krav}${famBrud(f) ? " ✗" : ""}`;
    }).join(" · ");
    out.push(`  ${ok(!famNavne.some(famBrud))} Terræn-gulve + rolling-bånd (§5): ${famLinje}${t.coverage?.classicStages ? ` · (heraf classic ${t.coverage.classicStages}, tælles i hilly)` : ""}`);
    for (const v of t.terrainBandViol ?? []) out.push(`     ! ${v}`);

    const c = t.composition?.pct ?? {};
    const komp = Object.keys(ACTIVE_TARGET).filter((k) => ACTIVE_TARGET[k] > 0).map((k) => {
      const har = Number(c[k] ?? 0), mål = ACTIVE_TARGET[k];
      return `${CATEGORY_LABELS[k] ?? k} ${har.toFixed(0)}/${mål}${Math.abs(har - mål) > TIER_COMPOSITION_TOLERANCE_PP[t.tier] ? " ✗" : ""}`;
    }).join(" · ");
    out.push(`  ${ok(t.compositionViol.length === 0)} Komposition (§6, gated ±${TIER_COMPOSITION_TOLERANCE_PP[t.tier]} pp): ${komp}`);
    out.push(`  --  Komposition mod §6's STRENGE ±${COMPOSITION_TOLERANCE_PP} pp (rapport, §10 modsigelse 2): ${t.compositionStrictViol.length} afvigelse(r)`);
    for (const v of t.compositionStrictViol) out.push(`       ~ ${v}`);

    const u = t.uniform?.pct ?? {};
    const uniLinje = TIER_UNIFORM_TARGET_CATEGORIES.map((k) => {
      const har = Number(u[k] ?? 0), mål = (TIER_UNIFORM_TARGET_FRACTIONS[k] ?? 0) * 100;
      return `${k} ${har.toFixed(1)}/${mål}${Math.abs(har - mål) > TIER_UNIFORM_TOLERANCE_PP ? " ✗" : ""}`;
    }).join(" · ");
    out.push(`  ${ok(t.uniformViol.length === 0)} Uniforme mål (§6b, ±${TIER_UNIFORM_TOLERANCE_PP} pp): ${uniLinje}`);
    for (const v of t.uniformViol) out.push(`       ~ ${v}`);

    const finishMountain = t.order?.mountainFinishPct;
    if (Number.isFinite(finishMountain)) {
      out.push(`  ${ok(finishMountain <= STAGE_ORDER_TARGETS.mountain_finish_max_pct)} Etapeløb der slutter på bjerg (§7): ${finishMountain.toFixed(1)} % (maks ${STAGE_ORDER_TARGETS.mountain_finish_max_pct} %) · flad slutning ${(t.order?.flatFinishPct ?? 0).toFixed(1)} % · ITT-slutning ${(t.order?.ittFinishPct ?? 0).toFixed(1)} %`);
    }
    out.push(`  ${ok(t.finaleViol.length === 0)} Finale-bånd pr. terræn (§7b) — slutter nedad i alt: ${t.descent} af ${t.etaper} = ${pct(t.descentAndel)}`);
    for (const p of Object.keys(TERRAIN_FINALE_BANDS)) {
      const slot = t.finale.byProfile?.[p];
      if (!slot?.total) continue;
      const bands = TERRAIN_FINALE_BANDS[p];
      const celler = FINALE_CLASSES
        .filter((cl) => bands[cl] || slot.pct[cl] > 0)
        .map((cl) => {
          const [lo, hi] = bands[cl] ?? [0, 0];
          const got = slot.pct[cl];
          return `${CLASS_LABELS[cl]} ${got.toFixed(0)}%${got < lo || got > hi ? `✗[${lo}-${hi}]` : ""}`;
        });
      const lille = slot.total < MIN_SAMPLE ? " (n<min, kun rapport)" : "";
      out.push(`      ${p.padEnd(14)} n=${String(slot.total).padStart(3)}  ${celler.join(" · ")}${lille}`);
    }
    const o = t.finale.overall;
    out.push(`      ${"SAMLET".padEnd(14)} n=${String(t.finale.total).padStart(3)}  ` +
      Object.entries(OVERALL_FINALE_BAND).map(([cl, [lo, hi]]) => {
        const got = o.pct[cl];
        return `${CLASS_LABELS[cl]} ${got.toFixed(1)}%${got < lo || got > hi ? `✗[${lo}-${hi}]` : ""}`;
      }).join(" · ") + ` · ${CLASS_LABELS.tt} ${o.pct.tt.toFixed(1)}%`);
    if (t.finaleRaw.length && !t.finaleViol.length) {
      out.push(`      (${t.finaleRaw.length} afvigelse(r) fra det rå bånd bæres af stikprøve-tillægget — se ✗)`);
    }

    // §1: baade toppen (cap, laast 28/6) og bunden (#3329, ejer 3/9). Histogrammet staar
    // med, fordi "maks 3" og "min 1" hver for sig skjuler hvor mange dage der er tynde.
    // #4687's DB-tilstand maaler dem ikke: overlap og plan-invarianter har deres eget
    // prod-niveau (verify-invariants.js / calendarOverlapInvariant.js, §9c), og
    // monument-i-GT + mindste-overlap regnes ud af PLANENS to-akse-form.
    if (fraDb) {
      out.push(`  --  Samtidige løb pr. løbsdag (§1) + mindste-overlap (§1/#3329) + monument uden for GT-spænd (§4/#4203) + plan-invarianter (§3): IKKE målt her — de har eget prod-niveau i verify-invariants.js / calendarOverlapInvariant.js (§9c)`);
    } else {
      const gd = t.gameDayOverlap ?? {};
      const hist = Object.keys(gd.histogram ?? {}).sort((a, b) => Number(a) - Number(b))
        .map((n) => `${n} løb: ${gd.histogram[n]} dage`).join(" · ");
      out.push(`  ${ok((t.maxOverlap ?? 0) <= (t.overlapCap ?? 99))} Samtidige løb pr. løbsdag (§1): maks ${t.maxOverlap} (cap ${t.overlapCap})`);
      out.push(`  ${ok((t.minOverlapViol?.length ?? 0) === 0)} Mindste-overlap (§1/#3329): min ${gd.minOverlap ?? "?"} (krav ${t.overlapMin ?? "ingen bund sat"}) · ${(100 * (gd.multiRaceShare ?? 0)).toFixed(1)} % af løbsdagene har ≥2 løb (gulv ${t.multiRaceShareMin != null ? `${(100 * t.multiRaceShareMin).toFixed(0)} %` : "ikke sat"}) · ${hist}`);
      for (const v of t.minOverlapViol ?? []) out.push(`     ! ${v}`);
      out.push(`  ${ok((t.monumentGtViol?.length ?? 0) === 0)} Monument uden for GT-spænd (§4/#4203, løbsdags-aksen): ${t.monumentGtViol?.length ?? 0} brud`);
      for (const v of t.monumentGtViol ?? []) out.push(`     ! ${v}`);
      out.push(`  ${ok((t.planViolations?.length ?? 0) === 0)} Plan-invarianter (§3 GT, whitelist, dedup): ${t.planViolations.length} brud`);
      for (const v of t.planViolations.slice(0, 5)) out.push(`     ${v}`);
    }
    // "!" = brud der taeller i `regelbrud` (og dermed i exit-koden). §6b's uniforme maal
    // og §6's strenge tolerance staar med "~" ovenfor: de RAPPORTERES her og gates i
    // buildSeasonCalendar.js's apply-sti bag hvert sit override-flag, men maa ikke
    // aendre dommen i det eksisterende CI-scorecard (#4215) uden en ejer-beslutning.
    for (const v of [...t.coverageViol, ...t.compositionViol, ...t.orderViol, ...t.finaleViol].slice(0, 10)) out.push(`     ! ${v}`);
  }

  out.push(`\n${"═".repeat(72)}`);
  out.push(`${ok(rapport.sæsonFinaleViol.length === 0)} SÆSON-AGGREGAT, finale-bånd uden stikprøve-tillæg (${rapport.sæsonFinale.total} etaper)`);
  for (const v of rapport.sæsonFinaleViol) out.push(`     ! ${v}`);
  out.push(`SAMLET: ${rapport.regelbrud} regelbrud`
    + ` · ${rapport.placeringsbrud ?? 0} placeringsbrud (#4270, stopper --apply)`
    + ` · dækning ${rapport.dækning.ok ? "OK" : "HULLER"}`
    + (fraDb ? "" : ` · ${rapport.kollisioner.length} navnekollisioner`)
    + (rapport.unassessed?.length ? ` · ${rapport.unassessed.length} kunne ikke vurderes` : ""));
  out.push(rapport.ok
    ? "Kalenderen overholder alle gates i docs/CALENDAR_RULES.md.\n"
    : "Se linjerne markeret FEJL / ! ovenfor.\n");
  return out;
}
