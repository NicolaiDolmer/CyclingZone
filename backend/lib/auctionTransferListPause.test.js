import test from "node:test";
import assert from "node:assert/strict";

import {
  PAUSED_LISTING_STATUS,
  getListingOnAuctionIssue,
  getPausedListingDecision,
  pauseTransferListingsForAuction,
  reconcileOrphanPausedListings,
  resumePausedTransferListings,
  safePauseTransferListingsForAuction,
  safeReconcileOrphanPausedListings,
  safeResumePausedListingsForAuctionId,
  safeResumePausedTransferListings,
} from "./auctionTransferListPause.ts";

// Minimal in-memory supabase-fake: eq/in-filtre, update(...).select(), select().
// Valgfri unik-regel paa transfer_listings (open/negotiating pr. rytter) som
// uniq_transfer_listings_one_active_per_rider.
function makeFake(tables, { uniqueActiveListing = true, failOn = null } = {}) {
  const state = Object.fromEntries(
    Object.entries(tables).map(([name, rows]) => [name, rows.map((r) => ({ ...r }))])
  );
  const calls = [];
  const hooks = {};

  function query(table) {
    const filters = [];
    let op = "select";
    let patch = null;
    const builder = {
      select() { return builder; },
      update(p) { op = "update"; patch = p; return builder; },
      eq(col, val) { filters.push((r) => r[col] === val); return builder; },
      in(col, vals) { filters.push((r) => vals.includes(r[col])); return builder; },
      limit() { return builder; },
      maybeSingle() {
        return Promise.resolve().then(() => run()).then((res) => ({ data: res.data?.[0] ?? null, error: res.error }));
      },
      then(resolve, reject) {
        return Promise.resolve().then(() => run()).then(resolve, reject);
      },
    };
    function run() {
      calls.push({ table, op, patch });
      if (hooks.beforeRun) hooks.beforeRun({ table, op, patch, state });
      if (failOn && failOn.table === table && failOn.op === op) {
        return { data: null, error: { message: "boom", code: failOn.code } };
      }
      const rows = state[table] || [];
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "select") return { data: hit.map((r) => ({ ...r })), error: null };
      if (table === "transfer_listings" && uniqueActiveListing && ["open", "negotiating"].includes(patch.status)) {
        for (const r of hit) {
          const clash = rows.some((o) => o.id !== r.id && o.rider_id === r.rider_id && ["open", "negotiating"].includes(o.status));
          if (clash) return { data: null, error: { message: "duplicate key", code: "23505" } };
        }
      }
      for (const r of hit) Object.assign(r, patch);
      return { data: hit.map((r) => ({ id: r.id })), error: null };
    }
    return builder;
  }

  return { from: query, state, calls, hooks };
}

const SELLER = "team-a";
const BUYER = "team-b";

test("getPausedListingDecision: aktiv auktion holder listingen paa pause", () => {
  assert.equal(
    getPausedListingDecision({ listing: { seller_team_id: SELLER }, rider: { team_id: SELLER }, riderOnActiveAuction: true }),
    "keep_paused",
  );
});

test("getPausedListingDecision: usolgt rytter hos saelgeren kommer tilbage", () => {
  assert.equal(
    getPausedListingDecision({ listing: { seller_team_id: SELLER }, rider: { team_id: SELLER, pending_team_id: null, is_retired: false }, riderOnActiveAuction: false }),
    "resume",
  );
});

test("getPausedListingDecision: solgt, ventende overgang, pensioneret eller ukendt rytter lukkes", () => {
  const listing = { seller_team_id: SELLER };
  assert.equal(getPausedListingDecision({ listing, rider: { team_id: BUYER }, riderOnActiveAuction: false }), "withdraw");
  assert.equal(getPausedListingDecision({ listing, rider: { team_id: null }, riderOnActiveAuction: false }), "withdraw");
  assert.equal(getPausedListingDecision({ listing, rider: { team_id: SELLER, pending_team_id: BUYER }, riderOnActiveAuction: false }), "withdraw");
  assert.equal(getPausedListingDecision({ listing, rider: { team_id: SELLER, is_retired: true }, riderOnActiveAuction: false }), "withdraw");
  assert.equal(getPausedListingDecision({ listing, rider: undefined, riderOnActiveAuction: false }), "withdraw");
  assert.equal(getPausedListingDecision({ listing: { seller_team_id: null }, rider: { team_id: null }, riderOnActiveAuction: false }), "withdraw");
});

test("getListingOnAuctionIssue: rytter paa aktiv auktion kan ikke listes", () => {
  assert.deepEqual(getListingOnAuctionIssue({ riderId: "r1", activeAuctionRiderIds: ["r1"] }), { code: "rider_on_auction_listing" });
  assert.equal(getListingOnAuctionIssue({ riderId: "r1", activeAuctionRiderIds: [] }), null);
  assert.equal(getListingOnAuctionIssue({ riderId: "r1", activeAuctionRiderIds: undefined }), null);
});

test("pauseTransferListingsForAuction: open og negotiating paa rytteren saettes paa pause, intet andet", async () => {
  const fake = makeFake({
    transfer_listings: [
      { id: "l1", rider_id: "r1", seller_team_id: SELLER, status: "open" },
      { id: "l2", rider_id: "r1", seller_team_id: SELLER, status: "withdrawn" },
      { id: "l3", rider_id: "r2", seller_team_id: SELLER, status: "open" },
    ],
  });
  const res = await pauseTransferListingsForAuction(fake, { riderId: "r1" });
  assert.deepEqual(res, { paused: 1 });
  assert.equal(fake.state.transfer_listings[0].status, PAUSED_LISTING_STATUS);
  assert.equal(fake.state.transfer_listings[1].status, "withdrawn");
  assert.equal(fake.state.transfer_listings[2].status, "open");
});

test("pauseTransferListingsForAuction: uden rytter-id sker intet", async () => {
  const fake = makeFake({ transfer_listings: [] });
  assert.deepEqual(await pauseTransferListingsForAuction(fake, { riderId: null }), { paused: 0 });
  assert.equal(fake.calls.length, 0);
});

test("resumePausedTransferListings: usolgt auktion -> listingen er aaben igen med samme pris", async () => {
  const fake = makeFake({
    transfer_listings: [{ id: "l1", rider_id: "r1", seller_team_id: SELLER, status: "paused", asking_price: 500 }],
    auctions: [{ rider_id: "r1", status: "completed" }],
    riders: [{ id: "r1", team_id: SELLER, pending_team_id: null, is_retired: false }],
  });
  const res = await resumePausedTransferListings(fake, { riderIds: ["r1"] });
  assert.deepEqual(res, { resumed: ["l1"], withdrawn: [], kept: [] });
  assert.equal(fake.state.transfer_listings[0].status, "open");
  assert.equal(fake.state.transfer_listings[0].asking_price, 500);
});

test("resumePausedTransferListings: solgt rytter (ventende overgang) -> listingen lukkes", async () => {
  const fake = makeFake({
    transfer_listings: [{ id: "l1", rider_id: "r1", seller_team_id: SELLER, status: "paused" }],
    auctions: [],
    riders: [{ id: "r1", team_id: SELLER, pending_team_id: BUYER, is_retired: false }],
  });
  const res = await resumePausedTransferListings(fake, { riderIds: ["r1"] });
  assert.deepEqual(res, { resumed: [], withdrawn: ["l1"], kept: [] });
  assert.equal(fake.state.transfer_listings[0].status, "withdrawn");
});

test("resumePausedTransferListings: solgt rytter (nyt hold) -> listingen lukkes", async () => {
  const fake = makeFake({
    transfer_listings: [{ id: "l1", rider_id: "r1", seller_team_id: SELLER, status: "paused" }],
    auctions: [],
    riders: [{ id: "r1", team_id: BUYER, pending_team_id: null, is_retired: false }],
  });
  const res = await resumePausedTransferListings(fake, { riderIds: ["r1"] });
  assert.deepEqual(res.withdrawn, ["l1"]);
});

test("resumePausedTransferListings: rytter stadig paa aktiv auktion -> roeres ikke", async () => {
  const fake = makeFake({
    transfer_listings: [{ id: "l1", rider_id: "r1", seller_team_id: SELLER, status: "paused" }],
    auctions: [{ rider_id: "r1", status: "extended" }],
    riders: [{ id: "r1", team_id: SELLER }],
  });
  const res = await resumePausedTransferListings(fake, { riderIds: ["r1"] });
  assert.deepEqual(res, { resumed: [], withdrawn: [], kept: ["l1"] });
  assert.equal(fake.state.transfer_listings[0].status, PAUSED_LISTING_STATUS);
  assert.ok(!fake.calls.some((c) => c.op === "update"));
});

test("resumePausedTransferListings: en anden aktiv listing findes -> den pausede lukkes i stedet", async () => {
  const fake = makeFake({
    transfer_listings: [
      { id: "l1", rider_id: "r1", seller_team_id: SELLER, status: "paused" },
      { id: "l2", rider_id: "r1", seller_team_id: SELLER, status: "open" },
    ],
    auctions: [],
    riders: [{ id: "r1", team_id: SELLER }],
  });
  const res = await resumePausedTransferListings(fake, { riderIds: ["r1"] });
  assert.deepEqual(res, { resumed: [], withdrawn: ["l1"], kept: [] });
  assert.equal(fake.state.transfer_listings[1].status, "open");
});

test("resumePausedTransferListings: ingen pausede listings -> kun et laeseopslag", async () => {
  const fake = makeFake({ transfer_listings: [{ id: "l1", rider_id: "r1", seller_team_id: SELLER, status: "open" }], auctions: [], riders: [] });
  const res = await resumePausedTransferListings(fake, { riderIds: ["r1", null, "r1"] });
  assert.deepEqual(res, { resumed: [], withdrawn: [], kept: [] });
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.state.transfer_listings[0].status, "open");
});

test("resumePausedTransferListings: idempotent ved anden koersel", async () => {
  const fake = makeFake({
    transfer_listings: [{ id: "l1", rider_id: "r1", seller_team_id: SELLER, status: "paused" }],
    auctions: [],
    riders: [{ id: "r1", team_id: SELLER }],
  });
  await resumePausedTransferListings(fake, { riderIds: ["r1"] });
  const second = await resumePausedTransferListings(fake, { riderIds: ["r1"] });
  assert.deepEqual(second, { resumed: [], withdrawn: [], kept: [] });
});

test("safe-varianterne sluger og returnerer fejlen i stedet for at kaste", async () => {
  const pauseFake = makeFake({ transfer_listings: [] }, { failOn: { table: "transfer_listings", op: "update", code: "23514" } });
  const pauseRes = await safePauseTransferListingsForAuction(pauseFake, { riderId: "r1" });
  assert.equal(pauseRes.paused, 0);
  assert.match(pauseRes.error, /boom/);

  const resumeFake = makeFake({ transfer_listings: [] }, { failOn: { table: "transfer_listings", op: "select" } });
  const resumeRes = await safeResumePausedTransferListings(resumeFake, { riderIds: ["r1"] });
  assert.deepEqual(resumeRes.resumed, []);
  assert.match(resumeRes.error, /boom/);
});

test("safeResumePausedListingsForAuctionId: admin-annullering slaar rytteren op og genaabner listingen", async () => {
  const fake = makeFake({
    transfer_listings: [{ id: "l1", rider_id: "r1", seller_team_id: SELLER, status: "paused" }],
    auctions: [{ id: "a1", rider_id: "r1", status: "cancelled" }],
    riders: [{ id: "r1", team_id: SELLER }],
  });
  const res = await safeResumePausedListingsForAuctionId(fake, "a1");
  assert.deepEqual(res.resumed, ["l1"]);
  assert.deepEqual(await safeResumePausedListingsForAuctionId(fake, null), { resumed: [], withdrawn: [], kept: [] });
});

test("resumePausedTransferListings: ny auktion startet midt i genaabningen -> listingen pauses igen", async () => {
  const fake = makeFake({
    transfer_listings: [{ id: "l1", rider_id: "r1", seller_team_id: SELLER, status: "paused" }],
    auctions: [],
    riders: [{ id: "r1", team_id: SELLER }],
  });
  // Saelgeren starter en ny auktion lige efter genaabningen: dens pause saa en
  // pauset listing og gjorde intet.
  fake.hooks.beforeRun = ({ table, op, patch, state }) => {
    if (table === "transfer_listings" && op === "update" && patch.status === "open") {
      state.auctions.push({ rider_id: "r1", status: "active" });
    }
  };
  const res = await resumePausedTransferListings(fake, { riderIds: ["r1"] });
  assert.deepEqual(res, { resumed: [], withdrawn: [], kept: ["l1"] });
  assert.equal(fake.state.transfer_listings[0].status, PAUSED_LISTING_STATUS);
});

test("reconcileOrphanPausedListings: forladt pause afgoeres, pause under aktiv auktion bliver", async () => {
  const fake = makeFake({
    transfer_listings: [
      { id: "l1", rider_id: "r1", seller_team_id: SELLER, status: "paused" },
      { id: "l2", rider_id: "r2", seller_team_id: SELLER, status: "paused" },
      { id: "l3", rider_id: "r3", seller_team_id: SELLER, status: "paused" },
    ],
    auctions: [{ rider_id: "r2", status: "active" }],
    riders: [
      { id: "r1", team_id: SELLER },
      { id: "r2", team_id: SELLER },
      { id: "r3", team_id: BUYER },
    ],
  });
  const res = await reconcileOrphanPausedListings(fake);
  assert.deepEqual(res, { resumed: ["l1"], withdrawn: ["l3"], kept: ["l2"] });
});

test("safeReconcileOrphanPausedListings: fejl sluges", async () => {
  const fake = makeFake({ transfer_listings: [] }, { failOn: { table: "transfer_listings", op: "select" } });
  const res = await safeReconcileOrphanPausedListings(fake);
  assert.match(res.error, /boom/);
});

test("pause -> usolgt -> tilbage: hele forloebet", async () => {
  const fake = makeFake({
    transfer_listings: [{ id: "l1", rider_id: "r1", seller_team_id: SELLER, status: "open" }],
    auctions: [{ rider_id: "r1", status: "active" }],
    riders: [{ id: "r1", team_id: SELLER }],
  });
  await pauseTransferListingsForAuction(fake, { riderId: "r1" });
  assert.deepEqual((await resumePausedTransferListings(fake, { riderIds: ["r1"] })).kept, ["l1"]);
  fake.state.auctions[0].status = "completed";
  assert.deepEqual((await resumePausedTransferListings(fake, { riderIds: ["r1"] })).resumed, ["l1"]);
  assert.equal(fake.state.transfer_listings[0].status, "open");
});
