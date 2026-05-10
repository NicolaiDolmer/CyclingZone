import test from "node:test";
import assert from "node:assert/strict";

import { resolveProxyBids as resolveProxyBidsRaw } from "./proxyBidding.js";

// #44: balance-gate er injectable. Eksisterende tests stuber den til "altid råd"
// så vi kan teste cascade-logikken isoleret. Tests for selve gaten passerer
// canAffordAutoBidFn eksplicit.
const ALWAYS_AFFORD = async () => true;
const resolveProxyBids = (args) =>
  resolveProxyBidsRaw({ canAffordAutoBidFn: ALWAYS_AFFORD, ...args });

// Allowed eq() columns per table — resolver må ikke filtrere på andet
const ALLOWED_EQ_COLUMNS = {
  auctions: ["id"],
  // #183: auction_id på select, auction_id+team_id på delete af stale winner-proxy
  auction_proxy_bids: ["auction_id", "team_id"],
  teams: ["id"],
};

// Stateful in-memory supabase-mock der dækker præcis de queries
// resolveProxyBids udfører. Hold den minimal — vi tester kun resolver-loopet.
function createMockSupabase({ auction, proxies = [], teams = {}, proxiesGen = null }) {
  const auctionState = { ...auction };
  // #183: muterbar kopi så delete på auction_proxy_bids reflekteres i efterfølgende selects.
  const proxiesState = [...proxies];
  const bidLog = [];
  const updateLog = [];
  const teamLookups = [];
  const proxyDeleteLog = [];

  function assertColumn(table, column) {
    const allowed = ALLOWED_EQ_COLUMNS[table];
    if (!allowed?.includes(column)) {
      throw new Error(`Unexpected eq column "${column}" on table "${table}" — allowed: ${allowed?.join(", ") || "(none)"}`);
    }
  }

  return {
    state: { auction: auctionState, bids: bidLog, updates: updateLog, teamLookups, proxies: proxiesState, proxyDeletes: proxyDeleteLog },
    from(table) {
      if (table === "auctions") {
        return {
          select() {
            return {
              eq(col) {
                assertColumn("auctions", col);
                return {
                  single() {
                    return Promise.resolve({ data: { ...auctionState }, error: null });
                  },
                };
              },
            };
          },
          update(payload) {
            return {
              eq(col) {
                assertColumn("auctions", col);
                Object.assign(auctionState, payload);
                updateLog.push({ ...payload });
                return Promise.resolve({ data: null, error: null });
              },
            };
          },
        };
      }
      if (table === "auction_proxy_bids") {
        return {
          select() {
            return {
              eq(col) {
                assertColumn("auction_proxy_bids", col);
                const data = proxiesGen ? proxiesGen(auctionState) : proxiesState;
                return Promise.resolve({ data, error: null });
              },
            };
          },
          // #183: delete + chained .eq() — muterer proxiesState så efterfølgende
          // selects (inkl. samme resolver-iteration) ser den slettede række borte.
          delete() {
            const filters = {};
            const applyAndResolve = () => {
              proxyDeleteLog.push({ ...filters });
              for (let i = proxiesState.length - 1; i >= 0; i--) {
                const row = proxiesState[i];
                let matches = true;
                for (const [col, val] of Object.entries(filters)) {
                  if (row[col] !== val) { matches = false; break; }
                }
                if (matches) proxiesState.splice(i, 1);
              }
              return { data: null, error: null };
            };
            const chain = {
              eq(col, val) {
                assertColumn("auction_proxy_bids", col);
                filters[col] = val;
                return chain;
              },
              then(onFulfilled, onRejected) {
                return Promise.resolve(applyAndResolve()).then(onFulfilled, onRejected);
              },
            };
            return chain;
          },
        };
      }
      if (table === "auction_bids") {
        return {
          insert(payload) {
            bidLog.push({ ...payload });
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      if (table === "teams") {
        return {
          select() {
            return {
              eq(col, id) {
                assertColumn("teams", col);
                teamLookups.push(id);
                const resolveTeam = () =>
                  Promise.resolve({ data: teams[id] || null, error: null });
                return {
                  single: resolveTeam,
                  maybeSingle: resolveTeam,
                };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

const FUTURE_END = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // +1h
const BID_TIME = new Date();

// Fast tidsstempel der falder på lørdag 12:00 CEST — robust mod weekend/weekday
// vinduer (08-23 CEST på weekend) og uafhængig af test-runner-tidspunkt.
// Bevidst valgt langt i fremtiden: isAuctionExpired bruger real Date.now() og
// ville få resolver til at bail før checkBidExtension hvis datoen var i fortiden.
const SAT_NOON_UTC = new Date("2030-05-04T10:00:00.000Z");
// Standard auction-config så windowCloseTime kan beregnes deterministisk
const FULL_CFG = {
  duration_hours: 6,
  weekday_open_hour: 16,
  weekday_close_hour: 22,
  weekend_open_hour: 8,
  weekend_close_hour: 23,
  extension_minutes: 10,
};

test("resolver: A's proxy 100K outbidder B's manuelle bid 80K til 80.001 (Test 1 fra #171)", async () => {
  const auction = {
    id: "auc-1",
    status: "active",
    calculated_end: FUTURE_END,
    current_price: 80000,
    current_bidder_id: "team-b",
    rider: { firstname: "Test", lastname: "Rider", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 0,
  };
  const proxies = [
    { team_id: "team-a", max_amount: 100000 },
    // B har INGEN proxy
  ];
  const supabase = createMockSupabase({ auction, proxies });

  await resolveProxyBids({
    supabase,
    auctionId: "auc-1",
    bidTime: BID_TIME,
    bidCfg: { extension_minutes: 10 },
    notifyTeamOwner: async () => {},
  });

  assert.equal(supabase.state.bids.length, 1);
  assert.equal(supabase.state.bids[0].team_id, "team-a");
  assert.equal(supabase.state.bids[0].amount, 80001);
  assert.equal(supabase.state.bids[0].is_proxy, true);
  assert.equal(supabase.state.auction.current_price, 80001);
  assert.equal(supabase.state.auction.current_bidder_id, "team-a");
});

test("resolver: A 100K vs B 200K opløses til B leder ved 100.001 (Test 2 fra #171)", async () => {
  const auction = {
    id: "auc-2",
    status: "active",
    calculated_end: FUTURE_END,
    current_price: 11000, // B lige bidet 11K manuelt
    current_bidder_id: "team-b",
    rider: { firstname: "Test", lastname: "Rider", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 0,
  };
  const proxies = [
    { team_id: "team-a", max_amount: 100000 },
    { team_id: "team-b", max_amount: 200000 },
  ];
  const supabase = createMockSupabase({ auction, proxies });

  await resolveProxyBids({
    supabase,
    auctionId: "auc-2",
    bidTime: BID_TIME,
    bidCfg: { extension_minutes: 10 },
    notifyTeamOwner: async () => {},
  });

  // Forventet: B's proxy slår A's max — B byder på 100.001 (A.max + 1) og loopet stopper.
  const lastBid = supabase.state.bids.at(-1);
  assert.equal(lastBid.team_id, "team-b");
  assert.equal(lastBid.amount, 100001);
  assert.equal(lastBid.is_proxy, true);
  assert.equal(supabase.state.auction.current_price, 100001);
  assert.equal(supabase.state.auction.current_bidder_id, "team-b");
});

test("resolver: stale winner-proxy efter eget manuelt bid blokerer ikke counter-bid (#171 rod-årsag)", async () => {
  // B satte proxy 60K tidligere, derefter manuelt bid 80K.
  // A's proxy 100K skal stadig følge med op til 80.001.
  // Pre-fix: resolver brugte winnerProxy.max + 1 = 60.001 < currentPrice → break.
  const auction = {
    id: "auc-3",
    status: "active",
    calculated_end: FUTURE_END,
    current_price: 80000,
    current_bidder_id: "team-b",
    rider: { firstname: "Test", lastname: "Rider", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 0,
  };
  const proxies = [
    { team_id: "team-a", max_amount: 100000 },
    { team_id: "team-b", max_amount: 60000 }, // STALE — under currentPrice
  ];
  const supabase = createMockSupabase({ auction, proxies });

  await resolveProxyBids({
    supabase,
    auctionId: "auc-3",
    bidTime: BID_TIME,
    bidCfg: { extension_minutes: 10 },
    notifyTeamOwner: async () => {},
  });

  // Forventet: A's proxy outbidder til 80.001 (minBid), loop stopper når intet challenger tilbage.
  assert.equal(supabase.state.bids.length, 1, "skulle place præcis 1 counter-bid (A's proxy)");
  assert.equal(supabase.state.bids[0].team_id, "team-a");
  assert.equal(supabase.state.bids[0].amount, 80001);
  assert.equal(supabase.state.bids[0].is_proxy, true);
  assert.equal(supabase.state.auction.current_price, 80001);
  assert.equal(supabase.state.auction.current_bidder_id, "team-a");
});

test("resolver: stale winner-proxy slettes fra DB efter manuelt over-bid (#183)", async () => {
  // Pre-fix #183: stale proxy hang i auction_proxy_bids → UI viste "Autobud loft 60K"
  // selvom resolver ignorerede den. Manageren troede autobud var aktiv. Silent failure.
  // Post-fix: resolver sletter winnerProxy fra DB når max < currentPrice.
  const auction = {
    id: "auc-stale-delete",
    status: "active",
    calculated_end: FUTURE_END,
    current_price: 80000,
    current_bidder_id: "team-b",
    rider: { firstname: "Test", lastname: "Rider", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 0,
  };
  const proxies = [
    { auction_id: "auc-stale-delete", team_id: "team-a", max_amount: 100000 },
    { auction_id: "auc-stale-delete", team_id: "team-b", max_amount: 60000 }, // STALE — under currentPrice
  ];
  const supabase = createMockSupabase({ auction, proxies });

  await resolveProxyBids({
    supabase,
    auctionId: "auc-stale-delete",
    bidTime: BID_TIME,
    bidCfg: { extension_minutes: 10 },
    notifyTeamOwner: async () => {},
  });

  // Stale proxy (team-b) skal være slettet
  const remainingProxies = supabase.state.proxies;
  assert.equal(remainingProxies.length, 1, "team-b's stale proxy skal være slettet");
  assert.equal(remainingProxies[0].team_id, "team-a", "kun team-a's proxy må være tilbage");

  // Delete-kaldet skal være rettet mod auction_id + team_id
  const stale = supabase.state.proxyDeletes.find((d) => d.team_id === "team-b");
  assert.ok(stale, "delete skal være kaldt for team-b");
  assert.equal(stale.auction_id, "auc-stale-delete");

  // Resolver-adfærd uændret fra #171-test: A overtager ved 80.001
  assert.equal(supabase.state.auction.current_bidder_id, "team-a");
  assert.equal(supabase.state.auction.current_price, 80001);
});

test("resolver: ingen challengers (proxies under minBid) → no-op", async () => {
  const auction = {
    id: "auc-4",
    status: "active",
    calculated_end: FUTURE_END,
    current_price: 100000,
    current_bidder_id: "team-a",
    rider: { firstname: "Test", lastname: "Rider", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 0,
  };
  const proxies = [
    { team_id: "team-b", max_amount: 50000 }, // under minBid 100.001
  ];
  const supabase = createMockSupabase({ auction, proxies });

  await resolveProxyBids({
    supabase,
    auctionId: "auc-4",
    bidTime: BID_TIME,
    bidCfg: { extension_minutes: 10 },
    notifyTeamOwner: async () => {},
  });

  assert.equal(supabase.state.bids.length, 0);
  assert.equal(supabase.state.auction.current_price, 100000);
});

test("resolver: ekspireret auktion → no-op", async () => {
  const auction = {
    id: "auc-5",
    status: "active",
    calculated_end: new Date(Date.now() - 60_000).toISOString(), // -1 min
    current_price: 50000,
    current_bidder_id: "team-b",
    rider: { firstname: "Test", lastname: "Rider", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 0,
  };
  const proxies = [{ team_id: "team-a", max_amount: 100000 }];
  const supabase = createMockSupabase({ auction, proxies });

  await resolveProxyBids({
    supabase,
    auctionId: "auc-5",
    bidTime: BID_TIME,
    bidCfg: { extension_minutes: 10 },
    notifyTeamOwner: async () => {},
  });

  assert.equal(supabase.state.bids.length, 0);
});

test("resolver: tre proxies — højeste leder ved næsthøjeste max + 1", async () => {
  // C med max 300K vs A 100K vs B 200K — C skal lede ved B.max + 1 = 200.001.
  // Test verificerer at multi-iteration korrekt opløser pyramiden.
  const auction = {
    id: "auc-6",
    status: "active",
    calculated_end: FUTURE_END,
    current_price: 50000,
    current_bidder_id: "team-x", // tilfældig ikke-proxy bidder
    rider: { firstname: "Test", lastname: "Rider", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 0,
  };
  const proxies = [
    { team_id: "team-a", max_amount: 100000 },
    { team_id: "team-b", max_amount: 200000 },
    { team_id: "team-c", max_amount: 300000 },
  ];
  const supabase = createMockSupabase({ auction, proxies });

  await resolveProxyBids({
    supabase,
    auctionId: "auc-6",
    bidTime: BID_TIME,
    bidCfg: { extension_minutes: 10 },
    notifyTeamOwner: async () => {},
  });

  // Itr 1: ingen winner-proxy (X), top-challenger C → C byder minBid 50.001
  // Itr 2: C leder, B er challenger, C's proxy 300K >= 200.001 → C byder 200.001
  // Itr 3: ingen challengers > 200.002, break
  const lastBid = supabase.state.bids.at(-1);
  assert.equal(lastBid.team_id, "team-c");
  assert.equal(lastBid.amount, 200001);
  assert.equal(lastBid.is_proxy, true);
  assert.equal(supabase.state.auction.current_bidder_id, "team-c");
  assert.equal(supabase.state.auction.current_price, 200001);
});

// =============================================================================
// Tier 1 — luk v2.67-coverage-hullet (notifyOutbidDM, sælger-notif, bidderName)
// =============================================================================

test("notifyOutbidDM: IKKE kaldt mid-cascade når mid-bidder ikke er udmattet (#192)", async () => {
  // Mid-cascade scenario: A's proxy outbidder B's manuelle bid. B har ingen proxy
  // og er ikke "exhausted" — B kunne stadig byde højere manuelt. DM ville være spam.
  // In-app notif (auction_outbid) fyrer stadig — kun Discord DM-adfærd ændret.
  const auction = {
    id: "auc-dm-1",
    status: "active",
    calculated_end: FUTURE_END,
    current_price: 80000,
    current_bidder_id: "team-b",
    rider: { firstname: "Lasse", lastname: "Norman", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 0,
  };
  const proxies = [{ team_id: "team-a", max_amount: 100000 }];
  const teams = { "team-a": { name: "Aagerups Aalborg" } };
  const supabase = createMockSupabase({ auction, proxies, teams });

  const dmCalls = [];
  const ownerCalls = [];
  await resolveProxyBids({
    supabase,
    auctionId: "auc-dm-1",
    bidTime: BID_TIME,
    bidCfg: { extension_minutes: 10 },
    notifyTeamOwner: async (...args) => { ownerCalls.push(args); },
    notifyOutbidDM: async (args) => { dmCalls.push(args); },
  });

  assert.equal(dmCalls.length, 0, "B er ikke exhausted → INGEN DM");
  // In-app notif til B skal stadig fyre
  const outbidNotif = ownerCalls.find(c => c[1] === "auction_outbid");
  assert.ok(outbidNotif, "auction_outbid in-app notif skal stadig fyre");
  assert.equal(outbidNotif[0], "team-b");
});

test("notifyOutbidDM: kaldes med exhausted=true når egen proxy bliver overbudt", async () => {
  // A leder ved cp=50K med proxy 100K. B's proxy 200K kommer ind → A's proxy
  // udmattes når den klampes mod B's getMinBid(A.max)=100.001.
  const auction = {
    id: "auc-dm-2",
    status: "active",
    calculated_end: FUTURE_END,
    current_price: 50000,
    current_bidder_id: "team-a",
    rider: { firstname: "Mads", lastname: "Pedersen", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 0,
  };
  const proxies = [
    { team_id: "team-a", max_amount: 100000 },
    { team_id: "team-b", max_amount: 200000 },
  ];
  const teams = { "team-b": { name: "Brønderslev BMC" } };
  const supabase = createMockSupabase({ auction, proxies, teams });

  const dmCalls = [];
  await resolveProxyBids({
    supabase,
    auctionId: "auc-dm-2",
    bidTime: BID_TIME,
    bidCfg: { extension_minutes: 10 },
    notifyTeamOwner: async () => {},
    notifyOutbidDM: async (args) => { dmCalls.push(args); },
  });

  // B overtager ved 100.001 (clamped af A's proxy + 1). A's proxy "udmattet".
  assert.equal(supabase.state.auction.current_bidder_id, "team-b");
  assert.equal(supabase.state.auction.current_price, 100001);

  const exhaustedDM = dmCalls.find(c => c.exhausted === true);
  assert.ok(exhaustedDM, "skal sende exhausted=true DM til A");
  assert.equal(exhaustedDM.teamId, "team-a");
  assert.equal(exhaustedDM.isAuto, true);
  assert.equal(exhaustedDM.newBid, 100001);
  assert.equal(exhaustedDM.bidderName, "Brønderslev BMC");
});

test("notifyTeamOwner: sælger får bid_received-notif når rider.team_id === seller_team_id (manager-ejet rytter)", async () => {
  const auction = {
    id: "auc-seller-notif",
    status: "active",
    calculated_end: FUTURE_END,
    current_price: 80000,
    current_bidder_id: "team-b",
    rider: { firstname: "Jonas", lastname: "Vingegaard", team_id: "team-seller" },
    seller_team_id: "team-seller", // sælger er rytter-ejer (manager-listing)
    extension_count: 0,
  };
  const proxies = [{ team_id: "team-a", max_amount: 100000 }];
  const teams = { "team-a": { name: "Aalborg" } };
  const supabase = createMockSupabase({ auction, proxies, teams });

  const ownerCalls = [];
  await resolveProxyBids({
    supabase,
    auctionId: "auc-seller-notif",
    bidTime: BID_TIME,
    bidCfg: { extension_minutes: 10 },
    notifyTeamOwner: async (...args) => { ownerCalls.push(args); },
  });

  // Forventet: 1) auction_outbid → team-b (current winner), 2) bid_received → team-seller
  const sellerNotif = ownerCalls.find(c => c[1] === "bid_received");
  assert.ok(sellerNotif, "skal sende bid_received til seller_team_id");
  assert.equal(sellerNotif[0], "team-seller");
  assert.equal(sellerNotif[2], "Nyt bud modtaget");
  assert.match(sellerNotif[3], /Jonas Vingegaard/);
  assert.match(sellerNotif[3], /80\.001/);
  assert.equal(sellerNotif[4], "auc-seller-notif");
});

test("bidderName: falder tilbage til \"Autobud\" når team-rækken mangler", async () => {
  // teams er tom — bidderName-fetch returnerer null. Verificér fallback i in-app notif.
  // Bruger exhausted-scenarie så DM også fyrer og kan testes for fallback.
  const auction = {
    id: "auc-fallback",
    status: "active",
    calculated_end: FUTURE_END,
    current_price: 50000,
    current_bidder_id: "team-a",
    rider: { firstname: "Test", lastname: "Rider", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 0,
  };
  const proxies = [
    { team_id: "team-a", max_amount: 100000 },
    { team_id: "team-b", max_amount: 200000 },
  ];
  const supabase = createMockSupabase({ auction, proxies, teams: {} });

  const dmCalls = [];
  const ownerCalls = [];
  await resolveProxyBids({
    supabase,
    auctionId: "auc-fallback",
    bidTime: BID_TIME,
    bidCfg: { extension_minutes: 10 },
    notifyTeamOwner: async (...args) => { ownerCalls.push(args); },
    notifyOutbidDM: async (args) => { dmCalls.push(args); },
  });

  // B overtager → A udmattes → DM med exhausted=true sendes til A
  const exhaustedDM = dmCalls.find(c => c.exhausted === true);
  assert.ok(exhaustedDM, "exhausted DM skal sendes");
  assert.equal(exhaustedDM.bidderName, "Autobud");
  // In-app proxy_outbid-notif til A bruger samme fallback
  const proxyOutbidNotif = ownerCalls.find(c => c[1] === "auction_proxy_outbid");
  assert.ok(proxyOutbidNotif, "auction_proxy_outbid notif skal fyre");
  assert.match(proxyOutbidNotif[3], /overbudt af Autobud/);
  // Verificér at teams-tabellen rent faktisk blev forespurgt (fetcher bidder = team-b)
  assert.ok(supabase.state.teamLookups.includes("team-b"));
});

// =============================================================================
// Tier 2 — edge-cases (extended-status + extension_count, runaway-guard, clamp-branch)
// =============================================================================

test("resolver: status \"extended\" auktion håndteres som active — cascade extender IKKE selv (#257)", async () => {
  // Auction allerede forlænget 2 gange. Et nyt bid inden for extension-vinduet skal:
  // a) fortsat behandles (extended er i [active, extended]-whitelist)
  // b) IKKE trigge ny forlængelse fra cascaden — extension er nu callerens ansvar
  //    via applyLeaderShiftExtension efter cascade settles (#257).
  const calculatedEnd = new Date(SAT_NOON_UTC.getTime() + 30_000); // bidTime + 30s
  const auction = {
    id: "auc-ext",
    status: "extended",
    calculated_end: calculatedEnd.toISOString(),
    current_price: 50000,
    current_bidder_id: "team-x", // ingen proxy
    rider: { firstname: "Test", lastname: "Rider", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 2,
  };
  const proxies = [{ team_id: "team-a", max_amount: 100000 }];
  const supabase = createMockSupabase({ auction, proxies });

  await resolveProxyBids({
    supabase,
    auctionId: "auc-ext",
    bidTime: SAT_NOON_UTC, // lørdag 12:00 CEST — robust mod weekend/weekday-vinduer
    bidCfg: { ...FULL_CFG, extension_minutes: 1 }, // 60s extension > 30s timeLeft
    notifyTeamOwner: async () => {},
  });

  // Cascade placerer counter-bid og ændrer leder, men extender IKKE selv.
  assert.equal(supabase.state.bids.length, 1);
  assert.equal(supabase.state.bids[0].team_id, "team-a");
  assert.equal(supabase.state.bids[0].amount, 50001);
  assert.equal(supabase.state.bids[0].is_proxy, true);
  assert.equal(supabase.state.bids[0].triggered_extension, false, "cascade-bid skal ikke flagge triggered_extension; callerens applyLeaderShiftExtension gør det");
  // Status + extension_count + calculated_end skal være uændret af cascaden selv.
  assert.equal(supabase.state.auction.status, "extended");
  assert.equal(supabase.state.auction.extension_count, 2, "cascade må ikke øge extension_count");
  assert.equal(supabase.state.auction.calculated_end, calculatedEnd.toISOString(), "cascade må ikke skubbe calculated_end");
  // Men leader skal være skiftet — det er signalet til caller om at extension skal anvendes.
  assert.equal(supabase.state.auction.current_bidder_id, "team-a");
});

test("resolver: MAX_PROXY_ITERATIONS guard kapper runaway-loop ved 30 iterationer", async () => {
  // Konstrueret scenarie: to phantom-proxies hvis max altid er 1.5× currentPrice (genereres
  // dynamisk pr. select-call). Hver iteration overtages føringen i challenger-overtages-grenen,
  // hvilket aldrig terminerer naturligt. Uden guard ville loopet køre i prod indtil overflow.
  const auction = {
    id: "auc-runaway",
    status: "active",
    calculated_end: FUTURE_END,
    current_price: 1000,
    current_bidder_id: "team-a",
    rider: { firstname: "Test", lastname: "Rider", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 0,
  };
  const proxiesGen = (a) => [
    { team_id: "team-a", max_amount: Math.round(a.current_price * 1.5) },
    { team_id: "team-b", max_amount: Math.round(a.current_price * 1.5) },
  ];
  const supabase = createMockSupabase({ auction, proxiesGen });

  await resolveProxyBids({
    supabase,
    auctionId: "auc-runaway",
    bidTime: BID_TIME,
    bidCfg: { extension_minutes: 10 },
    notifyTeamOwner: async () => {},
  });

  // Guarden i proxyBidding.js sætter MAX_PROXY_ITERATIONS = 30 — ingen flere bids end det
  assert.equal(supabase.state.bids.length, 30, "MAX_PROXY_ITERATIONS = 30 må aldrig overskrides");
});

test("resolver: challenger-overtages med winnerProxy clamper bud til winnerProxy.max + 1", async () => {
  // A leder cp=60K med proxy 100K. B's proxy 200K kommer ind. A's proxy clamper B's bid
  // til 100.001 (winnerProxy.max + 1) i stedet for B's fulde max 200K — ellers ville en
  // udmattet winnerProxy "stjæle" hele challengerens budget på en gang.
  const auction = {
    id: "auc-clamp",
    status: "active",
    calculated_end: FUTURE_END,
    current_price: 60000,
    current_bidder_id: "team-a",
    rider: { firstname: "Test", lastname: "Rider", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 0,
  };
  const proxies = [
    { team_id: "team-a", max_amount: 100000 },
    { team_id: "team-b", max_amount: 200000 },
  ];
  const supabase = createMockSupabase({ auction, proxies });

  await resolveProxyBids({
    supabase,
    auctionId: "auc-clamp",
    bidTime: BID_TIME,
    bidCfg: { extension_minutes: 10 },
    notifyTeamOwner: async () => {},
  });

  // B vinder ved 100.001 (A.max + 1), ikke 200K
  assert.equal(supabase.state.bids.length, 1, "skal kun place ÉT counter-bid (B udmatter A)");
  assert.equal(supabase.state.bids[0].team_id, "team-b");
  assert.equal(supabase.state.bids[0].amount, 100001);
  assert.equal(supabase.state.bids[0].is_proxy, true);
  assert.equal(supabase.state.auction.current_bidder_id, "team-b");
  assert.equal(supabase.state.auction.current_price, 100001);
});

// =============================================================================
// #44 — balance-gate på auto-bid (canAffordAutoBidFn)
// =============================================================================

test("#44: challenger med proxy > balance behandles som udmattet, næste challenger overtager", async () => {
  // A leder cp=50K, ingen proxy. B har proxy 200K men kun 100K balance (kan ikke afford 200K).
  // C har proxy 150K og 200K balance. Forventet: B afvises, C overtager ved 150K eller minBid.
  const auction = {
    id: "auc-balance",
    status: "active",
    calculated_end: FUTURE_END,
    current_price: 50000,
    current_bidder_id: "team-a",
    rider: { firstname: "Test", lastname: "Rider", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 0,
  };
  const proxies = [
    { team_id: "team-b", max_amount: 200000 },
    { team_id: "team-c", max_amount: 150000 },
  ];
  const supabase = createMockSupabase({ auction, proxies });

  const ownerCalls = [];
  await resolveProxyBidsRaw({
    supabase,
    auctionId: "auc-balance",
    bidTime: BID_TIME,
    bidCfg: { extension_minutes: 10 },
    notifyTeamOwner: async (...args) => { ownerCalls.push(args); },
    canAffordAutoBidFn: async (_supabase, teamId, amount) => {
      if (teamId === "team-b") return false; // afvis B
      return true;
    },
  });

  // C skal vinde — B afvist
  assert.equal(supabase.state.bids.length, 1);
  assert.equal(supabase.state.bids[0].team_id, "team-c");
  // B skal have notif om at deres proxy stoppede pga. utilstrækkelig balance
  const bRejectNotif = ownerCalls.find((c) => c[0] === "team-b" && c[1] === "auction_proxy_outbid");
  assert.ok(bRejectNotif, "team-b skal have proxy-outbid notif");
  assert.match(bRejectNotif[3], /utilstr.kkelig balance/);
});

test("#44: alle challengers afvist på balance → cascade stopper uden counter-bid", async () => {
  // A leder cp=50K. B og C har proxy men ingen råd → cascade ender uden bids.
  const auction = {
    id: "auc-no-afford",
    status: "active",
    calculated_end: FUTURE_END,
    current_price: 50000,
    current_bidder_id: "team-a",
    rider: { firstname: "Test", lastname: "Rider", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 0,
  };
  const proxies = [
    { team_id: "team-b", max_amount: 200000 },
    { team_id: "team-c", max_amount: 150000 },
  ];
  const supabase = createMockSupabase({ auction, proxies });

  await resolveProxyBidsRaw({
    supabase,
    auctionId: "auc-no-afford",
    bidTime: BID_TIME,
    bidCfg: { extension_minutes: 10 },
    notifyTeamOwner: async () => {},
    canAffordAutoBidFn: async () => false, // ingen kan afford
  });

  // Ingen counter-bids
  assert.equal(supabase.state.bids.length, 0);
  // A leder stadig
  assert.equal(supabase.state.auction.current_bidder_id, "team-a");
  assert.equal(supabase.state.auction.current_price, 50000);
});
