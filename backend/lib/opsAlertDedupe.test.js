// #4752 — unit-tests for den edge-triggede alarm-dedupe (CYCLINGZONE-58: 378
// Sentry-events på 32 t fra ÉN uafviselig tilstand). In-memory supabase-stub,
// ingen ægte DB.

import test from "node:test";
import assert from "node:assert/strict";

import { buildAlertSignature, shouldAlertOnChange, OPS_ALERT_STATE_TABLE } from "./opsAlertDedupe.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function makeSupabase({ initial = null, readError = null, upsertError = null } = {}) {
  const state = { row: initial, upserts: [] };
  return {
    state,
    from(table) {
      assert.equal(table, OPS_ALERT_STATE_TABLE);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: state.row, error: readError }),
          }),
        }),
        upsert: (row) => {
          if (upsertError) return Promise.resolve({ data: null, error: upsertError });
          state.upserts.push(row);
          state.row = { ...(state.row ?? {}), ...row };
          return Promise.resolve({ data: [row], error: null });
        },
      };
    },
  };
}

// ── buildAlertSignature ────────────────────────────────────────────────────

test("buildAlertSignature — sorterer, så kildens rækkefølge ikke ser ud som en ændring", () => {
  assert.equal(buildAlertSignature(["b", "a"]), buildAlertSignature(["a", "b"]));
});

test("buildAlertSignature — dubletter tælles én gang", () => {
  assert.equal(buildAlertSignature(["a", "a", "b"]), "a,b");
});

test("buildAlertSignature — tomt sæt giver tom signatur", () => {
  assert.equal(buildAlertSignature([]), "");
});

// ── shouldAlertOnChange ────────────────────────────────────────────────────

test("første gang (ingen state-række) → alarmerer og skriver last_alerted_at", async () => {
  const supabase = makeSupabase();
  const now = new Date("2026-09-04T06:00:00Z");
  const res = await shouldAlertOnChange({ supabase, alertKey: "k", signature: "team-1:stall", now });

  assert.equal(res.alert, true);
  assert.equal(res.reason, "changed");
  assert.equal(supabase.state.upserts.length, 1);
  assert.equal(supabase.state.upserts[0].last_alerted_at, now.toISOString());
});

test("uændret signatur inden for gulvet → INGEN alarm, og state røres ikke", async () => {
  const now = new Date("2026-09-04T06:00:00Z");
  const supabase = makeSupabase({
    initial: { signature: "team-1:stall", last_alerted_at: new Date(now.getTime() - 60_000).toISOString() },
  });
  const res = await shouldAlertOnChange({
    supabase, alertKey: "k", signature: "team-1:stall", now, reAlertAfterMs: DAY_MS,
  });

  assert.equal(res.alert, false);
  assert.equal(res.reason, "suppressed");
  assert.equal(supabase.state.upserts.length, 0, "et undertrykt tick må ikke skrive");
});

test("et helt døgn på 5-min-kadence giver 1 alarm i stedet for 288 (CYCLINGZONE-58-regressionen)", async () => {
  let now = new Date("2026-09-04T06:00:00Z");
  const supabase = makeSupabase({
    initial: { signature: "team-1:stall", last_alerted_at: now.toISOString() },
  });
  let alerts = 0;
  for (let i = 0; i < 288; i++) {
    now = new Date(now.getTime() + 5 * 60_000); // 5-min-kadencen, ét døgn
    const res = await shouldAlertOnChange({
      supabase, alertKey: "k", signature: "team-1:stall", now, reAlertAfterMs: DAY_MS,
    });
    if (res.alert) alerts += 1;
  }
  // Gulvet er 24 t og 288 ticks à 5 min ER 24 t — præcis det sidste tick rammer det.
  assert.equal(alerts, 1);
});

test("uændret signatur efter gulvet → alarmerer igen (tilstanden forsvinder ikke i tavshed)", async () => {
  const now = new Date("2026-09-04T06:00:00Z");
  const supabase = makeSupabase({
    initial: { signature: "team-1:stall", last_alerted_at: new Date(now.getTime() - DAY_MS - 1).toISOString() },
  });
  const res = await shouldAlertOnChange({
    supabase, alertKey: "k", signature: "team-1:stall", now, reAlertAfterMs: DAY_MS,
  });

  assert.equal(res.alert, true);
  assert.equal(res.reason, "re-alert");
  assert.equal(supabase.state.upserts[0].last_alerted_at, now.toISOString());
});

test("ændret signatur alarmerer straks, også midt i gulvet", async () => {
  const now = new Date("2026-09-04T06:00:00Z");
  const supabase = makeSupabase({
    initial: { signature: "team-1:stall", last_alerted_at: new Date(now.getTime() - 60_000).toISOString() },
  });
  const res = await shouldAlertOnChange({
    supabase, alertKey: "k", signature: "team-1:stall,team-2:stall", now, reAlertAfterMs: DAY_MS,
  });

  assert.equal(res.alert, true);
  assert.equal(res.reason, "changed");
});

test("uden reAlertAfterMs er dedupen ren edge-trigger (cronHeartbeat-semantikken)", async () => {
  const now = new Date("2026-09-04T06:00:00Z");
  const supabase = makeSupabase({
    initial: { signature: "s", last_alerted_at: new Date(0).toISOString() },
  });
  const res = await shouldAlertOnChange({ supabase, alertKey: "k", signature: "s", now });

  assert.equal(res.alert, false);
  assert.equal(res.reason, "suppressed");
});

test("tilstanden kommer sig (tom signatur) → ingen alarm, men signaturen nulstilles", async () => {
  const now = new Date("2026-09-04T06:00:00Z");
  const supabase = makeSupabase({
    initial: { signature: "team-1:stall", last_alerted_at: now.toISOString() },
  });
  const res = await shouldAlertOnChange({
    supabase, alertKey: "k", signature: "", now, reAlertAfterMs: DAY_MS,
  });

  assert.equal(res.alert, true, "skiftet ER ny information");
  assert.equal(supabase.state.row.signature, "", "næste ægte brud skal se en ren tavle");
});

test("læsefejl → fail-open (alarmér) + DB-fejlen rapporteres", async () => {
  const supabase = makeSupabase({ readError: { message: "state table down" } });
  const captured = [];
  const res = await shouldAlertOnChange({
    supabase, alertKey: "k", signature: "s", captureExceptionFn: (e) => captured.push(e.message),
  });

  assert.equal(res.alert, true);
  assert.equal(res.reason, "state-error");
  assert.match(captured[0], /state table down/);
});

test("skrivefejl → fail-open, så næste tick prøver igen i stedet for at tie", async () => {
  const supabase = makeSupabase({ upsertError: { message: "upsert boom" } });
  const captured = [];
  const res = await shouldAlertOnChange({
    supabase, alertKey: "k", signature: "s", captureExceptionFn: (e) => captured.push(e.message),
  });

  assert.equal(res.alert, true);
  assert.equal(res.reason, "state-error");
  assert.match(captured[0], /upsert boom/);
});

// ── alertOnReadError (#2738-migrering: fail-safe-stille kaldere) ────────────

test("alertOnReadError:false — læsefejl er fail-safe-stille (INGEN alarm), men fejlen rapporteres stadig", async () => {
  const supabase = makeSupabase({ readError: { message: "state table down" } });
  const captured = [];
  const res = await shouldAlertOnChange({
    supabase, alertKey: "k", signature: "s", alertOnReadError: false,
    captureExceptionFn: (e) => captured.push(e.message),
  });

  assert.equal(res.alert, false);
  assert.equal(res.reason, "state-error");
  assert.match(captured[0], /state table down/);
});

test("alertOnReadError:false ændrer INTET når læsningen rent faktisk lykkes", async () => {
  const now = new Date("2026-09-04T06:00:00Z");
  const supabase = makeSupabase();
  const res = await shouldAlertOnChange({
    supabase, alertKey: "k", signature: "team-1:stall", now, alertOnReadError: false,
  });

  assert.equal(res.alert, true);
  assert.equal(res.reason, "changed");
});
