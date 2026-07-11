// Tests for #25: per-team transfer history.
// Verificerer at:
//   - alle 3 transfer-kilder samles korrekt (auctions, transfer_offers, swap_offers;
//     #1994 fjernede den fjerde kilde, loan_agreements — udlåns-featuren er afviklet)
//   - direction (in/out/swap) bestemmes ud fra holdets rolle
//   - private statuses (pending/rejected/etc) ALDRIG vises (genbruger #105-kontrakt)
//   - events sorteres kronologisk (nyeste først)
//   - season_number udledes fra dato vs seasons.start_date/end_date
//   - AI-hold-handler er inkluderet (issue #25 acceptkriterium)

import test from "node:test";
import assert from "node:assert/strict";

const { buildTeamTransferHistory } = await import("./teamTransferHistory.js");

const TEAM = "team-target";
const OTHER = "team-other";
const AI_TEAM = "team-ai";
const RIDER = "rider-A";
const RIDER_B = "rider-B";

function createSupabase({
  auctions = [], transferOffers = [], swapOffers = [], seasons = [],
  academyIntake = [],
} = {}) {
  const tableData = {
    auctions, transfer_offers: transferOffers, swap_offers: swapOffers,
    seasons, academy_intake: academyIntake,
  };

  function matchOr(expr, row) {
    // Minimal parser for `col.eq.val,col2.eq.val2` (top-level OR)
    const parts = expr.split(",");
    return parts.some((p) => {
      const m = p.match(/^([a-z_]+)\.eq\.(.+)$/);
      if (!m) return false;
      return row[m[1]] === m[2];
    });
  }

  function buildQuery(table) {
    const filters = { or: null, in: null, eq: [] };
    const chain = {
      select() { return chain; },
      or(expr) { filters.or = expr; return chain; },
      in(column, values) { filters.in = { column, values }; return chain; },
      eq(column, value) { filters.eq.push({ column, value }); return chain; },
      order() {
        const rows = (tableData[table] || []).filter((row) => {
          if (filters.in && !filters.in.values.includes(row[filters.in.column])) return false;
          for (const { column, value } of filters.eq) if (row[column] !== value) return false;
          if (filters.or && !matchOr(filters.or, row)) return false;
          return true;
        });
        return Promise.resolve({ data: rows, error: null });
      },
    };
    return chain;
  }

  return { from(table) { return buildQuery(table); } };
}

function auctionRow({ id, seller, winner, price, date, sellerIsAi = false, winnerIsAi = false, guaranteed = false }) {
  return {
    id, status: "completed", current_price: price,
    actual_end: date, created_at: date,
    is_guaranteed_sale: guaranteed,
    seller_team_id: seller, current_bidder_id: winner ?? null,
    seller: { id: seller, name: `Team ${seller}`, is_ai: sellerIsAi },
    winner: winner ? { id: winner, name: `Team ${winner}`, is_ai: winnerIsAi } : null,
    rider: { id: RIDER, firstname: "A", lastname: "Rider" },
  };
}

function offerRow({ id, seller, buyer, amount, date, status = "accepted" }) {
  return {
    id, status, offer_amount: amount, counter_amount: null, updated_at: date,
    seller_team_id: seller, buyer_team_id: buyer,
    seller: { id: seller, name: `Team ${seller}`, is_ai: false },
    buyer: { id: buyer, name: `Team ${buyer}`, is_ai: false },
    rider: { id: RIDER, firstname: "A", lastname: "Rider" },
  };
}

function swapRow({ id, proposing, receiving, cash = 0, date, status = "accepted" }) {
  return {
    id, status, cash_adjustment: cash, counter_cash: null, updated_at: date,
    proposing_team_id: proposing, receiving_team_id: receiving,
    proposing: { id: proposing, name: `Team ${proposing}`, is_ai: false },
    receiving: { id: receiving, name: `Team ${receiving}`, is_ai: false },
    offered_rider: { id: RIDER, firstname: "A", lastname: "Rider" },
    requested_rider: { id: RIDER_B, firstname: "B", lastname: "Rider" },
  };
}

function academyIntakeRow({ id, team, date, status = "signed" }) {
  return {
    id, status, team_id: team,
    resolved_at: date, created_at: date,
    rider: { id: RIDER, firstname: "A", lastname: "Rider" },
  };
}

test("teamTransferHistory — samler events fra alle 3 kilder", async () => {
  const supabase = createSupabase({
    auctions: [auctionRow({ id: "A1", seller: OTHER, winner: TEAM, price: 50000, date: "2026-05-01T00:00:00Z" })],
    transferOffers: [offerRow({ id: "T1", seller: TEAM, buyer: OTHER, amount: 30000, date: "2026-05-02T00:00:00Z" })],
    swapOffers: [swapRow({ id: "S1", proposing: TEAM, receiving: OTHER, cash: 0, date: "2026-05-03T00:00:00Z" })],
  });
  const events = await buildTeamTransferHistory(supabase, TEAM);
  assert.equal(events.length, 3);
  const types = events.map((e) => e.type).sort();
  assert.deepEqual(types, ["auction", "swap", "transfer"]);
});

test("teamTransferHistory — direction afspejler holdets rolle", async () => {
  const supabase = createSupabase({
    auctions: [
      auctionRow({ id: "A-buy", seller: OTHER, winner: TEAM, price: 50000, date: "2026-05-01T00:00:00Z" }),
      auctionRow({ id: "A-sell", seller: TEAM, winner: OTHER, price: 40000, date: "2026-05-02T00:00:00Z" }),
    ],
    transferOffers: [
      offerRow({ id: "T-buy", seller: OTHER, buyer: TEAM, amount: 30000, date: "2026-05-03T00:00:00Z" }),
      offerRow({ id: "T-sell", seller: TEAM, buyer: OTHER, amount: 35000, date: "2026-05-04T00:00:00Z" }),
    ],
  });
  const events = await buildTeamTransferHistory(supabase, TEAM);
  const byId = Object.fromEntries(events.map((e) => [e.id, e]));
  assert.equal(byId["auction:A-buy"].direction, "in");
  assert.equal(byId["auction:A-sell"].direction, "out");
  assert.equal(byId["transfer:T-buy"].direction, "in");
  assert.equal(byId["transfer:T-sell"].direction, "out");
});

test("teamTransferHistory — swap uden cash får direction='swap'", async () => {
  const supabase = createSupabase({
    swapOffers: [
      swapRow({ id: "S-even", proposing: TEAM, receiving: OTHER, cash: 0, date: "2026-05-01T00:00:00Z" }),
      swapRow({ id: "S-paid", proposing: TEAM, receiving: OTHER, cash: 5000, date: "2026-05-02T00:00:00Z" }),
      swapRow({ id: "S-received", proposing: TEAM, receiving: OTHER, cash: -3000, date: "2026-05-03T00:00:00Z" }),
    ],
  });
  const events = await buildTeamTransferHistory(supabase, TEAM);
  const byId = Object.fromEntries(events.map((e) => [e.id, e]));
  assert.equal(byId["swap:S-even"].direction, "swap");
  assert.equal(byId["swap:S-paid"].direction, "out");  // TEAM proposing + cash>0 → TEAM betalte
  assert.equal(byId["swap:S-received"].direction, "in");
  assert.equal(byId["swap:S-paid"].amount, 5000);
  assert.equal(byId["swap:S-received"].amount, 3000);
});

test("teamTransferHistory — events sorteres nyeste først", async () => {
  const supabase = createSupabase({
    auctions: [
      auctionRow({ id: "A-old", seller: OTHER, winner: TEAM, price: 1000, date: "2026-04-01T00:00:00Z" }),
      auctionRow({ id: "A-new", seller: OTHER, winner: TEAM, price: 2000, date: "2026-05-15T00:00:00Z" }),
    ],
  });
  const events = await buildTeamTransferHistory(supabase, TEAM);
  assert.equal(events[0].id, "auction:A-new");
  assert.equal(events[1].id, "auction:A-old");
});

test("teamTransferHistory — AI-hold-handler er inkluderet", async () => {
  const supabase = createSupabase({
    auctions: [auctionRow({ id: "A-ai", seller: AI_TEAM, winner: TEAM, price: 10000, date: "2026-05-01T00:00:00Z", sellerIsAi: true })],
  });
  const events = await buildTeamTransferHistory(supabase, TEAM);
  assert.equal(events.length, 1);
  assert.equal(events[0].counterparty.is_ai, true);
});

test("teamTransferHistory — season_number udledes fra dato", async () => {
  const supabase = createSupabase({
    auctions: [
      auctionRow({ id: "A-s5", seller: OTHER, winner: TEAM, price: 1000, date: "2026-03-15T00:00:00Z" }),
      auctionRow({ id: "A-s6", seller: OTHER, winner: TEAM, price: 2000, date: "2026-05-01T00:00:00Z" }),
    ],
    seasons: [
      { id: "s5", number: 5, start_date: "2026-01-01", end_date: "2026-03-31" },
      { id: "s6", number: 6, start_date: "2026-04-01", end_date: "2026-06-30" },
    ],
  });
  const events = await buildTeamTransferHistory(supabase, TEAM);
  const byId = Object.fromEntries(events.map((e) => [e.id, e]));
  assert.equal(byId["auction:A-s5"].season_number, 5);
  assert.equal(byId["auction:A-s6"].season_number, 6);
});

test("teamTransferHistory — cash_flow afspejler kontobevægelsen, ikke rytter-retningen (#984)", async () => {
  // direction er rytter-centrisk (in=køb, out=salg) for auction/transfer,
  // men pengestrømmen er omvendt: køb = penge UD, salg = penge IND.
  // For swap følger direction allerede cash-flowet.
  const supabase = createSupabase({
    auctions: [
      auctionRow({ id: "A-buy", seller: OTHER, winner: TEAM, price: 50000, date: "2026-05-01T00:00:00Z" }),
      auctionRow({ id: "A-sell", seller: TEAM, winner: OTHER, price: 40000, date: "2026-05-02T00:00:00Z" }),
    ],
    transferOffers: [
      offerRow({ id: "T-buy", seller: OTHER, buyer: TEAM, amount: 30000, date: "2026-05-03T00:00:00Z" }),
      offerRow({ id: "T-sell", seller: TEAM, buyer: OTHER, amount: 35000, date: "2026-05-04T00:00:00Z" }),
    ],
    swapOffers: [
      swapRow({ id: "S-even", proposing: TEAM, receiving: OTHER, cash: 0, date: "2026-05-08T00:00:00Z" }),
      swapRow({ id: "S-paid", proposing: TEAM, receiving: OTHER, cash: 5000, date: "2026-05-09T00:00:00Z" }),
      swapRow({ id: "S-received", proposing: TEAM, receiving: OTHER, cash: -3000, date: "2026-05-10T00:00:00Z" }),
    ],
  });
  const events = await buildTeamTransferHistory(supabase, TEAM);
  const byId = Object.fromEntries(events.map((e) => [e.id, e]));
  assert.equal(byId["auction:A-buy"].cash_flow, "out", "auktionskøb = penge ud");
  assert.equal(byId["auction:A-sell"].cash_flow, "in", "auktionssalg = penge ind");
  assert.equal(byId["transfer:T-buy"].cash_flow, "out", "transferkøb = penge ud");
  assert.equal(byId["transfer:T-sell"].cash_flow, "in", "transfersalg = penge ind");
  assert.equal(byId["swap:S-even"].cash_flow, null, "ren bytte = ingen pengestrøm");
  assert.equal(byId["swap:S-paid"].cash_flow, "out", "swap med betalt cash = penge ud");
  assert.equal(byId["swap:S-received"].cash_flow, "in", "swap med modtaget cash = penge ind");
});

test("teamTransferHistory — grænsedag: salg samme dag som ny sæson starter hører til den gamle sæson (#984)", async () => {
  // seasons.start_date/end_date er DATE-kolonner: ved sæsonskifte deler gammel
  // sæsons end_date og ny sæsons start_date kalenderdag. Salg på grænsedagen
  // (vindues-lukning før transitionen) skal tilhøre den gamle sæson — ikke den
  // nye, som midnats-sammenligningen ellers tildeler dem.
  const supabase = createSupabase({
    auctions: [
      auctionRow({ id: "A-boundary", seller: TEAM, winner: OTHER, price: 20000, date: "2026-06-30T08:30:00Z" }),
      auctionRow({ id: "A-next", seller: TEAM, winner: OTHER, price: 25000, date: "2026-07-01T10:00:00Z" }),
    ],
    seasons: [
      { id: "s6", number: 6, start_date: "2026-04-01", end_date: "2026-06-30" },
      { id: "s7", number: 7, start_date: "2026-06-30", end_date: null },
    ],
  });
  const events = await buildTeamTransferHistory(supabase, TEAM);
  const byId = Object.fromEntries(events.map((e) => [e.id, e]));
  assert.equal(byId["auction:A-boundary"].season_number, 6, "grænsedags-salg → gammel sæson");
  assert.equal(byId["auction:A-next"].season_number, 7, "dagen efter → ny sæson");
});

test("teamTransferHistory — auktion uden bud markeres no_sale uden beløb/pengestrøm (#785)", async () => {
  // current_price for en auktion uden bud = den umødte startpris (sat ved
  // oprettelse) — den må ikke vises som beløb eller tælle som salg.
  const supabase = createSupabase({
    auctions: [
      auctionRow({ id: "A-nobids", seller: TEAM, winner: null, price: 106000, date: "2026-05-13T00:00:00Z" }),
      auctionRow({ id: "A-sold", seller: TEAM, winner: OTHER, price: 40000, date: "2026-05-02T00:00:00Z" }),
      auctionRow({ id: "A-guaranteed", seller: TEAM, winner: null, price: 25000, date: "2026-05-03T00:00:00Z", guaranteed: true }),
    ],
  });
  const events = await buildTeamTransferHistory(supabase, TEAM);
  const byId = Object.fromEntries(events.map((e) => [e.id, e]));

  assert.equal(byId["auction:A-nobids"].no_sale, true, "ingen bud → no_sale");
  assert.equal(byId["auction:A-nobids"].amount, null, "umødt startpris må ikke vises som beløb");
  assert.equal(byId["auction:A-nobids"].cash_flow, null, "intet salg = ingen pengestrøm");

  assert.equal(byId["auction:A-sold"].no_sale, false);
  assert.equal(byId["auction:A-sold"].amount, 40000);
  assert.equal(byId["auction:A-sold"].cash_flow, "in");

  // Garanteret AI-salg gennemføres uden current_bidder_id, men rytteren ER solgt.
  assert.equal(byId["auction:A-guaranteed"].no_sale, false, "garanteret salg er et salg");
  assert.equal(byId["auction:A-guaranteed"].amount, 25000);
});

test("teamTransferHistory — private statuses ekskluderes (#105 kontrakt)", async () => {
  // Mock-supabase'en respekterer `.in()`-filteret. Hvis buildTeamTransferHistory
  // ikke kalder .in() med PUBLIC_*-whitelisten, ville disse rows slippe igennem.
  const supabase = createSupabase({
    transferOffers: [
      offerRow({ id: "T-rejected", seller: TEAM, buyer: OTHER, amount: 5000, date: "2026-05-01T00:00:00Z", status: "rejected" }),
      offerRow({ id: "T-pending", seller: TEAM, buyer: OTHER, amount: 6000, date: "2026-05-02T00:00:00Z", status: "pending" }),
      offerRow({ id: "T-accepted", seller: TEAM, buyer: OTHER, amount: 7000, date: "2026-05-03T00:00:00Z", status: "accepted" }),
    ],
  });
  const events = await buildTeamTransferHistory(supabase, TEAM);
  const ids = events.map((e) => e.id);
  assert.ok(ids.includes("transfer:T-accepted"));
  assert.ok(!ids.some((id) => id.includes("rejected") || id.includes("pending")));
});

test("teamTransferHistory — akademi-hentninger (academy_intake, status='signed') vises som tilgang uden pris (#1776)", async () => {
  // De reelle akademi-hentninger ligger i academy_intake (status='signed'),
  // ikke i academy_graduation (0 rows i prod). De skal optræde som type='academy',
  // direction='in', uden pris og uden modpartshold.
  const supabase = createSupabase({
    academyIntake: [
      academyIntakeRow({ id: "AC1", team: TEAM, date: "2026-06-22T12:00:00Z" }),
      // Ikke-signede intakes (tilbudt/afvist) er ingen tilgang og må ikke vises.
      academyIntakeRow({ id: "AC-offered", team: TEAM, date: "2026-06-22T13:00:00Z", status: "offered" }),
      academyIntakeRow({ id: "AC-rejected", team: TEAM, date: "2026-06-22T14:00:00Z", status: "rejected" }),
    ],
  });
  const events = await buildTeamTransferHistory(supabase, TEAM);
  const ids = events.map((e) => e.id);
  assert.ok(ids.includes("academy:AC1"), "signet akademi-hentning skal vises");
  assert.ok(!ids.includes("academy:AC-offered"), "tilbudt intake må ikke vises");
  assert.ok(!ids.includes("academy:AC-rejected"), "afvist intake må ikke vises");

  const byId = Object.fromEntries(events.map((e) => [e.id, e]));
  const ac = byId["academy:AC1"];
  assert.equal(ac.type, "academy");
  assert.equal(ac.direction, "in");
  assert.equal(ac.amount, null, "akademi-hentning har ingen pris");
  assert.equal(ac.cash_flow, null, "akademi-hentning har ingen pengestrøm");
  assert.equal(ac.counterparty, null, "kilde = akademiet, ikke et modpartshold");
});

test("teamTransferHistory — nul-bred afsluttet sæson på delt grænsedag indfanger ikke launch-dagens events (#1776)", async () => {
  // Prod ved launch: sæson 0 (afsluttet, start=end=2026-06-22) og sæson 1
  // (aktiv, start=2026-06-22, end=null). Ascending-sorteringen lod den nul-brede
  // sæson 0 vinde grænsedagen, så sæson 1-transfers fejlagtigt blev tagget til
  // sæson 0. Launch-dagens events skal tilhøre den aktive sæson 1.
  const supabase = createSupabase({
    auctions: [
      auctionRow({ id: "A-launch", seller: OTHER, winner: TEAM, price: 50000, date: "2026-06-22T09:30:00Z" }),
      auctionRow({ id: "A-later", seller: OTHER, winner: TEAM, price: 60000, date: "2026-06-25T10:00:00Z" }),
    ],
    academyIntake: [
      academyIntakeRow({ id: "AC-launch", team: TEAM, date: "2026-06-22T12:00:00Z" }),
    ],
    seasons: [
      { id: "s0", number: 0, start_date: "2026-06-22", end_date: "2026-06-22" },
      { id: "s1", number: 1, start_date: "2026-06-22", end_date: null },
    ],
  });
  const events = await buildTeamTransferHistory(supabase, TEAM);
  const byId = Object.fromEntries(events.map((e) => [e.id, e]));
  assert.equal(byId["auction:A-launch"].season_number, 1, "grænsedags-event → aktiv sæson 1, ikke nul-bred sæson 0");
  assert.equal(byId["academy:AC-launch"].season_number, 1, "akademi-hentning på grænsedagen → aktiv sæson 1");
  assert.equal(byId["auction:A-later"].season_number, 1, "senere event → sæson 1");
});
