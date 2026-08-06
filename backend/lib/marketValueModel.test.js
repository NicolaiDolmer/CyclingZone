// Tests for marketValueModel.js (#3448)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  meanAbilityScore,
  predictMarketPrice,
  computeSupport,
  blendTarget,
  applyWeeklyCap,
} from "./marketValueModel.js";

const COEF = {
  a: 5.25, b: 0.0976, c: 0.000164, d_age: 0.139, e_age2: -0.0023,
  f_potentiale: 0.235, g_popularity: -0.0185, popularity_mode: "raw", h_is_youth: -0.452,
  offset: { gc: 0.136, baroudeur: 0, sprinter: 0.586 },
};

// ── meanAbilityScore ──────────────────────────────────────────────────────────

describe("meanAbilityScore", () => {
  it("gennemsnit af de kanoniske ability-keys", () => {
    const abilities = { climbing: 60, time_trial: 40, flat: 50, tempo: 50, sprint: 50, acceleration: 50, punch: 50, endurance: 50, recovery: 50, durability: 50, descending: 50, cobblestone: 50, aggression: 50 };
    const score = meanAbilityScore(abilities);
    assert.ok(score > 49 && score < 51);
  });

  it("null ved manglende abilities", () => {
    assert.equal(meanAbilityScore(null), null);
    assert.equal(meanAbilityScore({}), null);
  });

  it("ignorerer non-finite værdier, tæller kun gyldige keys", () => {
    const score = meanAbilityScore({ climbing: 80, time_trial: NaN, flat: "n/a" });
    assert.equal(score, 80);
  });
});

// ── predictMarketPrice ───────────────────────────────────────────────────────

describe("predictMarketPrice", () => {
  it("returnerer et positivt tal (exp af den lineære prædiktor)", () => {
    const price = predictMarketPrice({ O: 60, age: 26, potentiale: 3.5, popularity: 30, is_youth: false, primary_type: "gc" }, COEF);
    assert.ok(Number.isFinite(price) && price > 0);
  });

  it("højere O giver højere pris (alt andet lige)", () => {
    const low = predictMarketPrice({ O: 40, age: 26, potentiale: 3.5, popularity: 30, primary_type: "gc" }, COEF);
    const high = predictMarketPrice({ O: 80, age: 26, potentiale: 3.5, popularity: 30, primary_type: "gc" }, COEF);
    assert.ok(high > low);
  });

  it("ukendt type falder tilbage til laveste kendte offset", () => {
    const known = predictMarketPrice({ O: 60, age: 26, potentiale: 3.5, popularity: 30, primary_type: "baroudeur" }, COEF);
    const unknown = predictMarketPrice({ O: 60, age: 26, potentiale: 3.5, popularity: 30, primary_type: "ukendt_type" }, COEF);
    assert.equal(unknown, known); // baroudeur er laveste offset i COEF (0)
  });

  it("kaster ved manglende/ugyldige numeriske features", () => {
    assert.throws(() => predictMarketPrice({ O: null, age: 26, potentiale: 3.5, primary_type: "gc" }, COEF));
    assert.throws(() => predictMarketPrice({ O: 60, age: "gammel", potentiale: 3.5, primary_type: "gc" }, COEF));
  });

  it("kaster ved popularity_mode='residualized' (ikke understøttet i produktion)", () => {
    assert.throws(
      () => predictMarketPrice({ O: 60, age: 26, potentiale: 3.5, primary_type: "gc" }, { ...COEF, popularity_mode: "residualized" }),
      /residualized/
    );
  });

  it("popularity_mode='dropped' ignorerer popularity-koefficienten helt", () => {
    const withRaw = predictMarketPrice({ O: 60, age: 26, potentiale: 3.5, popularity: 100, primary_type: "gc" }, COEF);
    const dropped = predictMarketPrice({ O: 60, age: 26, potentiale: 3.5, popularity: 100, primary_type: "gc" }, { ...COEF, popularity_mode: "dropped" });
    assert.notEqual(withRaw, dropped);
  });
});

// ── computeSupport ────────────────────────────────────────────────────────────

const GUARD = { oWindow: 5, ageWindow: 3, K: 12 };

describe("computeSupport", () => {
  it("support=0 når salesIndex er tomt (kant: nul handelsevidens)", () => {
    assert.equal(computeSupport({ O: 60, age: 26, primary_type: "gc" }, [], GUARD), 0);
  });

  it("tæller kun salg af SAMME type inden for vinduerne", () => {
    const salesIndex = [
      { O: 61, age: 27, primary_type: "gc" },   // inden for
      { O: 61, age: 27, primary_type: "climber" }, // forkert type
      { O: 90, age: 27, primary_type: "gc" },   // O for langt væk
      { O: 61, age: 40, primary_type: "gc" },   // alder for langt væk
    ];
    const support = computeSupport({ O: 60, age: 26, primary_type: "gc" }, salesIndex, GUARD);
    assert.ok(support > 0 && support < 1); // 1 nærliggende / K=12
    assert.equal(Math.round(support * 12), 1);
  });

  it("clamper til 1 når count_nearby >= K (kant: fuld tillid)", () => {
    const salesIndex = Array.from({ length: 30 }, () => ({ O: 60, age: 26, primary_type: "gc" }));
    assert.equal(computeSupport({ O: 60, age: 26, primary_type: "gc" }, salesIndex, GUARD), 1);
  });

  it("nul for rytter uden gyldig O/age/type", () => {
    assert.equal(computeSupport({ O: null, age: 26, primary_type: "gc" }, [{ O: 60, age: 26, primary_type: "gc" }], GUARD), 0);
  });

  it("kaster ved manglende/ugyldig K", () => {
    assert.throws(() => computeSupport({ O: 60, age: 26, primary_type: "gc" }, [], { oWindow: 5, ageWindow: 3, K: null }));
  });
});

// ── blendTarget ───────────────────────────────────────────────────────────────

describe("blendTarget", () => {
  it("support=0 ⇒ target=current uanset globalWeight (guard fastfryser)", () => {
    assert.equal(blendTarget(100_000, 500_000, 1.0, 0), 100_000);
  });

  it("globalWeight=0 ⇒ target=current uanset support", () => {
    assert.equal(blendTarget(100_000, 500_000, 0, 1), 100_000);
  });

  it("support=1, globalWeight=1 ⇒ target=marketPred (fuld tillid, fuld vægt)", () => {
    assert.equal(blendTarget(100_000, 500_000, 1, 1), 500_000);
  });

  it("delvis vægt/support blander lineært", () => {
    // w = 0.5 * 0.5 = 0.25 → target = 0.75*100k + 0.25*500k = 200k
    assert.equal(blendTarget(100_000, 500_000, 0.5, 0.5), 200_000);
  });

  it("clamper globalWeight/support uden for [0,1]", () => {
    assert.equal(blendTarget(100_000, 500_000, 2, 5), 500_000); // begge clampes til 1
    assert.equal(blendTarget(100_000, 500_000, -1, 0.5), 100_000); // globalWeight clampes til 0
  });
});

// ── applyWeeklyCap ────────────────────────────────────────────────────────────

describe("applyWeeklyCap", () => {
  it("clamper opad ved for stor stigning", () => {
    assert.equal(applyWeeklyCap(100_000, 500_000, 0.25), 125_000);
  });

  it("clamper nedad ved for stort fald", () => {
    assert.equal(applyWeeklyCap(100_000, 10_000, 0.25), 75_000);
  });

  it("target inden for loftet returneres uændret", () => {
    assert.equal(applyWeeklyCap(100_000, 110_000, 0.25), 110_000);
  });

  it("kant: cap=0 fastfryser fuldstændig", () => {
    assert.equal(applyWeeklyCap(100_000, 500_000, 0), 100_000);
  });

  it("kant: current<=0 (ingen gyldig baseline) returnerer target urørt", () => {
    assert.equal(applyWeeklyCap(0, 500_000, 0.25), 500_000);
    assert.equal(applyWeeklyCap(-100, 500_000, 0.25), 500_000);
  });

  it("kant: negativt target clampes stadig korrekt inden for båndet", () => {
    assert.equal(applyWeeklyCap(100_000, -50_000, 0.25), 75_000);
  });
});
