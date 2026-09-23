import test from "node:test";
import assert from "node:assert/strict";

import { runRaceEntryGeneratorSweep, RACE_ENTRY_GENERATOR_RUNS_TABLE } from "./raceEntryGeneratorSweep.js";

// Chainable seasons-mock (mirrors activeSeasonLookup.js' forbrug): season-lookuppet
// kæder .select().eq().order().limit().maybeSingle(), og fler-aktiv-alarmen kæder
// .select(cols, {count:"exact", head:true}).eq() (uden maybeSingle — .then() resolver
// direkte). `seasons` er de rækker der matcher status='active'; `activeCount` styrer
// hvad tælle-forespørgslen svarer (default: seasons.length).
function makeSeasonsSupabase({ seasons = [], seasonsError = null, activeCount, countError = null } = {}) {
  return {
    from(table) {
      // #5246: writeRunLog() (best-effort) skriver til denne tabel efter enhver
      // faktisk kørsel. Tests der bruger DENNE helper tester sæson-lookuppet, ikke
      // logningen — no-op-succes her holder dem uændrede (ingen ekstra
      // captureExceptionFn-kald, se den dedikerede makeSweepSupabase nedenfor for
      // tests der faktisk verificerer race_entry_generator_runs-skrivningen).
      if (table === RACE_ENTRY_GENERATOR_RUNS_TABLE) {
        return { insert: async () => ({ error: null }) };
      }
      assert.equal(table, "seasons");
      return {
        select(_cols, opts) {
          if (opts?.head) {
            // Fler-aktiv-tælleforespørgslen (best-effort, ingen maybeSingle-kald).
            return {
              eq: () => Promise.resolve({
                count: countError ? null : (activeCount ?? seasons.length),
                error: countError,
              }),
            };
          }
          return {
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: seasonsError ? null : (seasons[0] ?? null),
                    error: seasonsError,
                  }),
                }),
              }),
            }),
          };
        },
      };
    },
  };
}

test("runRaceEntryGeneratorSweep: skip når flag OFF", async () => {
  const r = await runRaceEntryGeneratorSweep({
    supabase: {},
    isEnabled: async () => false,
    runGeneratorFn: async () => { throw new Error("burde ikke kaldes"); },
  });
  assert.deepEqual(r, { ran: false, reason: "flag_off" });
});

test("runRaceEntryGeneratorSweep: skip når ingen aktiv sæson", async () => {
  const supabase = makeSeasonsSupabase({ seasons: [] });
  const r = await runRaceEntryGeneratorSweep({
    supabase,
    isEnabled: async () => true,
    runGeneratorFn: async () => { throw new Error("burde ikke kaldes"); },
  });
  assert.deepEqual(r, { ran: false, reason: "no_active_season" });
});

test("runRaceEntryGeneratorSweep: kalder runGeneratorFn med aktiv sæson + dryRun:false", async () => {
  const supabase = makeSeasonsSupabase({ seasons: [{ id: "s1" }] });
  let called = null;
  const runGeneratorFn = async (args) => {
    called = args;
    return { dryRun: false, races: 3, teams: 5, generated: 20, skipped: 1 };
  };
  const r = await runRaceEntryGeneratorSweep({ supabase, isEnabled: async () => true, runGeneratorFn });

  assert.equal(called.supabase, supabase);
  assert.equal(called.seasonId, "s1");
  assert.equal(called.dryRun, false);
  assert.equal(r.ran, true);
  assert.equal(r.seasonId, "s1");
  assert.equal(r.races, 3);
  assert.equal(r.teams, 5);
  assert.equal(r.generated, 20);
  assert.equal(r.skipped, 1);
});

test("runRaceEntryGeneratorSweep: kaster hvis seasons-query fejler", async () => {
  const supabase = makeSeasonsSupabase({ seasonsError: { message: "boom" } });
  await assert.rejects(
    () => runRaceEntryGeneratorSweep({ supabase, isEnabled: async () => true, runGeneratorFn: async () => ({}) }),
    /seasons: boom/
  );
});

test("runRaceEntryGeneratorSweep: kaster videre hvis generatoren fejler (trackedTick fanger i cron.js)", async () => {
  const supabase = makeSeasonsSupabase({ seasons: [{ id: "s1" }] });
  await assert.rejects(
    () => runRaceEntryGeneratorSweep({
      supabase,
      isEnabled: async () => true,
      runGeneratorFn: async () => { throw new Error("race_entries insert boom"); },
    }),
    /race_entries insert boom/
  );
});

// #2743: to samtidige aktive sæsoner (delvist fejlet transitionToNextSeason,
// seasonTransition.js) må IKKE længere kaste hårdt (det gamle .maybeSingle() uden
// order+limit gjorde det, og dræbte sweepet hvert tick). Sweepet skal fortsætte med
// den nyeste aktive sæson OG alarmere via captureExceptionFn.
test("#2743: to aktive sæsoner → tager nyeste, kaster IKKE, alarmerer via captureExceptionFn", async () => {
  const supabase = makeSeasonsSupabase({ seasons: [{ id: "s2" }], activeCount: 2 });
  const captured = [];
  const captureExceptionFn = (err, ctx) => captured.push({ message: err.message, ctx });

  let called = null;
  const r = await runRaceEntryGeneratorSweep({
    supabase,
    isEnabled: async () => true,
    runGeneratorFn: async (args) => { called = args; return { dryRun: false, races: 0, teams: 0, generated: 0, skipped: 0 }; },
    captureExceptionFn,
  });

  assert.equal(r.ran, true);
  assert.equal(r.seasonId, "s2");
  assert.equal(called.seasonId, "s2");
  assert.equal(captured.length, 1);
  assert.match(captured[0].message, /Flere aktive sæsoner fundet \(2\)/);
  assert.equal(captured[0].ctx.tags.cron, "race-entry-generator-sweep");
});

// Tælle-forespørgslens FEJL må heller ikke stoppe sweepet (best-effort-alarm).
test("#2743: fler-aktiv-tælling fejler → sweepet fortsætter alligevel (best-effort)", async () => {
  const supabase = makeSeasonsSupabase({ seasons: [{ id: "s1" }], countError: { message: "count boom" } });
  const captured = [];
  const r = await runRaceEntryGeneratorSweep({
    supabase,
    isEnabled: async () => true,
    runGeneratorFn: async () => ({ dryRun: false, races: 0, teams: 0, generated: 0, skipped: 0 }),
    captureExceptionFn: (err, ctx) => captured.push({ message: err.message, ctx }),
  });
  assert.equal(r.ran, true);
  assert.equal(r.seasonId, "s1");
  assert.equal(captured.length, 0, "count-fejl (ikke >1) skal ikke selv udløse en alarm");
});

// #4201: sweepen er den ENE vej hvor assistant_selection_mode laeses. Bliver den
// ikke sendt videre, koerer motoren proactive uanset hvad ejeren har sat.
test("#4201: tilstand + horisont fra app_config sendes videre til generatoren", async () => {
  const supabase = makeSeasonsSupabase({ seasons: [{ id: "s1" }] });
  let called = null;
  const r = await runRaceEntryGeneratorSweep({
    supabase,
    isEnabled: async () => true,
    readModeFn: async () => ({ mode: "late_fill", lateFillHours: 12 }),
    runGeneratorFn: async (args) => {
      called = args;
      return { dryRun: false, mode: args.mode, races: 0, teams: 0, generated: 0, skipped: 0 };
    },
  });
  assert.equal(called.mode, "late_fill");
  assert.equal(called.lateFillHours, 12);
  assert.equal(called.dryRun, false);
  assert.equal(r.mode, "late_fill", "tilstanden er synlig i sweep-resultatet (cron-loggen)");
});

test("#4201: uden app_config-svar koerer sweepet proactive (fail-safe)", async () => {
  const supabase = makeSeasonsSupabase({ seasons: [{ id: "s1" }] });
  let called = null;
  await runRaceEntryGeneratorSweep({
    supabase,
    isEnabled: async () => true,
    // Ingen readModeFn: den ægte readAssistantSelectionConfig rammer seasons-mocken,
    // fejler internt og fail-safer — præcis prod-stien hvis app_config er utilgængelig.
    runGeneratorFn: async (args) => { called = args; return { dryRun: false, mode: args.mode }; },
  });
  assert.equal(called.mode, "proactive");
  assert.equal(called.lateFillHours, 24);
});

// ── #5246: race_entry_generator_runs-logning ────────────────────────────────────────

// Udvider makeSeasonsSupabase med en anden tabel: fanger INSERT-kald til
// race_entry_generator_runs i `writes` i stedet for at kaste (assert.equal(table,
// "seasons") ville ellers ramme enhver ny tabel — se writeRunLog's egen
// try/catch: den fanger netop den slags fejl som "log-skrivning fejlede", derfor
// tester eksisterende tests OVENFOR fortsat rent (best-effort, ingen synlig effekt).
function makeSweepSupabase({ seasons = [], insertError = null } = {}) {
  const writes = [];
  const seasonsSupabase = makeSeasonsSupabase({ seasons });
  return {
    writes,
    from(table) {
      if (table === RACE_ENTRY_GENERATOR_RUNS_TABLE) {
        return {
          insert: async (row) => {
            writes.push(row);
            return { error: insertError };
          },
        };
      }
      return seasonsSupabase.from(table);
    },
  };
}

test("#5246: succesfuld koersel skriver én række i race_entry_generator_runs, felterne matcher generator-resultatet", async () => {
  const supabase = makeSweepSupabase({ seasons: [{ id: "s1" }] });
  const r = await runRaceEntryGeneratorSweep({
    supabase,
    isEnabled: async () => true,
    readModeFn: async () => ({ mode: "late_fill", lateFillHours: 12 }),
    runGeneratorFn: async () => ({ races: 3, teams: 5, generated: 22, inserted: 20, skipped: 1 }),
  });
  assert.equal(r.ran, true);
  assert.equal(supabase.writes.length, 1);
  const row = supabase.writes[0];
  assert.equal(row.mode, "late_fill");
  assert.equal(row.late_fill_hours, 12);
  assert.equal(row.races_considered, 3);
  assert.equal(row.teams_filled, 5);
  assert.equal(row.entries_written, 20, "entries_written = result.inserted, ikke result.generated");
  assert.equal(row.error, null);
  assert.ok(row.started_at && row.finished_at, "started_at/finished_at skal være sat");
});

test("#5246: 0-fyld-koersel skriver STADIG en række (ikke kun ved fund, modsat email_sweep_runs)", async () => {
  const supabase = makeSweepSupabase({ seasons: [{ id: "s1" }] });
  await runRaceEntryGeneratorSweep({
    supabase,
    isEnabled: async () => true,
    runGeneratorFn: async () => ({ races: 0, teams: 0, generated: 0, inserted: 0, skipped: 0 }),
  });
  assert.equal(supabase.writes.length, 1);
  assert.equal(supabase.writes[0].entries_written, 0);
});

test("#5246: flag_off skriver INTET i race_entry_generator_runs (ikke en rigtig kørsel)", async () => {
  const supabase = makeSweepSupabase({ seasons: [] });
  await runRaceEntryGeneratorSweep({
    supabase,
    isEnabled: async () => false,
    runGeneratorFn: async () => { throw new Error("burde ikke kaldes"); },
  });
  assert.equal(supabase.writes.length, 0);
});

test("#5246: no_active_season skriver INTET i race_entry_generator_runs", async () => {
  const supabase = makeSweepSupabase({ seasons: [] });
  await runRaceEntryGeneratorSweep({
    supabase,
    isEnabled: async () => true,
    runGeneratorFn: async () => { throw new Error("burde ikke kaldes"); },
  });
  assert.equal(supabase.writes.length, 0);
});

test("#5246: generator-fejl logges MED besked i error-feltet, og fejlen kastes stadig videre", async () => {
  const supabase = makeSweepSupabase({ seasons: [{ id: "s1" }] });
  await assert.rejects(
    () => runRaceEntryGeneratorSweep({
      supabase,
      isEnabled: async () => true,
      runGeneratorFn: async () => { throw new Error("race_entries insert boom"); },
    }),
    /race_entries insert boom/,
  );
  assert.equal(supabase.writes.length, 1);
  assert.match(supabase.writes[0].error, /race_entries insert boom/);
  assert.equal(supabase.writes[0].entries_written, 0);
});

test("#5246: en fejlende log-skrivning er best-effort — sweepen returnerer stadig normalt (ran:true)", async () => {
  const supabase = makeSweepSupabase({ seasons: [{ id: "s1" }], insertError: { message: "log insert boom" } });
  const captured = [];
  const r = await runRaceEntryGeneratorSweep({
    supabase,
    isEnabled: async () => true,
    runGeneratorFn: async () => ({ races: 1, teams: 1, generated: 1, inserted: 1, skipped: 0 }),
    captureExceptionFn: (err, ctx) => captured.push({ message: err.message, ctx }),
  });
  assert.equal(r.ran, true, "en fejlet log-skrivning må aldrig vælte en sweep der ellers lykkedes");
  assert.equal(captured.length, 1);
  assert.match(captured[0].message, /log insert boom/);
  assert.equal(captured[0].ctx.tags.stage, "run_log_write");
});
