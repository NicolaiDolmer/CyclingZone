import test from "node:test";
import assert from "node:assert/strict";

import {
  seasonResetFatigue,
  applySeasonFatigueReset,
  SEASON_FATIGUE_RESET,
  SEASON_FATIGUE_RESET_FLAG_KEY,
} from "./seasonFatigueReset.js";
import { nextFatigue } from "./riderCondition.js";

// ─── Ren kerne ────────────────────────────────────────────────────────────────

test("mode 'off' er identitet (clampet + afrundet)", () => {
  assert.equal(seasonResetFatigue({ fatigue: 87, mode: "off" }), 87);
  assert.equal(seasonResetFatigue({ fatigue: 143, mode: "off" }), 100);
  assert.equal(seasonResetFatigue({ fatigue: -5, mode: "off" }), 0);
  assert.equal(seasonResetFatigue({ fatigue: 42.6, mode: "off" }), 43);
});

test("mode 'full' sender alle på nul, uanset udgangspunkt", () => {
  for (const f of [0, 1, 50, 99, 100]) {
    assert.equal(seasonResetFatigue({ fatigue: f, mode: "full" }), 0);
  }
});

test("mode 'rest_days' matcher den ægte daglige model dag for dag", () => {
  // Ingen egen matematik i modulet — restitution SKAL komme fra riderCondition.
  let expected = 100;
  for (let i = 0; i < 3; i++) {
    expected = nextFatigue({ fatigue: expected, intensity: "rest", recoveryAbility: 50 });
  }
  assert.equal(
    seasonResetFatigue({ fatigue: 100, recoveryAbility: 50, mode: "rest_days", restDays: 3 }),
    expected
  );
});

test("rest_days er monotont: flere dage kan aldrig give mere træthed", () => {
  let prev = 100;
  for (let d = 0; d <= 6; d++) {
    const v = seasonResetFatigue({ fatigue: 100, recoveryAbility: 50, mode: "rest_days", restDays: d });
    assert.ok(v <= prev, `dag ${d}: ${v} > ${prev}`);
    prev = v;
  }
  assert.equal(prev, 0, "6 hviledage skal ende i 0");
});

test("høj recovery-evne restituerer hurtigere end lav", () => {
  const lav = seasonResetFatigue({ fatigue: 100, recoveryAbility: 10, mode: "rest_days", restDays: 3 });
  const høj = seasonResetFatigue({ fatigue: 100, recoveryAbility: 99, mode: "rest_days", restDays: 3 });
  assert.ok(høj < lav, `høj (${høj}) skal være under lav (${lav})`);
});

test("resultatet er altid et heltal i 0-100", () => {
  for (const f of [0, 13, 37, 64, 100]) {
    for (const d of [0, 1, 2, 3, 5]) {
      const v = seasonResetFatigue({ fatigue: f, recoveryAbility: 73, mode: "rest_days", restDays: d });
      assert.ok(Number.isInteger(v) && v >= 0 && v <= 100, `f=${f} d=${d} → ${v}`);
    }
  }
});

test("korrupt/manglende træthed behandles som 0, ikke NaN", () => {
  assert.equal(seasonResetFatigue({ fatigue: null, mode: "rest_days", restDays: 2 }), 0);
  assert.equal(seasonResetFatigue({ fatigue: undefined, mode: "off" }), 0);
  assert.equal(seasonResetFatigue({ fatigue: "ikke-et-tal", mode: "off" }), 0);
});

test("ukendt mode kaster (ingen tavs fallback til en anden balance)", () => {
  assert.throws(() => seasonResetFatigue({ fatigue: 50, mode: "halv" }), /ukendt mode/);
});

test("determinisme: samme input giver samme output", () => {
  const a = seasonResetFatigue({ fatigue: 91, recoveryAbility: 44, mode: "rest_days", restDays: 3 });
  const b = seasonResetFatigue({ fatigue: 91, recoveryAbility: 44, mode: "rest_days", restDays: 3 });
  assert.equal(a, b);
});

// ─── apply-laget ──────────────────────────────────────────────────────────────

function buildMockSupabase({ conditions = [], abilities = [] } = {}) {
  const capture = { upserts: [], flagReads: [] };
  const supabase = {
    from(table) {
      if (table === "rider_condition") {
        const api = {
          select() { return api; },
          order() { return api; },
          range(from, to) {
            return Promise.resolve({ data: conditions.slice(from, to + 1), error: null });
          },
          upsert(rows) {
            capture.upserts.push(...rows);
            return Promise.resolve({ error: null });
          },
        };
        return api;
      }
      if (table === "rider_derived_abilities") {
        const api = {
          select() { return api; },
          in(_col, ids) {
            return Promise.resolve({
              data: abilities.filter((a) => ids.includes(a.rider_id)),
              error: null,
            });
          },
        };
        return api;
      }
      throw new Error(`uventet tabel: ${table}`);
    },
  };
  return { supabase, capture };
}

test("flag off → ingen læsning, ingen skrivning, nuværende adfærd", async () => {
  const { supabase, capture } = buildMockSupabase({ conditions: [{ rider_id: "r1", fatigue: 100 }] });
  const res = await applySeasonFatigueReset({ supabase, isEnabled: async () => false });
  assert.deepEqual(res, { ran: false, reason: "flag_off" });
  assert.equal(capture.upserts.length, 0);
});

test("apply skriver KUN de ryttere hvis træthed faktisk ændrer sig", async () => {
  const { supabase, capture } = buildMockSupabase({
    conditions: [
      { rider_id: "r1", fatigue: 100 },
      { rider_id: "r2", fatigue: 0 },   // allerede frisk → ingen skrivning
      { rider_id: "r3", fatigue: 40 },
    ],
  });
  const res = await applySeasonFatigueReset({
    supabase, isEnabled: async () => true, mode: "full", now: new Date("2026-07-26T19:30:00Z"),
  });
  assert.equal(res.ran, true);
  assert.equal(res.riders, 3);
  assert.equal(res.changed, 2);
  assert.deepEqual(capture.upserts.map((r) => r.rider_id).sort(), ["r1", "r3"]);
  assert.ok(capture.upserts.every((r) => r.fatigue === 0));
  // form/injured_until må ALDRIG være med i payloaden.
  assert.ok(capture.upserts.every((r) => !("form" in r) && !("injured_until" in r)));
});

test("apply rapporterer gennemsnittet før og efter", async () => {
  const { supabase } = buildMockSupabase({
    conditions: [
      { rider_id: "r1", fatigue: 100 },
      { rider_id: "r2", fatigue: 50 },
    ],
  });
  const res = await applySeasonFatigueReset({ supabase, isEnabled: async () => true, mode: "full" });
  assert.equal(res.avgBefore, 75);
  assert.equal(res.avgAfter, 0);
});

test("dryRun beregner alt, men skriver intet", async () => {
  const { supabase, capture } = buildMockSupabase({
    conditions: [{ rider_id: "r1", fatigue: 100 }],
    abilities: [{ rider_id: "r1", recovery: 50 }],
  });
  const res = await applySeasonFatigueReset({ supabase, isEnabled: async () => true, dryRun: true });
  assert.equal(res.dryRun, true);
  assert.equal(res.changed, 1);
  assert.equal(capture.upserts.length, 0);
});

test("rest_days bruger rytterens EGEN recovery-evne fra abilities-tabellen", async () => {
  const { supabase, capture } = buildMockSupabase({
    conditions: [
      { rider_id: "sløv", fatigue: 100 },
      { rider_id: "hurtig", fatigue: 100 },
    ],
    abilities: [
      { rider_id: "sløv", recovery: 10 },
      { rider_id: "hurtig", recovery: 99 },
    ],
  });
  await applySeasonFatigueReset({
    supabase, isEnabled: async () => true, mode: "rest_days", restDays: 3,
  });
  const by = new Map(capture.upserts.map((r) => [r.rider_id, r.fatigue]));
  assert.ok(by.get("hurtig") < by.get("sløv"),
    `hurtig (${by.get("hurtig")}) skal restituere mere end sløv (${by.get("sløv")})`);
});

test("defaults er de owner-gatede værdier", () => {
  assert.equal(SEASON_FATIGUE_RESET_FLAG_KEY, "season_fatigue_reset_enabled");
  assert.equal(SEASON_FATIGUE_RESET.MODE, "rest_days");
  assert.equal(SEASON_FATIGUE_RESET.REST_DAYS, 3);
});
