import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = (name) => readFile(new URL("../../database/" + name, import.meta.url), "utf8");
const id = (n) => "00000000-0000-0000-0000-" + String(n).padStart(12, "0");
const cases = [
  { user: 1, conversations: [10], messages: [21, 23] },
  { user: 2, conversations: [10], messages: [21, 22, 23] },
  { user: 3, conversations: [11], messages: [24] },
  { user: 5, conversations: [], messages: [] },
  { user: 6, conversations: [10], messages: [21, 22, 23] },
];

async function visibleRows(db, user) {
  await db.query("SELECT set_config('test.actor', $1, false)", [id(user)]);
  await db.exec("SET ROLE authenticated");
  try {
    const result = async (table) => (await db.query("SELECT id::text FROM public." + table + " ORDER BY id"))
      .rows.map((row) => Number(row.id.slice(-12)));
    return { user, conversations: await result("dm_conversations"), messages: await result("dm_messages") };
  } finally {
    await db.exec("RESET ROLE");
  }
}

test("the advisor migration preserves DM RLS on both applications", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users(id uuid PRIMARY KEY);
      GRANT USAGE ON SCHEMA auth TO authenticated;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
        AS $$ SELECT nullif(current_setting('test.actor', true), '')::uuid $$;
      CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE
        AS $$ SELECT auth.uid() = '${id(6)}'::uuid $$;
      CREATE FUNCTION public.training_runs_from_ticks_6490(uuid[], date, date, boolean)
        RETURNS int LANGUAGE sql STABLE AS $$ SELECT 1 $$;
      INSERT INTO auth.users VALUES ${[1, 2, 3, 4, 5, 6].map((n) => "('" + id(n) + "')").join(", ")};
    `);
    await db.exec(await migration("2026-09-08-3200-manager-dm.sql"));
    await db.exec(`
      INSERT INTO public.dm_conversations (id, participant_a, participant_b)
        VALUES ('${id(10)}','${id(1)}','${id(2)}'), ('${id(11)}','${id(3)}','${id(4)}');
      INSERT INTO public.dm_messages (id, conversation_id, sender_id, body, created_at)
        VALUES ('${id(21)}','${id(10)}','${id(2)}','before','2026-11-25 07:59Z'),
               ('${id(22)}','${id(10)}','${id(2)}','boundary','2026-11-25 08:00Z'),
               ('${id(23)}','${id(10)}','${id(1)}','reverse','2026-11-25 08:01Z'),
               ('${id(24)}','${id(11)}','${id(4)}','private','2026-11-25 08:01Z');
      INSERT INTO public.dm_blocks (blocker_id, blocked_id, created_at)
        VALUES ('${id(1)}','${id(2)}','2026-11-25 08:00Z');
      INSERT INTO public.dm_reports (conversation_id, reporter_id)
        VALUES ('${id(10)}','${id(1)}');
    `);
    const verifyAccess = async () => {
      for (const expected of cases) {
        assert.deepEqual(await visibleRows(db, expected.user), expected);
      }
      await db.exec("SET ROLE authenticated");
      try {
        await assert.rejects(db.exec("DELETE FROM public.dm_messages"), { code: "42501" });
      } finally {
        await db.exec("RESET ROLE");
      }
      await db.exec("SET ROLE anon");
      try {
        await assert.rejects(db.exec("SELECT id FROM public.dm_messages"), { code: "42501" });
      } finally {
        await db.exec("RESET ROLE");
      }
    };

    await verifyAccess();
    const sql = await migration("2026-11-26-8741-advisor-hardening.sql");
    await db.exec(sql);
    await verifyAccess();

    await db.exec(`
      CREATE FUNCTION public.get_team_result_history_page(uuid, integer, integer)
        RETURNS int LANGUAGE sql STABLE AS $$ SELECT 1 $$;
    `);
    await db.exec(sql);
    await verifyAccess();

    const policies = await db.query(`
      SELECT tablename, cmd, roles::text, permissive FROM pg_policies
      WHERE schemaname = 'public' AND tablename IN ('dm_conversations', 'dm_messages')
      ORDER BY tablename
    `);
    assert.deepEqual(policies.rows, ["dm_conversations", "dm_messages"].map((tablename) => ({
      tablename, cmd: "SELECT", roles: "{authenticated}", permissive: "PERMISSIVE",
    })));
    const paths = await db.query(`
      SELECT proconfig FROM pg_proc WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('get_team_result_history_page', 'training_runs_from_ticks_6490')
    `);
    assert.deepEqual(paths.rows, Array(2).fill({ proconfig: ["search_path=public, pg_catalog"] }));
  } finally {
    await db.close();
  }
});
