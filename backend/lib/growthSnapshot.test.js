import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isSubscriptionActive,
  estimateSubscriptionLtvCents,
  buildCustomerRows,
  hasEverPaid,
  partitionSubscriptions,
  summarizeNps,
  PLAN_PRICE_CENTS,
} from "./growthSnapshot.js";

const NOW = new Date("2026-08-03T12:00:00Z");

test("isSubscriptionActive: matcher backend/lib/entitlement.js's computeIsPro-definition", () => {
  assert.equal(isSubscriptionActive({ status: "active", current_period_end: "2026-09-01T00:00:00Z" }, NOW), true);
  assert.equal(isSubscriptionActive({ status: "cancelled", current_period_end: "2026-09-01T00:00:00Z" }, NOW), true, "cancelled tæller stadig som aktiv indtil period_end");
  assert.equal(isSubscriptionActive({ status: "active", current_period_end: "2026-07-01T00:00:00Z" }, NOW), false, "period_end i fortiden = ikke aktiv");
  assert.equal(isSubscriptionActive({ status: "inactive", current_period_end: "2026-09-01T00:00:00Z" }, NOW), false);
  assert.equal(isSubscriptionActive({ status: "active", current_period_end: null }, NOW), false);
  assert.equal(isSubscriptionActive(null, NOW), false);
});

test("estimateSubscriptionLtvCents: monthly, stadig active, 65 dage gammel -> 3 perioder (min 1)", () => {
  const sub = {
    status: "active",
    plan_interval: "monthly",
    created_at: "2026-05-30T00:00:00Z", // 65 dage før NOW
    current_period_end: "2026-09-01T00:00:00Z",
  };
  // 65 dage / 30.44 ≈ 2.14 -> ceil -> 3 perioder
  assert.equal(estimateSubscriptionLtvCents(sub, NOW), 3 * PLAN_PRICE_CENTS.monthly);
});

test("estimateSubscriptionLtvCents: ny monthly (samme dag) -> minimum 1 periode, aldrig 0", () => {
  const sub = { status: "active", plan_interval: "monthly", created_at: "2026-08-03T10:00:00Z", current_period_end: "2026-09-03T10:00:00Z" };
  assert.equal(estimateSubscriptionLtvCents(sub, NOW), 1 * PLAN_PRICE_CENTS.monthly);
});

test("estimateSubscriptionLtvCents: cancelled fryser ved current_period_end, ikke asOf", () => {
  const sub = {
    status: "cancelled",
    plan_interval: "monthly",
    created_at: "2026-01-01T00:00:00Z", // ville være 7 mdr siden NOW, men frøs ved period_end
    current_period_end: "2026-02-01T00:00:00Z", // 31 dage dækket -> ceil(31/30.44) = 2 perioder
  };
  assert.equal(estimateSubscriptionLtvCents(sub, NOW), 2 * PLAN_PRICE_CENTS.monthly);
});

test("estimateSubscriptionLtvCents: semiannual bruger 6-måneders periode-pris", () => {
  const sub = {
    status: "active",
    plan_interval: "semiannual",
    created_at: "2026-02-04T00:00:00Z", // ~180 dage før NOW -> 1 periode (< 182.625 dage)
    current_period_end: "2026-08-04T00:00:00Z",
  };
  assert.equal(estimateSubscriptionLtvCents(sub, NOW), 1 * PLAN_PRICE_CENTS.semiannual);
});

test("estimateSubscriptionLtvCents: Aluntas rå tal 6 prissættes som semiannual, 1 som monthly (#4541)", () => {
  const base = { status: "active", created_at: "2026-02-04T00:00:00Z", current_period_end: "2026-08-04T00:00:00Z" };
  assert.equal(estimateSubscriptionLtvCents({ ...base, plan_interval: 6 }, NOW), 1 * PLAN_PRICE_CENTS.semiannual);
  assert.equal(estimateSubscriptionLtvCents({ ...base, plan_interval: "6" }, NOW), 1 * PLAN_PRICE_CENTS.semiannual);
  // 180 dage som månedlig = 6 perioder à 49 kr, ikke 1 periode à 265 kr.
  assert.equal(estimateSubscriptionLtvCents({ ...base, plan_interval: "1" }, NOW), 6 * PLAN_PRICE_CENTS.monthly);
});

test("estimateSubscriptionLtvCents: ukendt/manglende plan_interval falder tilbage til monthly-pris", () => {
  const sub = { status: "active", plan_interval: null, created_at: "2026-08-03T00:00:00Z", current_period_end: "2026-09-03T00:00:00Z" };
  assert.equal(estimateSubscriptionLtvCents(sub, NOW), PLAN_PRICE_CENTS.monthly);
});

test("estimateSubscriptionLtvCents: manglende created_at -> 0 (ingen krasch)", () => {
  assert.equal(estimateSubscriptionLtvCents({}, NOW), 0);
  assert.equal(estimateSubscriptionLtvCents(null, NOW), 0);
});

test("buildCustomerRows: beriger med teamnavn, sorterer LTV faldende", () => {
  const subs = [
    { team_id: "t1", status: "active", plan_interval: "monthly", created_at: "2026-08-01T00:00:00Z", current_period_end: "2026-09-01T00:00:00Z" },
    { team_id: "t2", status: "active", plan_interval: "monthly", created_at: "2026-05-01T00:00:00Z", current_period_end: "2026-09-01T00:00:00Z" },
  ];
  const teams = { t1: { name: "Team Ét", manager_name: "Anna" }, t2: { name: "Team To", manager_name: "Bo" } };
  const rows = buildCustomerRows(subs, teams, NOW);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].team_id, "t2", "ældste abonnement har højest LTV -> først");
  assert.equal(rows[0].team_name, "Team To");
  assert.equal(rows[1].team_name, "Team Ét");
  assert.ok(rows[0].ltv_cents > rows[1].ltv_cents);
});

test("buildCustomerRows: manglende team -> team_name null, kraslher ikke", () => {
  const subs = [{ team_id: "ukendt", status: "active", plan_interval: "monthly", created_at: "2026-08-01T00:00:00Z", current_period_end: "2026-09-01T00:00:00Z" }];
  const rows = buildCustomerRows(subs, {}, NOW);
  assert.equal(rows[0].team_name, null);
});

test("buildCustomerRows: rå plan_interval '1' vises normaliseret som 'monthly' (#4541)", () => {
  const subs = [{ team_id: "t", status: "active", plan_interval: "1", created_at: "2026-08-01T00:00:00Z", current_period_end: "2026-09-01T00:00:00Z" }];
  assert.equal(buildCustomerRows(subs, {}, NOW)[0].plan_interval, "monthly");
});

// #4636: vilkårsaccept uden betaling er ikke en kunde. Den ægte prod-form 2/9:
// status='inactive' (kolonne-default), alt andet null, kun terms_accepted_at sat.
test("hasEverPaid: terms-only-række (checkout startet, aldrig betalt) -> false", () => {
  const termsOnly = { team_id: "t", status: "inactive", plan_interval: null, current_period_end: null, alunta_subscription_id: null, terms_accepted_at: "2026-09-02T10:30:49Z", created_at: "2026-09-02T10:30:49Z" };
  assert.equal(hasEverPaid(termsOnly), false);
  assert.equal(hasEverPaid(null), false);
});

test("hasEverPaid: Alunta-abonnements-id, Pro-relevant status ELLER dækket periode -> true", () => {
  assert.equal(hasEverPaid({ status: "inactive", alunta_subscription_id: "sub-1", current_period_end: null }), true, "udløbet kunde med Alunta-id har betalt engang");
  assert.equal(hasEverPaid({ status: "active", alunta_subscription_id: null, current_period_end: null }), true, "checkout.completed uden felter (prod 2/9) tæller");
  assert.equal(hasEverPaid({ status: "cancelled", alunta_subscription_id: null, current_period_end: null }), true);
  assert.equal(hasEverPaid({ status: "past_due", alunta_subscription_id: null, current_period_end: null }), true);
  assert.equal(hasEverPaid({ status: "inactive", alunta_subscription_id: null, current_period_end: "2026-08-31T21:59:59Z" }), true, "udløbet uden id: perioden var dækket");
});

test("partitionSubscriptions: prod-billedet 2/9 -> 2 betalende, 3 checkout-only, rækkefølge bevaret", () => {
  const subs = [
    { team_id: "wander", status: "inactive", current_period_end: null, alunta_subscription_id: null },
    { team_id: "lidl", status: "active", current_period_end: null, alunta_subscription_id: null },
    { team_id: "bacon", status: "inactive", current_period_end: null, alunta_subscription_id: null },
    { team_id: "badnames", status: "inactive", current_period_end: null, alunta_subscription_id: null },
    { team_id: "lorraine", status: "active", current_period_end: "2026-08-31T21:59:59Z", alunta_subscription_id: "sub-real" },
  ];
  const { paying, checkoutOnly } = partitionSubscriptions(subs);
  assert.deepEqual(paying.map(s => s.team_id), ["lidl", "lorraine"]);
  assert.deepEqual(checkoutOnly.map(s => s.team_id), ["wander", "bacon", "badnames"]);
  assert.deepEqual(partitionSubscriptions(null), { paying: [], checkoutOnly: [] });
});

test("summarizeNps: klassificerer promoters(9-10)/passives(7-8)/detractors(0-6) + standard NPS-formel", () => {
  const rows = [
    { score: 10 }, { score: 9 }, // promoters
    { score: 8 }, { score: 7 }, // passives
    { score: 6 }, { score: 0 }, // detractors
  ];
  const result = summarizeNps(rows);
  assert.equal(result.n, 6);
  assert.equal(result.promoters, 2);
  assert.equal(result.passives, 2);
  assert.equal(result.detractors, 2);
  // score = 100 * (2-2)/6 = 0
  assert.equal(result.score, 0);
});

test("summarizeNps: tomt datasæt -> n=0, score/average null (ikke 0 — 'for tidligt at konkludere')", () => {
  const result = summarizeNps([]);
  assert.equal(result.n, 0);
  assert.equal(result.score, null);
  assert.equal(result.average, null);
});

test("summarizeNps: alle promoters -> score 100", () => {
  const result = summarizeNps([{ score: 10 }, { score: 9 }, { score: 10 }]);
  assert.equal(result.score, 100);
  assert.equal(result.average, 9.67); // (10+9+10)/3 = 9.6666.. afrundet til 2 decimaler
});

test("summarizeNps: alle detractors -> score -100", () => {
  const result = summarizeNps([{ score: 0 }, { score: 3 }]);
  assert.equal(result.score, -100);
});
