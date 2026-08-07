// backend/lib/seasonCalendarGate.js
// #3469 (leverance 5): gatePlan EKSTRAHERET fra scripts/buildSeasonCalendar.js til lib/,
// så BEGGE veje der kan materialisere en sæson-kalender (den manuelle CLI OG
// seasonTransition.js's `auto_calendar_enabled`-forever-sti, fase 17) kører PRÆCIS
// samme gate — ren funktion, ingen DB. Før denne udtrækning kørte kun CLI'en gaten;
// forever-stien kaldte materializeTierCalendars direkte og sprang etaperækkefølge,
// komposition, kvote-hul og udtømt realisme-re-draw over (se seasonTransition.js's
// season_calendar-fase-docstring for hvordan resultatet bruges).
//
// scripts/buildSeasonCalendar.js re-eksporterer denne funktion uændret — CLI'ens egen
// import-sti (`./buildSeasonCalendar.js`) er derfor stadig gyldig for eksisterende
// kaldere/tests.

import { aggregateCompositionStats, detectCompositionViolations, ACTIVE_TARGET } from "./calendarCompositionTargets.js";
import { detectStageOrderViolations } from "./stageOrderMetrics.js";
import { scoreSeason, TIER_TARGETS } from "./raceRouteRealismMetrics.js";
import { resolveSeasonDraw } from "./raceRouteRealismDraw.js";

/**
 * Kør alle gates på en dry-run-plan (materializeTierCalendars-summary med dryRun:true).
 * Ren funktion af summary'en, så beslutningen kan testes uden DB.
 *
 * @param {object} summary materializeTierCalendars({ ..., dryRun: true })'s returværdi
 * @param {{allowTierCompositionDrift?:boolean}} [opts] #3469 (leverance 4): pr.-tier
 *   kompositions-brud (detectCompositionViolations({applyMinRaceDayTolerance:true}) pr.
 *   tier, IKKE kun sæson-aggregatet) er en NY kategori, adskilt fra `compositionDrift`
 *   (sæson-niveau, #3295). Default (false) gater HÅRDT — samme som de øvrige nye #3469-
 *   gates. `allowTierCompositionDrift:true` lemper PRÆCIS denne ene kategori (CLI-flaget
 *   `--allow-tier-composition-drift`), analogt med `--allow-composition-drift` for
 *   sæson-aggregatet. seasonTransition.js's forever-sti lader denne stå på default
 *   (false) — en automatisk transition skal ALDRIG selv acceptere en afvigelse, kun en
 *   menneske-kørt CLI-session med et eksplicit flag må det.
 * @returns {{blocking:string[], compositionDrift:string[], tierCompositionDrift:string[], severity:number, report:object}}
 *   blocking              brud der ALDRIG må overrides
 *   compositionDrift      K-B-afvigelser PÅ SÆSON-AGGREGATET (kan lempes med --allow-composition-drift)
 *   tierCompositionDrift  K-B-afvigelser PR. TIER (#3469) — lempes separat med
 *                         --allow-tier-composition-drift; ELLERS rykket ind i `blocking`
 *   severity               samlet numerisk afstand til båndene (0 = alt grønt) — lader en
 *                     søgning se delvis fremgang, hvor antal-brud ser nul
 */
export function gatePlan(summary, { allowTierCompositionDrift = false } = {}) {
  const blocking = [];
  const compositionDrift = [];
  const tierCompositionDrift = [];

  const tierEntries = [];
  for (const t of summary.tiers) {
    for (const v of t.calendarViolations ?? []) blocking.push(`kalender-invariant — ${v}`);

    if (!t.compositionStats || t.compositionStats.raceDays === 0) {
      blocking.push(`tier ${t.tier}: 0 løbsdage i planen — kalenderen ville være tom`);
      continue;
    }
    if (t.quotaHit === false && t.shortfall > 3) {
      // Små huller (1-3 dage) er katalog-knaphed og accepteret; et stort hul betyder at
      // selection fejlede og kalenderen ville have tomme perioder.
      blocking.push(`tier ${t.tier}: kvoten mangler ${t.shortfall} game-days — for stort hul til at materialisere`);
    }
    for (const v of detectStageOrderViolations({ stats: t.stageOrderStats, label: `tier ${t.tier}` })) {
      blocking.push(`etaperækkefølge (#3326) — ${v}`);
    }

    // #3469 (leverance 4): pr.-tier K-B-komposition. FØR denne ændring gatede
    // buildSeasonCalendar.js kun SÆSON-AGGREGATET (compositionDrift nedenfor) — en tier
    // kunne afvige markant fra K-B og forsvinde i sæson-gennemsnittet, hvis en anden tier
    // afveg den modsatte vej. applyMinRaceDayTolerance:true bruger SAMME skalerede
    // tolerance som #3295's egen dokumentation anbefaler for små stikprøver (tier 4 har
    // kun 56 løbsdage — ±2 pp der er reelt ±1 etape) i stedet for en fast ±2 pp der ville
    // være urealistisk stram for de mindre tiers.
    const { violations: tierDrift } = detectCompositionViolations({
      stats: t.compositionStats, target: ACTIVE_TARGET, label: `tier ${t.tier}`, applyMinRaceDayTolerance: true,
    });
    if (tierDrift.length) {
      if (allowTierCompositionDrift) tierCompositionDrift.push(...tierDrift);
      else for (const v of tierDrift) blocking.push(`pr.-tier komposition (#3469) — ${v}`);
    }

    if (Array.isArray(t.seedRaces) && t.seedRaces.length) tierEntries.push({ tier: t.tier, seedRaces: t.seedRaces });
  }

  // Realisme-båndene scores på det RESOLVEREDE træk — samme tal skrive-stien persisterer.
  // `severity` er den samlede NUMERISKE afstand til båndene, ikke bare antal brud. Antal
  // alene er en for grov ledetråd for en søgning: tier 3's summit-bånd lukkes først af
  // FLERE nye løb, så ingen enkelt kandidat fjerner bruddet, og en søgning der kun tæller
  // brud ser dem alle som værdiløse. Afstanden (summit 5 → 6 → 7 → 8) viser fremgangen.
  let severity = 0;
  if (tierEntries.length) {
    const draws = resolveSeasonDraw({ tierSeedRaces: tierEntries });
    const realism = scoreSeason(draws.map((d) => d.entry));
    for (const f of realism.failures) blocking.push(`realisme-bånd — ${f}`);
    for (const t of realism.tiers) {
      const s = t.score, tgt = TIER_TARGETS[t.tier] ?? {};
      if (tgt.summit_min != null) severity += Math.max(0, tgt.summit_min - s.summit_finishes);
      if (tgt.mdown_max_pct != null) severity += Math.max(0, s.mdown_pct - tgt.mdown_max_pct) / 5;
      if (tgt.itt_min != null) severity += Math.max(0, tgt.itt_min - s.standalone_itt) * 3;
      if (tgt.cobbles_min != null) severity += Math.max(0, tgt.cobbles_min - s.cobbles_in_stagerace) * 3;
      // #3469 finale-gulve — samme afstands-princip som ovenstående.
      if (tgt.bunch_sprint_min != null) severity += Math.max(0, tgt.bunch_sprint_min - s.bunch_sprint_stage_days);
      if (tgt.descent_finale_min != null) severity += Math.max(0, tgt.descent_finale_min - s.descent_finale_stage_days);
      if (tgt.solo_tt_final_min != null) severity += Math.max(0, tgt.solo_tt_final_min - s.solo_tt_final_races) * 3;
    }
  } else {
    blocking.push("ingen tier leverede et løbssæt at score realisme på");
    severity += 100;
  }
  severity += blocking.filter((b) => !b.startsWith("realisme-bånd")).length * 10;

  const season = aggregateCompositionStats(
    summary.tiers.map((t) => t.compositionStats).filter((s) => s && s.raceDays > 0)
  );
  const { rows, violations } = detectCompositionViolations({ stats: season, target: ACTIVE_TARGET, label: "sæson" });
  compositionDrift.push(...violations);

  return { blocking, compositionDrift, tierCompositionDrift, severity, report: { season, rows } };
}
