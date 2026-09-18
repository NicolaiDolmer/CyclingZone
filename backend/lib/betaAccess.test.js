// #5259 · Beta-adgang. To slags test her, med vilje adskilt:
//
//   1. De rene funktioner (betaAccessState/canRequest/canWithdraw). De er
//      udledningen BAADE API'et og fladen laeser, saa en uenighed her ville
//      vise spilleren én tilstand og give ham en anden.
//   2. DB-stierne mod en fake-klient. Det der testes er KONTRAKTEN — hvad der
//      skrives hvor, og hvad der IKKE skrives — ikke Postgres. Reglen
//      "is_beta_tester vinder over raekken" og "en fejlet indbakke-besked
//      ruller ikke beslutningen tilbage" er begge fanget her.
//
// Der er BEVIDST ingen test af selve gaten (evaluateFlagStage): #5259 aendrer
// den ikke, og en test her ville lade som om laget ejede den.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BETA_REQUEST_STATUS,
  betaAccessState,
  buildBetaDecisionNotification,
  canRequestBetaAccess,
  canWithdrawBetaAccess,
  decideBetaRequest,
  isBetaRequestsMissing,
  listBetaAccess,
  readBetaAccess,
  requestBetaAccess,
  setBetaTester,
  withdrawBetaAccess,
} from "./betaAccess.js";

// ── Fake-klient ─────────────────────────────────────────────────────────────
// Kun de kald betaAccess.js faktisk laver. En tabel i `missing` svarer som
// PostgREST goer naar migrationen ikke er koert endnu (42P01).

function makeSupabase({ users = [], beta_requests = [], missing = [] } = {}) {
  const tables = {
    users: users.map((u) => ({ ...u })),
    beta_requests: beta_requests.map((r) => ({ ...r })),
  };
  const missingSet = new Set(missing);
  const missingError = (table) => ({
    code: "42P01",
    message: `relation "public.${table}" does not exist`,
  });

  function builder(table) {
    const state = { op: null, payload: null, filters: [], selected: false };

    function rows() {
      return tables[table].filter((row) =>
        state.filters.every(({ kind, col, value }) =>
          kind === "in" ? value.includes(row[col]) : row[col] === value,
        ),
      );
    }

    function run() {
      if (missingSet.has(table)) return { data: null, error: missingError(table) };
      if (state.op === "update") {
        const hit = rows();
        hit.forEach((row) => Object.assign(row, state.payload));
        return { data: hit, error: null };
      }
      if (state.op === "upsert") {
        const key = state.payload.user_id;
        const existing = tables[table].find((row) => row.user_id === key);
        if (existing) Object.assign(existing, state.payload);
        else tables[table].push({ ...state.payload });
        return { data: null, error: null };
      }
      return { data: rows(), error: null };
    }

    const api = {
      select() { state.selected = true; if (!state.op) state.op = "select"; return api; },
      update(payload) { state.op = "update"; state.payload = payload; return api; },
      upsert(payload) { state.op = "upsert"; state.payload = payload; return api; },
      insert(payload) { state.op = "upsert"; state.payload = payload; return api; },
      eq(col, value) { state.filters.push({ kind: "eq", col, value }); return api; },
      in(col, value) { state.filters.push({ kind: "in", col, value }); return api; },
      order() { return api; },
      limit() { return api; },
      maybeSingle() {
        const { data, error } = run();
        return Promise.resolve({ data: error ? null : (data?.[0] ?? null), error });
      },
      single() {
        const { data, error } = run();
        if (error) return Promise.resolve({ data: null, error });
        if (!data?.length) return Promise.resolve({ data: null, error: { message: "no rows" } });
        return Promise.resolve({ data: data[0], error: null });
      },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return api;
  }

  return { from: (table) => builder(table), _tables: tables };
}

// ── 1. Udledningen ──────────────────────────────────────────────────────────

test("betaAccessState: is_beta_tester vinder over raekken", () => {
  // Ejeren kan saette kontakten direkte i Brugere-fanen uden at der nogensinde
  // har vaeret en ansoegning — og saa ER spilleren medlem.
  assert.equal(betaAccessState({ isBetaTester: true, requestStatus: null }), "member");
  assert.equal(betaAccessState({ isBetaTester: true, requestStatus: "pending" }), "member");
  assert.equal(betaAccessState({ isBetaTester: true, requestStatus: "rejected" }), "member");
});

test("betaAccessState: raekken bestemmer naar kontakten er slukket", () => {
  assert.equal(betaAccessState({ isBetaTester: false, requestStatus: "pending" }), "pending");
  assert.equal(betaAccessState({ isBetaTester: false, requestStatus: "rejected" }), "rejected");
  assert.equal(betaAccessState({ isBetaTester: false, requestStatus: "withdrawn" }), "none");
  assert.equal(betaAccessState({ isBetaTester: false, requestStatus: "approved" }), "none");
  assert.equal(betaAccessState(), "none");
});

test("canRequest/canWithdraw daekker hinanden uden overlap", () => {
  assert.equal(canRequestBetaAccess("none"), true);
  assert.equal(canRequestBetaAccess("rejected"), true);
  assert.equal(canRequestBetaAccess("pending"), false);
  assert.equal(canRequestBetaAccess("member"), false);

  assert.equal(canWithdrawBetaAccess("member"), true);
  assert.equal(canWithdrawBetaAccess("pending"), true);
  assert.equal(canWithdrawBetaAccess("none"), false);
  assert.equal(canWithdrawBetaAccess("rejected"), false);
});

test("buildBetaDecisionNotification baerer koder til klientens sprog (#4734)", () => {
  const yes = buildBetaDecisionNotification(true);
  assert.equal(yes.type, "beta_access_decided");
  assert.equal(yes.metadata.titleCode, "notif.betaAccess.approved.title");
  assert.equal(yes.metadata.messageCode, "notif.betaAccess.approved.message");
  assert.ok(yes.title.length > 0, "fallback-titel maa ikke vaere tom");

  const no = buildBetaDecisionNotification(false);
  assert.equal(no.metadata.titleCode, "notif.betaAccess.rejected.title");
  assert.notEqual(no.title, yes.title);
});

test("isBetaRequestsMissing skelner migrations-vindue fra aegte fejl", () => {
  assert.equal(isBetaRequestsMissing({ code: "42P01", message: "x" }), true);
  assert.equal(
    isBetaRequestsMissing({ message: "Could not find the table 'public.beta_requests' in the schema cache" }),
    true,
  );
  assert.equal(isBetaRequestsMissing({ code: "23505", message: "duplicate key" }), false);
  assert.equal(isBetaRequestsMissing(null), false);
});

// ── 2. DB-stierne ───────────────────────────────────────────────────────────

test("readBetaAccess samler de to kilder til een tilstand", async () => {
  const supabase = makeSupabase({
    users: [{ id: "u1", is_beta_tester: false }],
    beta_requests: [{ user_id: "u1", status: "pending", created_at: "2026-09-18T08:00:00.000Z" }],
  });
  const access = await readBetaAccess(supabase, "u1");
  assert.equal(access.state, "pending");
  assert.equal(access.is_beta_tester, false);
  assert.equal(access.requested_at, "2026-09-18T08:00:00.000Z");
});

test("requestBetaAccess: ny ansoegning efter afslag GENBRUGER raekken", async () => {
  const supabase = makeSupabase({
    users: [{ id: "u1", is_beta_tester: false }],
    beta_requests: [{ user_id: "u1", status: "rejected", created_at: "2026-09-01T00:00:00.000Z" }],
  });
  const result = await requestBetaAccess(supabase, "u1");
  assert.equal(result.ok, true);
  assert.equal(result.access.state, "pending");
  // EEN raekke pr. bruger — ellers kan admin-listen spammes med pending-raekker.
  assert.equal(supabase._tables.beta_requests.length, 1);
});

test("requestBetaAccess afviser den der allerede venter eller er med", async () => {
  const pending = makeSupabase({
    users: [{ id: "u1", is_beta_tester: false }],
    beta_requests: [{ user_id: "u1", status: "pending", created_at: "2026-09-18T08:00:00.000Z" }],
  });
  assert.equal((await requestBetaAccess(pending, "u1")).ok, false);

  const member = makeSupabase({ users: [{ id: "u1", is_beta_tester: true }] });
  const blocked = await requestBetaAccess(member, "u1");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "member");
});

test("withdrawBetaAccess slukker kontakten uden at spoerge ejeren", async () => {
  const supabase = makeSupabase({
    users: [{ id: "u1", is_beta_tester: true }],
    beta_requests: [{ user_id: "u1", status: "approved", created_at: "2026-09-10T00:00:00.000Z" }],
  });
  const result = await withdrawBetaAccess(supabase, "u1");
  assert.equal(result.ok, true);
  assert.equal(result.access.state, "none");
  assert.equal(supabase._tables.users[0].is_beta_tester, false);
  assert.equal(supabase._tables.beta_requests[0].status, BETA_REQUEST_STATUS.WITHDRAWN);
});

test("setBetaTester skriver kontakten OG spejler raekken", async () => {
  const supabase = makeSupabase({ users: [{ id: "u1", username: "rita", is_beta_tester: false }] });
  const result = await setBetaTester(supabase, { userId: "u1", isBetaTester: true, adminUserId: "a1" });
  assert.equal(result.ok, true);
  assert.equal(result.username, "rita");
  assert.equal(result.mirrored, true);
  assert.equal(supabase._tables.users[0].is_beta_tester, true);
  assert.equal(supabase._tables.beta_requests[0].status, BETA_REQUEST_STATUS.APPROVED);
  assert.equal(supabase._tables.beta_requests[0].decided_by, "a1");
});

test("setBetaTester saetter stadig kontakten naar tabellen mangler (deploy-vinduet)", async () => {
  const supabase = makeSupabase({
    users: [{ id: "u1", username: "rita", is_beta_tester: false }],
    missing: ["beta_requests"],
  });
  const result = await setBetaTester(supabase, { userId: "u1", isBetaTester: true, adminUserId: "a1" });
  assert.equal(result.ok, true);
  assert.equal(result.mirrored, false, "spejlet skal rapportere at det ikke blev skrevet");
  assert.equal(supabase._tables.users[0].is_beta_tester, true, "sandheden er users.is_beta_tester");
});

test("decideBetaRequest: en fejlet indbakke-besked ruller IKKE beslutningen tilbage", async () => {
  // notifications findes ikke i fake-klienten → notifyUser kaster. Beslutningen
  // er stadig truffet; det modsatte (rulle en godkendelse tilbage fordi en
  // besked fejlede) ville vaere vaerre end en manglende besked.
  const supabase = makeSupabase({
    users: [{ id: "u1", username: "rita", is_beta_tester: false }],
    beta_requests: [{ user_id: "u1", status: "pending", created_at: "2026-09-18T08:00:00.000Z" }],
  });
  const result = await decideBetaRequest(supabase, { userId: "u1", approved: true, adminUserId: "a1" });
  assert.equal(result.ok, true);
  assert.equal(result.notified, false);
  assert.equal(result.access.state, "member");
  assert.equal(supabase._tables.beta_requests[0].status, BETA_REQUEST_STATUS.APPROVED);
});

test("decideBetaRequest: afslag lader kontakten vaere slukket", async () => {
  const supabase = makeSupabase({
    users: [{ id: "u1", username: "rita", is_beta_tester: false }],
    beta_requests: [{ user_id: "u1", status: "pending", created_at: "2026-09-18T08:00:00.000Z" }],
  });
  const result = await decideBetaRequest(supabase, { userId: "u1", approved: false, adminUserId: "a1" });
  assert.equal(supabase._tables.users[0].is_beta_tester, false);
  assert.equal(result.access.state, "rejected");
});

test("listBetaAccess: medlemmer og ubesvarede ansoegninger, uden dubletter", async () => {
  const supabase = makeSupabase({
    users: [
      { id: "u1", username: "rita", email: "rita@example.com", is_beta_tester: true },
      { id: "u2", username: "kasper", email: "kasper@example.com", is_beta_tester: false },
      { id: "u3", username: "mo", email: "mo@example.com", is_beta_tester: true },
    ],
    beta_requests: [
      { user_id: "u2", status: "pending", created_at: "2026-09-18T08:00:00.000Z" },
      // u3 er allerede medlem: raekken maa ikke ogsaa staa som "venter paa svar".
      { user_id: "u3", status: "pending", created_at: "2026-09-17T08:00:00.000Z" },
    ],
  });
  const list = await listBetaAccess(supabase);
  assert.equal(list.table_ready, true);
  assert.deepEqual(list.members.map((m) => m.username).sort(), ["mo", "rita"]);
  assert.equal(list.pending.length, 1);
  assert.equal(list.pending[0].username, "kasper");
});

test("listBetaAccess: tabellen mangler → tom liste, ikke en fejl", async () => {
  const supabase = makeSupabase({
    users: [{ id: "u1", username: "rita", email: "r@e.com", is_beta_tester: true }],
    missing: ["beta_requests"],
  });
  const list = await listBetaAccess(supabase);
  assert.equal(list.table_ready, false);
  assert.equal(list.pending.length, 0);
  assert.equal(list.members.length, 1);
});
