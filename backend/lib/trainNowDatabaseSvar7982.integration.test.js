// #7982 trin 4a: "stedfortraederen svarer som databasen". Dommerens proeve (AGENTS.md regel 40),
// skrevet foer foerste kodelinje. Ejes af dommeren; byggeren aendrer den ikke.
//
// Saettet (trainNowSameResult7982.test.js) sammenligner den nye kode med den gamle mod en
// database-stedfortraeder skrevet i JavaScript. Det beviser kun noget om den rigtige database,
// hvis stedfortraederen svarer som databasen. Det bliver afgoerende i trin 4a: naar serveren selv
// regner datoens fem dag-felter, laeser den ikke laengere sine egne tal tilbage mellem dag-felterne.
//
// Denne proeve koerer de samme tryk som saettet, optager HVERT kald til en skrivende
// databasefunktion (registrering, frysning, gemme-kald, karantaene, afgang) med de praecise
// vaerdier, og afspiller dem i samme raekkefoelge mod en rigtig PostgreSQL 17 (PGlite) med
// repoets egne funktioner. Efter hvert kald sammenlignes:
//   1. funktionens svar,
//   2. hver raekke i de tabeller, funktionerne skriver i (evner, form og traethed, kvitteringer,
//      afregninger, dagsrapporter, datoens arbejde, loebsbelastning, historik, score),
// felt for felt mod stedfortraederens tilstand i samme oejeblik. Det, databasen ville have svaret
// paa naeste laesning, er altsaa det, stedfortraederen svarede. Afvigelser, der er kendte og uden
// betydning for motoren, staar i KENDTE nederst, hver med sin grund; alt andet er en fejl.
//
// Funktionerne er dem, der koerer i prod: md5(prosrc) er laest i prod 13/11 (kun laesning) og
// tjekkes her. Kolonnetyperne for evner, tilstand og score er prods (smallint), ikke fixturens.
// PGlite har én forbindelse: laase og samtidighed proeves ikke her (se trainNowInstant7737.pg17).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { SCENARIOS, seedState, createFake, canon, firstDifference } from "./trainNowSameResult7982.harness.js";

const file = async (name) => (await readFile(new URL(`../../database/${name}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

// md5(prosrc) i prod 13/11 kl. 15 UTC (laest af dommeren med SELECT). Flytter en funktion sig,
// skal dommeren laese igen og fryse igen: saa er det ikke laengere prods funktion, der proeves.
const PROD_SOURCE_MD5 = {
  commit_training_date_tick: "4c3999facdb7e213f55aa6084d173916",
  register_training_date_work: "622f3f202ee619e53adac9ed5d0f28e1",
  freeze_train_now_date_entries: "1b31c15091076df07090124ad1c5bb0a",
  quarantine_training_date_riders: "7cd91e92f0166f601e0b85cecd6c075a",
  depart_training_date_riders: "14ecccf6571fe6e806e486d88c3fbbb4",
  training_condition_injury_state: "2807aa1d2a7a65414ec4b6d0012c957f",
  training_frozen_slot_state: "9a6c6aae83b2675755c8dc0ae82f9a6b",
};
const REPLAYED = new Set(["register_training_date_work", "freeze_train_now_date_entries", "commit_training_date_tick", "quarantine_training_date_riders", "depart_training_date_riders"]);

// Prods kolonner for rytternes evner (information_schema 13/11). Fixturen har kun én evne.
const ABILITY_COLUMNS = ["climbing", "time_trial", "sprint", "punch", "endurance", "cobblestone", "acceleration", "recovery", "tactics", "positioning", "prolog", "flat", "tempo", "durability", "descending", "aggression", "hidden_potential", "teamwork", "leadership"];

async function newDb() {
  const db = new PGlite();
  await db.exec(await readFile(new URL("./__fixtures__/trainingHeldSchema.sql", import.meta.url), "utf8"));
  for (const name of ["2026-09-29-5928-training-condition-date.sql", "2026-09-29-5928-training-condition-partial.sql", "2026-09-29-5928-training-condition-recovery.sql", "2026-09-29-5928-training-condition-initialization.sql"]) await db.exec(await file(name));
  await db.exec("ALTER TABLE race_results ADD COLUMN rider_id uuid; ALTER TABLE training_day_runs ADD COLUMN id uuid DEFAULT gen_random_uuid(); ALTER TABLE app_config ADD COLUMN description text");
  for (const name of ["2026-09-30-5860-shared-race-day-recovery.sql", "2026-10-10-6439-training-follows-rider.sql", "2026-10-01-traen-nu-locks.sql"]) await db.exec(await file(name));
  await db.exec("CREATE TABLE race_entries(race_id uuid,rider_id uuid,team_id uuid,race_role text,is_auto_filled boolean DEFAULT false,auto_filled_source text, PRIMARY KEY(race_id,rider_id))");
  for (const name of ["2026-10-12-6490-rider-training-seen.sql", "2026-10-19-6504-departed-training-riders.sql", "2026-10-25-6461-train-now-whole-day.sql", "2026-11-09-7737-train-now-instant.sql", "2026-11-10-7737-train-now-bonus.sql", "2026-11-10-7737-train-now-instant-beta.sql"]) await db.exec(await file(name));
  // Trin 1 som auto-migrate koerer den: funktionen, den selvhelende blok og CREATE INDEX CONCURRENTLY hver for sig.
  const trin1 = await file("2026-11-12-7982-commit-training-date-tick-samlet-tjek.sql");
  const commit = trin1.indexOf("\nCOMMIT;\n") + "\nCOMMIT;\n".length;
  const heal = trin1.indexOf("END $$;", commit) + "END $$;".length;
  const [, wait, index] = trin1.slice(heal).replace(/^\s*--.*$/gm, "").trim().match(/^(SET lock_timeout = '\d+s';)\s*(CREATE INDEX CONCURRENTLY IF NOT EXISTS [^;]+;)$/) ?? [];
  assert.ok(commit > 9 && heal > commit && wait && index, "trin 1-migrationens dele fundet");
  await db.exec(trin1.slice(0, commit)); await db.exec(trin1.slice(commit, heal)); await db.exec(wait); await db.exec(index);
  for (const name of ["2026-11-13-7982-commit-training-date-tick-opslag-pr-rytter.sql", "2026-11-13-8089-ny-rytter-starttilstand.sql"]) await db.exec(await file(name));
  // Prods kolonnetyper dér, hvor fixturen er smallere eller bredere end prod.
  await db.exec(`ALTER TABLE rider_derived_abilities ALTER COLUMN climbing TYPE smallint;
    ${ABILITY_COLUMNS.filter((c) => c !== "climbing").map((c) => `ALTER TABLE rider_derived_abilities ADD COLUMN IF NOT EXISTS ${c} smallint;`).join("\n")}
    ALTER TABLE rider_derived_abilities ADD COLUMN IF NOT EXISTS ability_caps jsonb;
    ALTER TABLE rider_training_scores ALTER COLUMN score TYPE smallint;`);
  return db;
}

// ── Sammenligning ─────────────────────────────────────────────────────────────────────────────
const TIMESTAMP = /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/;
const tidy = (value) => {
  if (Array.isArray(value)) return value.map(tidy);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, tidy(value[key])]));
  if (typeof value === "string" && TIMESTAMP.test(value)) { const t = new Date(value.replace(" ", "T")); return Number.isNaN(+t) ? value : t.toISOString(); }
  return value ?? null;
};
// Tabellerne, de skrivende funktioner roerer, og hvad der kender en raekke.
const COMPARED = {
  rider_derived_abilities: ["rider_id"],
  rider_condition: ["rider_id"],
  training_rider_ticks: ["rider_id", "season_id", "game_day"],
  training_condition_settlements: ["rider_id", "season_id", "tick_date"],
  training_day_runs: ["team_id", "season_id", "game_day"],
  training_date_work: ["team_id", "season_id", "tick_date"],
  training_race_loads: ["rider_id", "race_id", "stage_number"],
  rider_derived_ability_history: ["rider_id", "snapshot_date", "source"],
  rider_ability_race_day_history: ["rider_id", "season_id", "game_day", "source"],
  rider_training_scores: ["rider_id", "season_id", "game_day"],
  training_train_now_locks: ["rider_id", "tick_date"],
};
// Tabeller, funktionerne kun laeser. De laegges ind fra stedfortraederens tilstand foer hvert kald.
const INPUT = {
  riders: ["id"], races: ["id"], app_config: ["key"], race_stage_schedule: ["race_id", "stage_number"], race_results: ["id"],
  race_incidents: ["race_id", "stage_number", "rider_id"], race_simulation_runs: ["id"], race_entries: ["race_id", "rider_id"],
  training_train_now_locks: ["rider_id", "tick_date"],
  // Loebsbelastningen skrives af loebsmotoren (uden for trykket) og lukkes af gemme-kaldet: den er baade
  // noget, funktionerne laeser, og noget, de skriver. Den sammenlignes efter hvert kald og bringes paa
  // linje foer det naeste, saa en etape, der koeres mellem to trin i et scenarie, ogsaa findes i databasen.
  training_race_loads: ["rider_id", "race_id", "stage_number"],
};

// Kendte forskelle uden betydning for motoren. Hver linje er "tabel.kolonne": grund.
const KENDTE = {
  // Ingen. Koert paa main 13/11 efter trin 3: efter tre rettelser af stedfortraederen (frysningens
  // raceIds og loebsdage, aftenkoerslens frist, registreringens stempler) er der ingen forskel i de
  // felter, stedfortraederen har. En ny linje her kraever en grund, dommeren har set og forstaaet.
};

async function columnsOf(db, table) {
  return (await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [table])).rows.map((row) => row.column_name);
}
// En kun-laest tabel bringes paa linje med stedfortraederen UDEN at slette raekker, der stadig
// findes (sletter man en rytter, tager databasen hans kvitteringer med). Kun raekker, der er
// aendret, roeres.
async function sync(db, table, rows, known, keys, seen) {
  const wanted = new Map((rows ?? []).map((row) => [keys.map((key) => String(row[key])).join("|"), JSON.stringify(row)]));
  const had = seen.get(table) ?? new Map();
  const cols = [...new Set((rows ?? []).flatMap((row) => Object.keys(row)))].filter((column) => known.includes(column));
  const match = `(${keys.map((key) => `t.${key}`).join(", ")}) = (SELECT ${keys.map((key) => `src.${key}`).join(", ")} FROM jsonb_populate_record(NULL::public.${table}, $1::jsonb) src)`;
  for (const [key, json] of had) if (!wanted.has(key)) await db.query(`DELETE FROM public.${table} t WHERE ${match}`, [json]);
  for (const [key, json] of wanted) {
    if (had.get(key) === json) continue;
    const others = cols.filter((column) => !keys.includes(column));
    const updated = had.has(key) && others.length
      ? await db.query(`UPDATE public.${table} t SET (${others.join(", ")}) = (SELECT ${others.map((c) => `src.${c}`).join(", ")} FROM jsonb_populate_record(NULL::public.${table}, $1::jsonb) src) WHERE ${match}`, [json]) : null;
    if (!updated?.affectedRows) await db.query(`INSERT INTO public.${table} (${cols.join(", ")}) SELECT ${cols.map((c) => `src.${c}`).join(", ")} FROM jsonb_populate_record(NULL::public.${table}, $1::jsonb) src`, [json]);
  }
  seen.set(table, wanted);
}
// Kun de kolonner, stedfortraederens raekker har, saettes; resten faar databasens egne standardvaerdier.
async function replace(db, table, rows, known) {
  await db.exec(`DELETE FROM public.${table}`);
  if (!rows?.length) return;
  const cols = [...new Set(rows.flatMap((row) => Object.keys(row)))].filter((column) => known.includes(column));
  await db.query(`INSERT INTO public.${table} (${cols.join(", ")}) SELECT ${cols.join(", ")} FROM jsonb_populate_recordset(NULL::public.${table}, $1::jsonb)`, [JSON.stringify(rows)]);
}
async function rowsOf(db, table) {
  return (await db.query(`SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) AS rows FROM public.${table} t`)).rows[0].rows;
}
async function call(db, base, args) {
  const { rows: [fn] } = await db.query("SELECT pg_get_function_arguments(p.oid) AS args, p.proretset AS setof FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname=$1", [base]);
  assert.ok(fn, `databasefunktionen ${base} findes`);
  const declared = fn.args.split(/,\s*(?=p_)/).map((part) => { const [, name, type] = part.match(/^(\w+)\s+(.+?)(?:\s+DEFAULT\s.*)?$/s) ?? []; return { name, type }; });
  const unknown = Object.keys(args).filter((name) => !declared.some((d) => d.name === name));
  assert.deepEqual(unknown, [], `${base}: argumenter databasen ikke kender`);
  const sent = declared.filter((d) => d.name in args);
  // Samme vej som PostgREST: ét json-dokument, pakket ud med funktionens egne typer.
  const sql = `SELECT to_jsonb(f) AS svar FROM jsonb_to_record($1::jsonb) AS r(${sent.map((d) => `${d.name} ${d.type}`).join(", ")}), LATERAL public.${base}(${sent.map((d) => `${d.name} => r.${d.name}`).join(", ")}) AS f`;
  try {
    const { rows } = await db.query(sql, [JSON.stringify(args)]);
    return { data: fn.setof ? rows.map((row) => row.svar) : rows[0]?.svar ?? null, error: null };
  } catch (err) { return { data: null, error: String(err.message) }; }
}

let comparedCells = 0; // hvor mange felter der faktisk er holdt op mod databasen (proeven maa ikke vaere tom)
const keyOf = (row, keys) => keys.map((key) => String(tidy(row[key]))).join("|");
function tableDifferences(table, keys, fakeRows, dbRows, shared) {
  const out = [];
  const byKey = new Map(dbRows.map((row) => [keyOf(row, keys), row]));
  if (fakeRows.length !== dbRows.length) out.push(`${table}: ${fakeRows.length} raekker i stedfortraederen, ${dbRows.length} i databasen`);
  for (const row of fakeRows) {
    const other = byKey.get(keyOf(row, keys));
    if (!other) { out.push(`${table}: raekken ${keyOf(row, keys).slice(-30)} findes ikke i databasen`); continue; }
    for (const column of shared) {
      if (`${table}.${column}` in KENDTE) continue;
      comparedCells += 1;
      const a = JSON.stringify(tidy(row[column])), b = JSON.stringify(tidy(other[column]));
      if (a !== b) { const d = firstDifference(JSON.parse(a), JSON.parse(b), column); out.push(`${table}.${d.path}: stedfortraeder ${JSON.stringify(d.expected)?.slice(0, 140)} | database ${JSON.stringify(d.actual)?.slice(0, 140)}`); }
    }
  }
  return out;
}

const dbs = [];
after(async () => { for (const db of dbs) await db.close(); });

test("databasens funktioner er dem, der koerer i prod (md5 af kildeteksten)", async () => {
  const db = await newDb(); dbs.push(db);
  for (const [name, md5] of Object.entries(PROD_SOURCE_MD5)) {
    const { rows } = await db.query("SELECT md5(p.prosrc) AS md5 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname=$1", [name]);
    assert.ok(rows.some((row) => row.md5 === md5), `${name}: repoets funktion er ikke den, der koerte i prod 13/11`);
  }
});

// De tryk, der afspilles. Scenariet koeres praecis som i saettet (samme frø, samme forloeb).
const CASES = ["lille_hold_uden_loeb", "stort_hold_beta_tryk", "stort_hold_almindeligt_tryk", "stort_hold_etape_koert", "to_tryk_samme_dato", "tryk_saa_aftenkoersel", "bundet_etape_koert", "etape_paa_datoens_foerste_loebsdag", "to_datoer"];

export async function replayScenario(name, { log = null } = {}) {
  const scenario = SCENARIOS[name];
  const state = seedState(scenario.seed);
  const fake = createFake(state, { failRpc: (ctx) => scenario.fail?.(ctx) === true });
  const db = await newDb(); dbs.push(db);
  const columns = {};
  for (const table of [...new Set([...Object.keys(INPUT), ...Object.keys(COMPARED)])]) columns[table] = await columnsOf(db, table);
  // Tilstanden tages, som den ville se ud efter en tur over nettet (JSON): en noegle uden vaerdi
  // findes ikke, praecis som i det, databasen faar og giver tilbage.
  const snapshot = (tables) => Object.fromEntries(tables.map((table) => [table, JSON.parse(JSON.stringify(state[table] ?? []))]));
  const seen = new Map();
  const calls = [];
  const real = fake.supabase.rpc;
  fake.supabase.rpc = (rpcName, args) => {
    const base = rpcName.replace(/^try_/, "");
    if (!REPLAYED.has(base)) return real(rpcName, args);
    const before = snapshot(Object.keys(INPUT));
    const pending = real(rpcName, args);
    const afterCall = snapshot(Object.keys(COMPARED));
    const entry = { base, args: structuredClone(args), before, after: afterCall, result: null };
    calls.push(entry);
    return Promise.resolve(pending).then((result) => { entry.result = structuredClone(result); return result; }, (err) => { entry.result = { data: null, error: { message: String(err.message) }, thrown: true }; throw err; });
  };
  // Udgangstilstanden: alle tabeller, databasen har, fyldes fra stedfortraederens frø.
  await db.exec("DELETE FROM public.app_config");
  for (const [table, keys] of Object.entries(INPUT)) await sync(db, table, state[table], columns[table], keys, seen);
  for (const table of Object.keys(COMPARED).filter((x) => !(x in INPUT))) await replace(db, table, state[table], columns[table]);
  const saved = { warn: console.warn, error: console.error, info: console.info, log: console.log };
  for (const key of Object.keys(saved)) console[key] = () => {};
  const out = [];
  try { await scenario.run(state, fake, out, () => { throw new Error("scenariet bruger flere tilstande; det kan ikke afspilles her"); }); } finally { Object.assign(console, saved); }

  const differences = [];
  const cellsBefore = comparedCells;
  for (const [n, entry] of calls.entries()) {
    const where = `${name}, kald ${n + 1} (${entry.base}${entry.base === "commit_training_date_tick" ? `, loebsdag ${entry.args.p_game_day}` : ""})`;
    // En fejl, dommeren har sproejtet ind i stedfortraederen, er ikke databasens svar: kaldet springes over.
    if (entry.result?.thrown) continue;
    for (const [table, keys] of Object.entries(INPUT)) await sync(db, table, entry.before[table], columns[table], keys, seen);
    const answer = await call(db, entry.base, entry.args);
    const fakeError = entry.result?.error?.message ?? null;
    if ((answer.error ?? null) !== fakeError && !(answer.error && fakeError && answer.error.includes(fakeError))) differences.push(`${where}: fejl. stedfortraeder ${JSON.stringify(fakeError)} | database ${JSON.stringify(answer.error)}`);
    else if (!answer.error) {
      // Hvilke ryttere gemme-kaldet tog med, svarer databasen paa uden at love en raekkefoelge
      // (listen samles uden ORDER BY). Den sammenlignes derfor som en maengde.
      const unordered = (value) => (value && Array.isArray(value.applied_rider_ids) ? { ...value, applied_rider_ids: [...value.applied_rider_ids].sort() } : value);
      const a = tidy(canon(unordered(entry.result.data))), b = tidy(canon(unordered(answer.data)));
      const shared = a && b && typeof a === "object" && !Array.isArray(a) && !Array.isArray(b) ? Object.keys(a).filter((key) => key in b) : null;
      const pick = (value) => (shared ? Object.fromEntries(shared.map((key) => [key, value[key]])) : value);
      const d = firstDifference(pick(a), pick(b), "svar");
      if (d && !(`svar.${entry.base}` in KENDTE)) differences.push(`${where}: ${d.path}. stedfortraeder ${JSON.stringify(d.expected)?.slice(0, 160)} | database ${JSON.stringify(d.actual)?.slice(0, 160)}`);
    }
    for (const [table, keys] of Object.entries(COMPARED)) {
      const fakeRows = entry.after[table];
      const dbRows = await rowsOf(db, table);
      const shared = [...new Set(fakeRows.flatMap((row) => Object.keys(row)))].filter((column) => columns[table].includes(column));
      for (const line of tableDifferences(table, keys, canon(fakeRows), canon(dbRows), shared)) differences.push(`${where}: ${line}`);
    }
  }
  if (log) log(`${name}: ${comparedCells - cellsBefore} felter sammenlignet; ${calls.length} kald afspillet (${calls.filter((c) => c.base === "commit_training_date_tick").length} gemme-kald), ${differences.length} afvigelser`);
  return { calls: calls.length, commits: calls.filter((c) => c.base === "commit_training_date_tick" && !c.result?.thrown).length, cells: comparedCells - cellsBefore, differences };
}

for (const name of CASES) {
  test(`stedfortraederen svarer som databasen: ${name}`, async () => {
    const { commits, cells, differences } = await replayScenario(name);
    assert.ok(commits >= 2, `${name}: mindst to gemme-kald blev afspillet (${commits})`);
    assert.ok(cells >= 1000, `${name}: mindst 1000 felter blev holdt op mod databasen (${cells})`);
    assert.deepEqual(differences.slice(0, 12), [], `${name}: ${differences.length} afvigelser mellem stedfortraederen og den rigtige database`);
  });
}

// En genregistrering af en dato, der allerede er registreret, aendrer intet i databasen. Derfor
// maa trykket kalde den faerre gange i trin 4a (saettet taeller den ikke som en skrivning).
test("en genregistrering af en registreret dato aendrer intet i databasen", async () => {
  const state = seedState(SCENARIOS.lille_hold_uden_loeb.seed);
  const db = await newDb(); dbs.push(db);
  for (const table of ["riders", "rider_condition", "rider_derived_abilities", "app_config"]) await replace(db, table, state[table], await columnsOf(db, table));
  const args = { p_team_id: state.teams[0].id, p_season_id: state.seasons[0].id, p_tick_date: "2026-11-09", p_game_days: [41, 42, 43, 44, 45], p_expected_rider_ids: state.riders.map((row) => row.id), p_deadline_at: "2026-11-10T01:00:00Z", p_registered_at: "2026-11-09T06:00:00Z" };
  const first = await call(db, "register_training_date_work", args);
  assert.equal(first.error, null);
  const dump = async () => JSON.stringify(tidy(Object.fromEntries(await Promise.all(["training_date_work", "rider_condition", "rider_derived_abilities", "training_rider_ticks", "training_day_runs"].map(async (table) => [table, await rowsOf(db, table)])))));
  const before = await dump();
  // Senere klokkeslaet, og en rytter har faaet ny form i mellemtiden: registreringen maa ikke flytte sig.
  await db.exec("UPDATE rider_condition SET form = form + 1 WHERE rider_id = (SELECT min(rider_id::text)::uuid FROM rider_condition)");
  const afterChange = await dump();
  const again = await call(db, "register_training_date_work", { ...args, p_registered_at: "2026-11-09T06:05:00Z" });
  assert.equal(again.error, null);
  assert.equal(await dump(), afterChange, "genregistreringen skrev intet");
  assert.notEqual(before, afterChange, "kontrol: aendringen imellem kunne ses");
  assert.equal(JSON.stringify(tidy(again.data)), JSON.stringify(tidy(first.data)), "genregistreringen svarer med den registrering, der staar");
});
