// #7859 · Spoiler-skjoldet: regler, migration (PGlite), notifikationer og ruter.
//
// Slukket kontakt = alt som i dag: ruterne svarer enabled: false, og
// notifikationerne skrives med vinderen og placeringen som før.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import express from "express";
import { PGlite } from "@electric-sql/pglite";
import { clearFlagStageCache } from "./featureStage.js";
import { emitRaceResultNotifications, emitStageResultNotifications } from "./notificationService.js";
import {
  cleanStages, createSpoilerShieldRouter, fetchShieldedRecipients, isMissingSpoilerStorage, isRaceShielded,
  raceStateFrom, readSettings, sanitizeSettingsPatch, settingsFromRow, SPOILER_SHIELD_FLAG_KEY, writeSettings,
} from "./spoilerShield7859.ts";

const RACE = "11111111-1111-4111-8111-111111111111";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// ── Rene regler ───────────────────────────────────────────────────────────

test("valgene har standarder: skjoldet er fra, en færdig etape åbner i Results", () => {
  assert.deepEqual(settingsFromRow(null), { shieldAll: false, openFinishedIn: "results" });
  assert.deepEqual(settingsFromRow({ shield_all: true, open_finished_in: "story" }), { shieldAll: true, openFinishedIn: "story" });
  assert.deepEqual(settingsFromRow({ shield_all: "yes", open_finished_in: "x" }), { shieldAll: false, openFinishedIn: "results" });
});

test("kontakten i løbets hoved vinder over valget for alle løb", () => {
  const on = { shieldAll: true, openFinishedIn: "results" as const };
  const off = { shieldAll: false, openFinishedIn: "results" as const };
  assert.equal(isRaceShielded(on, null), true);
  assert.equal(isRaceShielded(off, null), false);
  assert.equal(isRaceShielded(on, false), false);
  assert.equal(isRaceShielded(off, true), true);
  assert.deepEqual(raceStateFrom(off, { shield: true, opened_stages: [3, 1, 3, 0, 99, "2"] }), { shield: true, shielded: true, openedStages: [1, 3] });
  assert.deepEqual(cleanStages("1,2"), []);
});

test("PUT /settings tager kun kendte nøgler med rigtig type", () => {
  assert.deepEqual(sanitizeSettingsPatch({ shieldAll: true }), { ok: true, patch: { shieldAll: true } });
  assert.deepEqual(sanitizeSettingsPatch({ openFinishedIn: "story" }), { ok: true, patch: { openFinishedIn: "story" } });
  assert.equal(sanitizeSettingsPatch({ shieldAll: "on" }).ok, false);
  assert.equal(sanitizeSettingsPatch({ openFinishedIn: "film" }).ok, false);
  assert.equal(sanitizeSettingsPatch({ other: 1 }).ok, false);
  assert.equal(sanitizeSettingsPatch({}).ok, false);
  assert.equal(sanitizeSettingsPatch(null).ok, false);
});

test("manglende tabeller genkendes (deploy før migration), andre fejl gør ikke", () => {
  assert.equal(isMissingSpoilerStorage({ code: "42P01" }), true);
  assert.equal(isMissingSpoilerStorage({ code: "PGRST205" }), true);
  assert.equal(isMissingSpoilerStorage({ code: "PGRST202", message: "Could not find the function public.spoiler_open_stage_7859" }), true);
  assert.equal(isMissingSpoilerStorage({ code: "42883", message: "function other() does not exist" }), false);
  assert.equal(isMissingSpoilerStorage({ code: "23505", message: "duplicate" }), false);
  assert.equal(isMissingSpoilerStorage(null), false);
});

// ── Migrationen mod en rigtig Postgres (PGlite) ───────────────────────────

async function freshDb(t: { after: (fn: () => unknown) => void }) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE public.races(id uuid PRIMARY KEY);
    CREATE TABLE public.app_config(key text PRIMARY KEY, value jsonb, description text);
    INSERT INTO auth.users VALUES ('${A}'), ('${B}');
    INSERT INTO public.races VALUES ('${RACE}');
  `);
  const sql = await readFile(new URL("../../database/2026-11-16-7859-spoiler-shield.sql", import.meta.url), "utf8");
  await db.exec(sql);
  await db.exec(sql); // idempotent: anden kørsel må hverken fejle eller ændre noget
  return db;
}

test("migrationen: kontakten seedes off, RLS er slået til, kun service_role har adgang", async (t) => {
  const db = await freshDb(t);
  const flag = await db.query<{ value: unknown }>("SELECT value FROM public.app_config WHERE key = $1", [SPOILER_SHIELD_FLAG_KEY]);
  assert.deepEqual(flag.rows.map((r) => r.value), ["off"]);
  const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
    "SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('user_spoiler_shield_7859', 'user_spoiler_races_7859') ORDER BY relname");
  assert.deepEqual(rls.rows.map((r) => [r.relname, r.relrowsecurity]), [["user_spoiler_races_7859", true], ["user_spoiler_shield_7859", true]]);
  const grants = await db.query<{ grantee: string }>(
    "SELECT DISTINCT grantee FROM information_schema.role_table_grants WHERE table_name IN ('user_spoiler_shield_7859', 'user_spoiler_races_7859') AND grantee IN ('anon', 'authenticated', 'service_role') ORDER BY grantee");
  assert.deepEqual(grants.rows.map((r) => r.grantee), ["service_role"]);
  const exec = await db.query<{ r: string; ok: boolean }>(
    "SELECT r, has_function_privilege(r, 'public.spoiler_open_stage_7859(uuid,uuid,integer)', 'EXECUTE') AS ok FROM unnest(ARRAY['anon','authenticated','service_role']) r");
  assert.deepEqual(exec.rows.map((r) => [r.r, r.ok]), [["anon", false], ["authenticated", false], ["service_role", true]]);
});

test("migrationen: at åbne en etape kan kun tilføje, og kontakten i hovedet står urørt", async (t) => {
  const db = await freshDb(t);
  const open = async (stage: number) => (await db.query<{ s: number[] }>("SELECT public.spoiler_open_stage_7859($1, $2, $3) AS s", [A, RACE, stage])).rows[0].s;
  assert.deepEqual(await open(3), [3]);
  assert.deepEqual(await open(1), [1, 3]);
  assert.deepEqual(await open(3), [1, 3], "samme etape igen ændrer intet");
  await db.query("UPDATE public.user_spoiler_races_7859 SET shield = true WHERE user_id = $1", [A]);
  assert.deepEqual(await open(2), [1, 2, 3]);
  const row = await db.query<{ shield: boolean }>("SELECT shield FROM public.user_spoiler_races_7859 WHERE user_id = $1", [A]);
  assert.equal(row.rows[0].shield, true);
  await assert.rejects(() => open(0), /between 1 and 64/);
  await assert.rejects(() => db.query("INSERT INTO public.user_spoiler_shield_7859 (user_id, open_finished_in) VALUES ($1, 'film')", [B]));
});

// ── En lille supabase-forfalskning til notifikationer og ruter ────────────

type Row = Record<string, unknown>;
function fakeSupabase(tables: Record<string, Row[]>, { failOn = null as string | null } = {}) {
  const calls: string[] = [];
  function query(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let one = false;
    const run = async () => {
      calls.push(table);
      if (failOn === table) return { data: null, error: { code: "XX000", message: "boom" } };
      const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      return { data: one ? rows[0] ?? null : rows, error: null };
    };
    const q = {
      select() { return q; },
      eq(col: string, value: unknown) { filters.push((r) => r[col] === value); return q; },
      in(col: string, values: unknown[]) { filters.push((r) => values.includes(r[col])); return q; },
      order() { return q; },
      range() { return run(); },
      limit() { return run(); },
      maybeSingle() { one = true; return run(); },
      upsert(row: Row) {
        calls.push(`upsert:${table}`);
        const list = tables[table] ?? (tables[table] = []);
        const key = table === "user_spoiler_races_7859" ? ["user_id", "race_id"] : ["user_id"];
        const existing = list.find((r) => key.every((k) => r[k] === row[k]));
        if (existing) Object.assign(existing, row); else list.push({ ...row });
        return Promise.resolve({ error: null });
      },
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) { return run().then(resolve, reject); },
    };
    return q;
  }
  return {
    calls,
    from: (table: string) => query(table),
    async rpc(name: string, args: { p_user_id: string; p_race_id: string; p_stage: number }) {
      calls.push(`rpc:${name}`);
      const list = tables.user_spoiler_races_7859 ?? (tables.user_spoiler_races_7859 = []);
      let row = list.find((r) => r.user_id === args.p_user_id && r.race_id === args.p_race_id);
      if (!row) { row = { user_id: args.p_user_id, race_id: args.p_race_id, shield: null, opened_stages: [] }; list.push(row); }
      row.opened_stages = [...new Set([...(row.opened_stages as number[]), args.p_stage])].sort((a, b) => a - b);
      return { data: row.opened_stages, error: null };
    },
  };
}

function world(flag: string) {
  return {
    app_config: [{ key: SPOILER_SHIELD_FLAG_KEY, value: flag }],
    users: [{ id: A, role: "manager", is_beta_tester: true }, { id: B, role: "manager", is_beta_tester: false }, { id: C, role: "admin", is_beta_tester: false }],
    user_spoiler_shield_7859: [{ user_id: A, shield_all: true, open_finished_in: "results" }, { user_id: C, shield_all: true, open_finished_in: "story" }],
    user_spoiler_races_7859: [
      { user_id: B, race_id: RACE, shield: true, opened_stages: [2] },
      { user_id: C, race_id: RACE, shield: false, opened_stages: [] },
    ],
  };
}

test("modtagere med skjoldet: slukket kontakt = ingen (alt som i dag)", async () => {
  const supabase = fakeSupabase(world("off"));
  const out = await fetchShieldedRecipients({ supabase, raceId: RACE, userIds: [A, B, C], stageNumber: 3 });
  assert.deepEqual([...out], []);
  assert.deepEqual(supabase.calls, ["app_config"], "slukket kontakt læser intet andet");
});

test("modtagere med skjoldet: on = valget for alle løb, kontakten i hovedet vinder, åbnet etape er ikke skjult", async () => {
  const out = await fetchShieldedRecipients({ supabase: fakeSupabase(world("on")), raceId: RACE, userIds: [A, B, C], stageNumber: 3 });
  assert.deepEqual([...out].sort(), [A, B].sort(), "A: alle løb; B: kontakten i hovedet; C: slået fra i hovedet");
  const stage2 = await fetchShieldedRecipients({ supabase: fakeSupabase(world("on")), raceId: RACE, userIds: [A, B, C], stageNumber: 2 });
  assert.deepEqual([...stage2], [A], "B har allerede åbnet etape 2");
});

test("modtagere med skjoldet: beta = kun beta-testere og admins", async () => {
  const out = await fetchShieldedRecipients({ supabase: fakeSupabase(world("beta")), raceId: RACE, userIds: [A, B, C], stageNumber: 3 });
  assert.deepEqual([...out], [A], "B er ikke beta-tester; C er admin men har slået skjoldet fra i hovedet");
});

test("modtagere med skjoldet: en fejl giver ingen (som i dag) og meldes", async () => {
  const reported: unknown[] = [];
  const out = await fetchShieldedRecipients({
    supabase: fakeSupabase(world("on"), { failOn: "user_spoiler_shield_7859" }), raceId: RACE, userIds: [A, B], stageNumber: 1,
    reportError: (e) => reported.push(e),
  });
  assert.deepEqual([...out], []);
  assert.equal(reported.length, 1);
});

test("etape-notifikationen: med skjoldet neutral tekst uden rytter og placering, uden skjold som i dag", async () => {
  const sent: Array<{ userId: string; title: string; message: string; metadata?: object | null }> = [];
  await emitStageResultNotifications({
    supabase: {},
    race: { id: RACE, name: "Race X" },
    stageNumber: 3,
    totalStages: 5,
    notify: (async (n: { userId: string; title: string; message: string; metadata?: object | null }) => { sent.push(n); return { delivered: true }; }) as never,
    fetchStageParticipants: async () => [
      { userId: A, riderName: "Rider A", rank: 1 },
      { userId: B, riderName: "Rider B", rank: 4 },
    ],
    fetchStageNarrative: async () => ({ headlineText: "Rider A wins", ranksByUser: new Map([[A, [1]], [B, [4]]]), aboutUserIds: new Set([A, B]) }),
    fetchShielded: async () => new Set([A]),
  });
  const a = sent.find((n) => n.userId === A)!;
  const b = sent.find((n) => n.userId === B)!;
  assert.equal(a.title, "Stage result is in");
  assert.equal(a.message, "Stage 3 of Race X is done.");
  assert.equal((a.metadata as { messageCode?: string }).messageCode, "notif.stageResult.messageNoResult");
  assert.doesNotMatch(JSON.stringify(a), /Rider A|wins/);
  assert.match(`${b.title} ${b.message}`, /Rider B|position 4|placed 4th/, "uden skjold: som i dag");
});

test("løbs-notifikationen: med skjoldet uden de bedste ryttere og uden rubrik", async () => {
  const sent: Array<{ userId: string; title: string; message: string }> = [];
  await emitRaceResultNotifications({
    supabase: {},
    race: { id: RACE, name: "Race X" },
    notify: (async (n: { userId: string; title: string; message: string }) => { sent.push(n); return { delivered: true }; }) as never,
    fetchParticipatingManagers: async () => [A, B],
    fetchFirstTimeManagers: async () => new Set(),
    fetchRaceNarrative: async () => null,
    fetchTopResults: async () => new Map([[A, [{ riderName: "Rider A", rank: 1 }]], [B, [{ riderName: "Rider B", rank: 2 }]]]),
    fetchShielded: async () => new Set([A]),
  });
  const a = sent.find((n) => n.userId === A)!;
  assert.equal(a.message, "Race X has been run. View the result.");
  assert.doesNotMatch(a.message, /Rider A/);
  assert.match(sent.find((n) => n.userId === B)!.message, /Rider B/, "uden skjold: som i dag");
});

// ── Ruterne ───────────────────────────────────────────────────────────────

// AGENTS regel 16: testens skrivninger faar et fast ur, aldrig new Date().
const FIXED_NOW_ISO = "2026-11-17T12:00:00.000Z";

async function serve(t: { after: (fn: () => unknown) => void }, tables: Record<string, Row[]>, { beta = false, userId = A } = {}) {
  const supabase = fakeSupabase(tables);
  clearFlagStageCache({ client: supabase });
  const app = express();
  app.use(express.json());
  const requireAuth: express.RequestHandler = (req, _res, next) => { (req as express.Request & { user?: { id: string } }).user = { id: userId }; next(); };
  const pass: express.RequestHandler = (_req, _res, next) => next();
  app.use("/api/me/spoiler-shield", createSpoilerShieldRouter({ supabase, requireAuth, isViewerBetaTester: async () => beta, readLimiter: pass, writeLimiter: pass, nowIso: () => FIXED_NOW_ISO }));
  const srv = app.listen(0);
  t.after(() => srv.close());
  await new Promise((r) => srv.once("listening", r));
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}/api/me/spoiler-shield`;
  const call = async (path: string, init?: RequestInit) => {
    const res = await fetch(base + path, { ...init, headers: { "content-type": "application/json" } });
    return { status: res.status, body: await res.json() };
  };
  return { call, tables };
}

test("ruterne: slukket kontakt svarer enabled: false og afviser skrivninger", async (t) => {
  const { call } = await serve(t, world("off"));
  const got = await call(`/?raceId=${RACE}`);
  assert.equal(got.status, 200);
  assert.deepEqual(got.body, { enabled: false, available: false, settings: { shieldAll: false, openFinishedIn: "results" }, race: null });
  assert.equal((await call("/settings", { method: "PUT", body: JSON.stringify({ shieldAll: true }) })).status, 404);
  assert.equal((await call(`/races/${RACE}/opened`, { method: "POST", body: JSON.stringify({ stage: 1 }) })).status, 404);
});

test("ruterne: tændt kontakt læser og skriver kun den indloggedes rækker", async (t) => {
  const { call, tables } = await serve(t, world("on"), { userId: B });
  const got = await call(`/?raceId=${RACE}`);
  assert.deepEqual(got.body, { enabled: true, available: true, settings: { shieldAll: false, openFinishedIn: "results" }, race: { shield: true, shielded: true, openedStages: [2] } });
  const saved = await call("/settings", { method: "PUT", body: JSON.stringify({ openFinishedIn: "story" }) });
  assert.equal(saved.status, 200);
  // Kun det sendte felt skrives (Codex #8302); shield_all får tabellens standard (false) i Postgres.
  const rowB = tables.user_spoiler_shield_7859.find((r) => r.user_id === B)!;
  assert.deepEqual({ user_id: rowB.user_id, open_finished_in: rowB.open_finished_in }, { user_id: B, open_finished_in: "story" });
  assert.equal("shield_all" in rowB, false, "et felt kaldet ikke sendte, skrives ikke");
  assert.equal(rowB.updated_at, FIXED_NOW_ISO, "routeren bruger det injicerede ur (AGENTS regel 16)");
  const opened = await call(`/races/${RACE}/opened`, { method: "POST", body: JSON.stringify({ stage: 1 }) });
  assert.deepEqual(opened.body, { ok: true, openedStages: [1, 2] });
  assert.equal((await call(`/races/${RACE}`, { method: "PUT", body: JSON.stringify({ shield: null }) })).status, 200);
  assert.equal(tables.user_spoiler_races_7859.find((r) => r.user_id === B)!.shield, null);
  assert.equal(tables.user_spoiler_races_7859.find((r) => r.user_id === B)!.updated_at, FIXED_NOW_ISO, "også kontakten pr. løb");
  assert.deepEqual(tables.user_spoiler_races_7859.find((r) => r.user_id === B)!.opened_stages, [1, 2], "kontakten rører ikke de åbnede etaper");
});

test("ruterne: ugyldigt input giver 400", async (t) => {
  const { call } = await serve(t, world("on"));
  assert.equal((await call("/?raceId=nope")).status, 400);
  assert.equal((await call("/races/nope/opened", { method: "POST", body: JSON.stringify({ stage: 1 }) })).status, 400);
  assert.equal((await call(`/races/${RACE}/opened`, { method: "POST", body: JSON.stringify({ stage: 0 }) })).status, 400);
  assert.equal((await call(`/races/${RACE}`, { method: "PUT", body: JSON.stringify({ shield: "yes" }) })).status, 400);
  assert.equal((await call("/settings", { method: "PUT", body: JSON.stringify({ shieldAll: 1 }) })).status, 400);
});

test("ruterne: beta-stadiet gælder kun beta-testere", async (t) => {
  const tester = await serve(t, world("beta"), { beta: true });
  assert.equal((await tester.call("/")).body.enabled, true);
  const player = await serve(t, world("beta"), { beta: false });
  assert.equal((await player.call("/")).body.enabled, false);
});

test("writeSettings skriver kun de sendte felter, så to gem lige efter hinanden ikke overskriver hinanden (Codex #8302)", async () => {
  const supabase = fakeSupabase({ user_spoiler_shield_7859: [{ user_id: A, shield_all: false, open_finished_in: "results" }] });
  const [first, second] = await Promise.all([
    writeSettings(supabase as never, A, { shieldAll: true }, () => "t1"),
    writeSettings(supabase as never, A, { openFinishedIn: "story" }, () => "t2"),
  ]);
  assert.equal(first.available && second.available, true);
  const after = await readSettings(supabase as never, A);
  assert.deepEqual(after.settings, { shieldAll: true, openFinishedIn: "story" }, "begge valg står");
});
