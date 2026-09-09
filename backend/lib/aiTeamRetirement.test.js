import test from "node:test";
import assert from "node:assert/strict";

import { teamHasLiveTransferOffers, LIVE_OFFER_STATUSES } from "./aiTeamRetirement.js";
import { AI_TEAM_RETIRE_FLAG_KEY, AI_POOL_RETIREMENT_RELEASE_KEY } from "./aiTeamRetireFlag.js";
import { teamIsBlockedForRemoval } from "./aiTeamGenerator.js";

// #4753 — AI-hold nedlægges i stedet for at hård-slettes.
//
// Den vigtigste test i filen er "trim-stien rører aldrig delete": det er den der
// beviser at klassen er væk. De 6 måneders symptomfix (#2074 → #2389 → #4233) kom
// alle af at der blev SLETTET; en test der kun tjekker slut-tilstanden ville stadig
// være grøn den dag nogen genindfører en DELETE ad en sidevej.

// ── Mock-supabase med DELETE-tracker + .or()-støtte (swap_offers) ────────────
function makeSupabase(initial = {}) {
  let idSeq = 1;
  const deletes = [];
  const state = {
    teams: [], riders: [], transfer_offers: [], transfer_listings: [],
    swap_offers: [], race_entries: [], races: [], rider_watchlist: [],
    app_config: [], notifications: [],
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
        if (f.t === "gt") return (row[f.c] ?? 0) > f.v;
        if (f.t === "gte") return (row[f.c] ?? "") >= f.v;
        if (f.t === "is") return f.v === null ? row[f.c] == null : row[f.c] === f.v;
        if (f.t === "not_is_null") return row[f.c] != null;
        if (f.t === "or") return f.fn(row);
        return true;
      });
    }
    const builder = {
      select() { return builder; },
      eq(c, v) { filters.push({ t: "eq", c, v }); return builder; },
      neq(c, v) { filters.push({ t: "neq", c, v }); return builder; },
      in(c, v) { filters.push({ t: "in", c, v }); return builder; },
      gt(c, v) { filters.push({ t: "gt", c, v }); return builder; },
      gte(c, v) { filters.push({ t: "gte", c, v }); return builder; },
      is(c, v) { filters.push({ t: "is", c, v }); return builder; },
      not(c, op, v) { if (op === "is" && v === null) filters.push({ t: "not_is_null", c }); return builder; },
      // Kun de to or()-former koden bruger: swap_offers' rider-liste og
      // riderEligibility's is_retired-null-or-false.
      or(expr) {
        filters.push({
          t: "or",
          fn: (row) => expr.split(",").some((clause) => {
            const inMatch = clause.match(/^(\w+)\.in\.\((.*)\)$/);
            if (inMatch) return inMatch[2].split(",").filter(Boolean).includes(row[inMatch[1]]);
            const isNull = clause.match(/^(\w+)\.is\.null$/);
            if (isNull) return row[isNull[1]] == null;
            const eq = clause.match(/^(\w+)\.eq\.(.*)$/);
            if (eq) return String(row[eq[1]]) === eq[2];
            return false;
          }),
        });
        return builder;
      },
      order() { return builder; },
      range(from) { return Promise.resolve({ data: from === 0 ? rows().filter(matches) : [], error: null }); },
      limit(n) { return Promise.resolve({ data: rows().filter(matches).slice(0, n), error: null }); },
      maybeSingle() { return Promise.resolve({ data: rows().filter(matches)[0] ?? null, error: null }); },
      insert(payload) {
        const arr = Array.isArray(payload) ? payload : [payload];
        const inserted = arr.map((r) => ({ id: `${table}-${idSeq++}`, ...r }));
        rows().push(...inserted.map((r) => JSON.parse(JSON.stringify(r))));
        return {
          select: () => Promise.resolve({ data: inserted.map((r) => ({ id: r.id })), error: null }),
          then: (res, rej) => Promise.resolve({ data: null, error: null }).then(res, rej),
        };
      },
      update(payload) {
        const upd = {
          eq(c, v) { filters.push({ t: "eq", c, v }); return upd; },
          in(c, v) { filters.push({ t: "in", c, v }); return upd; },
          is(c, v) { filters.push({ t: "is", c, v }); return upd; },
          or(expr) { builder.or(expr); return upd; },
          select() { return upd; },
          then(res, rej) {
            const hit = rows().filter(matches);
            for (const row of hit) Object.assign(row, JSON.parse(JSON.stringify(payload)));
            return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null }).then(res, rej);
          },
        };
        return upd;
      },
      delete() {
        const del = {
          eq(c, v) { filters.push({ t: "eq", c, v }); return del; },
          in(c, v) { filters.push({ t: "in", c, v }); return del; },
          select() { return del; },
          then(res, rej) {
            const removed = rows().filter(matches);
            deletes.push({ table, rows: removed.length });
            state[table] = rows().filter((row) => !matches(row));
            return Promise.resolve({ data: removed.map((r) => ({ id: r.id })), error: null }).then(res, rej);
          },
        };
        return del;
      },
      then(res, rej) { return Promise.resolve({ data: rows().filter(matches), error: null }).then(res, rej); },
    };
    return builder;
  }

  return { from, state, deletes };
}

function seedTeam({ teamId = "ai-1", poolId = 8, riderCount = 3, offers = [] } = {}) {
  const riders = Array.from({ length: riderCount }, (_, i) => ({
    id: `r${i + 1}`, team_id: teamId, firstname: "A", lastname: `B${i}`, is_retired: false,
  }));
  return makeSupabase({
    teams: [{ id: teamId, name: "Stuck Devo", is_ai: true, league_division_id: poolId, pending_removal_at: "2026-08-28T00:00:00.000Z", retired_at: null }],
    riders,
    transfer_offers: offers,
  });
}

// Retirement effects/rollback are exercised against real SQL in aiPoolRetirement.integration.test.js.

// ── Guard-semantikken: hvad blokerer, og hvad gør ikke ───────────────────────

test("teamHasLiveTransferOffers: døde tilbud blokerer IKKE (rod-årsagen til de 13 fastlåste hold)", async () => {
  for (const status of ["withdrawn", "accepted", "rejected"]) {
    const supabase = seedTeam({ riderCount: 1, offers: [{ id: "o1", rider_id: "r1", seller_team_id: "ai-1", status }] });
    assert.equal(await teamHasLiveTransferOffers(supabase, "ai-1"), false, `${status} må ikke blokere`);
  }
});

test("teamHasLiveTransferOffers: levende tilbud blokerer — både som køber-modpart og som sælger", async () => {
  for (const status of LIVE_OFFER_STATUSES) {
    const onRider = seedTeam({ riderCount: 1, offers: [{ id: "o1", rider_id: "r1", seller_team_id: "other", status }] });
    assert.equal(await teamHasLiveTransferOffers(onRider, "ai-1"), true, `${status} på rytter skal blokere`);

    const asSeller = seedTeam({ riderCount: 1, offers: [{ id: "o1", rider_id: "x", seller_team_id: "ai-1", status }] });
    assert.equal(await teamHasLiveTransferOffers(asSeller, "ai-1"), true, `${status} som sælger skal blokere`);
  }
});

test("teamIsBlockedForRemoval: samme døde tilbud blokerer hård-slet, men ikke nedlæggelse", async () => {
  const offers = [{ id: "o1", rider_id: "r1", seller_team_id: "ai-1", status: "withdrawn" }];
  const hardDelete = seedTeam({ riderCount: 1, offers });
  assert.equal(
    await teamIsBlockedForRemoval(hardDelete, "ai-1", [], { retire: false }),
    true,
    "hård-slet: FK'en er NO ACTION, så enhver række blokerer (#4233)",
  );

  const retire = seedTeam({ riderCount: 1, offers });
  assert.equal(
    await teamIsBlockedForRemoval(retire, "ai-1", [], { retire: true }),
    false,
    "nedlæggelse: der slettes ikke, så en død række kan ikke blokere noget",
  );
});

test("teamIsBlockedForRemoval: inflight-entries (#2074) blokerer i BEGGE tilstande", async () => {
  const supabase = seedTeam({ riderCount: 1 });
  supabase.state.race_entries.push({ race_id: "race-1", rider_id: "r1" });
  for (const retire of [false, true]) {
    assert.equal(
      await teamIsBlockedForRemoval(supabase, "ai-1", ["race-1"], { retire }),
      true,
      `et hold midt i et løb må ikke fjernes (retire=${retire})`,
    );
  }
});

// ── Flaget ───────────────────────────────────────────────────────────────────

test("ai_team_retire_enabled: fail-safe OFF når nøglen mangler", async () => {
  const { isAiTeamRetireEnabled } = await import("./aiTeamRetireFlag.js");
  const supabase = makeSupabase({ app_config: [] });
  assert.equal(await isAiTeamRetireEnabled(supabase), false);

  const legacyOnly = makeSupabase({ app_config: [{ key: AI_TEAM_RETIRE_FLAG_KEY, value: "on" }] });
  assert.equal(await isAiTeamRetireEnabled(legacyOnly), false);
  const on = makeSupabase({ app_config: [{ key: AI_TEAM_RETIRE_FLAG_KEY, value: "on" }, { key: AI_POOL_RETIREMENT_RELEASE_KEY, value: "on" }] });
  assert.equal(await isAiTeamRetireEnabled(on), true);

  const off = makeSupabase({ app_config: [{ key: AI_TEAM_RETIRE_FLAG_KEY, value: "off" }] });
  assert.equal(await isAiTeamRetireEnabled(off), false);
});
