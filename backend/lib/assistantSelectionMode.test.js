import test from "node:test";
import assert from "node:assert/strict";

import {
  ASSISTANT_MODES, DEFAULT_ASSISTANT_MODE, DEFAULT_LATE_FILL_HOURS,
  normalizeAssistantMode, normalizeLateFillHours, readAssistantSelectionConfig,
} from "./assistantSelectionMode.js";

// app_config-mock: value pr. key, eller en fejl (fail-safe-stien).
function makeConfigSupabase(byKey = {}, { error = null } = {}) {
  return {
    from(table) {
      assert.equal(table, "app_config");
      return {
        select: () => ({
          eq: (_col, key) => ({
            maybeSingle: async () => ({
              data: error ? null : (key in byKey ? { value: byKey[key] } : null),
              error,
            }),
          }),
        }),
      };
    },
  };
}

test("normalizeAssistantMode: kun de tre kendte vaerdier slipper igennem", () => {
  assert.equal(normalizeAssistantMode("proactive"), ASSISTANT_MODES.PROACTIVE);
  assert.equal(normalizeAssistantMode("late_fill"), ASSISTANT_MODES.LATE_FILL);
  assert.equal(normalizeAssistantMode("opt_in"), ASSISTANT_MODES.OPT_IN);
});

test("normalizeAssistantMode: ukendt/tom/forkert type → proactive (fail-safe)", () => {
  for (const v of [null, undefined, "", "on", "LATE_FILL", 1, true, {}]) {
    assert.equal(normalizeAssistantMode(v), DEFAULT_ASSISTANT_MODE, `${String(v)} skal fail-safe`);
  }
});

test("normalizeLateFillHours: gyldige tal bevares, resten falder til default", () => {
  assert.equal(normalizeLateFillHours(6), 6);
  assert.equal(normalizeLateFillHours(1), 1);
  assert.equal(normalizeLateFillHours(168), 168);
  assert.equal(normalizeLateFillHours("12"), 12);
  for (const v of [0, -3, 169, NaN, null, undefined, "sent", {}]) {
    assert.equal(normalizeLateFillHours(v), DEFAULT_LATE_FILL_HOURS, `${String(v)} skal fail-safe`);
  }
});

test("readAssistantSelectionConfig: laeser begge noegler", async () => {
  const supabase = makeConfigSupabase({
    assistant_selection_mode: "late_fill",
    assistant_late_fill_hours: 12,
  });
  assert.deepEqual(await readAssistantSelectionConfig(supabase), {
    mode: "late_fill", lateFillHours: 12,
  });
});

test("readAssistantSelectionConfig: manglende noegler → proactive/24", async () => {
  assert.deepEqual(await readAssistantSelectionConfig(makeConfigSupabase({})), {
    mode: "proactive", lateFillHours: 24,
  });
});

test("readAssistantSelectionConfig: DB-fejl → proactive/24 (aldrig et kast)", async () => {
  const supabase = makeConfigSupabase({}, { error: { message: "boom" } });
  assert.deepEqual(await readAssistantSelectionConfig(supabase), {
    mode: "proactive", lateFillHours: 24,
  });
});

test("readAssistantSelectionConfig: uden supabase-klient → proactive/24", async () => {
  assert.deepEqual(await readAssistantSelectionConfig(null), {
    mode: "proactive", lateFillHours: 24,
  });
});
