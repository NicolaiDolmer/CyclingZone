import { QueryObserver, focusManager } from "@tanstack/react-query";
import test from "node:test";
import assert from "node:assert/strict";
import { createDataRuntime, privateKey } from "./queryRuntime.ts";
import { createAuctionRealtime } from "./auctionRealtime.ts";

const NOW = Date.parse("2026-11-12T12:00:00Z");
function auction(id = "a") {
  return { id, rider_id: "rider", current_price: 100, min_increment: 10, calculated_end: "2026-11-12T13:00:00Z", status: "active", is_guaranteed_sale: false, is_flash: false, is_youth: false,
    seller_team_id: "seller", current_bidder_id: "rival", rider: { id: "rider", firstname: "Ada" }, seller: { id: "seller", name: "Seller" }, current_bidder: { id: "rival", name: "Rival" }, myHighestBid: 90, myProxyMax: 180 };
}
function snapshot() { return { auctions: [auction()], moneyPending: false, _serverRead: 0, recentBids: [], watchlist: new Set(["rider"]), currentRiderCount: 9, academySquadCounts: { senior: 9 } }; }
const flush = async () => { for (let i = 0; i < 15; i += 1) await Promise.resolve(); };
function setup(t: test.TestContext, seed = true) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: NOW });
  const runtime = createDataRuntime(); runtime.setViewer("viewer"); runtime.setTeam("mine");
  const scope = runtime.scope(); const key = privateKey(scope, "auctions");
  let reads = 0; let names = 0; let teamReads = 0;
  const teamKey = ["private", scope.generation, scope.viewerId, null, "team"] as const;
  let teamLoad = async (_signal: AbortSignal) => ({ id: "mine", balance: 1000 });
  runtime.client.setQueryDefaults(teamKey, { queryFn: ({ signal }) => { teamReads += 1; return teamLoad(signal); } });
  runtime.client.setQueryData(teamKey, { id: "mine", balance: 1000 });
  let load = async (_signal: AbortSignal) => snapshot();
  let protectedSnapshot = false;
  let nameLoad = async (id: string, _signal: AbortSignal): Promise<{id: string; name: string} | null> => ({ id, name: `Name ${id}` });
  const makeOwner = () => createAuctionRealtime({ runtime, scope, resolveTeam: (id, signal) => { names += 1; return nameLoad(id, signal); } });
  let owner = makeOwner();
  runtime.client.setQueryDefaults(key, { queryFn: async ({ signal }) => {
    reads += 1; const ticket = owner.beginRead(signal, protectedSnapshot);
    try { return owner.completeRead(await load(signal), ticket, signal); } finally { owner.settledRead(ticket); }
  } });
  if (seed) runtime.client.setQueryData(key, snapshot());
  t.after(() => { owner.dispose(); runtime.client.clear(); });
  return { runtime, scope, key, owner, data: () => runtime.client.getQueryData<ReturnType<typeof snapshot>>(key), counts: () => ({ reads, names }), load: (next: typeof load) => { load = next; }, protectSnapshot: () => { protectedSnapshot = true; }, activate: () => { const observer = new QueryObserver(runtime.client, { queryKey: key }); const stop = observer.subscribe(() => {}); t.after(stop); return observer; }, makeOwner, useOwner: (next: typeof owner) => { owner = next; }, nameLoad: (next: typeof nameLoad) => { nameLoad = next; }, teamKey, teamReads: () => teamReads, teamLoad: (next: typeof teamLoad) => { teamLoad = next; } };
}

test("committed price/end is cached before callback and does zero reads", async t => {
  const s = setup(t); const previous = s.data()!.auctions[0];
  let called = false;
  s.owner.auction({ new: { id: "a", current_price: 125, calculated_end: "2026-11-12T13:10:00Z" } }, (next, old) => {
    called = true; assert.equal(old, previous); assert.equal(next.current_price, 125);
    assert.equal(s.data()!.auctions[0].current_price, 125);
  });
  assert.equal(called, true);
  assert.equal(s.data()!.auctions[0].current_price, 125);
  assert.equal(s.data()!.auctions[0].rider, previous.rider);
  assert.equal(s.data()!.auctions[0].seller, previous.seller);
  assert.equal(s.data()!.auctions[0].myProxyMax, 180);
  t.mock.timers.tick(1200); await flush(); assert.deepEqual(s.counts(), { reads: 0, names: 0 });
});

test("closed rows disappear immediately without hydrating the closing bidder", async t => {
  const s = setup(t);
  s.owner.auction({ new: { id: "a", status: "completed", current_bidder_id: "unknown" } });
  assert.deepEqual(s.data()!.auctions, []);
  t.mock.timers.tick(800); await flush(); assert.deepEqual(s.counts(), { reads: 0, names: 0 });
});

test("DELETE accepts a primary-key-only old row", t => {
  const s = setup(t); s.owner.auction({ eventType: "DELETE", old: { id: "a" } });
  assert.deepEqual(s.data()!.auctions, []);
});

test("new bidder clears wrong join and one lookup hydrates the committed id", async t => {
  const s = setup(t);
  s.owner.auction({ new: { id: "a", current_bidder_id: "new-team", current_price: 130 } });
  assert.equal(s.data()!.auctions[0].current_bidder, null);
  s.owner.auction({ new: { id: "a", current_price: 140 } });
  await flush(); assert.equal(s.data()!.auctions[0].current_bidder?.id, "new-team");
  assert.equal(s.data()!.auctions[0].current_bidder?.name, "Name new-team");
  assert.deepEqual(s.counts(), { reads: 0, names: 1 });
});

test("older in-flight HTTP cannot undo committed data; cancel leaves success/idle", async t => {
  const s = setup(t); let finish!: (v: ReturnType<typeof snapshot>) => void;
  s.load(() => new Promise(resolve => { finish = resolve; }));
  const pending = s.runtime.client.fetchQuery({ queryKey: s.key, staleTime: 0 }).catch(error => error);
  await flush();
  s.owner.auction({ new: { id: "a", current_price: 160 } });
  assert.equal(s.runtime.client.getQueryState(s.key)?.status, "success");
  assert.equal(s.runtime.client.getQueryState(s.key)?.fetchStatus, "idle");
  finish(snapshot()); await pending; await flush();
  assert.equal(s.data()!.auctions[0].current_price, 160);
});

test("own bid server fact changes own-highest/feed, never price or private proxy", async t => {
  const s = setup(t);
  s.load(async () => ({ ...snapshot(), auctions: [{ ...auction(), myHighestBid: 170, myProxyMax: 350 }] }));
  s.owner.bid({ new: { id: "b", auction_id: "a", team_id: "mine", amount: 170, bid_time: "2026-11-12T12:00:00Z", max_amount: 999999 } });
  assert.equal(s.data()!.auctions[0].myHighestBid, 170);
  assert.equal(s.data()!.auctions[0].myProxyMax, 180);
  assert.equal(s.data()!.auctions[0].current_price, 100);
  assert.equal(s.data()!.recentBids.length, 1);
  assert.equal(s.data()!.moneyPending, true);
  t.mock.timers.tick(800); await flush(); assert.equal(s.counts().reads, 1);
  assert.equal(s.teamReads(), 0); assert.equal(s.data()!.auctions[0].myProxyMax, 350);
  assert.equal(s.data()!.moneyPending, false);
});

test("unrelated public bid does not cause a resource refetch", async t => {
  const s = setup(t); s.owner.bid({ new: { id: "unrelated", auction_id: "elsewhere", team_id: "other", amount: 100, bid_time: "2026-11-12T12:00:00Z" } });
  t.mock.timers.tick(800); await flush(); assert.equal(s.counts().reads, 0);
});

test("cold read keeps unknown context pending then reapplies committed membership", async t => {
  const s = setup(t, false); let finish!: (v: ReturnType<typeof snapshot>) => void;
  s.load(() => new Promise(resolve => { finish = resolve; }));
  const pending = s.runtime.client.fetchQuery({ queryKey: s.key }); await flush();
  s.owner.auction({ new: { id: "a", current_price: 155 } });
  s.owner.bid({ new: { id: "cold", auction_id: "a", team_id: "mine", amount: 150, bid_time: "2026-11-12T12:00:00Z" } });
  assert.equal(s.data(), undefined);
  finish(snapshot()); await pending;
  assert.equal(s.data()!.currentRiderCount, 9); assert.equal(s.data()!.auctions[0].current_price, 155);
  assert.equal(s.data()!.auctions[0].myHighestBid, 150); assert.equal(s.data()!.auctions[0].myProxyMax, 180);
});

test("unknown/partial auction events coalesce one exact-key reconcile", async t => {
  const s = setup(t);
  let unrelatedReads = 0; const other = privateKey(s.scope, "listings");
  s.runtime.client.setQueryDefaults(other, { queryFn: () => { unrelatedReads += 1; return []; } });
  s.runtime.client.setQueryData(other, []);
  s.owner.auction({ new: { id: "new-auction", current_price: 15 } });
  t.mock.timers.tick(200); s.owner.auction({ new: { id: "new-auction" } });
  t.mock.timers.tick(200); await flush();
  assert.equal(s.counts().reads, 1); assert.equal(unrelatedReads, 0);
});

test("disposal and viewer/team changes fence delayed events and reconciliation", async t => {
  const s = setup(t); s.owner.auction({ new: { id: "new" } }); s.owner.dispose();
  s.owner.auction({ new: { id: "a", current_price: 999 } });
  t.mock.timers.tick(1000); await flush(); assert.equal(s.data()!.auctions[0].current_price, 100); assert.equal(s.counts().reads, 0);
  s.runtime.setTeam("other"); s.owner.auction({ new: { id: "a", current_price: 777 } });
  assert.equal(s.runtime.client.getQueryCache().getAll().length, 0);
});


test("own settlement hides uncertain money until exact team and auction reads succeed", async t => {
  const s = setup(t);
  s.runtime.client.setQueryData(s.key, { ...snapshot(), auctions: [{ ...auction(), current_bidder_id: "mine", current_bidder: { id: "mine", name: "Mine" } }] });
  let finish!: (value: { id: string; balance: number }) => void;
  s.teamLoad(() => new Promise(resolve => { finish = resolve; }));
  s.load(async () => ({ ...snapshot(), auctions: [] }));
  s.owner.auction({ new: { id: "a", status: "completed", current_bidder_id: null } });
  assert.deepEqual(s.data()!.auctions, []);
  assert.equal(s.data()!.moneyPending, true);
  await flush(); assert.equal(s.teamReads(), 1); assert.equal(s.counts().reads, 1);
  assert.equal(s.data()!.moneyPending, true);
  finish({ id: "mine", balance: 850 }); await s.owner.moneyReady();
  assert.equal(s.data()!.moneyPending, false);
  assert.equal(s.runtime.client.getQueryData<{balance: number}>(s.teamKey)?.balance, 850);
});

test("failed settlement retains uncertainty and a manual retry recovers", async t => {
  const s = setup(t);
  s.runtime.client.setQueryData(s.key, { ...snapshot(), auctions: [{ ...auction(), current_bidder_id: "mine" }] });
  s.teamLoad(async () => { throw new Error("network unavailable"); });
  s.load(async () => ({ ...snapshot(), auctions: [] }));
  s.owner.auction({ new: { id: "a", status: "completed" } }); await flush();
  assert.equal(s.data()!.moneyPending, true);
  await assert.rejects(s.owner.moneyReady());
  assert.equal(s.data()!.moneyPending, true);
  s.teamLoad(async () => ({ id: "mine", balance: 800 }));
  await s.owner.moneyReady(); assert.equal(s.data()!.moneyPending, false);
});


test("two rapid events receive successive canonical pre-patch rows", t => {
  const s = setup(t); const previousPrices: number[] = [];
  s.owner.auction({ new: { id: "a", current_price: 120 } }, (_next, previous) => previousPrices.push(previous.current_price));
  s.owner.auction({ new: { id: "a", current_price: 130 } }, (_next, previous) => previousPrices.push(previous.current_price));
  assert.deepEqual(previousPrices, [100, 120]);
});

test("changed rider/seller never display the old joined identity and reconcile only auction key", async t => {
  const s = setup(t);
  s.load(async () => ({ ...snapshot(), auctions: [{ ...auction(), rider_id: "new-rider", rider: { id: "new-rider", firstname: "New" }, seller_team_id: "new-seller", seller: { id: "new-seller", name: "New seller" } }] }));
  s.owner.auction({ new: { id: "a", rider_id: "new-rider", seller_team_id: "new-seller" } });
  assert.equal(s.data()!.auctions[0].rider, null); assert.equal(s.data()!.auctions[0].seller, null);
  t.mock.timers.tick(400); await flush();
  assert.equal(s.data()!.auctions[0].rider?.id, "new-rider");
  assert.equal(s.data()!.auctions[0].seller?.name, "New seller");
  assert.equal(s.counts().reads, 1); assert.equal(s.teamReads(), 0);
});

test("invalid numeric payload never becomes cached money", async t => {
  const s = setup(t);
  s.owner.auction({ new: { id: "a", current_price: "bad" } });
  assert.equal(s.data()!.auctions[0].current_price, 100);
  t.mock.timers.tick(400); await flush(); assert.equal(s.counts().reads, 1);
});

test("continuous events do not starve resync and partial patches accumulate over an in-flight read", async t => {
  const s = setup(t); let finish!: (v: ReturnType<typeof snapshot>) => void;
  s.load(() => new Promise(resolve => { finish = resolve; }));
  s.owner.auction({ new: { id: "unknown", current_price: 1 } });
  t.mock.timers.tick(400); await flush(); assert.equal(s.counts().reads, 1);
  s.owner.auction({ new: { id: "a", current_price: 150 } });
  s.owner.auction({ new: { id: "a", calculated_end: "2026-11-12T14:00:00Z" } });
  finish(snapshot()); await flush();
  assert.equal(s.data()!.auctions[0].current_price, 150);
  assert.equal(s.data()!.auctions[0].calculated_end, "2026-11-12T14:00:00Z");
  s.load(async () => snapshot());
  for (let i = 0; i < 8; i += 1) { s.owner.auction({ new: { id: "unknown" } }); t.mock.timers.tick(100); await flush(); }
  assert.ok(s.counts().reads >= 2, "leading windows must not be debounced forever");
});

test("terminal tombstone survives an older targeted reconcile", async t => {
  const s = setup(t); let finish!: (v: ReturnType<typeof snapshot>) => void;
  s.load(() => new Promise(resolve => { finish = resolve; }));
  s.owner.auction({ new: { id: "unknown" } }); t.mock.timers.tick(400); await flush();
  s.owner.auction({ new: { id: "a", status: "completed" } });
  finish(snapshot()); await flush(); assert.deepEqual(s.data()!.auctions, []);
});

test("a late name response cannot change a newer bidder and failure is not retried on every price", async t => {
  const s = setup(t); const resolve = new Map<string, (v: {id: string; name: string} | null) => void>();
  s.nameLoad(id => new Promise(finish => resolve.set(id, finish)));
  s.owner.auction({ new: { id: "a", current_bidder_id: "first" } });
  s.owner.auction({ new: { id: "a", current_bidder_id: "second" } });
  resolve.get("first")!({ id: "first", name: "First" }); await flush();
  assert.equal(s.data()!.auctions[0].current_bidder, null);
  resolve.get("second")!(null); await flush();
  s.owner.auction({ new: { id: "a", current_price: 150 } }); await flush();
  assert.equal(s.counts().names, 2);
});

test("same-viewer token refresh preserves generation, cache and realtime owner", t => {
  const s = setup(t); const generation = s.runtime.scope().generation;
  s.runtime.setViewer("viewer");
  assert.equal(s.runtime.scope().generation, generation);
  s.owner.auction({ new: { id: "a", current_price: 175 } });
  assert.equal(s.data()!.auctions[0].current_price, 175);
  assert.equal(s.data()!.auctions[0].myProxyMax, 180);
});

test("failed own settlement stays uncertain across immediate remount and retries fresh keys", async t => {
  const s = setup(t);
  s.runtime.client.setQueryData(s.key, { ...snapshot(), auctions: [{ ...auction(), current_bidder_id: "mine" }] });
  s.teamLoad(async () => { throw new Error("offline"); });
  s.load(async () => ({ ...snapshot(), auctions: [] }));
  s.owner.auction({ new: { id: "a", status: "completed" } }); await flush();
  assert.equal(s.data()!.moneyPending, true); s.owner.dispose();
  const next = s.makeOwner(); s.useOwner(next);
  let finish!: (v: {id: string; balance: number}) => void;
  s.teamLoad(() => new Promise(resolve => { finish = resolve; }));
  next.start(); await flush(); assert.equal(s.data()!.moneyPending, true);
  finish({ id: "mine", balance: 700 }); await next.moneyReady();
  assert.equal(s.data()!.moneyPending, false);
});

test("cancelled settlement does not mark reverted old cash confirmed", async t => {
  const s = setup(t);
  s.runtime.client.setQueryData(s.key, { ...snapshot(), auctions: [{ ...auction(), current_bidder_id: "mine" }] });
  let finish!: (v: {id: string; balance: number}) => void;
  s.teamLoad(() => new Promise(resolve => { finish = resolve; }));
  s.load(async () => ({ ...snapshot(), auctions: [] }));
  s.owner.auction({ new: { id: "a", status: "completed" } }); await flush();
  await s.runtime.client.cancelQueries({ queryKey: s.teamKey, exact: true }); await flush();
  assert.equal(s.data()!.moneyPending, true);
  finish({ id: "mine", balance: 700 }); await flush(); assert.equal(s.data()!.moneyPending, true);
});


test("focus/reconnect snapshot finishes under price traffic and preserves fresh private data", async t => {
  const s = setup(t); s.protectSnapshot();
  let finish!: (v: ReturnType<typeof snapshot>) => void;
  s.load(() => new Promise(resolve => { finish = resolve; }));
  const pending = s.runtime.client.fetchQuery({ queryKey: s.key, staleTime: 0 }); await flush();
  s.owner.auction({ new: { id: "a", current_price: 150 } });
  s.owner.auction({ new: { id: "a", calculated_end: "2026-11-12T14:00:00Z" } });
  assert.equal(s.runtime.client.getQueryState(s.key)?.fetchStatus, "fetching");
  assert.equal(s.data()!.auctions[0].current_price, 150);
  finish({ ...snapshot(), currentRiderCount: 10, auctions: [{ ...auction(), myHighestBid: 120, myProxyMax: 350 }] });
  await pending;
  assert.equal(s.data()!.auctions[0].current_price, 150);
  assert.equal(s.data()!.auctions[0].calculated_end, "2026-11-12T14:00:00Z");
  assert.equal(s.data()!.auctions[0].myProxyMax, 350);
  assert.equal(s.data()!.currentRiderCount, 10);
  assert.equal(s.counts().reads, 1);
  assert.equal(s.runtime.client.getQueryState(s.key)?.fetchStatus, "idle");
});


test("cold own terminal raw ownership requires fresh team cash before confirmation", async t => {
  const s = setup(t, false);
  let finishFirst!: (v: ReturnType<typeof snapshot>) => void;
  let first = true;
  s.load(() => { if (first) { first = false; return new Promise(resolve => { finishFirst = resolve; }); } return Promise.resolve({ ...snapshot(), auctions: [] }); });
  let finishTeam!: (v: {id: string; balance: number}) => void;
  s.teamLoad(() => new Promise(resolve => { finishTeam = resolve; }));
  s.activate();
  const initial = s.runtime.client.fetchQuery({ queryKey: s.key }).catch(error => error); await flush();
  s.owner.auction({ new: { id: "a", status: "completed", current_bidder_id: "mine", seller_team_id: "seller" } });
  assert.equal(s.data(), undefined, "unknown private context must not be fabricated");
  await flush();
  finishFirst({ ...snapshot(), auctions: [{ ...auction(), current_bidder_id: "mine" }] });
  await initial; await flush();
  assert.equal(s.data()?.moneyPending, true);
  assert.equal(s.teamReads(), 1);
  finishTeam({ id: "mine", balance: 850 }); await s.owner.moneyReady();
  assert.equal(s.data()!.moneyPending, false);
  assert.deepEqual(s.data()!.auctions, []);
});


test("cold tombstone can use ownership from the first snapshot without guessing unknown deletes", async t => {
  const s = setup(t, false); let finish!: (v: ReturnType<typeof snapshot>) => void; let first = true;
  s.load(() => { if (first) { first = false; return new Promise(resolve => { finish = resolve; }); } return Promise.resolve({ ...snapshot(), auctions: [] }); });
  s.teamLoad(async () => ({ id: "mine", balance: 850 }));
  const initial = s.runtime.client.fetchQuery({ queryKey: s.key }); await flush();
  s.owner.auction({ eventType: "DELETE", old: { id: "a" } });
  assert.equal(s.teamReads(), 0, "no owner proof exists yet");
  finish({ ...snapshot(), auctions: [{ ...auction(), current_bidder_id: "mine" }] }); await initial;
  assert.equal(s.data()!.moneyPending, true);
  await s.owner.moneyReady(); assert.equal(s.data()!.moneyPending, false); assert.equal(s.teamReads(), 1);
});


test("legitimate full raw row with nullable columns still patches immediately without reads", async t => {
  const s = setup(t); s.owner.auction({ new: { id: "a", rider_id: "rider", current_price: 125, calculated_end: "2026-11-12T13:00:00Z", current_bidder_id: "rival", seller_team_id: "seller", status: "active", is_flash: false, is_youth: false, min_increment: null, is_guaranteed_sale: null } });
  assert.equal(s.data()!.auctions[0].current_price, 125);
  t.mock.timers.tick(800); await flush(); assert.equal(s.counts().reads, 0);
});


test("nullable status leaves the active query immediately", t => {
  const s = setup(t); s.owner.auction({ new: { id: "a", status: null } });
  assert.deepEqual(s.data()!.auctions, []);
});


test("an unknown primary-key-only delete does not invent viewer ownership", async t => {
  const s = setup(t); s.owner.auction({ eventType: "DELETE", old: { id: "unknown" } });
  t.mock.timers.tick(800); await flush();
  assert.equal(s.teamReads(), 0); assert.equal(s.counts().reads, 0);
  assert.equal(s.data()!.moneyPending, false);
});


test("disposed subscription callbacks remain fenced after the same owner restarts", t => {
  const s = setup(t); const old = s.owner.start(); s.owner.dispose(); const next = s.owner.start();
  s.owner.auction({ new: { id: "a", current_price: 999 } }, undefined, old);
  assert.equal(s.data()!.auctions[0].current_price, 100);
  s.owner.auction({ new: { id: "a", current_price: 125 } }, undefined, next);
  assert.equal(s.data()!.auctions[0].current_price, 125);
});


test("pre-patch seller id remains settlement proof when terminal payload clears ids and join is pending", async t => {
  const s = setup(t);
  s.runtime.client.setQueryData(s.key, { ...snapshot(), auctions: [{ ...auction(), seller_team_id: "mine", rider: null }] });
  s.load(async () => ({ ...snapshot(), auctions: [] }));
  s.teamLoad(async () => ({ id: "mine", balance: 1200 }));
  s.owner.auction({ new: { id: "a", status: "completed", seller_team_id: null, current_bidder_id: null } });
  assert.equal(s.data()!.moneyPending, true);
  await s.owner.moneyReady(); assert.equal(s.teamReads(), 1);
});


test("public updates do not renew private snapshot freshness or suppress focus recovery", async t => {
  const s = setup(t); s.protectSnapshot();
  s.load(async () => ({ ...snapshot(), auctions: [{ ...auction(), current_price: 125, myProxyMax: 350 }] }));
  focusManager.setFocused(false); s.runtime.client.mount();
  const observer = new QueryObserver(s.runtime.client, { queryKey: s.key, staleTime: 30000 });
  const stop = observer.subscribe(() => {});
  t.after(() => { stop(); s.runtime.client.unmount(); focusManager.setFocused(undefined); });
  const original = s.runtime.client.getQueryState(s.key)!.dataUpdatedAt;
  t.mock.timers.tick(35000);
  s.owner.auction({ new: { id: "a", current_price: 125 } });
  assert.equal(s.runtime.client.getQueryState(s.key)!.dataUpdatedAt, original);
  assert.equal(s.counts().reads, 0);
  focusManager.setFocused(true); await flush();
  assert.equal(s.counts().reads, 1);
  assert.equal(s.data()!.auctions[0].myProxyMax, 350);
});


test("cold terminal uncertainty survives disposal before receipts and blocks a remounted writer", async t => {
  const s = setup(t, false); const oldAuctionReceipts: Array<(v: ReturnType<typeof snapshot>) => void> = [];
  const oldTeamReceipts: Array<(v: {id: string; balance: number}) => void> = [];
  s.load(() => new Promise(resolve => oldAuctionReceipts.push(resolve)));
  s.teamLoad(() => new Promise(resolve => oldTeamReceipts.push(resolve)));
  const firstObserver = s.activate(); await flush();
  s.owner.auction({ new: { id: "a", status: "completed", current_bidder_id: "mine" } }); await flush();
  assert.equal(s.data(), undefined);
  firstObserver.destroy(); s.owner.dispose();
  const next = s.makeOwner(); s.useOwner(next);
  s.load(async () => ({ ...snapshot(), auctions: [] }));
  let finishTeam!: (v: {id: string; balance: number}) => void;
  s.teamLoad(() => new Promise(resolve => { finishTeam = resolve; }));
  s.activate(); next.start(); await flush();
  let wrote = false; const write = next.moneyReady().then(() => { wrote = true; });
  await flush();
  assert.equal(wrote, false, "old bootstrap cash is not confirmed on remount");
  assert.equal(s.data()!.moneyPending, true);
  for (const finish of oldAuctionReceipts) finish({ ...snapshot(), auctions: [{ ...auction(), current_bidder_id: "mine" }] });
  for (const finish of oldTeamReceipts) finish({ id: "mine", balance: 1000 });
  await flush(); assert.equal(wrote, false); assert.equal(s.data()!.moneyPending, true);
  finishTeam({ id: "mine", balance: 700 }); await write;
  assert.equal(wrote, true); assert.equal(s.data()!.moneyPending, false);
  assert.equal(s.runtime.client.getQueryData<{balance: number}>(s.teamKey)?.balance, 700);
});


test("uncertainty control unsubscribes and cannot cross a viewer/team reset", async t => {
  const s = setup(t); const original = s.runtime.subscribe; let cleaned = 0;
  t.mock.method(s.runtime, "subscribe", (listener: () => void) => { const stop = original(listener); return () => { cleaned += 1; stop(); }; });
  s.runtime.client.setQueryData(s.key, { ...snapshot(), auctions: [{ ...auction(), current_bidder_id: "mine" }] });
  s.owner.auction({ new: { id: "a", status: "completed" } });
  s.runtime.setViewer("different-viewer"); s.runtime.setTeam("different-team");
  assert.equal(cleaned, 1);
  const next = createAuctionRealtime({ runtime: s.runtime, scope: s.runtime.scope(), resolveTeam: async () => null });
  await next.moneyReady(); next.dispose();
  assert.equal(s.runtime.client.getQueryCache().getAll().length, 0);
});
