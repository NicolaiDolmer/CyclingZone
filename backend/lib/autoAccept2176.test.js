// #2176 auto-accept, backend-delen uden database: kontakten, tilbuds-gaten,
// saelgers udgaaende auktioner, laengde/sluttid og handlerne.
//
// "Slukket = bit-identisk" bevises her: med auto_accept_enabled slukket laeser
// hver hjaelper KUN kontakten (app_config) og goer intet andet, ruterne springes
// over (next("route")), og tilbuds-/gulv-stierne faar samme svar som foer.
import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTO_ACCEPT_FLAG_KEY,
  autoAcceptAuctionEnd,
  autoAcceptRouteGate,
  countSellerAuctionOutgoing,
  getAutoAcceptDurationIssue,
  getOfferAutoAcceptConflict,
  getOfferAutoAcceptIssue,
  makeSetAutoAcceptPriceHandler,
  makeStartAutoAcceptHandler,
  mapReleaseUnderTeamLockResult,
  mapSetAutoAcceptPriceResult,
  mapStartAutoAcceptResult,
  releaseRiderUnderTeamLock,
} from "./autoAccept2176.js";
import { calculateAuctionEnd, DEFAULT_AUCTION_CONFIG } from "./auctionEngine.js";
import { MIN_RIDERS_FOR_RACE } from "./marketUtils.js";

// Optagende fake: hvert opslag gemmes som { table, ops }, svaret kommer fra `respond`.
function fakeSupabase({ flag = null, respond = () => ({ data: null, error: null }), rpc = () => ({ data: null, error: null }) } = {}) {
  const calls = [];
  const rpcCalls = [];
  const client = {
    calls,
    rpcCalls,
    from(table) {
      const entry = { table, ops: [] };
      calls.push(entry);
      const result = () => (table === "app_config"
        ? { data: flag == null ? null : { value: flag }, error: null }
        : respond(table, entry.ops));
      const builder = new Proxy({}, {
        get(_target, prop) {
          if (prop === "then") {
            return (resolve, reject) => Promise.resolve(result()).then(resolve, reject);
          }
          return (...args) => { entry.ops.push([prop, ...args]); return builder; };
        },
      });
      return builder;
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return rpc(name, args);
    },
  };
  return client;
}

const tablesTouched = (client) => client.calls.map((c) => c.table);

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

// ── Slukket kontakt ─────────────────────────────────────────────────────────

test("slukket: tilbuds-gaten laeser kun kontakten og svarer null (uaendret tilbudsflow)", async () => {
  for (const flag of [null, "off", false, "beta"]) {
    const client = fakeSupabase({ flag });
    const listing = { id: "L1", status: "open", auto_accept_price: 500 };
    assert.equal(await getOfferAutoAcceptIssue(client, { riderId: "R1", offerAmount: 10_000 }), null);
    assert.equal(await getOfferAutoAcceptIssue(client, { listing, offerAmount: 10_000 }), null);
    assert.deepEqual(tablesTouched(client), ["app_config"], `kun kontakten laeses (flag=${flag})`);
    assert.equal(client.calls[0].ops.find((op) => op[0] === "eq")?.[2], AUTO_ACCEPT_FLAG_KEY);
  }
});

test("slukket: saelgers udgaaende auktioner er 0, og kun kontakten laeses (gulv-tjek uaendret)", async () => {
  const client = fakeSupabase({ flag: "off" });
  assert.equal(await countSellerAuctionOutgoing(client, "TEAM_A", { skipRiderIds: ["R1"], atRiskSeasonNumber: 3 }), 0);
  assert.deepEqual(tablesTouched(client), ["app_config"]);
  assert.equal(await countSellerAuctionOutgoing(fakeSupabase({ flag: "on" }), null), 0);
});

test("slukket: ruterne springes over, saa svaret er det samme som foer de fandtes", async () => {
  const client = fakeSupabase({ flag: "off" });
  let nextArg = "not called";
  await autoAcceptRouteGate(client)({}, fakeRes(), (arg) => { nextArg = arg; });
  assert.equal(nextArg, "route");

  const on = fakeSupabase({ flag: "on" });
  await autoAcceptRouteGate(on)({}, fakeRes(), (arg) => { nextArg = arg; });
  assert.equal(nextArg, undefined);
});

test("slukket: handlerne svarer 404 og kalder ingen RPC", async () => {
  const client = fakeSupabase({ flag: "off" });
  const deps = { supabase: client, getAuctionConfig: async () => DEFAULT_AUCTION_CONFIG, getActiveSeasonNumber: async () => 1, logActivity: async () => {} };
  const res1 = fakeRes();
  await makeStartAutoAcceptHandler(deps)({ params: { id: "L1" }, body: { expected_price: 500, duration_minutes: 60 }, team: { id: "B" } }, res1);
  const res2 = fakeRes();
  await makeSetAutoAcceptPriceHandler(deps)({ params: { id: "L1" }, body: { auto_accept_price: 500, expected_auto_accept_price: null }, team: { id: "A" } }, res2);
  assert.equal(res1.statusCode, 404);
  assert.equal(res2.statusCode, 404);
  assert.equal(client.rpcCalls.length, 0);
  assert.ok(tablesTouched(client).every((table) => table === "app_config"), "kun kontakten laeses (cachet)");
});

test("slukket: frigivelsen under holdlaasen svarer null, kalder ingen RPC og laeser kun kontakten", async () => {
  for (const flag of [null, "off", false, "beta"]) {
    const client = fakeSupabase({ flag });
    assert.equal(await releaseRiderUnderTeamLock(client, { riderId: "R1", teamId: "A", atRiskRiders: [{ id: "R2" }] }), null);
    assert.equal(client.rpcCalls.length, 0, `ingen RPC (flag=${flag})`);
    assert.deepEqual(tablesTouched(client), ["app_config"], `kun kontakten laeses (flag=${flag})`);
  }
});

// ── Taendt kontakt ──────────────────────────────────────────────────────────

test("tilbuds-reglen: bud paa Y eller derover afvises, bud under Y gaar igennem", () => {
  const listing = { id: "L1", status: "open", auto_accept_price: 500_000 };
  assert.equal(getOfferAutoAcceptConflict(listing, 499_999), null);
  assert.deepEqual(getOfferAutoAcceptConflict(listing, 500_000), { listingId: "L1", autoAcceptPrice: 500000 });
  assert.deepEqual(getOfferAutoAcceptConflict({ ...listing, status: "negotiating" }, "600000"), { listingId: "L1", autoAcceptPrice: 500000 });
  assert.equal(getOfferAutoAcceptConflict({ ...listing, status: "paused" }, 600_000), null);
  assert.equal(getOfferAutoAcceptConflict({ ...listing, auto_accept_price: null }, 600_000), null);
  assert.equal(getOfferAutoAcceptConflict(null, 600_000), null);
});

test("taendt: begge tilbudsruter peger paa knappen ved bud paa Y", async () => {
  const client = fakeSupabase({ flag: "on", respond: (table) => (table === "transfer_listings"
    ? { data: { id: "L1", status: "open", auto_accept_price: 500_000 }, error: null }
    : { data: null, error: null }) });
  const direct = await getOfferAutoAcceptIssue(client, { riderId: "R1", offerAmount: 500_000 });
  assert.equal(direct.status, 409);
  assert.equal(direct.body.errorCode, "offer_at_auto_accept_price");
  assert.deepEqual(direct.body.errorParams, { autoAcceptPrice: 500000, listingId: "L1" });
  const listingOps = client.calls.find((c) => c.table === "transfer_listings").ops;
  assert.deepEqual(listingOps.find((op) => op[0] === "eq"), ["eq", "rider_id", "R1"]);
  assert.equal(await getOfferAutoAcceptIssue(client, { riderId: "R1", offerAmount: 499_999 }), null);

  // Listing-ruten har allerede listingen: intet ekstra opslag.
  const before = client.calls.length;
  const viaListing = await getOfferAutoAcceptIssue(client, { listing: { id: "L2", status: "open", auto_accept_price: 700 }, offerAmount: 700 });
  assert.equal(viaListing.body.errorParams.listingId, "L2");
  assert.deepEqual(tablesTouched(client).slice(before), []);
});

test("taendt: saelgers ryttere paa auktion med en anden byder taeller som udgaaende", async () => {
  const client = fakeSupabase({ flag: "on", respond: (table, ops) => {
    if (table === "riders") return { data: [{ id: "R1" }, { id: "R2" }, { id: "R3" }, { id: "R4" }], error: null };
    if (table === "auctions") {
      const ids = ops.find((op) => op[0] === "in" && op[1] === "rider_id")[2];
      assert.deepEqual(ids, ["R2", "R3"], "rytteren i handlen og risiko-rytterne springes over");
      return { data: [{ rider_id: "R2", current_bidder_id: "B" }, { rider_id: "R3", current_bidder_id: "C" }], error: null };
    }
    return { data: null, error: null };
  } });
  assert.equal(await countSellerAuctionOutgoing(client, "A", { skipRiderIds: ["R1", "R4"] }), 2);
  const auctionOps = client.calls.find((c) => c.table === "auctions").ops;
  assert.ok(auctionOps.some((op) => op[0] === "neq" && op[1] === "current_bidder_id" && op[2] === "A"));
});

test("laengde: 30 min til 24 t som heltal", () => {
  assert.equal(getAutoAcceptDurationIssue(30), null);
  assert.equal(getAutoAcceptDurationIssue(1440), null);
  assert.equal(getAutoAcceptDurationIssue("90"), null);
  for (const bad of [29, 1441, 60.5, "x", null, undefined, ""]) {
    assert.equal(getAutoAcceptDurationIssue(bad)?.code, "invalid_duration", String(bad));
  }
});

test("sluttid: aktiv tid via calculateAuctionEnd, aldrig vaegur og aldrig om natten", () => {
  const cfg = { ...DEFAULT_AUCTION_CONFIG, weekday_open_hour: 8, weekday_close_hour: 24, weekend_open_hour: 8, weekend_close_hour: 24 };
  // Mandag 23:30 dansk tid + 60 min aktiv tid: 30 min i aften, resten fra 08:00.
  const start = new Date("2026-11-09T22:30:00Z");
  const end = autoAcceptAuctionEnd(start, cfg, 60);
  assert.equal(end.toISOString(), "2026-11-10T07:30:00.000Z");
  assert.equal(end.getTime(), calculateAuctionEnd(start, { ...cfg, duration_hours: 1 }).getTime());
  // 30 min fra 23:30 rammer ikke 00:00, men ruller til 08:00 (#6181 PR 1).
  assert.equal(autoAcceptAuctionEnd(start, cfg, 30).toISOString(), "2026-11-10T07:00:00.000Z");
  // 24 t aktiv tid er laengere end 24 t vaegur.
  const long = autoAcceptAuctionEnd(new Date("2026-11-09T09:00:00Z"), cfg, 1440);
  assert.ok(long.getTime() - Date.parse("2026-11-09T09:00:00Z") > 24 * 3600_000);
});

test("RPC-status oversaettes til HTTP-svar med kendte fejlkoder", () => {
  assert.equal(mapStartAutoAcceptResult({ status: "started", auction_id: "X" }).status, 201);
  const cases = {
    listing_not_found: [404, "listing_not_found"],
    own_listing: [400, "cannot_bid_own_listing"],
    listing_closed: [409, "listing_already_closed"],
    no_auto_accept_price: [409, "auto_accept_price_changed"],
    price_changed: [409, "auto_accept_price_changed"],
    rider_on_auction: [409, "rider_on_auction_transfer"],
    rider_not_with_seller: [409, "auto_accept_rider_unavailable"],
    rider_retired: [409, "auto_accept_rider_unavailable"],
    rider_is_academy: [409, "auto_accept_rider_unavailable"],
    rider_pending_transfer: [409, "auto_accept_rider_unavailable"],
    rider_in_open_swap: [409, "auto_accept_rider_unavailable"],
    insufficient_funds: [400, "start_bid_exceeds_balance"],
    squad_full: [409, "auto_accept_squad_full"],
    seller_squad_floor: [409, "auto_accept_seller_squad_floor"],
  };
  for (const [status, [http, code]] of Object.entries(cases)) {
    const mapped = mapStartAutoAcceptResult({ status, auto_accept_price: 600, max_riders: 30, min_riders: 8 });
    assert.equal(mapped.status, http, status);
    assert.equal(mapped.body.errorCode, code, status);
  }
  assert.deepEqual(mapStartAutoAcceptResult({ status: "price_changed", auto_accept_price: "600" }).body.errorParams, { autoAcceptPrice: 600 });
  assert.throws(() => mapStartAutoAcceptResult({ status: "buyer_not_found" }), /unexpected status/);

  assert.equal(mapSetAutoAcceptPriceResult({ status: "updated", listing_id: "L", auto_accept_price: 5 }).status, 200);
  assert.equal(mapSetAutoAcceptPriceResult({ status: "price_changed", auto_accept_price: 5 }).status, 409);
  assert.equal(mapSetAutoAcceptPriceResult({ status: "not_owner" }).status, 403);
  assert.equal(mapSetAutoAcceptPriceResult({ status: "not_above_asking", asking_price: 4 }).body.errorParams.askingPrice, 4);
  assert.throws(() => mapSetAutoAcceptPriceResult({ status: "nope" }), /unexpected status/);
});

test("taendt: frigivelsen sender gulv og risiko-ryttere til RPC'en og svarer som ruten", async () => {
  const atRiskRiders = [{ id: "R2", firstname: "Rytter", lastname: "To" }];
  let answer = { status: "released", rider_id: "R1" };
  const client = fakeSupabase({ flag: "on", rpc: () => ({ data: answer, error: null }) });

  assert.deepEqual(await releaseRiderUnderTeamLock(client, { riderId: "R1", teamId: "A", atRiskRiders }), { data: [{ id: "R1" }] });
  assert.deepEqual(client.rpcCalls, [{
    name: "auto_accept_release_rider",
    args: { p_rider_id: "R1", p_team_id: "A", p_min_riders: MIN_RIDERS_FOR_RACE, p_at_risk_rider_ids: ["R2"] },
  }]);

  answer = { status: "squad_floor", min_riders: MIN_RIDERS_FOR_RACE };
  const floor = await releaseRiderUnderTeamLock(client, { riderId: "R1", teamId: "A", atRiskRiders });
  assert.equal(floor.error.status, 409);
  assert.equal(floor.error.body.errorCode, "cannot_release_squad_risk");
  assert.deepEqual(floor.error.body.errorParams, { minRiders: MIN_RIDERS_FOR_RACE, atRiskCount: 1, atRiskNames: "Rytter To" });

  assert.deepEqual(mapReleaseUnderTeamLockResult({ status: "rider_state_changed" }).error,
    { status: 409, body: { error: "This rider is no longer on your team", errorCode: "rider_state_changed" } });
  assert.equal(mapReleaseUnderTeamLockResult({ status: "rider_on_auction" }).error.body.errorCode, "rider_on_auction_release");
  assert.throws(() => mapReleaseUnderTeamLockResult({ status: "nope" }), /unexpected status/);

  const failing = fakeSupabase({ flag: "on", rpc: () => ({ data: null, error: new Error("boom") }) });
  await assert.rejects(releaseRiderUnderTeamLock(failing, { riderId: "R1", teamId: "A" }), /boom/);
});

test("taendt: start-handleren sender aktiv-tid-sluttid, trup-loft, gulv og risiko-ryttere til RPC'en", async () => {
  const fixedNow = new Date("2026-11-09T22:30:00Z");
  const cfg = { ...DEFAULT_AUCTION_CONFIG, weekday_open_hour: 8, weekday_close_hour: 24 };
  const client = fakeSupabase({
    flag: "on",
    respond: (table) => (table === "transfer_listings"
      ? { data: { id: "L1", rider_id: "R1", seller_team_id: "A" }, error: null }
      : { data: null, error: null }),
    rpc: () => ({ data: { status: "price_changed", auto_accept_price: 600_000 }, error: null }),
  });
  let announced = false;
  const handler = makeStartAutoAcceptHandler({
    supabase: client,
    getAuctionConfig: async () => cfg,
    getActiveSeasonNumber: async () => 4,
    logActivity: async () => {},
    now: () => fixedNow,
    marketState: async () => ({ squad_limits: { max: 30 } }),
    atRiskRiders: async (_s, teamId, season, opts) => {
      assert.equal(teamId, "A");
      assert.equal(season, 4);
      assert.deepEqual(opts, { excludeRiderIds: ["R1"] });
      return [{ id: "R9" }];
    },
    signingAllowed: async () => null,
    seasonBoundary: async () => null,
    announce: async () => { announced = true; },
  });
  const res = fakeRes();
  await handler({ params: { id: "L1" }, body: { expected_price: 500_000, duration_minutes: 60 }, team: { id: "B" } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.errorCode, "auto_accept_price_changed");
  assert.equal(announced, false);
  assert.deepEqual(client.rpcCalls, [{ name: "start_auto_accept_auction", args: {
    p_listing_id: "L1",
    p_buyer_team_id: "B",
    p_expected_price: 500000,
    p_duration_minutes: 60,
    p_calculated_end: "2026-11-10T07:30:00.000Z",
    p_max_riders: 30,
    p_min_seller_riders: 8,
    p_seller_at_risk_rider_ids: ["R9"],
    p_now: "2026-11-09T22:30:00.000Z",
  } }]);
});

test("taendt: start-handleren afviser ugyldig laengde, manglende pris og egen listing foer RPC", async () => {
  const client = fakeSupabase({ flag: "on", respond: (table) => (table === "transfer_listings"
    ? { data: { id: "L1", rider_id: "R1", seller_team_id: "B" }, error: null }
    : { data: null, error: null }) });
  const handler = makeStartAutoAcceptHandler({ supabase: client, getAuctionConfig: async () => DEFAULT_AUCTION_CONFIG, getActiveSeasonNumber: async () => 1, logActivity: async () => {} });
  const run = async (body) => { const res = fakeRes(); await handler({ params: { id: "L1" }, body, team: { id: "B" } }, res); return res; };
  assert.equal((await run({ expected_price: 5, duration_minutes: 10 })).body.errorCode, "auto_accept_invalid_duration");
  assert.equal((await run({ duration_minutes: 60 })).body.errorCode, "auto_accept_invalid_price");
  assert.equal((await run({ expected_price: null, duration_minutes: 60 })).body.errorCode, "auto_accept_invalid_price");
  assert.equal((await run({ expected_price: 5, duration_minutes: 60 })).body.errorCode, "cannot_bid_own_listing");
  assert.equal(client.rpcCalls.length, 0);
});

test("taendt: pris-handleren kraever den pris klienten saa og sender aktoeren med", async () => {
  const client = fakeSupabase({ flag: "on", rpc: () => ({ data: { status: "updated", listing_id: "L1", auto_accept_price: 700 }, error: null }) });
  const handler = makeSetAutoAcceptPriceHandler({ supabase: client });
  const res = fakeRes();
  await handler({ params: { id: "L1" }, body: { auto_accept_price: 700, expected_auto_accept_price: null }, team: { id: "A" }, user: { id: "U1" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(client.rpcCalls[0], { name: "set_listing_auto_accept_price", args: {
    p_listing_id: "L1", p_seller_team_id: "A", p_price: 700, p_expected_price: null, p_actor_user_id: "U1",
  } });
  const missing = fakeRes();
  await handler({ params: { id: "L1" }, body: { auto_accept_price: 700 }, team: { id: "A" } }, missing);
  assert.equal(missing.body.errorCode, "auto_accept_invalid_price");
  assert.equal(client.rpcCalls.length, 1);
});
