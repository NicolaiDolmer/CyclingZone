// #5405: reuse the existing bounded route variants, but choose them against the
// season's actual gates together. No new seeds, relaxed targets or DB access.
import { drawTierAttempt, MAX_REALISM_DRAW_ATTEMPTS } from './raceRouteRealismDraw.js';
import { generateRaceStageProfiles } from './raceStageProfileGenerator.js';
import { scoreTierPlan } from './calendarScorecardReport.js';
import { mergeFinaleStats, detectFinaleViolations } from './stageFinaleMetrics.js';
import { aggregateCompositionStats, detectCompositionViolations } from './calendarCompositionTargets.js';

export function chooseCalendarDraw({ baseline, choices, accepts }) {
  if (accepts(baseline)) return { draws: baseline, exhausted: false };
  let winner = null;
  function visit(selected) {
    if (selected.length === choices.length) {
      if (accepts(selected)) winner = selected;
      return;
    }
    for (const choice of choices[selected.length]) {
      visit([...selected, choice]);
      if (winner) return;
    }
  }
  if (choices.length && choices.every(c => c.length)) visit([]);
  return { draws: winner || baseline, exhausted: !winner };
}

export function resolveCalendarFinaleDraw({ tierPlans, seedRacesByTier, archetypeByPoolRace,
  generateProfiles = generateRaceStageProfiles, archetypeProfilesByTier = new Map(), maxAttempts = MAX_REALISM_DRAW_ATTEMPTS }) {
  const plans = [...tierPlans].sort((a, b) => a.tier - b.tier);
  const cache = new Map();
  function candidate(plan, attempt) {
    const key = `${plan.tier}:${attempt}`;
    if (cache.has(key)) return cache.get(key);
    const profiles = new Map();
    const draw = drawTierAttempt({ tier: plan.tier, seedRaces: seedRacesByTier.get(plan.tier) || [], attempt,
      generateProfiles: race => {
        const generated = generateProfiles(race, { archetypeProfiles: archetypeProfilesByTier.get(plan.tier) });
        profiles.set(race.id, generated);
        return generated;
      } });
    const report = scoreTierPlan({ plan, profilesByPoolRaceId: profiles, archetypeByPoolRace });
    const failures = [...draw.failures, ...draw.entry.errors, ...report.coverageViol, ...report.terrainBandViol,
      ...report.compositionViol, ...report.uniformViol, ...report.orderViol, ...report.finaleViol];
    const result = { ...draw, tier: plan.tier, attempt, profiles, report, failures,
      legacyPass: draw.failures.length === 0 && draw.entry.errors.length === 0 };
    cache.set(key, result);
    return result;
  }
  const limit = Math.max(1, Math.min(MAX_REALISM_DRAW_ATTEMPTS, Number(maxAttempts) || 1));
  const baseline = plans.map(plan => {
    for (let attempt = 0; attempt < limit; attempt++) {
      const c = candidate(plan, attempt);
      if (c.legacyPass) return c;
    }
    return candidate(plan, 0);
  });
  const accepts = draws => {
    if (!draws.length || draws.some(d => d.failures.length)) return false;
    const finale = mergeFinaleStats(draws.map(d => d.report.finale));
    const composition = aggregateCompositionStats(draws.map(d => d.report.composition));
    return detectFinaleViolations({ stats: finale, strict: true }).length === 0
      && detectCompositionViolations({ stats: composition, label: 'season' }).violations.length === 0;
  };
  const choices = accepts(baseline) ? [] : plans.map(plan => Array.from({ length: limit }, (_, attempt) => candidate(plan, attempt)).filter(d => !d.failures.length));
  const selected = chooseCalendarDraw({ baseline, choices, accepts });
  return { exhausted: selected.exhausted,
    byTier: new Map(selected.draws.map(d => [d.tier, { ...d, exhausted: !d.legacyPass,
      attemptsTried: [...cache.values()].filter(c => c.tier === d.tier).length,
      firstDrawFailures: candidate(plans.find(p => p.tier === d.tier), 0).failures }])) };
}
