import test from "node:test";
import assert from "node:assert/strict";
import {
  FAIRPLAY_DEFAULTS,
  IDENTITY_WEIGHTS,
  computeValueComponent,
  computeIdentityComponent,
  computePriceOutlierStrength,
  computeAccountAgeStrength,
  computeActivityStrength,
  computeLoanFunnelStrength,
  computeLifecycleComponent,
  scorePairIncident,
  scoreFunnelIncident,
} from "./fairplayScoring.js";

const THRESHOLD = FAIRPLAY_DEFAULTS.flagThreshold;

// ── Komponenter ──────────────────────────────────────────────────────────────

test("computeValueComponent: under gulvet (50k) = 0 — identitet alene må aldrig flagge", () => {
  assert.equal(computeValueComponent(0), 0);
  assert.equal(computeValueComponent(10_539), 0); // TR↔LEGO-Vestas' ene handel
  assert.equal(computeValueComponent(49_999), 0);
  assert.equal(computeValueComponent(NaN), 0);
  assert.equal(computeValueComponent(undefined), 0);
});

test("computeValueComponent: lineær over gulvet, mætter ved 250k", () => {
  assert.ok(Math.abs(computeValueComponent(76_678) - 0.3067) < 0.001);
  assert.equal(computeValueComponent(250_000), 1);
  assert.equal(computeValueComponent(766_201), 1); // #2221
  assert.equal(computeValueComponent(1_967_061), 1); // #2776
});

test("computeIdentityComponent: ip_exact impliserer ip_prefix — aldrig dobbelt-tælling", () => {
  const both = computeIdentityComponent({ ip_exact_low_fanout: true, ip_prefix_low_fanout: true });
  assert.equal(both, IDENTITY_WEIGHTS.ip_exact_low_fanout); // 0.7, ikke 1.2
  const prefixOnly = computeIdentityComponent({ ip_prefix_low_fanout: true });
  assert.equal(prefixOnly, IDENTITY_WEIGHTS.ip_prefix_low_fanout);
});

test("computeIdentityComponent: flere signaler cappes på 1.0", () => {
  const c = computeIdentityComponent({ first_seen_at_match: true, signup_proximity: true });
  assert.equal(c, 1); // 0.9 + 0.5 capped
  assert.equal(computeIdentityComponent({}), 0);
});

test("computePriceOutlierStrength: 0 inde i det kalibrerede bånd (0.10×–2.2×)", () => {
  assert.equal(computePriceOutlierStrength(0.1), 0);
  assert.equal(computePriceOutlierStrength(0.49), 0); // median ærlig auktionspris
  assert.equal(computePriceOutlierStrength(1.0), 0);
  assert.equal(computePriceOutlierStrength(2.2), 0);
});

test("computePriceOutlierStrength: skalerer med ekstremitet under gulvet", () => {
  assert.ok(computePriceOutlierStrength(0.008) > 0.9); // #2221-swapbenet
  assert.ok(computePriceOutlierStrength(0.0000006) > 0.999); // #2776 1-kr-handler
  assert.ok(computePriceOutlierStrength(0.09) < 0.11); // lige under gulvet = mildt
});

test("computePriceOutlierStrength: skalerer over loftet, mætter ved ~3× cap", () => {
  assert.ok(computePriceOutlierStrength(15.6) === 1); // #2221 15-16× handler
  const mild = computePriceOutlierStrength(2.5);
  assert.ok(mild > 0 && mild < 0.1);
  assert.equal(computePriceOutlierStrength(NaN), 0);
});

test("computeAccountAgeStrength: gwshare (7 min) ≈ 1.0, 7.5t ≈ 0.84 (audit: 0.831), ≥48t = 0", () => {
  assert.ok(computeAccountAgeStrength(7 / 60) > 0.99);
  assert.ok(Math.abs(computeAccountAgeStrength(7.5) - 0.844) < 0.01);
  assert.equal(computeAccountAgeStrength(48), 0);
  assert.equal(computeAccountAgeStrength(-1), 0);
});

test("computeActivityStrength: level 1 / 0 xp / streak 0 = 1.0 (gwshare-profilen)", () => {
  assert.equal(computeActivityStrength({ level: 1, xp: 0, loginStreak: 0 }), 1);
  assert.ok(computeActivityStrength({ level: 5, xp: 2000, loginStreak: 10 }) === 0);
});

test("computeLoanFunnelStrength: #2776 (1 kr, ~1 dags gap) nær max; fair pris = 0", () => {
  const s = computeLoanFunnelStrength({ ratio: 0.0000006, gapDays: 1.06 });
  assert.ok(s > 0.9);
  assert.equal(computeLoanFunnelStrength({ ratio: 1.0, gapDays: 1 }), 0); // Borregaard-casen: fuld pris
  assert.equal(computeLoanFunnelStrength({ ratio: 0.1, gapDays: 8 }), 0); // uden for 7-dages-vinduet
});

test("computeLifecycleComponent: vægtet sum, cap 1.0, ukendte navne ignoreres", () => {
  const c = computeLifecycleComponent([
    { name: "loan_then_value_loss", strength: 1 },
    { name: "account_age_at_tx", strength: 1 },
    { name: "ukendt_signal", strength: 1 },
  ]);
  assert.equal(c, 1); // 0.7 + 0.5 capped
});

// ── Kalibrering: kendte sager SKAL score højt (acceptkriterium #3138) ────────

test("KALIBRERING #2221 (EvoPro↔Barra CC): scorer HØJT", () => {
  // Tal fra docs/audits/2026-08-03-identity-correlation-3135.md +
  // 2026-08-03-price-band-recalibration-3136.md: netto 766.201 mod EvoPro,
  // jcarey-email-lighed, swap-ratioer 0,008×/15,6×, Barra CC aktivitet 0,765.
  const r = scorePairIncident({
    netFlowAbs: 766_201,
    identitySignals: { email_username_similarity: true },
    priceOutlierStrengths: [computePriceOutlierStrength(0.008), computePriceOutlierStrength(15.6)],
    lifecycleSignals: [{ name: "low_activity_profile", strength: 0.765 }],
  });
  assert.ok(r.score >= 1.0, `forventede >= 1.0, fik ${r.score}`);
  assert.ok(r.score >= 2 * THRESHOLD, "skal ligge KLART over tærsklen");
});

test("KALIBRERING #2221 robusthed: selv UDEN prisafvigelses-data flagges parret (#3135-basisreglen)", () => {
  // Svag email-lighed + 766k ensidig strøm — præcis den regel der fangede
  // sagen i 3135-scanningen. Må ikke gå tabt hvis ratio-data mangler.
  const r = scorePairIncident({
    netFlowAbs: 766_201,
    identitySignals: { email_username_similarity: true },
  });
  assert.ok(r.score >= THRESHOLD, `forventede >= ${THRESHOLD}, fik ${r.score}`);
});

test("KALIBRERING #2776 (1-kr-handlerne): scorer MEGET højt", () => {
  // Tal fra #3135-/#3137-audits: 1.967.061 flyttet, first_seen_at-arv (61 s),
  // konti oprettet samme aften (proximity via arv), 1-kr-priser, lån 388.349
  // fulgt af salgene ~1-2 døgn senere, køberkonto ~46 t gammel ved 1. salg.
  const r = scorePairIncident({
    netFlowAbs: 1_967_061,
    identitySignals: { first_seen_at_match: true, signup_proximity: true },
    priceOutlierStrengths: [computePriceOutlierStrength(1 / 1_787_739), computePriceOutlierStrength(1 / 179_322)],
    lifecycleSignals: [
      { name: "loan_then_value_loss", strength: computeLoanFunnelStrength({ ratio: 1 / 1_787_739, gapDays: 1.06 }) },
      { name: "account_age_at_tx", strength: computeAccountAgeStrength(46) },
    ],
  });
  assert.ok(r.score >= 2.0, `forventede >= 2.0, fik ${r.score}`);
});

// ── Kalibrering: de 5 kendte lovlige par SKAL ligge under tærsklen ───────────

test("KALIBRERING lovlige par: 3 husstandspar uden handler = score 0", () => {
  // 24/7 Aspire-Light↔Metro-L3, Wheelbarrels↔Nickstar, MorseCodes↔VelocityOne
  // (#3135-auditten: identitetssignal fundet, 0 transaktioner).
  for (const identitySignals of [
    { ip_exact_low_fanout: true },
    { ip_exact_low_fanout: true, first_seen_at_match: true },
    { ip_exact_low_fanout: true },
  ]) {
    const r = scorePairIncident({ netFlowAbs: 0, identitySignals });
    assert.equal(r.score, 0);
  }
});

test("KALIBRERING lovligt par TR Cycling↔LEGO-Vestas: én 10.539-handel = score 0", () => {
  const r = scorePairIncident({
    netFlowAbs: 10_539,
    identitySignals: { ip_exact_low_fanout: true },
  });
  assert.equal(r.score, 0); // under 50k-værdigulvet
});

test("KALIBRERING Beers&Gears↔Guaracha (fan-out=2, -76.678): under tærsklen", () => {
  // #3135-auditten: sandsynligt CGNAT-sammenfald — skal IKKE flagges.
  const r = scorePairIncident({
    netFlowAbs: 76_678,
    identitySignals: { ip_exact_low_fanout: true },
  });
  assert.ok(r.score < THRESHOLD, `forventede < ${THRESHOLD}, fik ${r.score}`);
  assert.ok(r.score > 0, "men den er ikke NUL — den ligger synligt i dry-run-rapporten");
});

test("KALIBRERING CGNAT-parret 24/7↔LEGO-Vestas (152.720 strøm, HØJT fan-out): score 0", () => {
  // Fan-out-filteret har allerede fjernet IP-signalet → ingen identitet,
  // ingen prisafvigelse, ingen livscyklus → gate eller ej: intet at gange med.
  const r = scorePairIncident({ netFlowAbs: 152_720, identitySignals: {} });
  assert.equal(r.score, 0);
});

// ── Livscyklus-tragten (#3137) ───────────────────────────────────────────────

test("FUNNEL gwshare-casen (649.853, konto 7 min, level 1/0 xp, temp-mail): flagges til review", () => {
  const r = scoreFunnelIncident({
    amount: 649_853,
    lifecycleSignals: [
      { name: "account_age_at_tx", strength: computeAccountAgeStrength(7 / 60) },
      { name: "low_activity_profile", strength: computeActivityStrength({ level: 1, xp: 0, loginStreak: 0 }) },
      { name: "disposable_email", strength: 0.55 },
    ],
  });
  // Bevidst: sagen var sandsynligvis IKKE snyd (#3137), men det er den eneste
  // 100k+-handel fra en <2t-konto i spillets historie — den SKAL til review.
  assert.ok(r.score >= THRESHOLD, `forventede >= ${THRESHOLD}, fik ${r.score}`);
});

test("FUNNEL kræver mindst 2 forskellige livscyklus-signaler (auditens signal-alene-lektie)", () => {
  const r = scoreFunnelIncident({
    amount: 649_853,
    lifecycleSignals: [{ name: "account_age_at_tx", strength: 1 }],
  });
  assert.equal(r.score, 0);
});

test("FUNNEL under 100k-beløbsgaten = 0 uanset signaler", () => {
  const r = scoreFunnelIncident({
    amount: 99_999,
    lifecycleSignals: [
      { name: "account_age_at_tx", strength: 1 },
      { name: "low_activity_profile", strength: 1 },
    ],
  });
  assert.equal(r.score, 0);
});

test("FUNNEL: almindelig ny spiller (kun ét mildt signal) flagges ikke", () => {
  // En 30 timer gammel konto der køber en 120k-rytter — helt normal onboarding.
  const r = scoreFunnelIncident({
    amount: 120_000,
    lifecycleSignals: [{ name: "account_age_at_tx", strength: computeAccountAgeStrength(30) }],
  });
  assert.equal(r.score, 0);
});

// ── Signal-breakdown (til evidence i fairplay_flags) ─────────────────────────

test("scorePairIncident: signals-listen indeholder bidrag pr. fyret signal", () => {
  const r = scorePairIncident({
    netFlowAbs: 300_000,
    identitySignals: { ip_exact_low_fanout: true, ip_prefix_low_fanout: true },
    priceOutlierStrengths: [0.5],
    lifecycleSignals: [{ name: "disposable_email", strength: 0.55 }],
  });
  const names = r.signals.map((s) => s.name);
  assert.deepEqual(names, ["ip_exact_low_fanout", "price_band_outlier", "disposable_email"]);
  for (const s of r.signals) {
    assert.ok(s.contribution > 0 && s.weight > 0 && s.strength > 0);
  }
});
