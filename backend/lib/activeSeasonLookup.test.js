import test from "node:test";
import assert from "node:assert/strict";

import { loadSingleActiveSeason } from "./activeSeasonLookup.js";

// Chainable seasons-mock: hoved-lookuppet kæder .select().eq().order().limit().maybeSingle();
// fler-aktiv-tælleforespørgslen kæder .select(cols, {count, head:true}).eq() uden maybeSingle.
function makeSupabase({ seasons = [], seasonsError = null, activeCount, countError = null } = {}) {
  return {
    from(table) {
      assert.equal(table, "seasons");
      return {
        select(_cols, opts) {
          if (opts?.head) {
            return { eq: () => Promise.resolve({ count: countError ? null : (activeCount ?? seasons.length), error: countError }) };
          }
          return {
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: seasonsError ? null : (seasons[0] ?? null), error: seasonsError }),
                }),
              }),
            }),
          };
        },
      };
    },
  };
}

test("loadSingleActiveSeason: ingen aktiv sæson → null, ingen alarm", async () => {
  const supabase = makeSupabase({ seasons: [] });
  const captured = [];
  const season = await loadSingleActiveSeason(supabase, { tag: "test", captureExceptionFn: (e, c) => captured.push({ e, c }) });
  assert.equal(season, null);
  assert.equal(captured.length, 0);
});

test("loadSingleActiveSeason: én aktiv sæson → returneres, ingen alarm", async () => {
  const supabase = makeSupabase({ seasons: [{ id: "s1", number: 5 }] });
  const captured = [];
  const season = await loadSingleActiveSeason(supabase, { tag: "test", captureExceptionFn: (e, c) => captured.push({ e, c }) });
  assert.deepEqual(season, { id: "s1", number: 5 });
  assert.equal(captured.length, 0);
});

test("loadSingleActiveSeason: fejl i hoved-queryen kastes videre (præfikset seasons:)", async () => {
  const supabase = makeSupabase({ seasonsError: { message: "boom" } });
  await assert.rejects(
    () => loadSingleActiveSeason(supabase, { tag: "test" }),
    /seasons: boom/
  );
});

// #2743: kernescenariet — 2 aktive sæsoner (delvist fejlet transitionToNextSeason) må
// IKKE kaste. Det gamle .eq("status","active").maybeSingle() (uden order+limit) ville
// kaste hårdt her, fordi PostgREST leverer BEGGE rækker til maybeSingle().
test("#2743: to aktive sæsoner → tager nyeste (order+limit), kaster ikke, og alarmerer med korrekt count+tag+fingerprint", async () => {
  const supabase = makeSupabase({ seasons: [{ id: "s2", number: 2 }], activeCount: 2 });
  const captured = [];
  const season = await loadSingleActiveSeason(supabase, {
    tag: "test-callsite",
    captureExceptionFn: (err, ctx) => captured.push({ err, ctx }),
  });
  assert.deepEqual(season, { id: "s2", number: 2 });
  assert.equal(captured.length, 1);
  assert.match(captured[0].err.message, /Flere aktive sæsoner fundet \(2\)/);
  assert.equal(captured[0].ctx.tags.area, "active-season-guard");
  assert.equal(captured[0].ctx.tags.cron, "test-callsite");
  assert.deepEqual(captured[0].ctx.fingerprint, ["active-season-guard", "multi-active", "test-callsite"]);
});

test("#2743: 3+ aktive sæsoner rapporterer det faktiske antal i alarmen", async () => {
  const supabase = makeSupabase({ seasons: [{ id: "s3", number: 3 }], activeCount: 3 });
  const captured = [];
  await loadSingleActiveSeason(supabase, { tag: "t", captureExceptionFn: (e, c) => captured.push({ e, c }) });
  assert.match(captured[0].e.message, /\(3\)/);
});

test("#2743: tælle-queryen fejler → best-effort, ingen kast, ingen falsk alarm, men fejlen alarmeres separat", async () => {
  const supabase = makeSupabase({ seasons: [{ id: "s1" }], countError: { message: "count boom" } });
  const captured = [];
  const season = await loadSingleActiveSeason(supabase, { tag: "t", captureExceptionFn: (e, c) => captured.push({ e, c }) });
  assert.deepEqual(season, { id: "s1" });
  assert.equal(captured.length, 0, "en query-fejl (data=null) skal ikke fejlagtigt tolkes som fler-aktiv");
});

test("#2743: captureExceptionFn der selv kaster stopper ikke lookuppet (dobbelt best-effort)", async () => {
  const supabase = makeSupabase({ seasons: [{ id: "s2" }], activeCount: 2 });
  let calls = 0;
  const season = await loadSingleActiveSeason(supabase, {
    tag: "t",
    captureExceptionFn: () => { calls++; throw new Error("sentry sdk boom"); },
  });
  assert.deepEqual(season, { id: "s2" });
  // Første kald (fler-aktiv-alarmen) kaster → fanges af den ydre catch, som forsøger
  // ÉN gang mere (capture af selve alarm-fejlen) — også det kald kastes væk stille.
  assert.equal(calls, 2);
});
