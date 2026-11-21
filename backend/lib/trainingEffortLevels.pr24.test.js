// #7947 PR 2+4 (Let/Mellem/Haard): skrivestierne, det koerte niveau paa score-raekken,
// aldringsbremsens taelling og R16-dommerens opregning. Lukker Fable-dommens fund paa #8517
// (se #7947 og #8529): 1 (aldringsbremsen), 2 (R16), 4 (api.js) og 5 (de ekstra opslag).
//
// Bevis for "kontakten off = bit-identisk" (#7587): trainingEffortLevels7947b.golden.json er
// genereret af trainingEffortLevels7947b.golden.mjs paa MERGE-BASEN (se mergeBase i filen) i et
// separat, read-only worktree. Motorens hele dato er stadig bevist af PR 1's frosne facit
// (trainingEffortLevels.test.js, krav 1) og de oevrige goldens.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

import {
  EFFORT_LEVELS, TRAINING_EFFORT_LEVELS_KEY, effortForWrite, executedEffortForScore,
} from "./trainingEffortLevels.js";
import { programForChoice, sessionIntensityFor, RECOVERY_FOCUS, SESSION_INTENSITY_V3 } from "./trainingDayTypes.js";
import { computeSeasonLoad, loadSeasonDevelopmentLoad } from "./seasonDevelopmentLoad.js";
import { copyWeekDays } from "./trainingGroups.ts";
import { traeningsPas } from "./dommer6110.r16traening.mjs";
import {
  hash, OFF_FLAGS, programCellOutcome, groupCellOutcome, seasonLoadOutcome, CELL_CALLS, fakeSupabase,
} from "./trainingEffortLevels7947b.golden.mjs";
import { rawPairScoreRows, engineScoreRows, RAW_PAIRS } from "./trainingEffortLevels7947.golden.mjs";
import { rider as harnessRider } from "./trainNowSameResult7982.harness.js";

const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN = JSON.parse(readFileSync(join(here, "trainingEffortLevels7947b.golden.json"), "utf8"));
const ON = { training_effort_levels: "on" };

// Stedfortraederen skriver advarsler om manglende private parametre; de er ikke testens sag.
const quiet = async (fn) => {
  const { warn, log } = console;
  console.warn = () => {}; console.log = () => {};
  try { return await fn(); } finally { console.warn = warn; console.log = log; }
};

// ── Off = basen (frossen golden) ──────────────────────────────────────────────────────────────
describe("kontakten off = merge-basen bit for bit", () => {
  test("fixturen er fra en merge-base, ikke fra den nye kode", () => {
    assert.match(GOLDEN.mergeBase, /^[0-9a-f]{40}$/);
  });
  test("PUT /programs/cell med og uden indsats: samme svar og samme raekker som basen", async () => {
    for (const flag of OFF_FLAGS) assert.equal(hash(await programCellOutcome(flag)), GOLDEN.programCell[String(flag)], String(flag));
  });
  test("PUT /groups/:id/cell med og uden indsats: samme svar, gruppe og kopier som basen", async () => {
    for (const flag of OFF_FLAGS) assert.equal(hash(await groupCellOutcome(flag)), GOLDEN.groupCell[String(flag)], String(flag));
  });
  test("aldringsbremsens taelling uden koert niveau: samme som basen", async () => {
    assert.equal(hash(await seasonLoadOutcome()), GOLDEN.seasonLoad);
  });
});

// ── Skrivestierne (PR 2) ──────────────────────────────────────────────────────────────────────
function flagFake(value) {
  const reads = [];
  return {
    reads,
    from: (table) => ({ select: () => ({ eq: (_c, key) => ({ maybeSingle: async () => {
      reads.push(`${table}:${key}`);
      return { data: value === undefined ? null : { value }, error: null };
    } }) }) }),
  };
}

describe("effortForWrite", () => {
  test("ikke sendt: intet opslag, indsatsen roeres ikke", async () => {
    const fake = flagFake("on");
    assert.deepEqual(await effortForWrite(fake, undefined), { ok: true, effort: undefined });
    assert.deepEqual(fake.reads, []);
  });
  test("slukket (manglende, off, beta): feltet ignoreres, ogsaa et ugyldigt", async () => {
    for (const flag of [undefined, "off", "beta", true]) {
      for (const effort of [...EFFORT_LEVELS, null, "bogus", 7]) {
        const fake = flagFake(flag);
        assert.deepEqual(await effortForWrite(fake, effort), { ok: true, effort: undefined }, `${flag} ${effort}`);
        assert.deepEqual(fake.reads, [`app_config:${TRAINING_EFFORT_LEVELS_KEY}`]);
      }
    }
  });
  test("on: easy/normal/hard og null gemmes; alt andet afvises", async () => {
    for (const effort of [...EFFORT_LEVELS, null]) {
      assert.deepEqual(await effortForWrite(flagFake("on"), effort), { ok: true, effort });
    }
    for (const effort of ["rest", "recovery", "race", "HARD", "", 2, {}]) {
      assert.deepEqual(await effortForWrite(flagFake("on"), effort), { ok: false, reason: "invalid_effort" }, String(effort));
    }
  });
  test("api.js: slukket giver praecis dagens programForChoice-kald; on giver det valgte niveau", () => {
    // resolveTrainingWrite kalder programForChoice({ ..., effort: effort ?? null, effortLevels: effort !== undefined }).
    const call = (session, effort) => programForChoice({ dayType: "training", session, effort: effort ?? null, effortLevels: effort !== undefined });
    for (const session of Object.keys(sessionIntensityFor({ catalogV3: false }))) {
      const dayType = ["technique", "aero", "loebslaere"].includes(session) ? "skill" : "training";
      const today = programForChoice({ dayType, session });
      const via = (effort) => programForChoice({ dayType, session, effort: effort ?? null, effortLevels: effort !== undefined });
      assert.deepEqual(via(undefined), today, session);
      assert.deepEqual(via(null), today, session);
      for (const effort of EFFORT_LEVELS) assert.deepEqual(via(effort), { ok: true, focus: session, intensity: effort }, `${session} ${effort}`);
    }
    assert.equal(call("endurance", "hard").intensity, "hard");
  });
  test("api.js: begge skrivestier til training_plans gaar gennem effortForWrite", () => {
    const src = readFileSync(join(here, "..", "routes", "api.js"), "utf8").replace(/\r\n/g, "\n");
    const calls = src.match(/resolveTrainingWrite\(req\.body[^\n]*/g) ?? [];
    assert.equal(calls.length, 2);
    for (const line of calls) assert.match(line, /, effortWrite\.effort\);$/);
    assert.equal((src.match(/const effortWrite = await effortForWrite\(supabase, req\.body\?\.effort\);/g) ?? []).length, 2);
  });
});

describe("felterne med kontakten on", () => {
  test("programfeltet: indsats paa ugedag og felt gemmes, null nulstiller, ugyldig giver 400", async () => {
    const { answers, state } = await programCellOutcome("on");
    const statuses = answers.map((a) => a.status);
    CELL_CALLS.forEach((body, i) => {
      const expected = body.effort === "bogus" ? 400 : 200;
      assert.equal(statuses[i], expected, JSON.stringify(body));
      assert.equal(statuses[i + CELL_CALLS.length], expected, JSON.stringify(body));
    });
    assert.deepEqual(answers.filter((a) => a.status === 400).map((a) => a.body.error), ["invalid_effort", "invalid_effort"]);
    for (const riderId of ["r1", "r2"]) {
      const days = state.training_week_plans.find((r) => r.rider_id === riderId).days;
      assert.equal(days.mon.effort, "hard", riderId);
      assert.equal(days.mon.intensity, "easy", "cellens intensity forbliver sessionens standardniveau");
      assert.deepEqual(days.tue.slotEfforts, [null, null, "easy", null, null], riderId);
      assert.equal(days.thu.slotEfforts?.[1], "normal", riderId);
      assert.equal(days.wed.effort, undefined, "det ugyldige kald skrev intet");
    }
  });
  test("gruppefeltet: indsatsen gemmes paa gruppen og foelger med i hver foelgende rytters kopi", async () => {
    const { answers, state } = await groupCellOutcome("on");
    assert.deepEqual(answers.map((a) => a.status), CELL_CALLS.map((b) => (b.effort === "bogus" ? 400 : 200)));
    const group = state.training_groups.find((g) => g.id === "g1");
    assert.equal(group.days.mon.effort, "hard");
    for (const riderId of ["r1", "r2"]) {
      const days = state.training_week_plans.find((r) => r.rider_id === riderId).days;
      assert.deepEqual(days, group.days, riderId);
    }
    assert.equal(state.training_week_plans.some((r) => r.rider_id === "r3"), false, "en rytter der ikke foelger gruppen faar ingen kopi");
  });
  test("copyWeekDays: kopien bevarer indsats-noeglerne og deler ingen arrays", () => {
    const days = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((w) => [w, { session: "endurance", intensity: "easy" }]));
    days.mon = { ...days.mon, effort: "hard", slotEfforts: [null, "easy", null, null, null] };
    const copy = copyWeekDays(days);
    assert.deepEqual(copy, days);
    assert.notEqual(copy.mon.slotEfforts, days.mon.slotEfforts);
    assert.deepEqual(Object.keys(copyWeekDays({ ...days, mon: { session: "endurance", intensity: "easy" } }).mon), ["session", "intensity"]);
  });
});

// ── Det koerte niveau paa score-raekken (PR 4) ────────────────────────────────────────────────
describe("motoren gemmer det koerte niveau", () => {
  test("executedEffortForScore: kun easy/normal/hard, alt andet er null", () => {
    for (const level of EFFORT_LEVELS) assert.equal(executedEffortForScore(level), level);
    for (const other of ["rest", "recovery", "race", "unknown_pending", null, undefined]) assert.equal(executedEffortForScore(other), null);
  });
  test("off (manglende, off, beta): ingen score-raekke faar noeglen intensity", async () => {
    for (const flags of [{}, { training_effort_levels: "off" }, { training_effort_levels: "beta" }]) {
      for (const way of ["plans", "cells"]) {
        const rows = (await quiet(() => rawPairScoreRows(way, { flags }))).scores;
        assert.ok(rows.length > 0);
        assert.ok(rows.every((row) => !("intensity" in row)), `${way} ${JSON.stringify(flags)}`);
      }
    }
  });
  // Det gemte niveau er det motoren KOERTE (kvitteringens intensitet), ogsaa naar
  // traethedsgraensen har sat en traet rytter ned; ellers er det parrets niveau.
  test("on: en plan og en programcelle paa andet niveau gemmer det koerte niveau (Lang tur haardt osv.)", async () => {
    const pairRiders = new Set(RAW_PAIRS.map((_, n) => harnessRider(n)));
    for (const way of ["plans", "cells"]) {
      const { scores, receipts } = await quiet(() => rawPairScoreRows(way, { flags: ON }));
      const rows = scores.filter((r) => r.was_race_day === false && pairRiders.has(r.rider_id));
      assert.ok(rows.length > 0, `${way}: de raa par giver score-raekker`);
      for (const row of rows) {
        const receipt = receipts.find((t) => t.rider_id === row.rider_id && t.game_day === row.game_day)?.report;
        assert.ok(receipt, `${way} ${row.session}: kvittering`);
        assert.equal(row.intensity, executedEffortForScore(receipt.intensity), `${way} ${row.session}`);
      }
      // Lang tur paa Haard (raa par 1) koeres og gemmes haardt: det tabel-niveauet aldrig ville sige.
      const longHard = rows.filter((r) => r.rider_id === harnessRider(1));
      assert.ok(longHard.length > 0 && longHard.every((r) => r.session === "endurance" && r.intensity === "hard"), way);
    }
  });
  test("on: standardniveau gemmes som standardniveauet; loebsdage og restitution har null", async () => {
    const rows = await quiet(() => engineScoreRows("standard", { flags: ON }));
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.ok("intensity" in row, "med kontakten on har hver raekke fra datoens pas noeglen");
      if (row.was_race_day || row.session == null || row.session === RECOVERY_FOCUS) assert.equal(row.intensity, null, JSON.stringify(row));
      else assert.ok(EFFORT_LEVELS.includes(row.intensity), JSON.stringify(row));
    }
  });
});

// ── Aldringsbremsen taeller det koerte niveau (PR 4) ──────────────────────────────────────────
describe("aldringsbremsen", () => {
  const t = (over) => ({ rider_id: "a", day_type: "training", was_race_day: false, game_day: null, tick_date: "2026-10-01", ...over });
  test("koert niveau foer tabel-niveau: Lang tur haardt taeller, VO2max let taeller ikke, null = tabellen", () => {
    const load = computeSeasonLoad({
      trainingRows: [
        t({ session: "endurance", intensity: "hard", tick_date: "2026-10-01" }),
        t({ session: "vo2max", intensity: "easy", tick_date: "2026-10-02" }),
        t({ session: "vo2max", intensity: "normal", tick_date: "2026-10-03" }),
        t({ session: "vo2max", intensity: null, tick_date: "2026-10-04" }),
        t({ session: "vo2max", tick_date: "2026-10-05" }),
        t({ session: "tempo", intensity: "hard", tick_date: "2026-10-06" }),
        t({ session: "endurance", intensity: "hard", tick_date: "2026-10-07", was_race_day: true }),
        t({ session: "technique", intensity: "hard", tick_date: "2026-10-08", day_type: "skill" }),
      ],
    });
    // Lang tur koert haardt, VO2max uden koert niveau (to), Tempo koert haardt.
    assert.deepEqual(load.get("a"), { raceDays: 0, hardDays: 4 });
  });

  function mock(tables, { missingIntensity = false } = {}) {
    const base = fakeSupabase(tables);
    // Uden kolonnen svarer databasen ingen intensity.
    const withoutColumn = fakeSupabase({ ...tables, rider_training_scores: tables.rider_training_scores.map(({ intensity: _i, ...row }) => row) });
    return {
      from(table) {
        const b = base.from(table);
        if (!missingIntensity || table !== "rider_training_scores") return b;
        return { select: (cols) => {
          if (String(cols).includes("intensity")) {
            const fail = { eq: () => fail, in: () => fail, gt: () => fail, order: () => fail,
              limit: async () => ({ data: null, error: { code: "42703", message: "column rider_training_scores.intensity does not exist" } }) };
            return fail;
          }
          return withoutColumn.from(table).select(cols);
        } };
      },
    };
  }
  const rows = () => [
    { id: "t1", rider_id: "a", season_id: "s4", day_type: "training", was_race_day: false, session: "endurance", intensity: "hard", game_day: 1, tick_date: "d" },
    { id: "t2", rider_id: "a", season_id: "s4", day_type: "training", was_race_day: false, session: "vo2max", intensity: "easy", game_day: 2, tick_date: "d" },
    { id: "t3", rider_id: "a", season_id: "s4", day_type: "training", was_race_day: false, session: "vo2max", intensity: null, game_day: 3, tick_date: "d" },
    { id: "t4", rider_id: "a", season_id: "s4", day_type: "training", was_race_day: false, session: "vo2max", intensity: "hard", game_day: 4, tick_date: "d" },
    { id: "t5", rider_id: "a", season_id: "s3", day_type: "training", was_race_day: false, session: "endurance", intensity: "hard", game_day: 5, tick_date: "d" },
  ];
  test("loadSeasonDevelopmentLoad henter ogsaa et haardt koert pas paa en let session, uden dubletter", async () => {
    const out = await loadSeasonDevelopmentLoad({ supabase: mock({ seasons: [{ id: "s4", number: 4 }], races: [], rider_training_scores: rows() }), seasonId: "s4" });
    assert.deepEqual(out.byRider.get("a"), { raceDays: 0, hardDays: 3 }, "t1 (koert haardt), t3 (tabel), t4; ikke t2 (koert let) eller t5 (anden saeson)");
  });
  test("mangler kolonnen endnu (deploy foer auto-migrate): tabel-niveauet som foer, ingen fejl", async () => {
    const out = await loadSeasonDevelopmentLoad({ supabase: mock({ seasons: [{ id: "s4", number: 4 }], races: [], rider_training_scores: rows() }, { missingIntensity: true }), seasonId: "s4" });
    assert.deepEqual(out.byRider.get("a"), { raceDays: 0, hardDays: 3 }, "tabellen: t2, t3, t4 er VO2max");
  });
});

// ── R16-dommeren opregner alle sessioner x tre niveauer (Fable fund 2) ────────────────────────
test("R16: dommerens pas er hver session x Let/Mellem/Haard i begge kataloger, plus restitution", async () => {
  const pas = await traeningsPas();
  for (const [katalog, catalogV3] of [["i dag", false], ["v3", true]]) {
    const tabel = sessionIntensityFor({ catalogV3 });
    const mine = pas.filter((p) => p.katalog === katalog);
    for (const [session, standard] of Object.entries(tabel)) {
      const levels = mine.filter((p) => p.program.focus === session).map((p) => p.niveau).sort();
      assert.deepEqual(levels, [...EFFORT_LEVELS].sort(), `${katalog} ${session}`);
      for (const p of mine.filter((x) => x.program.focus === session)) {
        assert.equal(p.program.intensity, p.niveau);
        assert.equal(p.standard, p.niveau === standard, `${katalog} ${session} ${p.niveau}`);
      }
    }
    assert.equal(mine.filter((p) => p.program.focus === RECOVERY_FOCUS).length, 1, `${katalog}: restitution har eet niveau`);
    assert.equal(mine.length, Object.keys(tabel).length * EFFORT_LEVELS.length + 1);
  }
  assert.ok(Object.values(SESSION_INTENSITY_V3).includes("hard"));
});

// ── Migrationen (PGlite = PostgreSQL 17) ──────────────────────────────────────────────────────
const file = async (name) => (await readFile(new URL(`../../database/${name}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const MIGRATION = "2026-11-21-7947-effort-executed-level.sql";
const BASE_1118 = "2026-11-18-7982-race-session-no-provisional.sql";
const OLD_INSERT = "INSERT INTO public.rider_training_scores(rider_id,team_id,season_id,tick_date,game_day,score,session,day_type,was_race_day,intention,contributions)\n    SELECT rider_id,team_id,season_id,tick_date,game_day,score,session,day_type,was_race_day,intention,contributions FROM";
const NEW_INSERT = "INSERT INTO public.rider_training_scores(rider_id,team_id,season_id,tick_date,game_day,score,session,day_type,was_race_day,intention,contributions,intensity)\n    SELECT rider_id,team_id,season_id,tick_date,game_day,score,session,day_type,was_race_day,intention,contributions,intensity FROM";

async function frozenSql(name, as) {
  const source = await file(name);
  const start = source.indexOf("CREATE OR REPLACE FUNCTION public.commit_training_date_tick(");
  const end = source.indexOf("$$;", start) + 3;
  return source.slice(start, end).replace("public.commit_training_date_tick(", `public.${as}(`);
}

async function applyTrin1(db) {
  const sql = await file("2026-11-12-7982-commit-training-date-tick-samlet-tjek.sql");
  const commit = sql.indexOf("\nCOMMIT;\n") + "\nCOMMIT;\n".length;
  const heal = sql.indexOf("END $$;", commit) + "END $$;".length;
  const tail = sql.slice(heal).replace(/^\s*--.*$/gm, "").trim();
  const [, wait, index] = tail.match(/^(SET lock_timeout = '\d+s';)\s*(CREATE INDEX CONCURRENTLY IF NOT EXISTS [^;]+;)$/) ?? [];
  await db.exec(sql.slice(0, commit)); await db.exec(sql.slice(commit, heal)); await db.exec(wait); await db.exec(index);
}

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const TEAM = id(1), SEASON = id(900), RIDERS = [11, 12].map(id), DATE = "2026-11-09", DAYS = [41, 42, 43, 44, 45];
const j = (x) => `'${JSON.stringify(x).replace(/'/g, "''")}'::jsonb`;

async function newDb() {
  const db = new PGlite();
  await db.exec(await readFile(new URL("./__fixtures__/trainingHeldSchema.sql", import.meta.url), "utf8"));
  for (const name of ["2026-09-29-5928-training-condition-date.sql", "2026-09-29-5928-training-condition-partial.sql", "2026-09-29-5928-training-condition-recovery.sql", "2026-09-29-5928-training-condition-initialization.sql"]) await db.exec(await file(name));
  await db.exec("ALTER TABLE race_results ADD COLUMN rider_id uuid; ALTER TABLE training_day_runs ADD COLUMN id uuid DEFAULT gen_random_uuid(); ALTER TABLE app_config ADD COLUMN description text");
  for (const name of ["2026-09-30-5860-shared-race-day-recovery.sql", "2026-10-10-6439-training-follows-rider.sql", "2026-10-01-traen-nu-locks.sql"]) await db.exec(await file(name));
  await db.exec("CREATE TABLE race_entries(race_id uuid,rider_id uuid,team_id uuid,race_role text, PRIMARY KEY(race_id,rider_id))");
  await db.exec(await file("2026-11-09-7737-train-now-instant.sql"));
  await applyTrin1(db);
  for (const name of ["2026-11-13-7982-commit-training-date-tick-opslag-pr-rytter.sql", "2026-11-15-7982-settle-race-session.sql", BASE_1118]) await db.exec(await file(name));
  await db.exec(await frozenSql(BASE_1118, "commit_training_date_tick_1118"));
  await db.exec(await file(MIGRATION));
  await db.exec(await file(MIGRATION)); // idempotent
  await db.exec(`INSERT INTO riders(id,team_id) VALUES ${RIDERS.map((r) => `('${r}','${TEAM}')`).join(",")};
    INSERT INTO rider_derived_abilities VALUES ${RIDERS.map((r) => `('${r}',50,'{}')`).join(",")};
    INSERT INTO rider_condition(rider_id,form,fatigue,updated_at) VALUES ${RIDERS.map((r) => `('${r}',50,32,'2026-11-08T20:00:00Z')`).join(",")};`);
  return db;
}

async function commitDay(db, fn, scores) {
  const { opening_conditions: openings } = (await db.query(`SELECT register_training_date_work('${TEAM}','${SEASON}','${DATE}','{${DAYS}}','{${RIDERS.join(",")}}'::uuid[],NULL,'2026-11-09T14:00:00Z') AS w`)).rows[0].w;
  const report = { condition_per_date: true, riders: RIDERS.map((r) => ({
    rider_id: r, game_day: 41, intensity: "normal", condition_before_date: openings[r] ?? null, condition_observed: openings[r] ?? null, missing_evidence: [],
  })) };
  await db.query(`SELECT ${fn}('${TEAM}','${SEASON}','senior',41,'${DATE}','{${DAYS}}','assistant',${j(report)},'[]','[]','[]','[]',${j(scores)},'[]',false,'2026-11-09T14:01:00Z') AS r`);
  return (await db.query("SELECT rider_id,session,day_type,was_race_day,score,intensity FROM rider_training_scores ORDER BY rider_id")).rows;
}

const score = (rider, over = {}) => ({
  rider_id: rider, team_id: TEAM, season_id: SEASON, tick_date: DATE, game_day: 41, score: 60, session: "endurance",
  day_type: "training", was_race_day: false, intention: null, contributions: [], ...over,
});

describe("migrationen 2026-11-21 (PGlite)", () => {
  let db;
  test("kolonnen er additiv, og funktionen er 18/11-kroppen med kun INSERT-linjen aendret", async () => {
    db = await newDb();
    const cols = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='rider_training_scores' ORDER BY ordinal_position")).rows.map((r) => r.column_name);
    assert.equal(cols.at(-1), "intensity");
    const migrated = (await db.query("SELECT prosrc FROM pg_proc WHERE proname='commit_training_date_tick'")).rows[0].prosrc;
    const frozen = (await db.query("SELECT prosrc FROM pg_proc WHERE proname='commit_training_date_tick_1118'")).rows[0].prosrc;
    assert.equal(frozen.split(OLD_INSERT).length, 2);
    assert.equal(migrated, frozen.replace(OLD_INSERT, NEW_INSERT));
    const sql = await file(MIGRATION);
    assert.doesNotMatch(sql, /POLICY|ROW LEVEL SECURITY|SECURITY DEFINER|DROP |DELETE |TRUNCATE/i);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS intensity/);
  });

  test("uden noeglen (kontakten off) giver den nye funktion samme raekker som 18/11-udgaven", async () => {
    const out = {};
    for (const fn of ["commit_training_date_tick_1118", "commit_training_date_tick"]) {
      await db.exec("BEGIN");
      try { out[fn] = await commitDay(db, fn, RIDERS.map((r) => score(r))); } finally { await db.exec("ROLLBACK"); }
    }
    assert.deepEqual(out.commit_training_date_tick, out.commit_training_date_tick_1118);
    assert.ok(out.commit_training_date_tick.every((r) => r.intensity === null));
  });

  test("med noeglen (kontakten on) gemmes det koerte niveau; et ugyldigt niveau afvises af databasen", async () => {
    await db.exec("BEGIN");
    try {
      const rows = await commitDay(db, "commit_training_date_tick", [score(RIDERS[0], { intensity: "hard" }), score(RIDERS[1], { intensity: null })]);
      assert.deepEqual(rows.map((r) => r.intensity), ["hard", null]);
    } finally { await db.exec("ROLLBACK"); }
    await assert.rejects(() => db.exec(`INSERT INTO rider_training_scores(rider_id,intensity) VALUES('${RIDERS[0]}','rest')`), /check constraint/i);
  });
});
