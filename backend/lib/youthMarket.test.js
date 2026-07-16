import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_AUCTION_CONFIG } from "./auctionEngine.js";
import { listRejectedAsYouthAuction, YOUTH_AUCTION_START_RATE } from "./youthMarket.js";

// ─── Mock-supabase ────────────────────────────────────────────────────────────

/**
 * Minimal mock for youthMarket: riders-lookup + auctions-insert.
 */
function makeYouthMarketSupabase({
  rider = {
    id: "rider-Y",
    firstname: "Yann",
    lastname: "Ungdom",
    base_value: 100000,
    market_value: 100000,
    prize_earnings_bonus: 0,
    team_id: null,
  },
  riderMissing = false,
  insertError = null,
  // FIFO-kø af resultater for auctions-select .maybeSingle() (findActiveAuctionForRider).
  // Default tom → pre-check finder ingen aktiv auktion (normal afvisning).
  activeAuctionReads = [],
} = {}) {
  const auctionInserts = [];
  let readIdx = 0;

  const supabase = {
    from(table) {
      if (table === "riders") {
        const api = {
          select() { return api; },
          eq() { return api; },
          maybeSingle() {
            return Promise.resolve({ data: riderMissing ? null : rider, error: null });
          },
        };
        return api;
      }

      if (table === "auctions") {
        return {
          select() {
            const api = {
              eq() { return api; },
              in() { return api; },
              maybeSingle() {
                const val = readIdx < activeAuctionReads.length ? activeAuctionReads[readIdx] : null;
                readIdx += 1;
                return Promise.resolve({ data: val, error: null });
              },
            };
            return api;
          },
          insert(row) {
            auctionInserts.push(row);
            return {
              select() {
                return {
                  single() {
                    return Promise.resolve({
                      data: insertError ? null : { id: "youth-auction-1", ...row },
                      error: insertError,
                    });
                  },
                };
              },
            };
          },
        };
      }

      return {};
    },
    _auctionInserts: auctionInserts,
  };

  return supabase;
}

// ─── listRejectedAsYouthAuction ───────────────────────────────────────────────

test("listRejectedAsYouthAuction: opretter is_youth-auktion uden sælger, lav startpris, ingen bidder", async () => {
  const supabase = makeYouthMarketSupabase();
  const auction = await listRejectedAsYouthAuction(supabase, {
    riderId: "rider-Y",
    now: new Date("2026-06-20T12:00:00Z"),
    auctionConfig: DEFAULT_AUCTION_CONFIG,
  });

  assert.equal(supabase._auctionInserts.length, 1, "præcis én auktion oprettet");
  const ins = supabase._auctionInserts[0];
  assert.equal(ins.rider_id, "rider-Y");
  assert.equal(ins.seller_team_id, null, "ingen sælger (klubben afviste)");
  assert.equal(ins.is_youth, true, "markeret som ungdomsauktion");
  assert.equal(ins.current_bidder_id, null, "ingen initial bidder");
  assert.ok(ins.starting_price >= 1, "startpris >= 1");
  assert.equal(ins.starting_price, ins.current_price, "current = starting ved oprettelse");
  assert.ok(ins.calculated_end, "calculated_end sat");

  assert.equal(auction.id, "youth-auction-1");
});

test("listRejectedAsYouthAuction: startpris = lav andel af markedsværdi (YOUTH_AUCTION_START_RATE)", async () => {
  const supabase = makeYouthMarketSupabase({
    rider: { id: "rider-Y", firstname: "A", lastname: "B", base_value: 200000, market_value: 200000, prize_earnings_bonus: 0, team_id: null },
  });
  await listRejectedAsYouthAuction(supabase, {
    riderId: "rider-Y",
    now: new Date("2026-06-20T12:00:00Z"),
    auctionConfig: DEFAULT_AUCTION_CONFIG,
  });
  const ins = supabase._auctionInserts[0];
  assert.equal(ins.starting_price, Math.round(200000 * YOUTH_AUCTION_START_RATE));
  assert.ok(YOUTH_AUCTION_START_RATE < 1, "startpris-rate er lav (< 1)");
});

test("listRejectedAsYouthAuction: kaster når rytter mangler", async () => {
  const supabase = makeYouthMarketSupabase({ riderMissing: true });
  await assert.rejects(
    () => listRejectedAsYouthAuction(supabase, { riderId: "ghost", auctionConfig: DEFAULT_AUCTION_CONFIG }),
    /not found/,
  );
});

test("listRejectedAsYouthAuction: kaster når riderId mangler", async () => {
  const supabase = makeYouthMarketSupabase();
  await assert.rejects(
    () => listRejectedAsYouthAuction(supabase, { auctionConfig: DEFAULT_AUCTION_CONFIG }),
    /riderId required/,
  );
});

test("listRejectedAsYouthAuction: idempotent når rytteren allerede ligger på en aktiv auktion (CYCLINGZONE-14)", async () => {
  // Gentaget afvisning / dobbeltklik: pre-tjekket finder en eksisterende aktiv
  // auktion → returnér den uden at forsøge en dublet-insert (ville ramme
  // uniq_auctions_one_active_per_rider).
  const existing = { id: "existing-auc", rider_id: "rider-Y", status: "active", is_youth: true };
  const supabase = makeYouthMarketSupabase({ activeAuctionReads: [existing] });

  const auction = await listRejectedAsYouthAuction(supabase, {
    riderId: "rider-Y",
    now: new Date("2026-06-20T12:00:00Z"),
    auctionConfig: DEFAULT_AUCTION_CONFIG,
  });

  assert.equal(auction.id, "existing-auc", "returnerer den eksisterende auktion");
  assert.equal(supabase._auctionInserts.length, 0, "ingen dublet-insert forsøgt");
});

test("listRejectedAsYouthAuction: TOCTOU-race → fanger 23505 og returnerer vinderens auktion (CYCLINGZONE-14)", async () => {
  // To afvisninger i sub-sekund-vindue: begge består pre-tjekket (read #1 = null),
  // den ene insert'er, den anden rammer unique-indexet (23505) og genhenter
  // vinderens auktion (read #2) i stedet for at boble op som 500.
  const raced = { id: "raced-auc", rider_id: "rider-Y", status: "active", is_youth: true };
  const supabase = makeYouthMarketSupabase({
    activeAuctionReads: [null, raced],
    insertError: { code: "23505", message: 'duplicate key value violates unique constraint "uniq_auctions_one_active_per_rider"' },
  });

  const auction = await listRejectedAsYouthAuction(supabase, {
    riderId: "rider-Y",
    now: new Date("2026-06-20T12:00:00Z"),
    auctionConfig: DEFAULT_AUCTION_CONFIG,
  });

  assert.equal(auction.id, "raced-auc", "returnerer vinderens auktion ved race");
  assert.equal(supabase._auctionInserts.length, 1, "den tabende request forsøgte præcis én insert");
});

test("listRejectedAsYouthAuction: andre insert-fejl end 23505 kaster stadig", async () => {
  const supabase = makeYouthMarketSupabase({
    insertError: { code: "23502", message: "null value in column violates not-null constraint" },
  });
  await assert.rejects(
    () => listRejectedAsYouthAuction(supabase, {
      riderId: "rider-Y",
      now: new Date("2026-06-20T12:00:00Z"),
      auctionConfig: DEFAULT_AUCTION_CONFIG,
    }),
    /listRejectedAsYouthAuction insert/,
  );
});
