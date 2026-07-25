import test from "node:test";
import assert from "node:assert/strict";
import {
  generateOffers,
  SPONSOR_NAME_POOL,
  FULL_CALENDAR_DAYS,
  guaranteedFractionForLength,
} from "./sponsorOffers.js";

const ctx = { teamId: "team-1", seasonNumber: 2, renownTargetValue: 520000 };

// Mirror af NAME_POOLS i sponsorOffers.js (ikke selv eksporteret) — bruges KUN
// til at verificere at hvert navn kommer fra den arketype-specifikke pulje,
// ikke bare den samlede SPONSOR_NAME_POOL.
const NAME_POOLS_MIRROR = {
  safe: [
    "Meridian Bank", "Halvorsen Bank", "Provincia Forsikring", "Polaris Insurance",
    "Verema Pharma", "Brandt Pharma", "Sundberg Group", "Aurelia Jewelers",
    "Ravensburg Glass", "Lumen Optics",
  ],
  loyal: [
    "Falcon Logistics", "Thorne Logistics", "Nordhavn Shipping", "Granvik Maritime",
    "Nilsen Marine", "Dalmar Cement", "Rendal Timber", "Ferro Metals",
    "Borealis Steel", "Hartmann Bau", "Petra Stone", "Stenmark Tools",
  ],
  racing: [
    "Alta Cycles", "Kestrel Outdoor", "Aiden Outdoor", "Cobalt Mobility",
    "Vanguard Motors", "Northwind Energy", "Mistral Energy", "Eldfell Geothermal",
    "Calluna Botanics",
  ],
  results: [
    "Vesna Robotics", "Sable Aerospace", "Corvus Aviation", "Saber Security",
    "Halcyon Telecom", "Vossberg Optics", "Cygnus Media", "Bjarke Design",
  ],
  ambition: [
    "Larkin Brewing", "Brennan Whisky", "Drummond Whisky", "Marisol Wines",
    "Castell Vineyards", "Tagliani Olive", "Marquez Coffee", "Otero Foods",
    "Wexler Foods", "Solveig Dairy", "Kettler & Vos",
  ],
};

test("genererer præcis 5 tilbud (#2948: 5 arketyper)", () => {
  assert.equal(generateOffers(ctx).length, 5);
  const variants = generateOffers(ctx).map((o) => o.variant).sort();
  assert.deepEqual(variants, ["ambition", "loyal", "racing", "results", "safe"].sort());
});

test("er deterministisk på samme input (ingen reroll ved reload)", () => {
  assert.deepEqual(generateOffers(ctx), generateOffers(ctx));
});

test("samme seed (team+season) → samme navne på tværs af kald", () => {
  const a = generateOffers(ctx).map((o) => o.sponsorName);
  const b = generateOffers({ ...ctx }).map((o) => o.sponsorName);
  assert.deepEqual(a, b);
});

test("forskellige hold/sæsoner → forskellige navne", () => {
  const a = generateOffers(ctx).map((o) => o.sponsorName);
  const b = generateOffers({ ...ctx, teamId: "team-2" }).map((o) => o.sponsorName);
  assert.notDeepEqual(a, b);
});

test("navne kommer fra den ARKETYPE-SPECIFIKKE pulje, ikke bare den samlede pulje", () => {
  for (const o of generateOffers(ctx)) {
    const pool = NAME_POOLS_MIRROR[o.variant];
    assert.ok(pool, `ukendt variant ${o.variant}`);
    assert.ok(
      pool.includes(o.sponsorName),
      `${o.variant}-tilbuddets navn "${o.sponsorName}" skal komme fra ${o.variant}-puljen`,
    );
    // Sanity: også med i den samlede eksporterede pulje.
    assert.ok(SPONSOR_NAME_POOL.includes(o.sponsorName));
  }
});

test("guaranteedBase = round(renownTarget × guaranteedFraction) for hver arketype", () => {
  const expectedFraction = {
    safe: 0.92, loyal: 0.78, racing: 0.5, results: 0.55, ambition: 0.7,
  };
  for (const o of generateOffers(ctx)) {
    assert.equal(o.guaranteedFraction, expectedFraction[o.variant]);
    assert.equal(o.guaranteedBase, Math.round(ctx.renownTargetValue * expectedFraction[o.variant]));
  }
});

test("perRaceDayRate rekonstruerer ≈ (guaranteedFraction+raceDayShare) × target ved default-kalender", () => {
  for (const o of generateOffers(ctx)) {
    const reconstructed = o.guaranteedBase + o.perRaceDayRate * FULL_CALENDAR_DAYS;
    const expectedTotal = ctx.renownTargetValue * (o.guaranteedFraction + o.raceDayShare);
    // Afrunding pr. variant (guaranteedBase + raceDayPool afrundes hver for sig,
    // og perRaceDayRate afrundes igen ved division) → tillad lille afvigelse.
    assert.ok(
      Math.abs(reconstructed - expectedTotal) < FULL_CALENDAR_DAYS,
      `${o.variant}: rekonstrueret ${reconstructed} bør være ≈ ${expectedTotal}`,
    );
  }
});

test("klausul-amounts er frosset til round(renownTarget × share) — intet 'share'-felt tilbage", () => {
  const expectedShares = {
    safe: [],
    loyal: [{ type: "signing", share: 0.08 }],
    racing: [],
    results: [
      { type: "stage_win", share: 0.018 },
      { type: "podium", share: 0.007 },
      { type: "results_cap", share: 0.5 },
    ],
    ambition: [{ type: "season_objective", objective: "top_half", share: 0.18 }],
  };
  for (const o of generateOffers(ctx)) {
    const expected = expectedShares[o.variant];
    assert.equal(o.clauses.length, expected.length, `${o.variant}: forkert antal klausuler`);
    o.clauses.forEach((clause, i) => {
      const { share, ...restExpected } = expected[i];
      assert.equal(clause.amount, Math.round(ctx.renownTargetValue * share));
      // Alle andre felter (type, objective) bevares uændret; 'share' er væk.
      for (const [k, v] of Object.entries(restExpected)) {
        assert.equal(clause[k], v);
      }
      assert.equal(clause.share, undefined, "share-feltet må ikke overleve freezeClauses");
    });
  }
});

test("safe/racing har ingen klausuler; loyal har kun signing; results har stage_win+podium+results_cap; ambition har kun season_objective", () => {
  const byVariant = Object.fromEntries(generateOffers(ctx).map((o) => [o.variant, o]));
  assert.deepEqual(byVariant.safe.clauses, []);
  assert.deepEqual(byVariant.racing.clauses, []);
  assert.deepEqual(byVariant.loyal.clauses.map((c) => c.type), ["signing"]);
  assert.deepEqual(byVariant.results.clauses.map((c) => c.type), ["stage_win", "podium", "results_cap"]);
  assert.deepEqual(byVariant.ambition.clauses.map((c) => c.type), ["season_objective"]);
  assert.equal(byVariant.ambition.clauses[0].objective, "top_half");
});

test("lengthSeasons matcher arketype-definitionen (safe/racing=1, results/ambition=2, loyal=3)", () => {
  const byVariant = Object.fromEntries(generateOffers(ctx).map((o) => [o.variant, o]));
  assert.equal(byVariant.safe.lengthSeasons, 1);
  assert.equal(byVariant.racing.lengthSeasons, 1);
  assert.equal(byVariant.results.lengthSeasons, 2);
  assert.equal(byVariant.ambition.lengthSeasons, 2);
  assert.equal(byVariant.loyal.lengthSeasons, 3);
});

test("guaranteedFractionForLength (legacy-fallback) er uændret: 0.88/0.55/0.73 for length 1/2/3", () => {
  assert.equal(guaranteedFractionForLength(1), 0.88);
  assert.equal(guaranteedFractionForLength(2), 0.55);
  assert.equal(guaranteedFractionForLength(3), 0.73);
});

test("guaranteedFractionForLength returnerer null for ukendt length_seasons", () => {
  assert.equal(guaranteedFractionForLength(7), null);
  assert.equal(guaranteedFractionForLength(undefined), null);
});
