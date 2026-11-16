// #8081 / #6944: aldersfokus i akademiets profil (gemmes på profilrækken, virker efter 14 dage).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACADEMY_PAGE_V2_FLAG_KEY,
  AGE_FOCUS_VALUES,
  normalizeAgeFocus,
  validateAgeFocusInput,
  resolveAgeFocusRows,
  loadAgeFocusState,
  saveAcademyProfileWithAgeFocus,
  isAcademyPageV2Enabled,
} from "./academyAgeFocus.js";
import { STAGE_FLAGS, PLAYER_VISIBLE_FLAG_KEYS } from "./stageFlagCatalog.js";
import { PROFILE_DELAY_DAYS } from "./academyIntakeProfile.ts";

// Kædbar fake: hver .from(tabel) svarer med `tables[tabel]`; .rpc() logges.
function fakeSupabase({ tier = 1, rows = [], flag = undefined, rpcResult = { data: 7, error: null } } = {}) {
  const rpcCalls = [];
  const chain = (result) => {
    const q = {
      select: () => q, eq: () => q, order: () => q, in: () => q,
      limit: () => Promise.resolve(result),
      maybeSingle: () => Promise.resolve(result),
      then: (res, rej) => Promise.resolve(result).then(res, rej),
    };
    return q;
  };
  return {
    rpcCalls,
    from(table) {
      if (table === "team_facilities") return chain({ data: { tier }, error: null });
      if (table === "academy_intake_profiles") return chain({ data: rows, error: null });
      if (table === "app_config") return chain({ data: flag === undefined ? null : { value: flag }, error: null });
      throw new Error(`unexpected table ${table}`);
    },
    rpc(name, args) {
      rpcCalls.push({ name, args });
      return Promise.resolve(rpcResult);
    },
  };
}

test("aldrene er præcis 16-19, og Blandet er null", () => {
  assert.deepEqual([...AGE_FOCUS_VALUES], ["16", "17", "18", "19"]);
  for (const mixed of [undefined, null, "", "mixed"]) assert.equal(normalizeAgeFocus(mixed), null);
  assert.equal(normalizeAgeFocus("17"), "17");
  assert.equal(normalizeAgeFocus(19), "19");
  for (const bad of ["15", "20", 18.5, "seventeen", {}, []]) assert.equal(normalizeAgeFocus(bad), undefined, String(bad));
});

test("aldersfokus er åbent fra første profilniveau (ejer 16/11), låst på niveau 0", () => {
  assert.deepEqual(validateAgeFocusInput("16", 0), { ok: false, error: "profile_locked" });
  assert.deepEqual(validateAgeFocusInput("mixed", 0), { ok: true, ageFocus: null });
  assert.deepEqual(validateAgeFocusInput("16", 1), { ok: true, ageFocus: "16" });
  assert.deepEqual(validateAgeFocusInput("19", 5), { ok: true, ageFocus: "19" });
  assert.deepEqual(validateAgeFocusInput("21", 3), { ok: false, error: "invalid_age_focus" });
});

test("aktivt og ventende aldersfokus følger profilrækkernes ur", () => {
  const now = "2026-11-16T12:00:00Z";
  const rows = [
    { age_focus: null, effective_from: "2026-10-01T00:00:00Z", created_at: "2026-09-17T00:00:00Z" },
    { age_focus: "17", effective_from: "2026-11-10T00:00:00Z", created_at: "2026-10-27T00:00:00Z" },
    { age_focus: "19", effective_from: "2026-11-30T00:00:00Z", created_at: "2026-11-16T00:00:00Z" },
  ];
  const { active, pending } = resolveAgeFocusRows(rows, now);
  assert.deepEqual(active, { ageFocus: "17", effectiveFrom: "2026-11-10T00:00:00Z" });
  assert.deepEqual(pending, { ageFocus: "19", effectiveFrom: "2026-11-30T00:00:00Z" });
  assert.deepEqual(resolveAgeFocusRows([], now), { active: null, pending: null });
  // En ukendt værdi i databasen læses som Blandet.
  assert.equal(resolveAgeFocusRows([{ age_focus: "99", effective_from: "2026-01-01T00:00:00Z" }], now).active.ageFocus, null);
});

test("loadAgeFocusState sender niveau, lås, valg og forsinkelsen", async () => {
  const state = await loadAgeFocusState(fakeSupabase({ tier: 0 }), { teamId: "team-a" });
  assert.equal(state.unlocked, false);
  assert.deepEqual(state.options, ["mixed", "16", "17", "18", "19"]);
  assert.equal(state.delayDays, PROFILE_DELAY_DAYS);
  assert.equal((await loadAgeFocusState(fakeSupabase({ tier: 1 }), { teamId: "team-a" })).unlocked, true);
});

test("gem: hele profilen + aldersfokus i ÉN række med samme ur (14 dage)", async () => {
  const db = fakeSupabase({ tier: 1 });
  const now = new Date("2026-11-16T12:00:00Z");
  const result = await saveAcademyProfileWithAgeFocus(db, {
    teamId: "team-a", now, input: { origins: ["DK"], types: [], ageFocus: "18" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.ageFocus, "18");
  assert.equal(db.rpcCalls.length, 1);
  const { name, args } = db.rpcCalls[0];
  assert.equal(name, "save_academy_intake_profile_8081");
  assert.deepEqual(args.p_origins, ["DK"]);
  assert.equal(args.p_age_focus, "18");
  assert.equal(new Date(args.p_effective_from).getTime() - now.getTime(), PROFILE_DELAY_DAYS * 86_400_000);
});

test("gem afviser ugyldige valg uden at skrive", async () => {
  const locked = fakeSupabase({ tier: 0 });
  assert.deepEqual(await saveAcademyProfileWithAgeFocus(locked, { teamId: "t", input: { origins: [], types: [], ageFocus: "16" } }),
    { ok: false, error: "profile_locked" });
  const open = fakeSupabase({ tier: 1 });
  assert.deepEqual(await saveAcademyProfileWithAgeFocus(open, { teamId: "t", input: { origins: [], types: [], ageFocus: "22" } }),
    { ok: false, error: "invalid_age_focus" });
  assert.equal(locked.rpcCalls.length + open.rpcCalls.length, 0);
});

test("kontakten er slukket uden række, og står i kataloget og spiller-allowlisten", async () => {
  assert.equal(await isAcademyPageV2Enabled(fakeSupabase({ flag: undefined })), false);
  assert.ok(STAGE_FLAGS.some((f) => f.key === ACADEMY_PAGE_V2_FLAG_KEY && f.area === "academy"));
  assert.ok(PLAYER_VISIBLE_FLAG_KEYS.includes(ACADEMY_PAGE_V2_FLAG_KEY));
});

test("migrationen seeder kontakten off og rører ikke den gamle gem-funktion", () => {
  const sql = readFileSync(new URL("../../database/2026-11-16-8081-academy-v2.sql", import.meta.url), "utf8");
  assert.match(sql, /'academy_page_v2_8081',\s*'"off"'::jsonb/);
  assert.match(sql, /ON CONFLICT \(key\) DO NOTHING/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS age_focus text NULL/);
  assert.doesNotMatch(sql, /FUNCTION public\.save_academy_intake_profile\(/);
  assert.match(sql, /REVOKE ALL\s+ON FUNCTION public\.save_academy_intake_profile_8081/);
});
