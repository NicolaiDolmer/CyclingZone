import test from "node:test";
import assert from "node:assert/strict";

import { deleteRiderWithCleanup } from "./riderCleanupDeletion.js";

// #3594: 9/8-oprydningen slettede fire defekte akademi-ryttere direkte i
// databasen mens de havde aktive auktioner — cascade fjernede
// auctions/auction_bids sammen med rytteren, så INGEN budgiver fik en
// `auction_cancelled`-notifikation. Disse tests beviser den nye, ENESTE
// sikre sletnings-sti (deleteRiderWithCleanup) faktisk lukker hullet: aktive
// auktioner annulleres + bydere notificeres FØR rytteren slettes, og
// sletningen AFVISES hvis en annullering fejler.

// ── Generisk in-memory postgrest-lignende mock — dækker de tabeller kæden
//    rører (riders, auctions, auction_bids, admin_log, rider_watchlist,
//    notifications). Joins simuleres IKKE — en "auctions"-række der skal
//    ligne et join (`rider:rider_id(...)`) seedes derfor med et allerede
//    udfyldt `rider`-felt (samme mønster som auctionCancellation.test.js). ──
function makeSupabase(initial = {}) {
  let idSeq = 1;
  const state = {
    riders: [],
    auctions: [],
    auction_bids: [],
    admin_log: [],
    rider_watchlist: [],
    notifications: [],
    activity_feed: [],
    ...JSON.parse(JSON.stringify(initial)),
  };

  function from(table) {
    if (!state[table]) state[table] = [];
    const rows = () => state[table];
    const filters = [];
    function matches(row) {
      return filters.every((f) => {
        if (f.t === "eq") return row[f.c] === f.v;
        if (f.t === "neq") return row[f.c] !== f.v;
        if (f.t === "in") return f.v.includes(row[f.c]);
        if (f.t === "gte") return (row[f.c] ?? "") >= f.v;
        if (f.t === "is") return f.v === null ? row[f.c] == null : row[f.c] === f.v;
        return true;
      });
    }
    const builder = {
      select() { return builder; },
      eq(c, v) { filters.push({ t: "eq", c, v }); return builder; },
      neq(c, v) { filters.push({ t: "neq", c, v }); return builder; },
      in(c, v) { filters.push({ t: "in", c, v }); return builder; },
      gte(c, v) { filters.push({ t: "gte", c, v }); return builder; },
      is(c, v) { filters.push({ t: "is", c, v }); return builder; },
      order() { return builder; },
      limit(n) {
        return Promise.resolve({ data: rows().filter(matches).slice(0, n), error: null });
      },
      maybeSingle() {
        const match = rows().filter(matches)[0] ?? null;
        return Promise.resolve({ data: match, error: null });
      },
      insert(payload) {
        const arr = Array.isArray(payload) ? payload : [payload];
        const inserted = arr.map((r) => ({ id: `${table}-${idSeq++}`, ...r }));
        rows().push(...inserted.map((r) => JSON.parse(JSON.stringify(r))));
        return {
          select() { return Promise.resolve({ data: inserted.map((r) => ({ id: r.id })), error: null }); },
          then(res, rej) { return Promise.resolve({ error: null }).then(res, rej); },
        };
      },
      update(payload) {
        const upd = {
          eq(c, v) { filters.push({ t: "eq", c, v }); return upd; },
          in(c, v) { filters.push({ t: "in", c, v }); return upd; },
          is(c, v) { filters.push({ t: "is", c, v }); return upd; },
          select() {
            const matched = rows().filter(matches);
            for (const row of matched) Object.assign(row, JSON.parse(JSON.stringify(payload)));
            return Promise.resolve({ data: matched.map((r) => ({ id: r.id })), error: null });
          },
          then(res, rej) {
            for (const row of rows()) if (matches(row)) Object.assign(row, JSON.parse(JSON.stringify(payload)));
            return Promise.resolve({ error: null }).then(res, rej);
          },
        };
        return upd;
      },
      delete() {
        const del = {
          eq(c, v) { filters.push({ t: "eq", c, v }); return del; },
          in(c, v) { filters.push({ t: "in", c, v }); return del; },
          select() {
            const removed = rows().filter(matches);
            state[table] = rows().filter((row) => !matches(row));
            return Promise.resolve({ data: removed.map((r) => ({ id: r.id })), error: null });
          },
          then(res, rej) {
            state[table] = rows().filter((row) => !matches(row));
            return Promise.resolve({ error: null }).then(res, rej);
          },
        };
        return del;
      },
      then(res, rej) {
        return Promise.resolve({ data: rows().filter(matches), error: null }).then(res, rej);
      },
    };
    return builder;
  }

  return { from, state };
}

test("#3594 deleteRiderWithCleanup: annullerer aktiv auktion + notificerer bydere + rydder watchlist FØR sletning", async () => {
  const supabase = makeSupabase({
    riders: [{ id: "r1", firstname: "Tadej", lastname: "Pogacar" }],
    auctions: [{
      id: "a1",
      rider_id: "r1",
      status: "active",
      current_price: 100_000,
      seller_team_id: null,
      rider: { id: "r1", firstname: "Tadej", lastname: "Pogacar" },
    }],
    auction_bids: [{ id: "bid-1", auction_id: "a1", team_id: "bidder-team" }],
    rider_watchlist: [{ id: "wl-1", user_id: "user-1", rider_id: "r1" }],
  });

  const bidderNotifications = [];
  const activity = [];

  const result = await deleteRiderWithCleanup({
    supabase,
    riderId: "r1",
    adminUserId: "admin-1",
    notifyTeamOwner: async (teamId, type, title, message, relatedId) => {
      bidderNotifications.push({ teamId, type, relatedId });
    },
    logActivity: async (type, data) => { activity.push({ type, data }); },
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "deleted");
  assert.equal(result.cancelled_auctions, 1);
  assert.equal(result.rider_name, "Tadej Pogacar");

  // Rytteren er faktisk slettet.
  assert.equal(supabase.state.riders.length, 0);

  // Auktionen er annulleret, ikke bare forsvundet.
  assert.equal(supabase.state.auctions[0].status, "cancelled");

  // #3594 kerne-fixet: bydere skal have fået en auction_cancelled-besked.
  assert.equal(bidderNotifications.length, 1);
  assert.equal(bidderNotifications[0].type, "auction_cancelled");

  // admin_log-sporet fra cancelAuctionByAdmin er skrevet.
  assert.equal(supabase.state.admin_log.length, 1);
  assert.equal(supabase.state.admin_log[0].action_type, "auction_cancel");

  // #2524-mønsteret er stadig intakt: watchlist ryddet + watcher notificeret.
  assert.equal(supabase.state.rider_watchlist.length, 0);
  assert.equal(supabase.state.notifications.length, 1);
  assert.equal(supabase.state.notifications[0].type, "watchlist_departed");

  // Egen activity_feed-log for selve sletningen — PLUS cancelAuctionByAdmin's
  // egen "auction_cancelled"-log (samme injicerede logActivity genbruges af
  // begge, som forventet — det er netop pointen med at dele logikken).
  assert.equal(activity.length, 2);
  const deletionLog = activity.find((a) => a.type === "rider_deleted_with_cleanup");
  assert.ok(deletionLog, "rider_deleted_with_cleanup skal være logget");
  assert.equal(deletionLog.data.meta.cancelled_auctions, 1);
  assert.ok(activity.some((a) => a.type === "auction_cancelled"), "cancelAuctionByAdmin's egen log skal også være der");
});

test("#3594 deleteRiderWithCleanup: rytter uden aktiv auktion slettes uden annulleringer", async () => {
  const supabase = makeSupabase({
    riders: [{ id: "r2", firstname: "Mads", lastname: "Pedersen" }],
    auctions: [],
  });

  const result = await deleteRiderWithCleanup({
    supabase,
    riderId: "r2",
    adminUserId: "admin-1",
    notifyTeamOwner: async () => {},
  });

  assert.equal(result.ok, true);
  assert.equal(result.cancelled_auctions, 0);
  assert.equal(supabase.state.riders.length, 0);
});

test("#3594 deleteRiderWithCleanup: rytter ikke fundet giver not_found uden sideeffekter", async () => {
  const supabase = makeSupabase({ riders: [] });

  const result = await deleteRiderWithCleanup({
    supabase,
    riderId: "missing",
    adminUserId: "admin-1",
    notifyTeamOwner: async () => {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "not_found");
});

test("#3594 GUARD: kan en aktiv auktion ikke annulleres, AFVISES sletningen — rytteren forbliver", async () => {
  // Simulerer at auktionen forsvinder/ændrer sig mellem opslag (fx en
  // konkurrerende finalizer) — cancelActiveAuctionsForRider finder id'et i
  // listen, men cancelAuctionByAdmin's egen detalje-opslag finder INTET
  // (not_found). Guarden skal stoppe HELE sletningen på netop dette signal.
  let riderDeleteCalled = false;
  const rider = { id: "r-ghost", firstname: "Ghost", lastname: "Rider" };

  const supabase = {
    from(table) {
      if (table === "riders") {
        return {
          select() {
            return { eq: () => ({ maybeSingle: () => Promise.resolve({ data: rider, error: null }) }) };
          },
          delete() {
            return {
              eq: () => {
                riderDeleteCalled = true;
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }
      if (table === "auctions") {
        return {
          select(cols) {
            if (cols === "id") {
              return {
                eq: () => ({ in: () => Promise.resolve({ data: [{ id: "auction-ghost" }], error: null }) }),
              };
            }
            return { eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) };
          },
        };
      }
      throw new Error(`Uventet tabel i guard-testen: ${table}`);
    },
  };

  const result = await deleteRiderWithCleanup({
    supabase,
    riderId: "r-ghost",
    adminUserId: "admin-1",
    notifyTeamOwner: async () => {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "auction_cancel_failed");
  assert.equal(riderDeleteCalled, false, "rytteren må ALDRIG slettes når en auktion ikke kunne annulleres");
});
