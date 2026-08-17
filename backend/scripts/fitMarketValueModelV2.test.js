import test from "node:test";
import assert from "node:assert/strict";

import {
  buildQualifiedSales,
  evidenceWeight,
  smearingFactor,
  seasonNumberAt,
  offsetFor,
  predictMarketLn,
  evalHoldout,
  median,
  quantile,
  EVIDENCE_K,
  MAX_PRICE_MULTIPLE,
  MAX_PAIR_TRADES,
} from "./fitMarketValueModelV2.js";

// Minimal fabrik - kun de felter filteret faktisk læser.
function sale(over = {}) {
  return {
    sale_id: over.sale_id ?? Math.random().toString(36).slice(2),
    source: "auction",
    rider_id: "r1",
    price: 1000,
    starting_price: 500,
    is_guaranteed_sale: false,
    distinct_bidders: 2,
    seller_team_id: null,
    buyer_team_id: "b1",
    seller_is_human: false,
    buyer_is_human: true,
    anchor_value: 100000,
    ...over,
  };
}

test("#3750: auktion der clearer på startprisen er bankens konstant, ikke en pris", () => {
  const { qualified, funnel } = buildQualifiedSales([
    sale({ sale_id: "a", distinct_bidders: 1, price: 500, starting_price: 500 }),
  ]);
  assert.equal(qualified.length, 0);
  assert.equal(funnel.dropped_auction_no_competition, 1);
});

test("#3750: to bud fra SAMME hold er ikke konkurrence (distinkte budgivere, ikke antal bud)", () => {
  // distinct_bidders er allerede de-duplikeret opstrøms; her sikrer vi at
  // tærsklen er 2 og ikke 1.
  const { qualified } = buildQualifiedSales([sale({ distinct_bidders: 1, price: 900 })]);
  assert.equal(qualified.length, 0);
  const ok = buildQualifiedSales([sale({ distinct_bidders: 2, price: 900 })]);
  assert.equal(ok.qualified.length, 1);
});

test("#3750: en konkurrenceprissat auktion hvor prisen steg, kvalificerer", () => {
  const { qualified, funnel } = buildQualifiedSales([sale({ distinct_bidders: 3, price: 1200, starting_price: 500 })]);
  assert.equal(qualified.length, 1);
  assert.equal(funnel.dropped_auction_price_not_raised, 0);
});

test("auktion hvor prisen ikke steg over startprisen frafiltreres selv med flere budgivere", () => {
  const { qualified, funnel } = buildQualifiedSales([sale({ distinct_bidders: 4, price: 500, starting_price: 500 })]);
  assert.equal(qualified.length, 0);
  assert.equal(funnel.dropped_auction_price_not_raised, 1);
});

test("garanterede salg er aldrig markedsevidens", () => {
  const { qualified, funnel } = buildQualifiedSales([sale({ is_guaranteed_sale: true, distinct_bidders: 5, price: 9000 })]);
  assert.equal(qualified.length, 0);
  assert.equal(funnel.dropped_guaranteed_sale, 1);
});

test("beslutning 3: forhandlet handel tæller kun mellem to menneskehold", () => {
  const human = sale({ source: "transfer", seller_is_human: true, buyer_is_human: true, seller_team_id: "s1", buyer_team_id: "b1" });
  const ai = sale({ source: "transfer", seller_is_human: false, buyer_is_human: true, seller_team_id: "ai", buyer_team_id: "b1" });
  const { qualified, funnel } = buildQualifiedSales([human, ai]);
  assert.equal(qualified.length, 1);
  assert.equal(funnel.dropped_transfer_not_human_to_human, 1);
});

test("kollusionsværn: handler over 3x ankerværdi frafiltreres", () => {
  const { qualified, funnel } = buildQualifiedSales([
    sale({ price: 3 * 1000 + 1, anchor_value: 1000, distinct_bidders: 2, starting_price: 1 }),
    sale({ price: 3 * 1000, anchor_value: 1000, distinct_bidders: 2, starting_price: 1 }),
  ]);
  assert.equal(funnel.dropped_over_price_multiple, 1);
  assert.equal(qualified.length, 1, "præcis 3x er inden for værnet, over 3x er ude");
  assert.equal(MAX_PRICE_MULTIPLE, 3);
});

test("kollusionsværn: par med 3+ handler frafiltreres helt", () => {
  const mk = (id) => sale({
    sale_id: id, source: "transfer", seller_is_human: true, buyer_is_human: true,
    seller_team_id: "s1", buyer_team_id: "b1",
  });
  const { qualified, funnel } = buildQualifiedSales([mk("1"), mk("2"), mk("3")]);
  assert.equal(qualified.length, 0);
  assert.equal(funnel.dropped_repeat_pair, 3);
  assert.equal(funnel.banned_pairs.length, 1);
  assert.equal(MAX_PAIR_TRADES, 3);
});

test("par-værnet er retningsuafhængigt (s->b og b->s er samme par)", () => {
  const a = sale({ sale_id: "1", source: "transfer", seller_is_human: true, buyer_is_human: true, seller_team_id: "s1", buyer_team_id: "b1" });
  const b = sale({ sale_id: "2", source: "transfer", seller_is_human: true, buyer_is_human: true, seller_team_id: "b1", buyer_team_id: "s1" });
  const c = sale({ sale_id: "3", source: "transfer", seller_is_human: true, buyer_is_human: true, seller_team_id: "s1", buyer_team_id: "b1" });
  const { qualified } = buildQualifiedSales([a, b, c]);
  assert.equal(qualified.length, 0);
});

test("bankens auktioner danner ikke par (ingen modpart at kollundere med)", () => {
  const bank = (id) => sale({ sale_id: id, seller_team_id: null, seller_is_human: false, buyer_team_id: "b1", price: 900 });
  const { qualified, funnel } = buildQualifiedSales([bank("1"), bank("2"), bank("3"), bank("4")]);
  assert.equal(qualified.length, 4);
  assert.equal(funnel.dropped_repeat_pair, 0);
});

test("evidensvægt Z = n/(n+K), ingen hård mætning ved K", () => {
  assert.equal(evidenceWeight(0), 0);
  assert.equal(EVIDENCE_K, 12);
  assert.equal(evidenceWeight(12), 0.5, "K sammenlignelige handler => markedet vejer halvt");
  assert.ok(evidenceWeight(24) > evidenceWeight(12), "Z fortsætter over K (v1.1's min(1, n/K) gjorde ikke)");
  assert.ok(evidenceWeight(1000) < 1, "Z når aldrig 1");
  assert.equal(evidenceWeight(null), 0);
  assert.equal(evidenceWeight(-5), 0);
});

test("smearing-faktoren korrigerer ln-retransformationen opad", () => {
  // Residualer symmetriske i log => exp-middel > 1 (Jensen).
  const rows = [
    { ln_price: Math.log(100) + 0.5 },
    { ln_price: Math.log(100) - 0.5 },
  ];
  const f = smearingFactor(rows, () => Math.log(100));
  assert.ok(f > 1, `forventede faktor > 1, fik ${f}`);
  assert.ok(Math.abs(f - (Math.exp(0.5) + Math.exp(-0.5)) / 2) < 1e-12);
});

test("smearing på perfekte residualer er neutral", () => {
  const rows = [{ ln_price: Math.log(100) }, { ln_price: Math.log(50) }];
  const f = smearingFactor(rows, (r) => r.ln_price);
  assert.equal(f, 1);
});

test("sæsonnummer slås op på salgstidspunktet, ikke på i dag", () => {
  const seasons = [
    { number: 1, start_date: "2026-06-22" },
    { number: 2, start_date: "2026-07-27" },
    { number: 3, start_date: "2026-08-24" },
  ];
  assert.equal(seasonNumberAt("2026-07-01T10:00:00Z", seasons), 1);
  assert.equal(seasonNumberAt("2026-08-17T10:00:00Z", seasons), 2);
  assert.equal(seasonNumberAt("2026-08-24T00:00:01Z", seasons), 3);
  assert.equal(seasonNumberAt("2026-01-01T00:00:00Z", seasons), null);
});

test("offsetFor falder tilbage til LAVESTE kendte offset for utypede/usamplede typer", () => {
  const dict = { climber: 0.8, tt: 0.2, gc: null };
  assert.equal(offsetFor("climber", dict), 0.8);
  assert.equal(offsetFor("gc", dict), 0.2, "aldrig 0 - 0 ville gøre en usamplet type dyrere end de fittede");
  assert.equal(offsetFor("findes_ikke", dict), 0.2);
});

test("predictMarketLn indregner smearing additivt i log-rummet", () => {
  const coef = {
    a: 5, b: 0.1, c: 0, d_age: 0, e_age2: 0, f_potentiale: 0, h_is_youth: 0,
    popularity_mode: "dropped", g_popularity: 0, offset: { climber: 0 },
  };
  const base = predictMarketLn(coef, { O: 50, age: 25, potentiale: 3, popularity: 10, is_youth: false, type: "climber" });
  const smeared = predictMarketLn({ ...coef, smearing: 1.5 }, { O: 50, age: 25, potentiale: 3, popularity: 10, is_youth: false, type: "climber" });
  assert.ok(Math.abs((smeared - base) - Math.log(1.5)) < 1e-12);
});

test("predictMarketLn ignorerer popularity når den er droppet", () => {
  const coef = {
    a: 5, b: 0, c: 0, d_age: 0, e_age2: 0, f_potentiale: 0, h_is_youth: 0,
    popularity_mode: "dropped", g_popularity: 99, offset: { climber: 0 },
  };
  const v = predictMarketLn(coef, { O: 0, age: 0, potentiale: 0, popularity: 1000, is_youth: false, type: "climber" });
  assert.equal(v, 5);
});

test("evalHoldout rapporterer median-AE ved siden af MAE (audit 14/8's krav)", () => {
  const rows = [
    { price: 100, ln_price: Math.log(100) },
    { price: 100, ln_price: Math.log(100) },
    { price: 100, ln_price: Math.log(100) },
    { price: 1_000_000, ln_price: Math.log(1_000_000) },
  ];
  const m = evalHoldout(rows, (r) => (r.price === 1_000_000 ? 1 : 100));
  assert.equal(m.n, 4);
  assert.equal(m.median_ae_czk, 0, "tre perfekte og én katastrofe => median 0");
  assert.ok(m.mae_czk > 200000, "... men MAE domineres af den ene");
});

test("evalHoldout springer ubrugelige prædiktioner over i stedet for at tælle dem som nul-fejl", () => {
  const rows = [{ price: 100, ln_price: Math.log(100) }, { price: 200, ln_price: Math.log(200) }];
  const m = evalHoldout(rows, (r) => (r.price === 100 ? null : 200));
  assert.equal(m.n, 1);
  assert.equal(m.skipped, 1);
  assert.equal(m.mae_czk, 0);
});

test("median og quantile håndterer tomme og ikke-endelige input", () => {
  assert.equal(median([]), null);
  assert.equal(quantile([], 0.5), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([1, NaN, 3]), 2);
});
