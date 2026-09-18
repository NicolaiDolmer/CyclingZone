// Tests for #5257: den globale handelsliste (GET /api/transfers/feed).
// Verificerer:
//   - query-parametre valideres/klemmes FØR de rører en PostgREST-filterstreng
//     (UUID-guard på ?team=, dybde-loft på ?offset=)
//   - alle tre kilder flettes, nyeste øverst
//   - private offer-statuser (pending/rejected/…) slipper ALDRIG ud
//   - no_sale-auktion: intet beløb, ikke rapporterbar
//   - paginering skærer den rigtige side ud og sætter has_more korrekt
//   - svaret indeholder ingen private felter (user_id/e-mail/besked)
//   - division-filtret kører to queries pr. kilde og deduper

import test from "node:test";
import assert from "node:assert/strict";

const {
  buildGlobalTradeFeed,
  parseTradeFeedQuery,
  TRADE_FEED_MAX_LIMIT,
  TRADE_FEED_MAX_OFFSET,
} = await import("./tradeListFeed.js");

const TEAM_A = "11111111-1111-4111-8111-111111111111";
const TEAM_B = "22222222-2222-4222-8222-222222222222";

const SEASONS = [{ id: "s1", number: 1, start_date: "2026-01-01", end_date: null }];

function teamRow(id, name, division = 1, isAi = false) {
  return { id, name, is_ai: isAi, division };
}

// Minimal PostgREST-stub i samme stil som teamTransferHistory.test.js.
// Registrerer også hvilke filtre der blev bygget, så division-filtrets to
// queries pr. kilde kan verificeres.
function createSupabase({ auctions = [], transferOffers = [], swapOffers = [], seasons = SEASONS, teams = [] } = {}) {
  const tableData = { auctions, transfer_offers: transferOffers, swap_offers: swapOffers, seasons, teams };
  const calls = [];

  // Minimal or-parser: `col.eq.val`, `col.not.is.null` og `col.is.true`.
  // Flere .or()-kald AND'es af PostgREST, så stubben holder dem i en liste.
  function matchOr(expr, row) {
    return expr.split(",").some((p) => {
      let m = p.match(/^([a-z_]+)\.eq\.(.+)$/);
      if (m) return row[m[1]] === m[2];
      m = p.match(/^([a-z_]+)\.not\.is\.null$/);
      if (m) return row[m[1]] != null;
      m = p.match(/^([a-z_]+)\.is\.true$/);
      if (m) return row[m[1]] === true;
      return false;
    });
  }

  function buildQuery(table) {
    const state = { table, select: "", or: [], in: [], eq: [], limit: null };
    calls.push(state);
    function rows() {
      let list = tableData[table] || [];
      list = list.filter((row) => {
        for (const { column, values } of state.in) {
          if (!values.includes(row[column])) return false;
        }
        for (const { column, value } of state.eq) {
          if (row[column] !== value) return false;
        }
        for (const expr of state.or) if (!matchOr(expr, row)) return false;
        return true;
      });
      if (state.limit != null) list = list.slice(0, state.limit);
      return Promise.resolve({ data: list, error: null });
    }
    const chain = {
      select(sel) { state.select = sel; return chain; },
      or(expr) { state.or.push(expr); return chain; },
      in(column, values) { state.in.push({ column, values }); return chain; },
      eq(column, value) { state.eq.push({ column, value }); return chain; },
      order() { return chain; },
      limit(n) { state.limit = n; return rows(); },
      then(resolve, reject) { return rows().then(resolve, reject); },
    };
    return chain;
  }

  return { from: buildQuery, __calls: calls };
}

function params(over = {}) {
  return { limit: 25, offset: 0, type: null, division: null, teamId: null, ...over };
}

// ── parseTradeFeedQuery ──────────────────────────────────────────────────────

test("parseTradeFeedQuery: default, klemning og 'all' som ingen-filter", () => {
  assert.deepEqual(parseTradeFeedQuery({}).params, params());
  assert.equal(parseTradeFeedQuery({ limit: "999" }).params.limit, TRADE_FEED_MAX_LIMIT);
  const all = parseTradeFeedQuery({ type: "all", division: "all", team: "all" });
  assert.deepEqual(all.params, params());
});

test("parseTradeFeedQuery: afviser et crafted team-param før det når et filter", () => {
  const injected = parseTradeFeedQuery({ team: "x,id.gt.00000000-0000-0000-0000-000000000000" });
  assert.equal(injected.ok, false);
  assert.equal(injected.errorCode, "trade_feed_invalid_team");
  assert.equal(parseTradeFeedQuery({ team: TEAM_A }).params.teamId, TEAM_A);
});

test("parseTradeFeedQuery: afviser ukendt type, ugyldig division og for dyb offset", () => {
  assert.equal(parseTradeFeedQuery({ type: "loan" }).errorCode, "trade_feed_invalid_type");
  assert.equal(parseTradeFeedQuery({ division: "0" }).errorCode, "trade_feed_invalid_division");
  assert.equal(parseTradeFeedQuery({ offset: "-1" }).errorCode, "trade_feed_invalid_offset");
  assert.equal(
    parseTradeFeedQuery({ offset: String(TRADE_FEED_MAX_OFFSET + 1) }).errorCode,
    "trade_feed_offset_too_deep",
  );
  assert.equal(parseTradeFeedQuery({ offset: String(TRADE_FEED_MAX_OFFSET) }).ok, true);
});

// ── buildGlobalTradeFeed ─────────────────────────────────────────────────────

test("fletter alle tre kilder, nyeste øverst", async () => {
  const supabase = createSupabase({
    auctions: [{
      id: "a1", status: "completed", current_price: 500000, actual_end: "2026-03-03T10:00:00Z",
      seller_team_id: TEAM_A, current_bidder_id: TEAM_B,
      rider: { id: "r1", firstname: "Ann", lastname: "Alpe" },
      seller: teamRow(TEAM_A, "Alpha"), winner: teamRow(TEAM_B, "Beta", 2),
    }],
    transferOffers: [{
      id: "t1", status: "accepted", offer_amount: 200000, counter_amount: null,
      updated_at: "2026-03-05T10:00:00Z", seller_team_id: TEAM_B, buyer_team_id: TEAM_A,
      rider: { id: "r2", firstname: "Bo", lastname: "Berg" },
      seller: teamRow(TEAM_B, "Beta", 2), buyer: teamRow(TEAM_A, "Alpha"),
    }],
    swapOffers: [{
      id: "s1", status: "accepted", cash_adjustment: -50000, counter_cash: null,
      updated_at: "2026-03-01T10:00:00Z", proposing_team_id: TEAM_A, receiving_team_id: TEAM_B,
      offered_rider: { id: "r3", firstname: "Cy", lastname: "Col" },
      requested_rider: { id: "r4", firstname: "Dee", lastname: "Dal" },
      proposing: teamRow(TEAM_A, "Alpha"), receiving: teamRow(TEAM_B, "Beta", 2),
    }],
  });

  const { events, has_more } = await buildGlobalTradeFeed(supabase, params());
  assert.deepEqual(events.map((e) => e.id), ["transfer:t1", "auction:a1", "swap:s1"]);
  assert.equal(has_more, false);
  assert.equal(events[0].from_team.name, "Beta");
  assert.equal(events[0].to_team.name, "Alpha");
  assert.equal(events[0].amount, 200000);
  assert.equal(events[0].season_number, 1);
  assert.equal(events[2].rider_swapped.lastname, "Dal");
  assert.equal(events[2].cash_direction, "receiving_pays");
  assert.equal(events[2].amount, 50000);
});

test("private offer-statuser slipper aldrig ud", async () => {
  const supabase = createSupabase({
    transferOffers: [
      { id: "t-pending", status: "pending", offer_amount: 1, updated_at: "2026-03-05T10:00:00Z",
        seller_team_id: TEAM_A, buyer_team_id: TEAM_B, seller: teamRow(TEAM_A, "Alpha"), buyer: teamRow(TEAM_B, "Beta") },
      { id: "t-ok", status: "accepted", offer_amount: 2, updated_at: "2026-03-04T10:00:00Z",
        seller_team_id: TEAM_A, buyer_team_id: TEAM_B, seller: teamRow(TEAM_A, "Alpha"), buyer: teamRow(TEAM_B, "Beta") },
    ],
    swapOffers: [
      { id: "s-rejected", status: "rejected", cash_adjustment: 0, updated_at: "2026-03-06T10:00:00Z",
        proposing_team_id: TEAM_A, receiving_team_id: TEAM_B, proposing: teamRow(TEAM_A, "Alpha"), receiving: teamRow(TEAM_B, "Beta") },
    ],
  });
  const { events } = await buildGlobalTradeFeed(supabase, params());
  assert.deepEqual(events.map((e) => e.id), ["transfer:t-ok"]);
});

test("auktion uden bud er slet ikke et skifte og kommer ikke med", async () => {
  const supabase = createSupabase({
    auctions: [
      { id: "a-nosale", status: "completed", current_price: 400000, actual_end: "2026-03-04T10:00:00Z",
        seller_team_id: TEAM_A, current_bidder_id: null, is_guaranteed_sale: false,
        rider: { id: "r1", firstname: "Ann", lastname: "Alpe" }, seller: teamRow(TEAM_A, "Alpha"), winner: null },
      // Garanteret AI-salg: ingen current_bidder_id, men rytteren SKIFTEDE hold.
      { id: "a-guaranteed", status: "completed", current_price: 90000, actual_end: "2026-03-03T10:00:00Z",
        seller_team_id: TEAM_A, current_bidder_id: null, is_guaranteed_sale: true,
        rider: { id: "r2", firstname: "Bo", lastname: "Berg" }, seller: teamRow(TEAM_A, "Alpha"), winner: null },
    ],
  });
  const { events } = await buildGlobalTradeFeed(supabase, params());
  assert.deepEqual(events.map((e) => e.id), ["auction:a-guaranteed"]);
  assert.equal(events[0].is_guaranteed_sale, true);
  // Uden current_bidder_id er der ingen modpart at rapportere imod — samme
  // regel som backendens resolveTradeParties.
  assert.equal(events[0].reportable, false);
  assert.equal(events[0].to_team, null);
});

test("fri-agent-auktion: intet fra-hold, men stadig et skifte", async () => {
  const supabase = createSupabase({
    auctions: [{
      id: "a-free", status: "completed", current_price: 2911, actual_end: "2026-03-03T10:00:00Z",
      seller_team_id: null, current_bidder_id: TEAM_B,
      rider: { id: "r1", firstname: "Ann", lastname: "Alpe" }, seller: null, winner: teamRow(TEAM_B, "Beta"),
    }],
  });
  const { events } = await buildGlobalTradeFeed(supabase, params());
  assert.equal(events[0].from_team, null, "fri agent har intet sælgende hold");
  assert.equal(events[0].to_team.name, "Beta");
  assert.equal(events[0].amount, 2911);
  assert.equal(events[0].reportable, true);
});

test("paginering: side 2 skæres korrekt ud og has_more er sandt når der er mere", async () => {
  const auctions = Array.from({ length: 5 }, (_, i) => ({
    id: `a${i}`, status: "completed", current_price: 1000 + i,
    actual_end: `2026-03-0${5 - i}T10:00:00Z`,
    seller_team_id: TEAM_A, current_bidder_id: TEAM_B,
    rider: { id: `r${i}`, firstname: "R", lastname: String(i) },
    seller: teamRow(TEAM_A, "Alpha"), winner: teamRow(TEAM_B, "Beta"),
  }));
  const supabase = createSupabase({ auctions });

  const page1 = await buildGlobalTradeFeed(supabase, params({ limit: 2, offset: 0 }));
  assert.deepEqual(page1.events.map((e) => e.id), ["auction:a0", "auction:a1"]);
  assert.equal(page1.has_more, true);

  const page2 = await buildGlobalTradeFeed(supabase, params({ limit: 2, offset: 2 }));
  assert.deepEqual(page2.events.map((e) => e.id), ["auction:a2", "auction:a3"]);
  assert.equal(page2.has_more, true);

  const page3 = await buildGlobalTradeFeed(supabase, params({ limit: 2, offset: 4 }));
  assert.deepEqual(page3.events.map((e) => e.id), ["auction:a4"]);
  assert.equal(page3.has_more, false);
});

test("svaret bærer ingen private felter", async () => {
  const supabase = createSupabase({
    transferOffers: [{
      id: "t1", status: "accepted", offer_amount: 2, updated_at: "2026-03-04T10:00:00Z",
      message: "privat forhandlingsbesked", seller_team_id: TEAM_A, buyer_team_id: TEAM_B,
      seller: teamRow(TEAM_A, "Alpha"), buyer: teamRow(TEAM_B, "Beta"),
    }],
  });
  const { events } = await buildGlobalTradeFeed(supabase, params());
  const serialized = JSON.stringify(events);
  for (const forbidden of ["user_id", "email", "privat forhandlingsbesked", "proxy_max"]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} må aldrig stå i feedet`);
  }
});

test("division-filter: to queries pr. kilde, og en handel internt i divisionen kommer kun én gang", async () => {
  const row = {
    id: "t1", status: "accepted", offer_amount: 2, updated_at: "2026-03-04T10:00:00Z",
    seller_team_id: TEAM_A, buyer_team_id: TEAM_B,
    rider: { id: "r1", firstname: "Ann", lastname: "Alpe" },
    seller: teamRow(TEAM_A, "Alpha", 1), buyer: teamRow(TEAM_B, "Beta", 1),
  };
  const supabase = createSupabase({
    transferOffers: [row],
    teams: [{ id: TEAM_A, division: 1 }, { id: TEAM_B, division: 1 }],
  });
  const { events } = await buildGlobalTradeFeed(supabase, params({ type: "transfer", division: 1 }));
  assert.deepEqual(events.map((e) => e.id), ["transfer:t1"], "dedupet, ikke vist to gange");

  const offerCalls = supabase.__calls.filter((c) => c.table === "transfer_offers");
  assert.equal(offerCalls.length, 2, "en query pr. hold-kolonne (sælger/køber)");
  const inColumns = offerCalls.map((c) => c.in.find((f) => f.column !== "status")?.column);
  assert.deepEqual(inColumns.sort(), ["buyer_team_id", "seller_team_id"]);
});

test("hold- og divisions-filter samtidigt: alle fire side-kombinationer dækkes", async () => {
  const supabase = createSupabase({
    transferOffers: [
      // Mit hold sælger, køberen ligger i division 1: skal med.
      { id: "t-hit", status: "accepted", offer_amount: 2, updated_at: "2026-03-04T10:00:00Z",
        seller_team_id: TEAM_A, buyer_team_id: TEAM_B,
        rider: { id: "r1", firstname: "Ann", lastname: "Alpe" },
        seller: teamRow(TEAM_A, "Alpha", 4), buyer: teamRow(TEAM_B, "Beta", 1) },
      // Mit hold er ikke part: skal IKKE med, selvom divisionen matcher.
      { id: "t-miss", status: "accepted", offer_amount: 2, updated_at: "2026-03-03T10:00:00Z",
        seller_team_id: TEAM_B, buyer_team_id: "44444444-4444-4444-8444-444444444444",
        seller: teamRow(TEAM_B, "Beta", 1), buyer: teamRow("44444444-4444-4444-8444-444444444444", "Delta", 1) },
    ],
    teams: [{ id: TEAM_B, division: 1 }, { id: "44444444-4444-4444-8444-444444444444", division: 1 }],
  });
  const { events } = await buildGlobalTradeFeed(
    supabase,
    params({ type: "transfer", division: 1, teamId: TEAM_A }),
  );
  assert.deepEqual(events.map((e) => e.id), ["transfer:t-hit"]);
  assert.equal(
    supabase.__calls.filter((c) => c.table === "transfer_offers").length,
    4,
    "2 hold-sider x 2 divisions-sider",
  );
});

test("division-filter udelukker handler uden for divisionen", async () => {
  const supabase = createSupabase({
    transferOffers: [{
      id: "t-out", status: "accepted", offer_amount: 2, updated_at: "2026-03-04T10:00:00Z",
      seller_team_id: TEAM_A, buyer_team_id: TEAM_B,
      seller: teamRow(TEAM_A, "Alpha", 3), buyer: teamRow(TEAM_B, "Beta", 4),
    }],
    teams: [{ id: "99999999-9999-4999-8999-999999999999", division: 1 }],
  });
  const { events } = await buildGlobalTradeFeed(supabase, params({ type: "transfer", division: 1 }));
  assert.deepEqual(events, []);
});

test("division uden hold giver tomt feed uden at ramme en tom .in()-liste", async () => {
  const supabase = createSupabase({ teams: [] });
  const res = await buildGlobalTradeFeed(supabase, params({ division: 7 }));
  assert.deepEqual(res.events, []);
  assert.equal(res.has_more, false);
  assert.equal(supabase.__calls.filter((c) => c.table === "transfer_offers").length, 0);
});

test("hold-filter rammer både køber- og sælger-siden", async () => {
  const supabase = createSupabase({
    transferOffers: [
      { id: "t-mine", status: "accepted", offer_amount: 2, updated_at: "2026-03-04T10:00:00Z",
        seller_team_id: TEAM_A, buyer_team_id: TEAM_B, seller: teamRow(TEAM_A, "Alpha"), buyer: teamRow(TEAM_B, "Beta") },
      { id: "t-theirs", status: "accepted", offer_amount: 2, updated_at: "2026-03-03T10:00:00Z",
        seller_team_id: "33333333-3333-4333-8333-333333333333", buyer_team_id: TEAM_B,
        seller: teamRow("33333333-3333-4333-8333-333333333333", "Gamma"), buyer: teamRow(TEAM_B, "Beta") },
    ],
  });
  const { events } = await buildGlobalTradeFeed(supabase, params({ type: "transfer", teamId: TEAM_A }));
  assert.deepEqual(events.map((e) => e.id), ["transfer:t-mine"]);
});
