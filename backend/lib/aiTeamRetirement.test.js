import test from "node:test";
import assert from "node:assert/strict";

import { retireAiTeam, teamHasLiveTransferOffers, LIVE_OFFER_STATUSES } from "./aiTeamRetirement.js";
import { AI_TEAM_RETIRE_FLAG_KEY } from "./aiTeamRetireFlag.js";
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

// ── Rytterne + holdet ────────────────────────────────────────────────────────

test("retireAiTeam: holdet forlader puljen og rytterne pensioneres — INTET slettes", async () => {
  const supabase = seedTeam({ riderCount: 3 });
  const res = await retireAiTeam(supabase, "ai-1", { now: new Date("2026-09-04T10:00:00Z") });

  assert.equal(res.retired, true);
  assert.equal(res.ridersRetired, 3);

  const team = supabase.state.teams[0];
  assert.equal(team.league_division_id, null, "puljepladsen skal være frigivet");
  assert.equal(team.retired_at, "2026-09-04T10:00:00.000Z");
  assert.equal(team.pending_removal_at, null, "udskydelses-markøren skal ryddes");

  assert.equal(supabase.state.teams.length, 1, "holdrækken må ikke slettes");
  assert.equal(supabase.state.riders.length, 3, "rytterrækkerne må ikke slettes");
  for (const r of supabase.state.riders) {
    assert.equal(r.is_retired, true);
    assert.equal(r.team_id, null);
  }

  const forbidden = supabase.deletes.filter((d) => d.table === "teams" || d.table === "riders");
  assert.deepEqual(forbidden, [], "nedlæggelse må ALDRIG kalde delete på teams/riders");
});

test("retireAiTeam: døde transfer_offers overlever nedlæggelsen (historik bevares)", async () => {
  const supabase = seedTeam({
    riderCount: 2,
    offers: [
      { id: "o1", rider_id: "r1", seller_team_id: "ai-1", status: "withdrawn" },
      { id: "o2", rider_id: "r2", seller_team_id: "ai-1", status: "accepted" },
    ],
  });
  await retireAiTeam(supabase, "ai-1");

  assert.equal(supabase.state.transfer_offers.length, 2, "døde tilbud er handelshistorik og skal bestå");
  assert.deepEqual(supabase.state.transfer_offers.map((o) => o.status).sort(), ["accepted", "withdrawn"]);
});

test("retireAiTeam: levende tilbud trækkes tilbage i stedet for at hænge som zombie", async () => {
  const supabase = seedTeam({
    riderCount: 1,
    offers: [{ id: "o1", rider_id: "r1", seller_team_id: "ai-1", status: "pending" }],
  });
  await retireAiTeam(supabase, "ai-1");
  assert.equal(supabase.state.transfer_offers[0].status, "withdrawn");
});

test("retireAiTeam: idempotent — anden kørsel ændrer ikke slut-tilstanden", async () => {
  const supabase = seedTeam({ riderCount: 2 });
  await retireAiTeam(supabase, "ai-1", { now: new Date("2026-09-04T10:00:00Z") });
  const first = JSON.stringify(supabase.state.riders);

  await retireAiTeam(supabase, "ai-1", { now: new Date("2026-09-05T10:00:00Z") });
  assert.equal(supabase.state.riders.length, 2);
  assert.equal(JSON.stringify(supabase.state.riders), first, "rytterne må ikke røres igen");
  assert.equal(supabase.state.teams[0].league_division_id, null);
});

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

// ── Forward-guard: HELE trim-stien, ikke bare retireAiTeam ──────────────────
//
// Den vigtigste assertion i filen. reconcileAiTeamsForPool → removeAiTeams er den
// sti der har fejlet 3 gange på 3 forskellige FK'er. Testen beviser at der med
// flaget tændt ikke findes ÉN delete på teams/riders nogen steder i den kæde — og
// at et hold blokeret af DØDE tilbud faktisk kommer ud af puljen.

test("reconcileAiTeamsForPool med flaget tændt: puljen falder fra 25 til 24 uden en eneste delete", async () => {
  const { reconcileAiTeamsForPool } = await import("./aiTeamGenerator.js");

  const POOL = 8;
  const teams = [
    // 9 ægte managere (samme fordeling som prod-puljen D4-A 4/9)
    ...Array.from({ length: 9 }, (_, i) => ({
      id: `mgr-${i}`, name: `Manager ${i}`, is_ai: false, is_bank: false,
      is_frozen: false, is_test_account: false, league_division_id: POOL, division: 4,
    })),
    // 16 AI-hold — ét for mange (target = 24 - 9 = 15)
    ...Array.from({ length: 16 }, (_, i) => ({
      id: `ai-${String(i).padStart(2, "0")}`, name: `AI ${i}`, is_ai: true, is_bank: false,
      is_frozen: false, is_test_account: false, league_division_id: POOL, division: 4,
      pending_removal_at: i === 0 ? "2026-08-28T00:00:00.000Z" : null, retired_at: null,
    })),
  ];
  const supabase = makeSupabase({
    league_divisions: [{ id: POOL, tier: 4, pool_index: 0, label: "Division 4 — A" }],
    teams,
    riders: [{ id: "rr1", team_id: "ai-00", firstname: "A", lastname: "B", is_retired: false }],
    // Den blokering der låste hold nr. 1 i id-orden permanent: et DØDT tilbud.
    transfer_offers: [{ id: "o1", rider_id: "rr1", seller_team_id: "ai-00", status: "withdrawn" }],
    app_config: [{ key: AI_TEAM_RETIRE_FLAG_KEY, value: "on" }],
  });

  const before = supabase.state.teams.filter((t) => t.league_division_id === POOL).length;
  assert.equal(before, 25);

  const res = await reconcileAiTeamsForPool({ supabase, poolId: POOL });
  assert.equal(res.removed, 1);

  const after = supabase.state.teams.filter((t) => t.league_division_id === POOL).length;
  assert.equal(after, 24, "puljen skal falde til 24 straks");

  const retired = supabase.state.teams.find((t) => t.id === "ai-00");
  assert.equal(retired.league_division_id, null);
  assert.ok(retired.retired_at, "holdet skal være markeret nedlagt");
  assert.equal(supabase.state.teams.length, 25, "ingen holdrække må forsvinde");

  const forbidden = supabase.deletes.filter((d) => d.table === "teams" || d.table === "riders");
  assert.deepEqual(forbidden, [], "trim-stien må ALDRIG kalde delete på teams/riders når flaget er tændt");
});

// ── Flaget ───────────────────────────────────────────────────────────────────

test("ai_team_retire_enabled: fail-safe OFF når nøglen mangler", async () => {
  const { isAiTeamRetireEnabled } = await import("./aiTeamRetireFlag.js");
  const supabase = makeSupabase({ app_config: [] });
  assert.equal(await isAiTeamRetireEnabled(supabase), false);

  const on = makeSupabase({ app_config: [{ key: AI_TEAM_RETIRE_FLAG_KEY, value: "on" }] });
  assert.equal(await isAiTeamRetireEnabled(on), true);

  const off = makeSupabase({ app_config: [{ key: AI_TEAM_RETIRE_FLAG_KEY, value: "off" }] });
  assert.equal(await isAiTeamRetireEnabled(off), false);
});
