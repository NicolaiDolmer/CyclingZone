// #7778 · Visningsvalg paa brugeren: allowlist, type-tjek og flet.
import test from "node:test";
import assert from "node:assert/strict";
import { UI_PREF_KEYS, isMissingUiPrefsTable, publicUiPrefs, readUiPrefs, sanitizeUiPrefsPatch, writeUiPrefs } from "./userUiPrefs.js";

function fakeSupabase({ row = null, readError = null, writeError = null } = {}) {
  const calls = { upserts: [] };
  return {
    calls,
    from(table) {
      assert.equal(table, "user_ui_prefs");
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle: async () => ({ data: row, error: readError }),
        upsert: async (value, opts) => {
          calls.upserts.push({ value, opts });
          return { error: writeError };
        },
      };
    },
  };
}

test("allowlisten har ruten og intet andet", () => {
  assert.deepEqual([...UI_PREF_KEYS], ["race_route_hidden"]);
});

test("sanitize: kendt noegle med rigtig type gaar igennem", () => {
  assert.deepEqual(sanitizeUiPrefsPatch({ prefs: { race_route_hidden: true } }), { ok: true, patch: { race_route_hidden: true } });
});

test("sanitize: ukendt noegle, forkert type og tomt/forkert body afvises", () => {
  assert.equal(sanitizeUiPrefsPatch({ prefs: { theme: "dark" } }).errorCode, "ui_prefs_unknown_keys");
  assert.equal(sanitizeUiPrefsPatch({ prefs: { race_route_hidden: "yes" } }).errorCode, "ui_prefs_invalid_value");
  assert.equal(sanitizeUiPrefsPatch({ prefs: {} }).errorCode, "ui_prefs_invalid_payload");
  assert.equal(sanitizeUiPrefsPatch({ prefs: [true] }).errorCode, "ui_prefs_invalid_payload");
  assert.equal(sanitizeUiPrefsPatch(null).errorCode, "ui_prefs_invalid_payload");
});

test("publicUiPrefs: kun kendte noegler med rigtig type", () => {
  assert.deepEqual(publicUiPrefs({ race_route_hidden: false, old_key: 1 }), { race_route_hidden: false });
  assert.deepEqual(publicUiPrefs({ race_route_hidden: "x" }), {});
  assert.deepEqual(publicUiPrefs(null), {});
});

test("read: ingen raekke = tomt objekt", async () => {
  assert.deepEqual(await readUiPrefs(fakeSupabase(), "u1"), { prefs: {}, available: true });
});

test("read: manglende tabel giver available=false, anden fejl kastes", async () => {
  assert.deepEqual(await readUiPrefs(fakeSupabase({ readError: { code: "PGRST205" } }), "u1"), { prefs: {}, available: false });
  await assert.rejects(() => readUiPrefs(fakeSupabase({ readError: { code: "XX000", message: "boom" } }), "u1"));
});

test("write: fletter med den gemte raekke og upserter paa user_id", async () => {
  const sb = fakeSupabase({ row: { prefs: { race_route_hidden: false } } });
  const out = await writeUiPrefs(sb, "u1", { race_route_hidden: true }, () => "2026-11-12T20:00:00.000Z");
  assert.deepEqual(out, { prefs: { race_route_hidden: true }, available: true });
  assert.deepEqual(sb.calls.upserts, [{
    value: { user_id: "u1", prefs: { race_route_hidden: true }, updated_at: "2026-11-12T20:00:00.000Z" },
    opts: { onConflict: "user_id" },
  }]);
});

test("write: manglende tabel skriver intet", async () => {
  const sb = fakeSupabase({ readError: { code: "42P01" } });
  assert.deepEqual(await writeUiPrefs(sb, "u1", { race_route_hidden: true }), { prefs: {}, available: false });
  assert.equal(sb.calls.upserts.length, 0);
});

test("isMissingUiPrefsTable", () => {
  assert.equal(isMissingUiPrefsTable({ code: "42P01" }), true);
  assert.equal(isMissingUiPrefsTable({ message: 'relation "public.user_ui_prefs" does not exist' }), true);
  assert.equal(isMissingUiPrefsTable({ code: "23505" }), false);
  assert.equal(isMissingUiPrefsTable(null), false);
});
