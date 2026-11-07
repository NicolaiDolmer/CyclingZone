// #6181 (pengelås PR 1): regressionstests for værnet mod at fyre eller sælge en
// solgt, ventende ("parkeret") rytter.
//
// Tre lag:
//   1. De rene guard-funktioner i parkedRiderGuard6181.js.
//   2. En tekst-kontrakt på api.js: hver af de fem ruter kalder guarden, henter
//      pending_team_id, og afviser FØR den skriver noget.
//   3. Adfærd: confirmTransferOffer mod en in-memory supabase. En rytter, der
//      allerede er solgt til hold A og venter på holdskiftet, må ikke kunne
//      sælges til hold B (den ikke-parkerede gren i executeTransferOffer).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  getParkedRiderReleaseIssue,
  getParkedRiderTradeIssue,
  isRiderParked,
} from "./parkedRiderGuard6181.js";
import { confirmTransferOffer } from "./transferExecution.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");

// AGENTS.md regel 16: fast ur gennem bekræftelses-/eksekveringsstien, så hverken
// ung-konto-cooldownen eller acquired_at læser maskinens ur.
const FIXED_NOW = new Date("2026-06-02T12:00:00.000Z");

// ── 1. Rene guard-funktioner ────────────────────────────────────────────────

test("isRiderParked: kun en rytter med pending_team_id er parkeret", () => {
  assert.equal(isRiderParked({ team_id: "seller", pending_team_id: "buyer" }), true);
  assert.equal(isRiderParked({ team_id: "seller", pending_team_id: null }), false);
  assert.equal(isRiderParked({ team_id: "seller" }), false);
  assert.equal(isRiderParked(null), false);
});

test("getParkedRiderReleaseIssue: afviser en parkeret rytter med 409 og egen fejlkode", () => {
  const issue = getParkedRiderReleaseIssue({ id: "r1", team_id: "seller", pending_team_id: "buyer" });
  assert.equal(issue.status, 409);
  assert.equal(issue.body.errorCode, "rider_pending_transfer_release");
  assert.match(issue.body.error, /sold/);
  assert.equal(getParkedRiderReleaseIssue({ id: "r1", team_id: "seller", pending_team_id: null }), null);
});

test("getParkedRiderTradeIssue: afviser en parkeret rytter med 409 og egen fejlkode", () => {
  const issue = getParkedRiderTradeIssue({ id: "r1", team_id: "seller", pending_team_id: "buyer" });
  assert.equal(issue.status, 409);
  assert.equal(issue.body.errorCode, "rider_pending_transfer_trade");
  assert.equal(getParkedRiderTradeIssue({ id: "r1", team_id: "seller", pending_team_id: null }), null);
});

test("fejlkoderne har tekst på alle fem sprog, uden em-dash og uden 'we'/'vi'", () => {
  for (const lng of ["en", "da", "fr", "es", "nl"]) {
    const errors = JSON.parse(readFileSync(join(repoRoot, "frontend", "public", "locales", lng, "errors.json"), "utf8"));
    for (const code of ["rider_pending_transfer_release", "rider_pending_transfer_trade"]) {
      const text = errors.api?.[code];
      assert.equal(typeof text, "string", `${lng}: api.${code} mangler`);
      assert.ok(text.length > 0, `${lng}: api.${code} er tom`);
      assert.doesNotMatch(text, /—/, `${lng}: api.${code} har em-dash`);
    }
  }
  const en = JSON.parse(readFileSync(join(repoRoot, "frontend", "public", "locales", "en", "errors.json"), "utf8"));
  const da = JSON.parse(readFileSync(join(repoRoot, "frontend", "public", "locales", "da", "errors.json"), "utf8"));
  for (const code of ["rider_pending_transfer_release", "rider_pending_transfer_trade"]) {
    assert.doesNotMatch(en.api[code], /\bwe\b/i);
    assert.doesNotMatch(da.api[code], /\bvi\b/i);
  }
});

// ── 2. Tekst-kontrakt på ruterne i api.js ───────────────────────────────────

const apiSource = readFileSync(join(repoRoot, "backend", "routes", "api.js"), "utf8").replace(/\r\n/g, "\n");

/** Kroppen af en route-handler: fra `router.<method>("<path>"` til næste `\nrouter.`. */
function routeBody(method, path) {
  const start = apiSource.indexOf(`router.${method}("${path}"`);
  assert.notEqual(start, -1, `route ${method.toUpperCase()} ${path} findes ikke i api.js`);
  const end = apiSource.indexOf("\nrouter.", start + 1);
  return apiSource.slice(start, end === -1 ? undefined : end);
}

/** Index af første skrivning (insert/update/rpc) i en handler-krop, eller Infinity. */
function firstWriteIndex(body) {
  const hits = [".insert(", ".update(", "incrementBalanceWithAudit("]
    .map((needle) => body.indexOf(needle))
    .filter((i) => i !== -1);
  return hits.length ? Math.min(...hits) : Infinity;
}

const ROUTES = [
  { method: "post", path: "/riders/:id/release", guard: "getParkedRiderReleaseIssue(" },
  { method: "get", path: "/riders/:id/release-quote", guard: "getParkedRiderReleaseIssue(" },
  { method: "post", path: "/transfers", guard: "getParkedRiderTradeIssue(" },
  { method: "post", path: "/transfers/offer", guard: "getParkedRiderTradeIssue(" },
  { method: "post", path: "/transfers/:id/offer", guard: "getParkedRiderTradeIssue(" },
];

for (const { method, path, guard } of ROUTES) {
  test(`api.js ${method.toUpperCase()} ${path}: kalder parkerings-værnet før første skrivning (#6181)`, () => {
    const body = routeBody(method, path);
    const guardAt = body.indexOf(guard);
    assert.notEqual(guardAt, -1, `${path} kalder ikke ${guard.slice(0, -1)}`);
    assert.ok(guardAt < firstWriteIndex(body), `${path}: værnet skal stå før første skrivning`);
  });
}

test("api.js: ruterne henter pending_team_id, så værnet ser parkeringen", () => {
  // Release-ruterne henter rytteren via loadOwnedSeniorRiderForAction.
  const loaderStart = apiSource.indexOf("async function loadOwnedSeniorRiderForAction(");
  const loader = apiSource.slice(loaderStart, apiSource.indexOf("\n}\n", loaderStart));
  assert.match(loader, /\.select\("[^"]*\bpending_team_id\b/);
  assert.match(routeBody("post", "/transfers"), /\.from\("riders"\)\.select\("[^"]*\bpending_team_id\b/);
  assert.match(routeBody("post", "/transfers/offer"), /\.from\("riders"\)\.select\("[^"]*\bpending_team_id\b/);
  assert.match(routeBody("post", "/transfers/:id/offer"), /rider:rider_id\([^)]*\bpending_team_id\b/);
});

test("api.js POST /riders/:id/release: frigivelsen kræver pending_team_id null (parallelt salg vinder)", () => {
  const body = routeBody("post", "/riders/:id/release");
  const updateAt = body.indexOf(".update(");
  const selectAfter = body.indexOf('.select("id")', updateAt);
  const updateChain = body.slice(updateAt, selectAfter);
  assert.match(updateChain, /\.is\("pending_team_id", null\)/);
});

// ── 3. Adfærd: en parkeret rytter kan ikke sælges igen ──────────────────────
//
// Minimal in-memory supabase, samme form som transferExecution.test.js'
// makeSupabase: nok til at køre confirmTransferOffer end-to-end.

function rowsFor(db, table) {
  if (!db[table]) db[table] = [];
  if (table === "riders") {
    for (const r of db[table]) {
      if (r.is_academy === undefined) r.is_academy = false;
      if (r.is_retired === undefined) r.is_retired = false;
      if (r.squad === undefined) r.squad = "senior";
    }
  }
  return db[table];
}

function matches(row, filters) {
  return filters.every((f) => {
    const v = row[f.col];
    if (f.kind === "eq") return v === f.val;
    if (f.kind === "neq") return v !== f.val;
    if (f.kind === "in") return f.val.includes(v);
    if (f.kind === "gt") return v > f.val;
    if (f.kind === "isNull") return v === null || v === undefined;
    if (f.kind === "notNull") return v !== null && v !== undefined;
    return true;
  });
}

function makeSupabase(db) {
  const finance = [];
  function builder(table) {
    const state = { op: "select", filters: [], updateObj: null, insertObj: null };
    function apply() {
      const rows = rowsFor(db, table);
      if (state.op === "update") {
        const hit = rows.filter((r) => matches(r, state.filters));
        hit.forEach((r) => Object.assign(r, state.updateObj));
        return hit;
      }
      if (state.op === "insert") {
        const inserted = { id: `row-${rows.length + 1}`, ...state.insertObj };
        rows.push(inserted);
        return [inserted];
      }
      return rows.filter((r) => matches(r, state.filters));
    }
    const api = {
      select() { return api; },
      update(obj) { state.op = "update"; state.updateObj = obj; return api; },
      insert(obj) { state.op = "insert"; state.insertObj = obj; return api; },
      eq(col, val) { state.filters.push({ kind: "eq", col, val }); return api; },
      neq(col, val) { state.filters.push({ kind: "neq", col, val }); return api; },
      in(col, val) { state.filters.push({ kind: "in", col, val }); return api; },
      gt(col, val) { state.filters.push({ kind: "gt", col, val }); return api; },
      is(col) { state.filters.push({ kind: "isNull", col }); return api; },
      not(col) { state.filters.push({ kind: "notNull", col }); return api; },
      range() { return api; },
      or() { return api; },
      order() { return api; },
      limit() { return api; },
      single() { return Promise.resolve({ data: apply()[0] ?? null, error: null }); },
      maybeSingle() { return Promise.resolve({ data: apply()[0] ?? null, error: null }); },
      then(resolve, reject) {
        try {
          const r = apply();
          return Promise.resolve({ data: r, count: r.length, error: null }).then(resolve, reject);
        } catch (e) { return Promise.reject(e).then(resolve, reject); }
      },
    };
    return api;
  }
  return {
    _finance: finance,
    from(table) { return builder(table); },
    rpc(name, params) {
      assert.equal(name, "increment_balance_with_audit");
      const team = rowsFor(db, "teams").find((t) => t.id === params.p_team_id);
      if (team) team.balance += params.p_delta;
      finance.push({ team_id: params.p_team_id, ...params.p_finance_payload });
      return Promise.resolve({ data: team?.balance ?? 0, error: null });
    },
  };
}

// Hold A har allerede købt rytteren (parkeret på pending_team_id), hold B
// forsøger nu at købe ham af sælgeren. Rytteren kører ikke længere et etapeløb,
// så handlen ville gå ad den ikke-parkerede gren.
function parkedDb({ parked }) {
  const sellerRiders = Array.from({ length: 9 }, (_, i) => ({
    id: `s-rider-${i}`, firstname: "S", lastname: `${i}`, team_id: "seller", pending_team_id: null,
  }));
  return {
    teams: [
      { id: "team-a", name: "Hold A", balance: 1000, division: 3, user_id: "u-a", is_bank: false },
      { id: "team-b", name: "Hold B", balance: 1000, division: 3, user_id: "u-b", is_bank: false },
      { id: "seller", name: "Sælger", balance: 500, division: 3, user_id: "u-s", is_bank: false },
    ],
    riders: [
      {
        id: "rider-1", firstname: "Alex", lastname: "Star", team_id: "seller",
        pending_team_id: parked ? "team-a" : null,
        salary: 0, prize_earnings_bonus: 0, contract_length: null, contract_end_season: null,
      },
      ...sellerRiders,
    ],
    transfer_offers: [{
      id: "offer-b", rider_id: "rider-1", seller_team_id: "seller", buyer_team_id: "team-b",
      offer_amount: 200, counter_amount: null, status: "awaiting_confirmation",
      buyer_confirmed: false, seller_confirmed: true,
    }],
    swap_offers: [],
    transfer_listings: [],
    auctions: [],
    auction_proxy_bids: [],
    seasons: [{ id: "season-1", status: "active" }],
    transfer_windows: [{ status: "open", created_at: "2026-05-31" }],
    races: [],
    race_entries: [],
  };
}

test("executeTransferOffer #6181: en solgt, ventende rytter kan ikke sælges igen til et andet hold", async () => {
  const db = parkedDb({ parked: true });
  const supabase = makeSupabase(db);

  const result = await confirmTransferOffer({
    supabase, offerId: "offer-b", confirmingTeamId: "team-b", notifyTeamOwner: async () => {}, now: FIXED_NOW,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "stale_rider_state");
  const rider = db.riders.find((r) => r.id === "rider-1");
  assert.equal(rider.team_id, "seller", "rytteren bliver hos sælgeren");
  assert.equal(rider.pending_team_id, "team-a", "hold A's køb står urørt");
  assert.equal(supabase._finance.length, 0, "ingen penge flyttes");
  assert.equal(db.teams.find((t) => t.id === "team-b").balance, 1000);
  assert.equal(db.teams.find((t) => t.id === "seller").balance, 500);
});

test("executeTransferOffer #6181 (kontrol): en ikke-parkeret rytter sælges som hidtil", async () => {
  const db = parkedDb({ parked: false });
  const supabase = makeSupabase(db);

  const result = await confirmTransferOffer({
    supabase, offerId: "offer-b", confirmingTeamId: "team-b", notifyTeamOwner: async () => {}, now: FIXED_NOW,
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, "accepted");
  const sold = db.riders.find((r) => r.id === "rider-1");
  assert.equal(sold.team_id, "team-b");
  assert.equal(sold.acquired_at, FIXED_NOW.toISOString(), "acquired_at kommer fra det injicerede ur");
});
