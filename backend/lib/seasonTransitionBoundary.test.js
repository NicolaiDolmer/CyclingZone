import test from "node:test";
import assert from "node:assert/strict";
import {
  computeSeasonTransitionBoundary,
  fetchSeasonTransitionBoundary,
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
  const boundary = await fetchSeasonTransitionBoundary(supabase);
  assert.equal(boundary.toISOString(), "2026-08-20T09:30:00.000Z");
});

test("fetchSeasonTransitionBoundary: gren b via DB (ingen app_config-række, upcoming season findes)", async () => {
  const supabase = makeSupabase({ appConfigRow: null, upcomingSeason: { start_date: "2026-08-24" } });
  const boundary = await fetchSeasonTransitionBoundary(supabase);
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
