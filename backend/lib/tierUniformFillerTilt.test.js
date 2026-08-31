// backend/lib/tierUniformFillerTilt.test.js
// #4103 (ejer-beslutning 31/8): tests af §6b-vægt-afledningen — tiltFactorFor/
// deriveUniformTierTilt (den matematiske afledning) og tiltFillerForUniformTargets/
// applyUniformTierTilt (anvendelsen på ARCHETYPE_PROFILES). Ren funktion → ingen
// DB/RNG, ingen fuld pipeline-simulering (det er en opfølgende, separat opgave — se
// fil-docstringen).

import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_WEIGHT, TILT_MIN, TILT_MAX, MEASURED_TIER_BASELINE_20260830,
  tiltFactorFor, deriveUniformTierTilt, TIER_UNIFORM_TILT_BY_TIER,
  tiltFillerForUniformTargets, applyUniformTierTilt,
} from "./tierUniformFillerTilt.js";
import { TIER_UNIFORM_TARGET_FRACTIONS, TIER_UNIFORM_TARGET_CATEGORIES } from "./calendarCompositionTargets.js";
import { ARCHETYPE_PROFILES } from "./raceStageProfileGenerator.js";

// ── tiltFactorFor ────────────────────────────────────────────────────────────────

test("tiltFactorFor: mål/målt, uafrundet", () => {
  assert.ok(Math.abs(tiltFactorFor(5, 10) - 2) < 1e-9, "5 % målt mod 10 % mål → tilt 2");
  assert.ok(Math.abs(tiltFactorFor(20, 10) - 0.5) < 1e-9, "20 % målt mod 10 % mål → tilt 0,5");
  assert.ok(Math.abs(tiltFactorFor(10, 10) - 1) < 1e-9, "målt = mål → tilt 1 (no-op)");
});

test("tiltFactorFor: målt = 0 giver loftet (max), ikke Infinity/NaN", () => {
  assert.equal(tiltFactorFor(0, 10), TILT_MAX);
});

test("tiltFactorFor: mål = 0 giver gulvet (min), ikke 0", () => {
  assert.equal(tiltFactorFor(10, 0), TILT_MIN);
});

test("tiltFactorFor: begge 0 er stadig totalt (falder tilbage til min via mål=0-grenen)", () => {
  assert.equal(tiltFactorFor(0, 0), TILT_MIN);
});

test("tiltFactorFor: klipper til [min, max] for ekstreme forhold", () => {
  assert.equal(tiltFactorFor(0.1, 10), TILT_MAX, "100x-forhold skal klippes til loftet");
  assert.equal(tiltFactorFor(50, 0.1), TILT_MIN, "500x-forhold skal klippes til gulvet");
});

// ── deriveUniformTierTilt ───────────────────────────────────────────────────────

test("deriveUniformTierTilt: én tier, matcher mål/målt for hver akse", () => {
  const tilt = deriveUniformTierTilt({ 1: { itt: 5, cobbles: 10, high_mountain: 6 } }, { itt: 0.10, cobbles: 0.05, high_mountain: 0.12 });
  assert.ok(Math.abs(tilt[1].itt - 2) < 1e-9, "itt: mål 10 / målt 5 = 2");
  assert.ok(Math.abs(tilt[1].cobbles - 0.5) < 1e-9, "cobbles: mål 5 / målt 10 = 0,5");
  assert.ok(Math.abs(tilt[1].high_mountain - 2) < 1e-9, "high_mountain: mål 12 / målt 6 = 2");
});

test("deriveUniformTierTilt: tomt/manglende input giver tom tabel, ikke en fejl", () => {
  assert.deepEqual(deriveUniformTierTilt({}), {});
  assert.deepEqual(deriveUniformTierTilt(undefined), {});
});

test("deriveUniformTierTilt: dækker kun TIER_UNIFORM_TARGET_CATEGORIES, ingen ekstra akser", () => {
  const tilt = deriveUniformTierTilt({ 1: { itt: 10, cobbles: 5, high_mountain: 12, flat: 24 } });
  assert.deepEqual(Object.keys(tilt[1]).sort(), [...TIER_UNIFORM_TARGET_CATEGORIES].sort());
});

test("TIER_UNIFORM_TILT_BY_TIER: dækker alle 4 tiers, én tilt-faktor pr. §6b-akse", () => {
  assert.deepEqual(Object.keys(TIER_UNIFORM_TILT_BY_TIER).map(Number).sort(), [1, 2, 3, 4]);
  for (const tier of [1, 2, 3, 4]) {
    for (const cat of TIER_UNIFORM_TARGET_CATEGORIES) {
      const f = TIER_UNIFORM_TILT_BY_TIER[tier][cat];
      assert.ok(Number.isFinite(f) && f >= TILT_MIN && f <= TILT_MAX, `tier ${tier} ${cat}: tilt ${f} uden for [${TILT_MIN}, ${TILT_MAX}]`);
    }
  }
});

test("TIER_UNIFORM_TILT_BY_TIER: retningen matcher #4103's målte skævhed pr. tier", () => {
  // D2 lå UNDER high_mountain-målet (5,6 % mod 12 %) → tilten skal løfte den (> 1).
  assert.ok(TIER_UNIFORM_TILT_BY_TIER[2].high_mountain > 1, "D2 high_mountain skal løftes");
  // D4 lå OVER high_mountain-målet (16,1 % mod 12 %) → tilten skal sænke den (< 1).
  assert.ok(TIER_UNIFORM_TILT_BY_TIER[4].high_mountain < 1, "D4 high_mountain skal sænkes");
  // D3 lå UNDER itt-målet (5,9 % mod 10 %) → løftes.
  assert.ok(TIER_UNIFORM_TILT_BY_TIER[3].itt > 1, "D3 itt skal løftes");
  // D2 lå OVER itt-målet (14,5 % mod 10 %) → sænkes.
  assert.ok(TIER_UNIFORM_TILT_BY_TIER[2].itt < 1, "D2 itt skal sænkes");
});

test("MEASURED_TIER_BASELINE_20260830 matcher CALENDAR_RULES.md §6b's tabel (30/8)", () => {
  assert.deepEqual(MEASURED_TIER_BASELINE_20260830[1], { itt: 9.7, cobbles: 3.9, high_mountain: 7.7 });
  assert.deepEqual(MEASURED_TIER_BASELINE_20260830[4], { itt: 9.7, cobbles: 4.8, high_mountain: 16.1 });
});

// ── tiltFillerForUniformTargets ──────────────────────────────────────────────────

test("tiltFillerForUniformTargets: skalerer KUN itt/cobbles/high_mountain, resten uændret", () => {
  const filler = [
    { value: "flat", weight: 20 }, { value: "rolling", weight: 20 }, { value: "hilly", weight: 20 },
    { value: "mountain", weight: 20 }, { value: "high_mountain", weight: 10 },
    { value: "itt", weight: 10 }, { value: "cobbles", weight: 10 },
  ];
  const tilt = { itt: 2, cobbles: 0.5, high_mountain: 3 };
  const out = tiltFillerForUniformTargets(filler, tilt);
  const byValue = Object.fromEntries(out.map((it) => [it.value, it.weight]));
  assert.equal(byValue.flat, 20, "flad er uden for #4103's akser og må ikke røres");
  assert.equal(byValue.rolling, 20);
  assert.equal(byValue.hilly, 20);
  assert.equal(byValue.mountain, 20, "almindelig bjerg (IKKE high_mountain) må ikke røres");
  assert.equal(byValue.high_mountain, 30, "10 × 3 = 30");
  assert.equal(byValue.itt, 20, "10 × 2 = 20");
  assert.equal(byValue.cobbles, 5, "10 × 0,5 = 5");
});

test("tiltFillerForUniformTargets: MIN_WEIGHT-gulv — en tilt kan aldrig nulstille en plads", () => {
  const filler = [{ value: "cobbles", weight: 1 }];
  const out = tiltFillerForUniformTargets(filler, { cobbles: 0.01 });
  assert.equal(out[0].weight, MIN_WEIGHT);
});

test("tiltFillerForUniformTargets: neutral tilt (alle 1) er et no-op på heltals-vægte", () => {
  const filler = [{ value: "itt", weight: 9 }, { value: "cobbles", weight: 8 }, { value: "high_mountain", weight: 13 }, { value: "flat", weight: 15 }];
  const out = tiltFillerForUniformTargets(filler, { itt: 1, cobbles: 1, high_mountain: 1 });
  assert.deepEqual(out, filler);
});

test("tiltFillerForUniformTargets: tom tilt (ingen akser) er også et no-op", () => {
  const filler = [{ value: "itt", weight: 9 }, { value: "flat", weight: 15 }];
  assert.deepEqual(tiltFillerForUniformTargets(filler, {}), filler);
});

// ── applyUniformTierTilt ──────────────────────────────────────────────────────────

test("applyUniformTierTilt: ukendt tier returnerer profiles UÆNDRET (fail-open)", () => {
  const out = applyUniformTierTilt({ tier: 99, profiles: ARCHETYPE_PROFILES });
  assert.equal(out, ARCHETYPE_PROFILES, "samme reference — ingen ny tabel bygget for en ukendt tier");
});

test("applyUniformTierTilt: kind:'single'-arketyper (endagsløb) er uberørt", () => {
  const out = applyUniformTierTilt({ tier: 2 });
  assert.deepEqual(out.cobbled_classic, ARCHETYPE_PROFILES.cobbled_classic, "endagsløbs-terræn er fast pr. design");
  assert.deepEqual(out.itt_classic, ARCHETYPE_PROFILES.itt_classic);
});

test("applyUniformTierTilt: guarantees rører sig aldrig, kun filler", () => {
  const out = applyUniformTierTilt({ tier: 3 });
  for (const name of Object.keys(ARCHETYPE_PROFILES)) {
    if (ARCHETYPE_PROFILES[name].kind !== "stage") continue;
    assert.deepEqual(out[name].guarantees, ARCHETYPE_PROFILES[name].guarantees, `${name}: guarantees må ikke ændres`);
  }
});

test("applyUniformTierTilt: skipArchetypes holder en arketype helt uændret", () => {
  const out = applyUniformTierTilt({ tier: 2, skipArchetypes: ["grand_tour"] });
  assert.deepEqual(out.grand_tour, ARCHETYPE_PROFILES.grand_tour);
});

test("applyUniformTierTilt: den tiltede tabel flytter et arketypes andel i den rigtige retning (D2 high_mountain løftes)", () => {
  // Vægt-derivations-sanity uden fuld pipeline-simulering: summér high_mountain-vægtens
  // ANDEL af summit_tour's filler før/efter tier 2's tilt. D2 lå UNDER målet → andelen
  // skal stige, aldrig falde.
  const shareOf = (cfg, value) => {
    const total = cfg.filler.reduce((s, it) => s + it.weight, 0);
    const w = cfg.filler.find((it) => it.value === value)?.weight ?? 0;
    return total > 0 ? w / total : 0;
  };
  const before = shareOf(ARCHETYPE_PROFILES.summit_tour, "high_mountain");
  const after = shareOf(applyUniformTierTilt({ tier: 2 }).summit_tour, "high_mountain");
  assert.ok(after > before, `high_mountain-andelen af summit_tour skal stige for D2 (${before} → ${after})`);
});

test("applyUniformTierTilt: samme arketypes cobbles-andel FALDER for en tier over brosten-målet (D3)", () => {
  // D3 lå OVER brosten-målet (7,1 % mod 5 %) → tilt < 1 → cobbles-andelen skal falde.
  const shareOf = (cfg, value) => {
    const total = cfg.filler.reduce((s, it) => s + it.weight, 0);
    const w = cfg.filler.find((it) => it.value === value)?.weight ?? 0;
    return total > 0 ? w / total : 0;
  };
  const before = shareOf(ARCHETYPE_PROFILES.cobbled_tour, "cobbles");
  const after = shareOf(applyUniformTierTilt({ tier: 3 }).cobbled_tour, "cobbles");
  assert.ok(after < before, `cobbles-andelen af cobbled_tour skal falde for D3 (${before} → ${after})`);
});

test("applyUniformTierTilt: input-tabellen muteres aldrig", () => {
  const snapshot = JSON.parse(JSON.stringify(ARCHETYPE_PROFILES));
  applyUniformTierTilt({ tier: 4 });
  assert.deepEqual(JSON.parse(JSON.stringify(ARCHETYPE_PROFILES)), snapshot);
});
