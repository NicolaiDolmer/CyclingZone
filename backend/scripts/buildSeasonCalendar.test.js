// backend/scripts/buildSeasonCalendar.test.js
// #3469 (leverance 4): pr.-tier K-B-kompositions-gate i gatePlan(). FØR denne ændring
// gatede buildSeasonCalendar.js kun SÆSON-AGGREGATET (compositionDrift, #3295) — en
// enkelt tier kunne afvige markant og forsvinde i sæson-gennemsnittet, hvis en anden
// tier afveg den modsatte vej. Ren funktion (gatePlan er DB-fri) → testbar uden Supabase.

import test from "node:test";
import assert from "node:assert/strict";
import { gatePlan } from "./buildSeasonCalendar.js";
import { computeCompositionStats } from "../lib/calendarCompositionTargets.js";

// Minimal, gyldig tier-plan-fixture. `seedRaces` udelades bevidst (null) i de fleste
// tests — det udløser gatePlan's "ingen tier leverede et løbssæt at score realisme på"
// (en forventet, ikke-relateret blocking-post), så testene asserter med `.some()`/
// `.includes()` i stedet for at kræve en tom `blocking`-liste. Kun testen der specifikt
// dækker "alt grønt" bygger ægte seedRaces.
function tierPlan({ tier, stages, seedRaces = null, quotaHit = true, shortfall = 0 }) {
  return {
    tier, calendarViolations: [], quotaHit, shortfall,
    compositionStats: computeCompositionStats([{ stages }]),
    stageOrderStats: null,
    seedRaces,
  };
}

const stagesOf = (profileType, n) => Array.from({ length: n }, () => ({ profile_type: profileType }));

test("gatePlan: en tier der er 100% flad (langt fra K-B's 24%) gates som blocking (#3469, default)", () => {
  const summary = { tiers: [tierPlan({ tier: 4, stages: stagesOf("flat", 56) })] };
  const { blocking, tierCompositionDrift } = gatePlan(summary);

  assert.ok(blocking.some((b) => b.includes("pr.-tier komposition (#3469)") && b.includes("tier 4") && b.includes("flad")), blocking.join(" · "));
  assert.deepEqual(tierCompositionDrift, [], "uden flaget rykkes bruddet ind i blocking, ikke den lempede liste");
});

test("gatePlan: --allow-tier-composition-drift flytter bruddet fra blocking til tierCompositionDrift", () => {
  const summary = { tiers: [tierPlan({ tier: 4, stages: stagesOf("flat", 56) })] };
  const { blocking, tierCompositionDrift } = gatePlan(summary, { allowTierCompositionDrift: true });

  assert.ok(!blocking.some((b) => b.includes("pr.-tier komposition")), blocking.join(" · "));
  assert.ok(tierCompositionDrift.some((v) => v.includes("tier 4") && v.includes("flad")), tierCompositionDrift.join(" · "));
});

test("gatePlan: en tier der rammer K-B inden for tolerancen giver INGEN pr.-tier-brud", () => {
  // K-B (ACTIVE_TARGET): flad 24 · kuperet 32 · bjerg 28 · ITT 10 · brosten 6 · TTT 0.
  // Byg 100 løbsdage der matcher profilen præcist.
  const stages = [
    ...stagesOf("flat", 24), ...stagesOf("hilly", 32), ...stagesOf("mountain", 28),
    ...stagesOf("itt", 10), ...stagesOf("cobbles", 6),
  ];
  const summary = { tiers: [tierPlan({ tier: 3, stages })] };
  const { blocking, tierCompositionDrift } = gatePlan(summary);

  assert.ok(!blocking.some((b) => b.includes("pr.-tier komposition")), blocking.join(" · "));
  assert.deepEqual(tierCompositionDrift, []);
});

test("gatePlan: pr.-tier-gaten fanger en afvigelse SÆSON-AGGREGATET ville have skjult", () => {
  // Tier A 100% flad, tier B 100% bjerg — season-aggregatet (vægtet ligeligt her, 56+56)
  // lander midt imellem og kan sagtens ramme K-B's ±tolerance, men INGEN af de to tiers
  // gør det hver for sig.
  const summary = {
    tiers: [
      tierPlan({ tier: 3, stages: stagesOf("flat", 56) }),
      tierPlan({ tier: 4, stages: stagesOf("mountain", 56) }),
    ],
  };
  const { blocking } = gatePlan(summary);
  assert.ok(blocking.some((b) => b.includes("tier 3") && b.includes("pr.-tier komposition")), blocking.join(" · "));
  assert.ok(blocking.some((b) => b.includes("tier 4") && b.includes("pr.-tier komposition")), blocking.join(" · "));
});

test("gatePlan: pr.-tier-tolerancen skalerer med stikprøvestørrelse (samme princip som #3295)", () => {
  // En lille tier (fx 8 løbsdage) hvor ÉT løb flytter langt mere end ±2pp bruger den
  // udvidede min-race-day-tolerance (applyMinRaceDayTolerance:true), ikke den faste ±2pp.
  const stages = [...stagesOf("flat", 2), ...stagesOf("hilly", 3), ...stagesOf("mountain", 2), ...stagesOf("itt", 1)];
  const summary = { tiers: [tierPlan({ tier: 4, stages })] };
  const { blocking } = gatePlan(summary);
  assert.ok(!blocking.some((b) => b.includes("pr.-tier komposition")), `lille stikprøve skal have udvidet tolerance: ${blocking.join(" · ")}`);
});

test("gatePlan: tomme tiers (0 løbsdage) rammer den EKSISTERENDE 'tom kalender'-gate, ikke kompositions-gaten", () => {
  const summary = { tiers: [{ tier: 4, calendarViolations: [], quotaHit: false, shortfall: 56, compositionStats: computeCompositionStats([]), stageOrderStats: null, seedRaces: null }] };
  const { blocking } = gatePlan(summary);
  assert.ok(blocking.some((b) => b.includes("0 løbsdage i planen")), blocking.join(" · "));
  assert.ok(!blocking.some((b) => b.includes("pr.-tier komposition")), "0-løbsdages-tieren continue'r FØR kompositions-checket rammes");
});
