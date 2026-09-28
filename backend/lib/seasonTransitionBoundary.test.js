import test from "node:test";
import assert from "node:assert/strict";
import { getAuctionSeasonBoundaryIssue } from "./auctionEngine.js";
import {
  computeSeasonTransitionBoundary,
  resolveActiveSeasonTransitionBoundary,
  SEASON_TRANSITION_OVERDUE_GRACE_MS,
  fetchSeasonTransitionBoundary,
  ensureSeasonTransitionPlannedAt,
  SEASON_TRANSITION_PLANNED_AT_KEY,
  TRANSITION_FALLBACK_HOUR_COPENHAGEN,
} from "./seasonTransitionBoundary.js";

// ── computeSeasonTransitionBoundary — ren funktion, tre grene (#4004) ─────────

test("gren a: app_config-nøglen findes → den ER grænsen, uanset upcoming season", () => {
  const boundary = computeSeasonTransitionBoundary({
    plannedAt: "2026-08-20T09:30:00.000Z",
    upcomingSeasonStartDate: "2026-08-24",
  });
  assert.equal(boundary.toISOString(), "2026-08-20T09:30:00.000Z");
});

test("gren a: ugyldig plannedAt-værdi falder tilbage til gren b (upcoming season)", () => {
  const boundary = computeSeasonTransitionBoundary({
    plannedAt: "ikke en dato",
    upcomingSeasonStartDate: "2026-08-24",
  });
  assert.equal(boundary.toISOString(), "2026-08-23T16:00:00.000Z");
});

test("gren b: ingen app_config-nøgle → upcoming season start_date minus én dag kl 18 dansk tid (CEST)", () => {
  const boundary = computeSeasonTransitionBoundary({ upcomingSeasonStartDate: "2026-08-24" });
  assert.equal(boundary.toISOString(), "2026-08-23T16:00:00.000Z"); // 18:00 CEST = 16:00Z
});

test("gren b: DST-sikker over vinteren (CET) — start_date minus én dag kl 18 dansk tid", () => {
  const boundary = computeSeasonTransitionBoundary({ upcomingSeasonStartDate: "2027-01-05" });
  assert.equal(boundary.toISOString(), "2027-01-04T17:00:00.000Z"); // 18:00 CET = 17:00Z
});

test("gren b: månedsskift håndteres korrekt (1. i måneden minus én dag → forrige måned)", () => {
  const boundary = computeSeasonTransitionBoundary({ upcomingSeasonStartDate: "2027-01-01" });
  assert.equal(boundary.toISOString(), "2026-12-31T17:00:00.000Z");
});

test("gren c: hverken app_config-nøgle eller upcoming season → null (ingen blokering)", () => {
  assert.equal(computeSeasonTransitionBoundary({}), null);
  assert.equal(computeSeasonTransitionBoundary({ plannedAt: null, upcomingSeasonStartDate: null }), null);
});

test("konstanter er stabile (dokumentation/test-værdier)", () => {
  assert.equal(SEASON_TRANSITION_PLANNED_AT_KEY, "season_transition_planned_at");
  assert.equal(TRANSITION_FALLBACK_HOUR_COPENHAGEN, 18);
});

// ── fetchSeasonTransitionBoundary — DB-opslag + fail-open ─────────────────────

function makeSupabase({ appConfigRow = null, upcomingSeason = null, throwOnTable = null } = {}) {
  return {
    from(table) {
      if (throwOnTable === table) throw new Error(`boom: ${table}`);
      if (table === "app_config") {
        return { select() { return { eq() { return { maybeSingle() { return Promise.resolve({ data: appConfigRow, error: null }); } }; } }; } };
      }
      if (table === "seasons") {
        return { select() { return { eq() { return { maybeSingle() { return Promise.resolve({ data: upcomingSeason, error: null }); } }; } }; } };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

test("fetchSeasonTransitionBoundary: gren a via DB (app_config-værdi vinder)", async () => {
  const supabase = makeSupabase({
    appConfigRow: { value: "2026-08-20T09:30:00.000Z" },
    upcomingSeason: { start_date: "2026-08-24" },
  });
  const boundary = await fetchSeasonTransitionBoundary(supabase, { now: new Date("2026-08-19T10:00:00Z") });
  assert.equal(boundary.toISOString(), "2026-08-20T09:30:00.000Z");
});

test("fetchSeasonTransitionBoundary: gren b via DB (ingen app_config-række, upcoming season findes)", async () => {
  const supabase = makeSupabase({ appConfigRow: null, upcomingSeason: { start_date: "2026-08-24" } });
  const boundary = await fetchSeasonTransitionBoundary(supabase, { now: new Date("2026-08-20T10:00:00Z") });
  assert.equal(boundary.toISOString(), "2026-08-23T16:00:00.000Z");
});

test("fetchSeasonTransitionBoundary: gren c via DB (hverken app_config eller upcoming season) → null", async () => {
  const supabase = makeSupabase({ appConfigRow: null, upcomingSeason: null });
  assert.equal(await fetchSeasonTransitionBoundary(supabase), null);
});

test("fetchSeasonTransitionBoundary: fail-open ved manglende/ugyldig supabase-client → null", async () => {
  assert.equal(await fetchSeasonTransitionBoundary(null), null);
  assert.equal(await fetchSeasonTransitionBoundary({}), null);
});

test("fetchSeasonTransitionBoundary: fail-open ved en fejlende DB-forespørgsel → null (ikke en kastet fejl)", async () => {
  const supabase = makeSupabase({ upcomingSeason: { start_date: "2026-08-24" }, throwOnTable: "app_config" });
  assert.equal(await fetchSeasonTransitionBoundary(supabase), null);
});


// ── #5846: gaten gælder kun et KOMMENDE (eller kørende) skifte ────────────────
//
// Prod-tallene fra S3→S4: planned_at 2026-09-27T17:30Z, fase-loggen 'started'
// 20:36:05Z og 'completed' 20:47:06Z; forrige 'completed' 2026-08-23T18:34:55Z.
const S4_PLANNED = "2026-09-27T17:30:00.000Z";
const S4_STARTED = "2026-09-27T20:36:05.055Z";
const S4_COMPLETED = "2026-09-27T20:47:06.417Z";
const S3_COMPLETED = "2026-08-23T18:34:55.316Z";

const hours = (n) => n * 60 * 60 * 1000;
const plus = (iso, ms) => new Date(new Date(iso).getTime() + ms);

test("#5846 FØR skiftet: planned_at i fremtiden → grænsen gælder; opret der krydser afvises, opret før tillades", () => {
  const now = new Date("2026-09-27T08:00:00Z");
  const boundary = resolveActiveSeasonTransitionBoundary({ plannedAt: S4_PLANNED, lastCompletedAt: S3_COMPLETED, now });
  assert.equal(boundary.toISOString(), S4_PLANNED);
  assert.deepEqual(getAuctionSeasonBoundaryIssue(plus(now.toISOString(), hours(12)), boundary), {
    code: "crosses_season_transition", boundary: S4_PLANNED,
  });
  assert.equal(getAuctionSeasonBoundaryIssue(plus(now.toISOString(), hours(4)), boundary), null);
});

test("#5846 UNDER skiftet (planned_at passeret, skiftet ikke startet endnu) → alle nye auktioner spærres", () => {
  const now = new Date("2026-09-27T19:00:00Z");
  const boundary = resolveActiveSeasonTransitionBoundary({ plannedAt: S4_PLANNED, lastCompletedAt: S3_COMPLETED, now });
  assert.equal(boundary.toISOString(), S4_PLANNED);
  assert.ok(getAuctionSeasonBoundaryIssue(plus(now.toISOString(), 30 * 60 * 1000), boundary), "selv en flash-auktion afvises");
});

test("#5846 UNDER skiftet (fase-log 'started' uden 'completed') → alle nye auktioner spærres", () => {
  const now = new Date("2026-09-27T20:40:00Z");
  const boundary = resolveActiveSeasonTransitionBoundary({
    plannedAt: S4_PLANNED, lastCompletedAt: S3_COMPLETED, inProgressSince: S4_STARTED, now,
  });
  assert.ok(boundary);
  assert.ok(getAuctionSeasonBoundaryIssue(plus(now.toISOString(), 30 * 60 * 1000), boundary));
});

test("#5846 UNDER skiftet der køres FØR planned_at → spærrer alligevel (pensionister/kontraktudløb beskyttes)", () => {
  const now = new Date("2026-09-27T16:05:00Z");
  const boundary = resolveActiveSeasonTransitionBoundary({
    plannedAt: S4_PLANNED, lastCompletedAt: S3_COMPLETED, inProgressSince: "2026-09-27T16:00:00Z", now,
  });
  assert.equal(boundary.toISOString(), "2026-09-27T16:00:00.000Z");
  assert.ok(getAuctionSeasonBoundaryIssue(plus(now.toISOString(), 30 * 60 * 1000), boundary));
});

test("#5846 EFTER skiftet (prod 28/9): planned_at i fortiden + 'completed' efter → ingen grænse; opret tillades", () => {
  const now = new Date("2026-09-28T08:06:00Z");
  const boundary = resolveActiveSeasonTransitionBoundary({ plannedAt: S4_PLANNED, lastCompletedAt: S4_COMPLETED, now });
  assert.equal(boundary, null);
  assert.equal(getAuctionSeasonBoundaryIssue(plus(now.toISOString(), hours(48)), boundary), null);
});

test("#5846 EFTER et skifte kørt tidligt: 'completed' før planned_at (inden for 24 t) bruger grænsen op", () => {
  const now = new Date("2026-09-27T17:00:00Z");
  const boundary = resolveActiveSeasonTransitionBoundary({
    plannedAt: S4_PLANNED, lastCompletedAt: "2026-09-27T16:30:00Z", now,
  });
  assert.equal(boundary, null);
});

test("#5846 EFTER skiftet uden fase-log (log-skrivning fejlede): grænsen udløber efter grace-perioden", () => {
  const within = resolveActiveSeasonTransitionBoundary({
    plannedAt: S4_PLANNED, now: plus(S4_PLANNED, SEASON_TRANSITION_OVERDUE_GRACE_MS - 60_000),
  });
  assert.equal(within?.toISOString(), S4_PLANNED);
  const after = resolveActiveSeasonTransitionBoundary({
    plannedAt: S4_PLANNED, now: plus(S4_PLANNED, SEASON_TRANSITION_OVERDUE_GRACE_MS),
  });
  assert.equal(after, null);
});

test("#5846 en gammel 'started'/'failed' uden afslutning spærrer ikke for evigt", () => {
  const boundary = resolveActiveSeasonTransitionBoundary({
    inProgressSince: "2026-09-27T20:36:05Z", lastCompletedAt: S3_COMPLETED, now: new Date("2026-09-28T12:00:00Z"),
  });
  assert.equal(boundary, null);
});

test("#5846 næste skifte: ny planned_at i fremtiden gælder igen trods S4's 'completed'", () => {
  const boundary = resolveActiveSeasonTransitionBoundary({
    plannedAt: "2026-10-25T17:30:00.000Z", lastCompletedAt: S4_COMPLETED, now: new Date("2026-10-20T10:00:00Z"),
  });
  assert.equal(boundary.toISOString(), "2026-10-25T17:30:00.000Z");
});

test("#5846 fallback fra upcoming season følger samme regel (fremtid gælder, brugt op efter 'completed')", () => {
  const before = resolveActiveSeasonTransitionBoundary({
    upcomingSeasonStartDate: "2026-10-26", lastCompletedAt: S4_COMPLETED, now: new Date("2026-10-20T10:00:00Z"),
  });
  assert.equal(before.toISOString(), "2026-10-25T17:00:00.000Z"); // 18:00 CET (vintertid fra 25/10)
  const after = resolveActiveSeasonTransitionBoundary({
    upcomingSeasonStartDate: "2026-10-26", lastCompletedAt: "2026-10-25T17:00:00Z", now: new Date("2026-10-26T08:00:00Z"),
  });
  assert.equal(after, null);
});

function makePhaseLogSupabase({ plannedAt, phaseRows = [] }) {
  const calls = [];
  return {
    calls,
    from(table) {
      if (table === "app_config") {
        return { select() { return { eq() { return { maybeSingle: async () => ({ data: plannedAt ? { value: plannedAt } : null, error: null }) }; } }; } };
      }
      if (table === "seasons") {
        return { select() { return { eq() { return { maybeSingle: async () => ({ data: null, error: null }) }; } }; } };
      }
      if (table === "admin_log") {
        const q = {
          select() { return q; },
          eq(col, val) { calls.push([col, val]); return q; },
          order() { return q; },
          limit: async () => ({ data: phaseRows, error: null }),
        };
        return q;
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

test("#5846 fetchSeasonTransitionBoundary: prod-tilstanden 28/9 (completed efter planned_at) → null", async () => {
  const supabase = makePhaseLogSupabase({
    plannedAt: S4_PLANNED,
    phaseRows: [
      { created_at: S4_COMPLETED, meta: { status: "completed" } },
      { created_at: S4_STARTED, meta: { status: "started" } },
      { created_at: S3_COMPLETED, meta: { status: "completed" } },
    ],
  });
  assert.equal(await fetchSeasonTransitionBoundary(supabase, { now: new Date("2026-09-28T08:06:00Z") }), null);
  assert.deepEqual(supabase.calls, [["action_type", "manual_override"], ["meta->>source", "season_transition_phase"]]);
});

test("#5846 fetchSeasonTransitionBoundary: skiftet kører ('started' nyest) → spærrer", async () => {
  const supabase = makePhaseLogSupabase({
    plannedAt: S4_PLANNED,
    phaseRows: [
      { created_at: S4_STARTED, meta: { status: "started" } },
      { created_at: S3_COMPLETED, meta: { status: "completed" } },
    ],
  });
  const boundary = await fetchSeasonTransitionBoundary(supabase, { now: new Date("2026-09-27T20:40:00Z") });
  assert.equal(boundary.toISOString(), S4_PLANNED);
});

test("#5846 fetchSeasonTransitionBoundary: fejlende admin_log-opslag → tids-reglen alene (fail-open, ingen 500)", async () => {
  const supabase = makeSupabase({ appConfigRow: { value: S4_PLANNED } });
  assert.equal(await fetchSeasonTransitionBoundary(supabase, { now: new Date("2026-09-28T08:06:00Z") }), null);
  assert.equal((await fetchSeasonTransitionBoundary(supabase, { now: new Date("2026-09-27T19:00:00Z") }))?.toISOString(), S4_PLANNED);
});

// ── ensureSeasonTransitionPlannedAt — idempotent write (#4129) ────────────────

function makeWritableSupabase({ appConfigRow = null, readError = null, writeError = null } = {}) {
  const upsertCalls = [];
  return {
    upsertCalls,
    from(table) {
      assert.equal(table, "app_config");
      return {
        select() {
          return { eq() { return { maybeSingle() { return Promise.resolve({ data: appConfigRow, error: readError }); } }; } };
        },
        upsert(payload, opts) {
          upsertCalls.push({ payload, opts });
          return Promise.resolve({ error: writeError });
        },
      };
    },
  };
}

test("ensureSeasonTransitionPlannedAt: nøgle mangler → skriver den beregnede fallback", async () => {
  const supabase = makeWritableSupabase({ appConfigRow: null });
  const result = await ensureSeasonTransitionPlannedAt({ supabase, seasonStartDate: "2026-08-24" });
  assert.equal(result.updated, true);
  assert.equal(result.reason, "missing");
  assert.equal(result.value, "2026-08-23T16:00:00.000Z");
  assert.equal(supabase.upsertCalls.length, 1);
  assert.equal(supabase.upsertCalls[0].payload.key, SEASON_TRANSITION_PLANNED_AT_KEY);
  assert.equal(supabase.upsertCalls[0].payload.value, "2026-08-23T16:00:00.000Z");
  assert.deepEqual(supabase.upsertCalls[0].opts, { onConflict: "key" });
});

test("ensureSeasonTransitionPlannedAt: værdien er allerede korrekt → ingen skrivning", async () => {
  const supabase = makeWritableSupabase({ appConfigRow: { value: "2026-08-23T16:00:00.000Z" } });
  const result = await ensureSeasonTransitionPlannedAt({ supabase, seasonStartDate: "2026-08-24" });
  assert.equal(result.updated, false);
  assert.equal(result.reason, "already-correct");
  assert.equal(supabase.upsertCalls.length, 0);
});

test("ensureSeasonTransitionPlannedAt: forældet værdi fra en TIDLIGERE sæsons cutover → overskrives", async () => {
  // Efterladenskab fra S2→S3 (23/8), ny sæson starter 2026-11-30.
  const supabase = makeWritableSupabase({ appConfigRow: { value: "2026-08-23T17:30:00.000Z" } });
  const result = await ensureSeasonTransitionPlannedAt({ supabase, seasonStartDate: "2026-11-30" });
  assert.equal(result.updated, true);
  assert.equal(result.reason, "stale");
  assert.equal(result.previous, "2026-08-23T17:30:00.000Z");
  assert.equal(supabase.upsertCalls.length, 1);
});

test("ensureSeasonTransitionPlannedAt: eksisterende værdi PÅ/EFTER ny sæsons start_date → rører ikke ved den", async () => {
  // En anomali (eller en bevidst ejer-indsat værdi der ikke passer beregningen) —
  // vores egen beregning ligger altid FØR start_date, så dette kan ikke være os.
  const supabase = makeWritableSupabase({ appConfigRow: { value: "2026-12-01T00:00:00.000Z" } });
  const result = await ensureSeasonTransitionPlannedAt({ supabase, seasonStartDate: "2026-11-30" });
  assert.equal(result.updated, false);
  assert.equal(result.reason, "existing-later-kept");
  assert.equal(supabase.upsertCalls.length, 0);
});

// ── #5592 (diff-tjek 24/9): et bevidst SENERE skifte bevares, og værdien der skrives er
// den kalenderen er planlagt mod ─────────────────────────────────────────────────────

test("#5592 ensureSeasonTransitionPlannedAt: senere skifte FØR start_date (27/9 kl. 21) bevares — blev før overskrevet med kl. 18", async () => {
  const supabase = makeWritableSupabase({ appConfigRow: { value: "2026-09-27T19:00:00.000Z" } });
  const result = await ensureSeasonTransitionPlannedAt({ supabase, seasonStartDate: "2026-09-28" });
  assert.equal(result.updated, false);
  assert.equal(result.reason, "existing-later-kept");
  assert.equal(result.existing, "2026-09-27T19:00:00.000Z");
  assert.equal(supabase.upsertCalls.length, 0);
});

test("#5592 ensureSeasonTransitionPlannedAt: target = det skifte kalenderen er bygget mod → PRÆCIS den værdi skrives", async () => {
  // S4: S3's seneste etape 27/9 kl. 19 + 30 min → 27/9 kl. 19:30 dansk tid (17:30Z).
  const target = new Date("2026-09-27T17:30:00.000Z");
  const missing = makeWritableSupabase({ appConfigRow: null });
  const r1 = await ensureSeasonTransitionPlannedAt({ supabase: missing, seasonStartDate: "2026-09-28", target });
  assert.equal(r1.updated, true);
  assert.equal(r1.value, "2026-09-27T17:30:00.000Z");
  assert.equal(missing.upsertCalls[0].payload.value, "2026-09-27T17:30:00.000Z", "ikke konventionens kl. 18");

  // Et tidligere skifte (konventionens kl. 18) kan ikke nås og overskrives med kalenderens.
  const earlier = makeWritableSupabase({ appConfigRow: { value: "2026-09-27T16:00:00.000Z" } });
  const r2 = await ensureSeasonTransitionPlannedAt({ supabase: earlier, seasonStartDate: "2026-09-28", target });
  assert.equal(r2.updated, true);
  assert.equal(r2.reason, "stale");
  assert.equal(earlier.upsertCalls[0].payload.value, "2026-09-27T17:30:00.000Z");

  // Samme værdi → idempotent.
  const same = makeWritableSupabase({ appConfigRow: { value: "2026-09-27T17:30:00.000Z" } });
  const r3 = await ensureSeasonTransitionPlannedAt({ supabase: same, seasonStartDate: "2026-09-28", target: target.toISOString() });
  assert.equal(r3.reason, "already-correct");
  assert.equal(same.upsertCalls.length, 0);

  // En senere værdi end kalenderens bevares og meldes, så kalderen kan stoppe.
  const later = makeWritableSupabase({ appConfigRow: { value: "2026-09-27T19:00:00.000Z" } });
  const r4 = await ensureSeasonTransitionPlannedAt({ supabase: later, seasonStartDate: "2026-09-28", target });
  assert.equal(r4.updated, false);
  assert.equal(r4.reason, "existing-later-kept");
  assert.equal(r4.target, "2026-09-27T17:30:00.000Z");
  assert.equal(later.upsertCalls.length, 0);
});

test("#5592 ensureSeasonTransitionPlannedAt: ugyldig target kastes (skriver aldrig et gæt)", async () => {
  const supabase = makeWritableSupabase({ appConfigRow: null });
  await assert.rejects(
    () => ensureSeasonTransitionPlannedAt({ supabase, seasonStartDate: "2026-09-28", target: "ikke en dato" }),
    /not a valid timestamp/,
  );
  assert.equal(supabase.upsertCalls.length, 0);
});

test("ensureSeasonTransitionPlannedAt: ingen seasonStartDate → no-op", async () => {
  const supabase = makeWritableSupabase();
  const result = await ensureSeasonTransitionPlannedAt({ supabase, seasonStartDate: null });
  assert.equal(result.updated, false);
  assert.equal(result.reason, "no-season-start-date");
  assert.equal(supabase.upsertCalls.length, 0);
});

test("ensureSeasonTransitionPlannedAt: manglende supabase-client → no-op (kaster ikke)", async () => {
  const result = await ensureSeasonTransitionPlannedAt({ supabase: null, seasonStartDate: "2026-08-24" });
  assert.equal(result.updated, false);
  assert.equal(result.reason, "no-supabase");
});

test("ensureSeasonTransitionPlannedAt: læsefejl kastes (må ikke stille sluge en DB-fejl ved en skrivning)", async () => {
  const supabase = makeWritableSupabase({ readError: { message: "connection reset" } });
  await assert.rejects(
    () => ensureSeasonTransitionPlannedAt({ supabase, seasonStartDate: "2026-08-24" }),
    /connection reset/
  );
});

test("ensureSeasonTransitionPlannedAt: skrivefejl kastes", async () => {
  const supabase = makeWritableSupabase({ appConfigRow: null, writeError: { message: "constraint violation" } });
  await assert.rejects(
    () => ensureSeasonTransitionPlannedAt({ supabase, seasonStartDate: "2026-08-24" }),
    /constraint violation/
  );
});
