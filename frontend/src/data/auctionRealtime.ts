import { privateKey, type DataRuntime, type DataScope } from "./queryRuntime.ts";
import type { AuctionView, BidRow } from "./auctionData.ts";

type TeamName = { id: string; name: string };
type CacheState = { auctions: AuctionView[]; recentBids: BidRow[]; teamNamesById?: Record<string, string>; moneyPending?: boolean; _serverRead?: number; _moneyNeedsTeam?: boolean };
type Payload = { new?: unknown; old?: unknown; eventType?: string; commit_timestamp?: string };
type Ticket = { revision: number; epoch: number; signal?: AbortSignal; protected: boolean; abort: () => void };
type Change = { revision: number; patch: Partial<AuctionView>; removed: boolean; settlementKnown?: boolean };
// Control metadata only, never rows or guessed private values. It survives a
// cold view's disposal until confirmed receipts or an auth/team scope reset.
type Uncertainty = { scope: DataScope; revision: number; needsTeam: boolean; unsubscribe: () => void };
const uncertainty = new WeakMap<DataRuntime, Uncertainty>();
const sameScope = (a: DataScope, b: DataScope) => a.generation === b.generation && a.viewerId === b.viewerId && a.teamId === b.teamId;
const fields = ["rider_id", "current_price", "min_increment", "calculated_end", "status", "is_guaranteed_sale", "is_flash", "is_youth", "seller_team_id", "current_bidder_id"] as const;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const active = (row: AuctionView) => row.status === "active" || row.status === "extended";

/** One canonical cache owner. Realtime is committed server data, never a money write. */
export function createAuctionRealtime({ runtime, scope, resolveTeam }: {
  runtime: DataRuntime; scope: DataScope;
  resolveTeam: (id: string, signal: AbortSignal) => Promise<TeamName | null>;
}) {
  const key = privateKey(scope, "auctions");
  let disposed = false, epoch = 0, revision = 0, resyncing = false, dirty = false, namesDirty = false;
  let serverRead = 0, settlementRevision = 0, moneyPending = false, needsTeam = false;
  let settlementPromise: Promise<void> | undefined;
  const teamKey = ["private", scope.generation, scope.viewerId, null, "team"] as const;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortNames = new AbortController();
  const reads = new Set<Ticket>();
  const changes = new Map<string, Change>();
  const bids = new Map<string, { revision: number; bid: BidRow }>();
  const ownBids = new Map<string, { revision: number; amount: number }>();
  const clearJournal = () => { changes.clear(); bids.clear(); ownBids.clear(); };
  const names = new Map<string, string>();
  const lookups = new Set<string>();
  const seenBids = new Set<string>();
  const current = () => !disposed && scope.ready && scope.viewerId !== null && scope.teamId !== null && runtime.scope().generation === scope.generation
    && runtime.scope().viewerId === scope.viewerId && runtime.scope().teamId === scope.teamId;
  const data = () => runtime.client.getQueryData<CacheState>(key);
  const pending = () => {
    const value = uncertainty.get(runtime);
    return value && sameScope(value.scope, scope) ? value : undefined;
  };
  function syncPending() {
    const value = pending();
    if (value) { moneyPending = true; needsTeam ||= value.needsTeam; settlementRevision = Math.max(settlementRevision, value.revision); }
  }
  function rememberPending() {
    let value = pending();
    if (!value) {
      value = { scope, revision: settlementRevision, needsTeam, unsubscribe: () => {} };
      uncertainty.set(runtime, value);
      const captured = value;
      value.unsubscribe = runtime.subscribe(() => {
        if (!sameScope(captured.scope, runtime.scope()) && uncertainty.get(runtime) === captured) {
          uncertainty.delete(runtime); captured.unsubscribe();
        }
      });
    }
    value.revision = Math.max(value.revision, settlementRevision);
    value.needsTeam ||= needsTeam;
  }
  function markBudget(includeTeam: boolean) {
    syncPending(); moneyPending = true; needsTeam ||= includeTeam;
    settlementRevision += 1; rememberPending();
  }
  function publish(update: (state: CacheState | undefined) => CacheState | undefined) {
    // Public deltas/enrichment do not make the combined private snapshot fresh.
    runtime.client.setQueryData<CacheState>(key, update, { updatedAt: runtime.client.getQueryState(key)?.dataUpdatedAt });
  }
  function seed(state: CacheState) {
    for (const [id, name] of Object.entries(state.teamNamesById ?? {})) names.set(id, name);
    for (const row of state.auctions) for (const team of [row.seller, row.current_bidder]) if (team?.id && team.name) names.set(team.id, team.name);
  }
  function enrich(row: AuctionView): AuctionView {
    const bidder = row.current_bidder_id;
    const seller = row.seller_team_id;
    return { ...row,
      rider: row.rider && row.rider_id && row.rider.id !== row.rider_id ? null : row.rider,
      current_bidder: bidder ? (row.current_bidder?.id === bidder ? row.current_bidder : names.has(bidder) ? { id: bidder, name: names.get(bidder)! } : null) : null,
      seller: seller ? (row.seller?.id === seller ? row.seller : names.has(seller) ? { id: seller, name: names.get(seller)! } : null) : null,
    };
  }
  function flushNames() {
    if (!current() || !data()) return;
    namesDirty = false;
    publish( previous => previous ? { ...previous, auctions: previous.auctions.map(enrich), teamNamesById: Object.fromEntries(names) } : previous);
  }
  function hydrate(row: AuctionView) {
    const id = row.current_bidder_id;
    if (!active(row) || !id || row.current_bidder?.name || names.has(id) || lookups.has(id) || !current()) return;
    lookups.add(id); const captured = epoch;
    void resolveTeam(id, abortNames.signal).then(team => {
      if (!current() || captured !== epoch || !team || team.id !== id || !team.name) return;
      names.set(id, team.name); namesDirty = true;
      if (data()) flushNames(); else schedule();
    }).catch(() => { /* one attempt per id; retain pending name until a fresh joined read */ });
  }
  function schedule() {
    if (!current() || timer !== undefined || resyncing || settlementPromise) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (!current()) return;
      if (namesDirty) flushNames();
      if (moneyPending) { void settleMoney().catch(() => {}); return; }
      if (!dirty || runtime.client.getQueryState(key)?.fetchStatus === "fetching") return;
      dirty = false; resyncing = true; const captured = epoch;
      void runtime.client.invalidateQueries({ queryKey: key, exact: true, refetchType: "all" }, { cancelRefetch: false })
        .catch(() => { /* retain known data, no retry loop */ })
        .finally(() => { if (captured !== epoch) return; resyncing = false; if (current() && (dirty || namesDirty)) schedule(); });
    }, 400);
  }
  function reconcile() { dirty = true; schedule(); }
  function cancelOlderRead() {
    // A reconcile's own read is journalled rather than repeatedly cancelled by
    // a busy auction. Continuous committed events cannot starve membership.
    // Pinned v5.107 leaves revert:false fetching until its async error path.
    // Cancel/revert synchronously first, then publish the committed patch.
    if (!resyncing && !settlementPromise && ![...reads].some(ticket => ticket.protected)) void runtime.client.cancelQueries({ queryKey: key, exact: true }, { revert: true });
  }
  function relatedSettlement(previous: AuctionView | undefined, row: Partial<AuctionView>) {
    return row.current_bidder_id === scope.teamId || row.seller_team_id === scope.teamId
      || previous?.current_bidder_id === scope.teamId
      || previous?.seller_team_id === scope.teamId;
  }
  function markSettlement() { markBudget(true); dirty = true; }
  function update(state: CacheState, id: string, change: Change): CacheState {
    const rows = state.auctions.flatMap(row => row.id !== id ? [row] : change.removed ? [] : [enrich({ ...row, ...change.patch })]);
    if (change.patch.calculated_end !== undefined) rows.sort((a, b) => Date.parse(a.calculated_end) - Date.parse(b.calculated_end));
    return { ...state, moneyPending: moneyPending || state.moneyPending, _moneyNeedsTeam: needsTeam || state._moneyNeedsTeam, auctions: rows, teamNamesById: Object.fromEntries(names) };
  }
  function applyBid(state: CacheState, bid: BidRow): CacheState {
    return { ...state, moneyPending: moneyPending || state.moneyPending, _moneyNeedsTeam: needsTeam || state._moneyNeedsTeam,
      auctions: bid.team_id === scope.teamId ? state.auctions.map(row => row.id === bid.auction_id ? { ...row, myHighestBid: Math.max(row.myHighestBid ?? 0, bid.amount) } : row) : state.auctions,
      recentBids: [...state.recentBids.filter(row => row.id !== bid.id), bid].sort((a, b) => Date.parse(a.bid_time ?? "") - Date.parse(b.bid_time ?? "")).slice(-60),
    };
  }
  function settleMoney(): Promise<void> {
    if (!current()) return Promise.reject(new DOMException("Data scope changed", "AbortError"));
    syncPending();
    if (!moneyPending) return Promise.resolve();
    if (settlementPromise) return settlementPromise;
    const captured = epoch, version = settlementRevision, includeTeam = needsTeam;
    dirty = false;
    const previousTeamRead = runtime.client.getQueryState(teamKey)?.dataUpdateCount ?? 0;
    const previousAuctionRead = data()?._serverRead ?? 0;
    let repeat = false;
    settlementPromise = Promise.resolve().then(async () => {
      await Promise.all([
        includeTeam ? runtime.client.cancelQueries({ queryKey: teamKey, exact: true }) : Promise.resolve(),
        runtime.client.cancelQueries({ queryKey: key, exact: true }),
      ]);
      if (!current() || captured !== epoch) throw new DOMException("Data scope changed", "AbortError");
      await Promise.all([
        includeTeam ? runtime.client.invalidateQueries({ queryKey: teamKey, exact: true, refetchType: "all" }, { throwOnError: true }) : Promise.resolve(),
        runtime.client.invalidateQueries({ queryKey: key, exact: true, refetchType: "all" }, { throwOnError: true }),
      ]);
      if (!current() || captured !== epoch) throw new DOMException("Data scope changed", "AbortError");
      repeat = version !== (pending()?.revision ?? settlementRevision);
      if (repeat) syncPending();
      if (repeat) return;
      // Cancellation can resolve reverted cached data. Only actual fresh server
      // reads may confirm spendable cash after releasing a closing reservation.
      if ((includeTeam && (runtime.client.getQueryState(teamKey)?.dataUpdateCount ?? 0) <= previousTeamRead)
        || (data()?._serverRead ?? 0) <= previousAuctionRead) throw new DOMException("Settlement read cancelled", "AbortError");
      moneyPending = false; needsTeam = false;
      const confirmed = pending();
      if (confirmed) { uncertainty.delete(runtime); confirmed.unsubscribe(); }
      publish( state => state ? { ...state, moneyPending: false, _moneyNeedsTeam: false } : state);
    }).finally(() => {
      if (captured !== epoch) return;
      settlementPromise = undefined;
      if (repeat) void settleMoney().catch(() => {});
      else if (current() && (dirty || namesDirty)) schedule();
    });
    return settlementPromise;
  }
  syncPending();
  const owner = {
    start() {
      if (disposed) { disposed = false; epoch += 1; abortNames = new AbortController(); }
      syncPending();
      if (moneyPending || data()?.moneyPending) { moneyPending = true; needsTeam ||= !!data()?._moneyNeedsTeam; rememberPending(); void settleMoney().catch(() => {}); }
      return epoch;
    },
    async moneyReady() { syncPending(); while (moneyPending || data()?.moneyPending) { moneyPending = true; needsTeam ||= !!data()?._moneyNeedsTeam; rememberPending(); await settleMoney(); syncPending(); } },
    beginRead(signal?: AbortSignal, protectedSnapshot = false): Ticket {
      const ticket: Ticket = { revision, epoch, signal, protected: protectedSnapshot || runtime.client.getQueryState(key)?.isInvalidated === true, abort: () => { reads.delete(ticket); if (!reads.size) { clearJournal(); } } };
      reads.add(ticket); signal?.addEventListener("abort", ticket.abort, { once: true }); return ticket;
    },
    completeRead<T extends CacheState>(state: T, ticket: Ticket, signal?: AbortSignal): T {
      if (!current() || ticket.epoch !== epoch || signal?.aborted) throw new DOMException("Auction read superseded", "AbortError");
      syncPending();
      seed(state); serverRead = Math.max(serverRead, data()?._serverRead ?? 0) + 1;
      let next: CacheState = { ...state, _serverRead: serverRead, _moneyNeedsTeam: needsTeam || data()?._moneyNeedsTeam || false, moneyPending: moneyPending || data()?.moneyPending || false, auctions: state.auctions.map(enrich), teamNamesById: Object.fromEntries(names) };
      for (const [id, change] of changes) if (change.revision > ticket.revision) {
        if (change.removed && !change.settlementKnown && relatedSettlement(next.auctions.find(row => row.id === id), change.patch)) {
          change.settlementKnown = true; markSettlement();
        }
        next = update(next, id, change);
      }
      for (const entry of bids.values()) if (entry.revision > ticket.revision) next = applyBid(next, entry.bid);
      for (const [id, own] of ownBids) if (own.revision > ticket.revision) next = { ...next, auctions: next.auctions.map(row => row.id === id ? { ...row, myHighestBid: Math.max(row.myHighestBid ?? 0, own.amount) } : row) };
      for (const row of next.auctions) hydrate(row);
      return next as T;
    },
    settledRead(ticket?: Ticket) {
      if (ticket) { ticket.signal?.removeEventListener("abort", ticket.abort); reads.delete(ticket); }
      if (!reads.size) { clearJournal(); }
      if (current() && (dirty || namesDirty)) schedule();
    },
    auction(payload: Payload, callback?: (next: AuctionView, previous: AuctionView) => void, lease = epoch) {
      if (!current() || lease !== epoch) return;
      const raw = object(payload.eventType === "DELETE" ? payload.old : payload.new);
      if (typeof raw.id !== "string") { reconcile(); return; }
      const previousState = data(); if (previousState) seed(previousState);
      const previous = previousState?.auctions.find(row => row.id === raw.id);
      const provided = fields.filter(field => raw[field] !== undefined);
      const invalid = provided.some(field => {
        const value = raw[field];
        if (field === "current_price") return typeof value !== "number" || !Number.isFinite(value);
        if (field === "min_increment") return value !== null && (typeof value !== "number" || !Number.isFinite(value));
        if (field === "calculated_end") return typeof value !== "string" || !Number.isFinite(Date.parse(value));
        if (field === "seller_team_id" || field === "current_bidder_id") return value !== null && typeof value !== "string";
        if (field === "status") return value !== null && (typeof value !== "string" || !value);
        if (field === "rider_id") return typeof value !== "string" || !value;
        if (field === "is_guaranteed_sale") return value !== null && typeof value !== "boolean";
        return typeof value !== "boolean";
      });
      if (invalid) { reconcile(); return; }
      const patch: Partial<AuctionView> = Object.fromEntries(provided.map(field => [field, raw[field]]));
      const relationshipChanged = previous && ((typeof raw.rider_id === "string" && raw.rider_id !== (previous.rider_id ?? previous.rider?.id))
        || (raw.seller_team_id !== undefined && raw.seller_team_id !== previous.seller_team_id));
      const removed = payload.eventType === "DELETE" || (raw.status !== undefined && raw.status !== "active" && raw.status !== "extended");
      const prior = changes.get(raw.id);
      const change: Change = { revision: ++revision, patch: { ...prior?.patch, ...patch }, removed: raw.status === undefined && payload.eventType !== "DELETE" ? prior?.removed ?? removed : removed };
      const ownsSettlement = change.removed && relatedSettlement(previous, patch);
      if (ownsSettlement) { change.settlementKnown = true; markSettlement(); }
      if (reads.size) changes.set(raw.id, change);
      if (!previous) {
        if (ownsSettlement) {
          publish( state => state ? { ...state, moneyPending: true, _moneyNeedsTeam: true } : state);
          void settleMoney().catch(() => {});
        } else if (!removed) reconcile();
        return;
      }
      if (!removed && Object.keys(patch).length === 0) { reconcile(); return; }
      cancelOlderRead();
      publish( state => state ? update(state, raw.id as string, change) : state);
      if (!removed && relationshipChanged) reconcile();
      if (!removed) {
        const updated = data()?.auctions.find(row => row.id === raw.id); if (updated) hydrate(updated);
      }
      if (ownsSettlement) void settleMoney().catch(() => {});
      // Use the canonical pre-patch object, not a React effect's previous frame.
      if (payload.eventType !== "DELETE") callback?.(enrich({ ...previous, ...patch }), previous);
    },
    bid(payload: Payload, callback?: (bid: BidRow) => void, lease = epoch) {
      if (!current() || lease !== epoch) return;
      const raw = object(payload.new);
      if (typeof raw.id !== "string" || typeof raw.auction_id !== "string" || typeof raw.team_id !== "string"
        || typeof raw.amount !== "number" || !Number.isFinite(raw.amount) || typeof raw.bid_time !== "string" || !Number.isFinite(Date.parse(raw.bid_time))) { reconcile(); return; }
      if (seenBids.has(raw.id)) return;
      seenBids.add(raw.id); if (seenBids.size > 60) seenBids.delete(seenBids.values().next().value!);
      const bid: BidRow = { id: raw.id, auction_id: raw.auction_id, team_id: raw.team_id, amount: raw.amount, bid_time: raw.bid_time };
      const state = data(); const row = state?.auctions.find(item => item.id === bid.auction_id);
      if (reads.size) {
        bids.set(bid.id, { revision: ++revision, bid });
        if (bids.size > 60) bids.delete(bids.keys().next().value!);
        if (bid.team_id === scope.teamId) ownBids.set(bid.auction_id, { revision, amount: Math.max(ownBids.get(bid.auction_id)?.amount ?? 0, bid.amount) });
      }
      if (bid.team_id === scope.teamId) markBudget(false);
      if (state && (row || bid.team_id === scope.teamId)) { cancelOlderRead(); publish( old => old ? applyBid(old, bid) : old); }
      if (bid.team_id === scope.teamId) schedule();
      callback?.(bid);
    },
    dispose() {
      disposed = true; epoch += 1;
      if (reads.size || resyncing || settlementPromise) void runtime.client.cancelQueries({ queryKey: key, exact: true });
      if (settlementPromise) void runtime.client.cancelQueries({ queryKey: teamKey, exact: true });
      resyncing = false; settlementPromise = undefined;
      if (timer !== undefined) clearTimeout(timer); timer = undefined;
      abortNames.abort(); lookups.clear(); names.clear(); seenBids.clear();
      for (const ticket of reads) ticket.signal?.removeEventListener("abort", ticket.abort);
      reads.clear(); clearJournal(); dirty = false; namesDirty = false;
    },
  };
  return owner;
}
export type AuctionRealtime = ReturnType<typeof createAuctionRealtime>;
