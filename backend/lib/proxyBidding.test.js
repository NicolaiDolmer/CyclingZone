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

// #1740: A fører via autobud, B byder under A's loft → A's proxy genvinder.
// resolveProxyBids skal returnere finalLeaderId === A og IKKE have notificeret A
// som overbudt. Kalderen bruger dette til at undertrykke den FALSKE overbudt-besked.
test("resolver (#1740): A's autobud genvinder → finalLeaderId=A, A IKKE notificeret som overbudt", async () => {
  const auction = {
    id: "auc-1740",
    status: "active",
    calculated_end: FUTURE_END,
    current_price: 80000,
    current_bidder_id: "team-b", // B lige bød 80K manuelt (under A's loft)
    rider: { firstname: "Test", lastname: "Rider", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 0,
  };
  const proxies = [
    { team_id: "team-a", max_amount: 100000 }, // A's autobud genvinder
  ];
  const supabase = createMockSupabase({ auction, proxies });

  const outbidCalls = [];
  const result = await resolveProxyBids({
    supabase,
    auctionId: "auc-1740",
    bidTime: BID_TIME,
    bidCfg: { extension_minutes: 10 },
    notifyTeamOwner: async (teamId, type) => {
      if (type === "auction_outbid" || type === "auction_proxy_outbid") {
        outbidCalls.push({ teamId, type });
      }
    },
    // previousLeader = A (lederen FØR B's udløsende bud).
    previousLeader: "team-a",
  });

  // A genvinder føringen.
  assert.equal(result.finalLeaderId, "team-a");
  // A er IKKE blandt de overbudt-notificerede (ingen falsk besked).
  assert.equal(result.outbidNotified.has("team-a"), false, "A må ikke få overbudt-notif når eget autobud genvinder");
  assert.ok(!outbidCalls.some((c) => c.teamId === "team-a"), "cascaden sender ikke overbudt til A");
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
  // #666: title nu EN ("New bid received") med metadata-driven i18n. Message er
  // også EN fallback uden tusind-separator (formatNumber skubbes til frontend).
  assert.equal(sellerNotif[2], "New bid received");
  assert.match(sellerNotif[3], /Jonas Vingegaard/);
  assert.match(sellerNotif[3], /80001/);
  assert.equal(sellerNotif[4], "auc-seller-notif");
  // metadata sikrer locale-rendering i frontend
  const metadata = sellerNotif[5];
  assert.equal(metadata?.titleCode, "notif.autoBidPlaced.title");
  assert.equal(metadata?.messageCode, "notif.autoBidPlaced.message");
  assert.equal(metadata?.messageParams?.amount, 80001);
  assert.equal(metadata?.messageParams?.riderName, "Jonas Vingegaard");
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
// #1091 — tie-break: ved identisk bud beholder den hidtidige fører med autobud føringen
// =============================================================================

test("#1091: manuelt bud PRÆCIS på førerens proxy-max → føreren beholder føringen (proxy-vs-manuelt)", async () => {
  // A leder ved 80K med proxy max 100K. B byder manuelt PRÆCIS 100K — routen har
  // allerede sat price=100K, bidder=B før cascaden. Med previousLeader=A skal
  // cascaden matche buddet på A's vegne: føringen tilbage til A, prisen uændret.
  const auction = {
    id: "auc-tie-1",
    status: "active",
    calculated_end: FUTURE_END,
    current_price: 100000,
    current_bidder_id: "team-b",
    rider: { firstname: "Test", lastname: "Rider", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 0,
  };
  const proxies = [{ team_id: "team-a", max_amount: 100000 }];
  const teams = { "team-a": { name: "Aalborg" } };
  const supabase = createMockSupabase({ auction, proxies, teams });

  const ownerCalls = [];
  await resolveProxyBids({
    supabase,
    auctionId: "auc-tie-1",
    bidTime: BID_TIME,
    bidCfg: { extension_minutes: 10 },
    notifyTeamOwner: async (...args) => { ownerCalls.push(args); },
    previousLeader: "team-a",
  });

  assert.equal(supabase.state.bids.length, 1, "præcis 1 tie-match-bid");
  assert.equal(supabase.state.bids[0].team_id, "team-a");
  assert.equal(supabase.state.bids[0].amount, 100000, "match på samme beløb — ingen prisstigning");
  assert.equal(supabase.state.bids[0].is_proxy, true);
  assert.equal(supabase.state.auction.current_price, 100000);
  assert.equal(supabase.state.auction.current_bidder_id, "team-a", "føringen skal tilbage til A");

  // B skal notificeres som overbudt
  const outbidNotif = ownerCalls.find((c) => c[1] === "auction_outbid");
  assert.ok(outbidNotif, "auction_outbid notif til den fortrængte byder");
  assert.equal(outbidNotif[0], "team-b");
});

test("#1091: tie-match + fortrængt byder har højere proxy → dennes proxy counter-byder bagefter", async () => {
  // A leder med proxy 100K. B byder manuelt 100K MED proxy_max 150K (gemt af routen).
  // Forventet: A matcher ved 100K (tie går til føreren), derefter counter-byder B's
  // proxy ved 100.001 — eBay-semantik: tie kræver at udfordreren OVERGÅR loftet.
  const auction = {
    id: "auc-tie-2",
    status: "active",
    calculated_end: FUTURE_END,
    current_price: 100000,
    current_bidder_id: "team-b",
    rider: { firstname: "Test", lastname: "Rider", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 0,
  };
  const proxies = [
    { team_id: "team-a", max_amount: 100000 },
    { team_id: "team-b", max_amount: 150000 },
  ];
  const teams = { "team-a": { name: "Aalborg" }, "team-b": { name: "Brønderslev" } };
  const supabase = createMockSupabase({ auction, proxies, teams });

  await resolveProxyBids({
    supabase,
    auctionId: "auc-tie-2",
    bidTime: BID_TIME,
    bidCfg: { extension_minutes: 10 },
    notifyTeamOwner: async () => {},
    previousLeader: "team-a",
  });

  assert.equal(supabase.state.bids.length, 2, "tie-match (A) + counter-bid (B)");
  assert.equal(supabase.state.bids[0].team_id, "team-a");
  assert.equal(supabase.state.bids[0].amount, 100000);
  assert.equal(supabase.state.bids[1].team_id, "team-b");
  assert.equal(supabase.state.bids[1].amount, 100001);
  assert.equal(supabase.state.auction.current_bidder_id, "team-b");
  assert.equal(supabase.state.auction.current_price, 100001);
});

test("#1091: proxy-vs-proxy tie ved minBid-kanten → hidtidig fører beholder føringen", async () => {
  // A leder ved 100.000 med proxy max 100.001. B sætter proxy max 100.001 — routens
  // opening bid (minBid 100.001) har gjort B til midlertidig leder. Identisk
  // effektivt loft: tie skal gå til A (hidtidig fører).
  // Pre-fix: A's proxy (max == currentPrice < minBid) var ikke challenger → B beholdt føringen.
  const auction = {
    id: "auc-tie-3",
    status: "active",
    calculated_end: FUTURE_END,
    current_price: 100001,
    current_bidder_id: "team-b",
    rider: { firstname: "Test", lastname: "Rider", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 0,
  };
  const proxies = [
    { team_id: "team-a", max_amount: 100001 },
    { team_id: "team-b", max_amount: 100001 },
  ];
  const teams = { "team-a": { name: "Aalborg" } };
  const supabase = createMockSupabase({ auction, proxies, teams });

  await resolveProxyBids({
    supabase,
    auctionId: "auc-tie-3",
    bidTime: BID_TIME,
    bidCfg: { extension_minutes: 10 },
    notifyTeamOwner: async () => {},
    previousLeader: "team-a",
  });

  assert.equal(supabase.state.bids.length, 1, "kun A's tie-match — B kan ikke counter-byde over eget loft");
  assert.equal(supabase.state.bids[0].team_id, "team-a");
  assert.equal(supabase.state.bids[0].amount, 100001);
  assert.equal(supabase.state.auction.current_bidder_id, "team-a");
  assert.equal(supabase.state.auction.current_price, 100001);
});

test("#1091: proxy-vs-proxy med ens max over minBid → hidtidig fører vinder ved max (eksisterende cascade-adfærd)", async () => {
  // A leder ved 50K med proxy 100K. B sætter proxy 100K — opening bid 50.001 gjorde
  // B til midlertidig leder. Cascadens challenger-overtagelses-gren klamper B's
  // "winner-proxy" til A.max = 100K, så A (challenger i cascadens optik) ender med
  // føringen ved 100K. Pin'er at tie-reglen allerede holdt i dette flow.
  const auction = {
    id: "auc-tie-4",
    status: "active",
    calculated_end: FUTURE_END,
    current_price: 50001,
    current_bidder_id: "team-b",
    rider: { firstname: "Test", lastname: "Rider", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 0,
  };
  const proxies = [
    { team_id: "team-a", max_amount: 100000 },
    { team_id: "team-b", max_amount: 100000 },
  ];
  const teams = { "team-a": { name: "Aalborg" } };
  const supabase = createMockSupabase({ auction, proxies, teams });

  await resolveProxyBids({
    supabase,
    auctionId: "auc-tie-4",
    bidTime: BID_TIME,
    bidCfg: { extension_minutes: 10 },
    notifyTeamOwner: async () => {},
    previousLeader: "team-a",
  });

  const lastBid = supabase.state.bids.at(-1);
  assert.equal(lastBid.team_id, "team-a");
  assert.equal(lastBid.amount, 100000);
  assert.equal(supabase.state.auction.current_bidder_id, "team-a", "ved ens proxy-max vinder den hidtidige fører");
  assert.equal(supabase.state.auction.current_price, 100000);
});

test("#1091: uden previousLeader (bagudkompat) → ingen tie-match, ny byder beholder føringen", async () => {
  // Kalder uden previousLeader (fx ældre call-sites/tests): adfærd som før fixet.
  const auction = {
    id: "auc-tie-5",
    status: "active",
    calculated_end: FUTURE_END,
    current_price: 100000,
    current_bidder_id: "team-b",
    rider: { firstname: "Test", lastname: "Rider", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 0,
  };
  const proxies = [{ team_id: "team-a", max_amount: 100000 }];
  const supabase = createMockSupabase({ auction, proxies });

  await resolveProxyBids({
    supabase,
    auctionId: "auc-tie-5",
    bidTime: BID_TIME,
    bidCfg: { extension_minutes: 10 },
    notifyTeamOwner: async () => {},
  });

  assert.equal(supabase.state.bids.length, 0);
  assert.equal(supabase.state.auction.current_bidder_id, "team-b");
});

test("#1091 + #44: tie-match balance-gates — fører uden råd mister tie-fortrinnet", async () => {
  // A's proxy matcher beløbet, men A har ikke længere råd (fx salary-deduction
  // siden proxy blev sat). Tie-match skal afvises, B beholder føringen, A notificeres.
  const auction = {
    id: "auc-tie-6",
    status: "active",
    calculated_end: FUTURE_END,
    current_price: 100000,
    current_bidder_id: "team-b",
    rider: { firstname: "Test", lastname: "Rider", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 0,
  };
  const proxies = [{ team_id: "team-a", max_amount: 100000 }];
  const supabase = createMockSupabase({ auction, proxies });

  const ownerCalls = [];
  await resolveProxyBidsRaw({
    supabase,
    auctionId: "auc-tie-6",
    bidTime: BID_TIME,
    bidCfg: { extension_minutes: 10 },
    notifyTeamOwner: async (...args) => { ownerCalls.push(args); },
    previousLeader: "team-a",
    canAffordAutoBidFn: async () => false,
  });

  assert.equal(supabase.state.bids.length, 0, "ingen tie-match uden råd");
  assert.equal(supabase.state.auction.current_bidder_id, "team-b");
  const rejectNotif = ownerCalls.find((c) => c[0] === "team-a" && c[1] === "auction_proxy_outbid");
  assert.ok(rejectNotif, "A skal notificeres om stoppet autobud");
  assert.match(rejectNotif[3], /utilstr.kkelig balance/);
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
    canAffordAutoBidFn: async (_supabase, teamId, _amount) => {
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

// #269: hvis reject_late_auction_bid-triggeren afviser cascade-INSERT (auction blev
// expired/inaktiv mellem caller'ens fetch og cascade-iteration), skal cascade
// breake gracefully — ingen yderligere iterationer, ingen auction-update.
test("resolver: cascade breaker når INSERT afvises af late-bid trigger (#269)", async () => {
  const auction = {
    id: "auc-late",
    status: "active",
    calculated_end: FUTURE_END,
    current_price: 50000,
    current_bidder_id: "team-a",
    rider: { firstname: "Test", lastname: "Rider", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 0,
  };
  const proxies = [
    { team_id: "team-b", max_amount: 80000 }, // B challenger med proxy
  ];
  const auctionState = { ...auction };
  const proxiesState = [...proxies];
  const bidAttempts = [];
  const auctionUpdates = [];

  const supabase = {
    from(table) {
      if (table === "auctions") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { ...auctionState }, error: null }),
            }),
          }),
          update(payload) {
            return {
              eq: () => {
                Object.assign(auctionState, payload);
                auctionUpdates.push({ ...payload });
                return Promise.resolve({ data: null, error: null });
              },
            };
          },
        };
      }
      if (table === "auction_proxy_bids") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: proxiesState, error: null }),
          }),
          delete: () => ({
            eq() { return this; },
            then(onFulfilled) { return Promise.resolve({ data: null, error: null }).then(onFulfilled); },
          }),
        };
      }
      if (table === "auction_bids") {
        return {
          insert(payload) {
            bidAttempts.push({ ...payload });
            // Simuler trigger-fejl — auctionen blev expired mellem caller'ens fetch
            // og denne cascade-INSERT.
            return Promise.resolve({
              data: null,
              error: {
                code: "P0001",
                message: "auction_expired_at_insert (bid_time=... calculated_end=...)",
              },
            });
          },
        };
      }
      if (table === "teams") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: null, error: null }),
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  // Vigtigt: brug raw resolver så vi tester ægte canAffordAutoBidFn-default-flow
  // hvis nødvendigt — her stuber vi alligevel for at undgå teams/proxy DB-roundtrip.
  await resolveProxyBidsRaw({
    supabase,
    auctionId: "auc-late",
    bidTime: BID_TIME,
    bidCfg: { extension_minutes: 10 },
    notifyTeamOwner: async () => {},
    canAffordAutoBidFn: async () => true,
  });

  // Præcist 1 INSERT-forsøg (cascade prøvede én gang, så break'ede)
  assert.equal(bidAttempts.length, 1, "cascade må ikke fortsætte efter trigger-rejection");
  // Ingen auction-update (UPDATE skipper når INSERT fejler)
  assert.equal(auctionUpdates.length, 0, "auction current_price må ikke opdateres når bid afvistes");
});

test("resolver: ikke-trigger INSERT-fejl propageres som exception (#269)", async () => {
  const auction = {
    id: "auc-other-err",
    status: "active",
    calculated_end: FUTURE_END,
    current_price: 50000,
    current_bidder_id: "team-a",
    rider: { firstname: "Test", lastname: "Rider", team_id: null },
    seller_team_id: "ai-team",
    extension_count: 0,
  };
  const proxies = [{ team_id: "team-b", max_amount: 80000 }];
  const auctionState = { ...auction };

  const supabase = {
    from(table) {
      if (table === "auctions") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { ...auctionState }, error: null }),
            }),
          }),
          update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
        };
      }
      if (table === "auction_proxy_bids") {
        return {
          select: () => ({ eq: () => Promise.resolve({ data: proxies, error: null }) }),
          delete: () => ({
            eq() { return this; },
            then(onFulfilled) { return Promise.resolve({ data: null, error: null }).then(onFulfilled); },
          }),
        };
      }
      if (table === "auction_bids") {
        return {
          insert() {
            return Promise.resolve({
              data: null,
              error: { code: "23505", message: "unique violation" },
            });
          },
        };
      }
      if (table === "teams") {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: null, error: null }),
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  await assert.rejects(
    () => resolveProxyBidsRaw({
      supabase,
      auctionId: "auc-other-err",
      bidTime: BID_TIME,
      bidCfg: { extension_minutes: 10 },
      notifyTeamOwner: async () => {},
      canAffordAutoBidFn: async () => true,
    }),
    (err) => err?.code === "23505",
  );
});
