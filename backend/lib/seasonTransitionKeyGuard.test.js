import test from "node:test";
import assert from "node:assert/strict";

import {
  checkSeasonTransitionKeyDrift,
  SEASON_TRANSITION_KEY_DRIFT_WINDOW_DAYS,
  SEASON_TRANSITION_KEY_DRIFT_TOLERANCE_MS,
} from "./seasonTransitionKeyGuard.js";

// stagesBySeason: { [seasonId]: ["ISO", ...] } — race_stage_schedule-rækker pr. sæson.
function makeSupabase({
  upcomingSeason = null, activeSeason = null, appConfigRow = null, stagesBySeason = {},
  seasonsError = null, configError = null, stagesError = null,
} = {}) {
  return {
    from(table) {
      if (table === "seasons") {
        return { select() { return { eq(_col, status) { return { maybeSingle() {
          return Promise.resolve({ data: status === "active" ? activeSeason : upcomingSeason, error: seasonsError });
        } }; } }; } };
      }
      if (table === "app_config") {
        return { select() { return { eq() { return { maybeSingle() { return Promise.resolve({ data: appConfigRow, error: configError }); } }; } }; } };
      }
      if (table === "race_stage_schedule") {
        return { select() { return { eq(_col, seasonId) { return { order(_c, { ascending }) { return { limit(n) {
          const sorted = [...(stagesBySeason[seasonId] ?? [])].sort();
          if (!ascending) sorted.reverse();
          return Promise.resolve({ data: sorted.slice(0, n).map((scheduled_at) => ({ scheduled_at })), error: stagesError });
        } }; } }; } }; } };
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

// #7022: kalenderen er dommeren, når den kommende sæson har etaper.
const S4 = { id: "s4", number: 4, start_date: "2026-09-28" };
const S5 = { id: "s5", number: 5, start_date: "2026-10-28" };
const S5_NOW = new Date("2026-10-21T06:04:00Z"); // Sentry CYCLINGZONE-A9
const S5_STAGES = {
  s4: ["2026-09-28T17:30:00Z", "2026-10-25T14:00:00Z"], // S4's sidste etape lørdag 16:00 dansk tid
  s5: ["2026-10-28T10:00:00Z", "2026-11-28T14:00:00Z"],
};

test("#7022 regression: S5-nøglen 25/10 18:30Z ligger dage før konventionen, men passer til kalenderen → ingen drift", async () => {
  const supabase = makeSupabase({
    upcomingSeason: S5, activeSeason: S4, stagesBySeason: S5_STAGES,
    appConfigRow: { value: "2026-10-25T18:30:00.000Z" },
  });
  const result = await checkSeasonTransitionKeyDrift({ supabase, now: S5_NOW });
  assert.equal(result.drift, false);
  assert.equal(result.reason, "ok-calendar");
});

test("#7022: nøgle før den afsluttende sæsons sidste etape + buffer → drift=true, reason=too-early", async () => {
  const supabase = makeSupabase({
    upcomingSeason: S5, activeSeason: S4, stagesBySeason: S5_STAGES,
    appConfigRow: { value: "2026-10-25T14:15:00.000Z" }, // 15 min efter sidste etapes start (< 30 min buffer)
  });
  const result = await checkSeasonTransitionKeyDrift({ supabase, now: S5_NOW });
  assert.equal(result.drift, true);
  assert.equal(result.reason, "too-early");
  assert.equal(result.earliestAllowed, "2026-10-25T14:30:00.000Z");
});

test("#7022: nøgle < 24 t før den nye sæsons første etape → drift=true, reason=too-late (selv inden for konventionens 12 t)", async () => {
  const supabase = makeSupabase({
    upcomingSeason: S5, activeSeason: S4, stagesBySeason: S5_STAGES,
    appConfigRow: { value: "2026-10-27T17:00:00.000Z" }, // konventionen selv, men kun 17 t før 28/10 10:00Z
  });
  const result = await checkSeasonTransitionKeyDrift({ supabase, now: S5_NOW });
  assert.equal(result.drift, true);
  assert.equal(result.reason, "too-late");
  assert.equal(result.latestAllowed, "2026-10-27T10:00:00.000Z");
});

test("#7022: grænserne er inklusive (præcis buffer efter sidste etape og præcis 24 t før første)", async () => {
  for (const value of ["2026-10-25T14:30:00.000Z", "2026-10-27T10:00:00.000Z"]) {
    const supabase = makeSupabase({ upcomingSeason: S5, activeSeason: S4, stagesBySeason: S5_STAGES, appConfigRow: { value } });
    const result = await checkSeasonTransitionKeyDrift({ supabase, now: S5_NOW });
    assert.equal(result.drift, false, value);
  }
});

test("#7022: kalender bygget men ingen aktiv sæson (første sæson) → kun 24 t-reglen gælder", async () => {
  const supabase = makeSupabase({
    upcomingSeason: S5, activeSeason: null, stagesBySeason: S5_STAGES,
    appConfigRow: { value: "2026-10-20T12:00:00.000Z" },
  });
  const result = await checkSeasonTransitionKeyDrift({ supabase, now: S5_NOW });
  assert.equal(result.drift, false);
  assert.equal(result.reason, "ok-calendar");
});

test("#7022: nøglen mangler stadig → missing, også når kalenderen er bygget", async () => {
  const supabase = makeSupabase({ upcomingSeason: S5, activeSeason: S4, stagesBySeason: S5_STAGES, appConfigRow: null });
  const result = await checkSeasonTransitionKeyDrift({ supabase, now: S5_NOW });
  assert.equal(result.drift, true);
  assert.equal(result.reason, "missing");
});

test("#7022: fejlende etape-opslag kastes", async () => {
  const supabase = makeSupabase({
    upcomingSeason: S5, activeSeason: S4, stagesBySeason: S5_STAGES,
    appConfigRow: { value: "2026-10-25T18:30:00.000Z" }, stagesError: { message: "timeout" },
  });
  await assert.rejects(() => checkSeasonTransitionKeyDrift({ supabase, now: S5_NOW }), /timeout/);
});
