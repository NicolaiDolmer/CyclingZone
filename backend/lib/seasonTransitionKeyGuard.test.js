import test from "node:test";
import assert from "node:assert/strict";

import {
  checkSeasonTransitionKeyDrift,
  SEASON_TRANSITION_KEY_DRIFT_WINDOW_DAYS,
  SEASON_TRANSITION_KEY_DRIFT_TOLERANCE_MS,
} from "./seasonTransitionKeyGuard.js";

function makeSupabase({ upcomingSeason = null, appConfigRow = null, seasonsError = null, configError = null } = {}) {
  return {
    from(table) {
      if (table === "seasons") {
        return { select() { return { eq() { return { maybeSingle() { return Promise.resolve({ data: upcomingSeason, error: seasonsError }); } }; } }; } };
      }
      if (table === "app_config") {
        return { select() { return { eq() { return { maybeSingle() { return Promise.resolve({ data: appConfigRow, error: configError }); } }; } }; } };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

test("konstanter er stabile", () => {
  assert.equal(SEASON_TRANSITION_KEY_DRIFT_WINDOW_DAYS, 7);
  assert.equal(SEASON_TRANSITION_KEY_DRIFT_TOLERANCE_MS, 12 * 60 * 60 * 1000);
});

test("ingen upcoming sæson → ingen drift, tjekket alligevel (read-only safety-net er tomt)", async () => {
  const supabase = makeSupabase({ upcomingSeason: null });
  const result = await checkSeasonTransitionKeyDrift({ supabase, now: new Date("2026-08-01T00:00:00Z") });
  assert.equal(result.checked, true);
  assert.equal(result.drift, false);
  assert.equal(result.reason, "no-upcoming-season");
});

test("upcoming sæson > 7 dage ude → uden for vinduet, ikke tjekket mod app_config", async () => {
  const supabase = {
    from(table) {
      if (table === "seasons") {
        return { select() { return { eq() { return { maybeSingle() { return Promise.resolve({ data: { number: 4, start_date: "2026-09-28" }, error: null }); } }; } }; } };
      }
      throw new Error("app_config bør ikke slås op uden for vinduet");
    },
  };
  const result = await checkSeasonTransitionKeyDrift({ supabase, now: new Date("2026-09-01T00:00:00Z") });
  assert.equal(result.drift, false);
  assert.equal(result.reason, "outside-window");
});

test("< 7 dage til sæsonstart + nøgle mangler → drift=true, reason=missing", async () => {
  const supabase = makeSupabase({
    upcomingSeason: { number: 4, start_date: "2026-09-28" },
    appConfigRow: null,
  });
  const result = await checkSeasonTransitionKeyDrift({ supabase, now: new Date("2026-09-24T00:00:00Z") });
  assert.equal(result.drift, true);
  assert.equal(result.reason, "missing");
  assert.equal(result.seasonNumber, 4);
  assert.equal(result.expected, "2026-09-27T16:00:00.000Z"); // 18:00 CEST dagen før = 16:00Z
  assert.equal(result.existing, null);
});

test("< 7 dage til sæsonstart + nøgle inden for 12t af fallback → ingen drift", async () => {
  const supabase = makeSupabase({
    upcomingSeason: { number: 4, start_date: "2026-09-28" },
    appConfigRow: { value: "2026-09-27T19:30:00.000Z" }, // 3,5t fra 16:00Z-fallback
  });
  const result = await checkSeasonTransitionKeyDrift({ supabase, now: new Date("2026-09-24T00:00:00Z") });
  assert.equal(result.drift, false);
  assert.equal(result.reason, "ok");
});

test("< 7 dage til sæsonstart + nøgle afviger > 12t fra fallback → drift=true, reason=diverges", async () => {
  const supabase = makeSupabase({
    upcomingSeason: { number: 4, start_date: "2026-09-28" },
    appConfigRow: { value: "2026-09-25T16:00:00.000Z" }, // 2 dage for tidligt sat
  });
  const result = await checkSeasonTransitionKeyDrift({ supabase, now: new Date("2026-09-24T00:00:00Z") });
  assert.equal(result.drift, true);
  assert.equal(result.reason, "diverges");
  assert.ok(result.diffMs > SEASON_TRANSITION_KEY_DRIFT_TOLERANCE_MS);
});

test("nøgle-værdi er ugyldig dato → behandles som manglende", async () => {
  const supabase = makeSupabase({
    upcomingSeason: { number: 4, start_date: "2026-09-28" },
    appConfigRow: { value: "ikke en dato" },
  });
  const result = await checkSeasonTransitionKeyDrift({ supabase, now: new Date("2026-09-24T00:00:00Z") });
  assert.equal(result.drift, true);
  assert.equal(result.reason, "missing");
});

test("manglende supabase-client → checked=false, kaster ikke", async () => {
  const result = await checkSeasonTransitionKeyDrift({ supabase: null });
  assert.equal(result.checked, false);
  assert.equal(result.drift, false);
});

test("fejlende seasons-opslag kastes (ingen fail-open her — det er en aktiv alarm-vagt, ikke en gate)", async () => {
  const supabase = makeSupabase({ seasonsError: { message: "timeout" } });
  await assert.rejects(() => checkSeasonTransitionKeyDrift({ supabase }), /timeout/);
});

test("fejlende app_config-opslag kastes", async () => {
  const supabase = makeSupabase({
    upcomingSeason: { number: 4, start_date: "2026-09-28" },
    configError: { message: "timeout" },
  });
  await assert.rejects(
    () => checkSeasonTransitionKeyDrift({ supabase, now: new Date("2026-09-24T00:00:00Z") }),
    /timeout/
  );
});
