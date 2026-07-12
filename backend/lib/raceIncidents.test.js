// Race Engine v3 (#2224), slice S4 (#1176) — raceIncidents.js unit-tests.
import test from "node:test";
import assert from "node:assert/strict";

import { incidentProbability, rollIncidents, loadAbandonedRiderIds } from "./raceIncidents.js";
import { RACE_V3_TUNING } from "./raceRoles.js";

function entrant(id, positioning) {
  return { rider_id: id, abilities: { positioning } };
}
function field(n, positioning = 50) {
  return Array.from({ length: n }, (_, i) => entrant(`r${String(i).padStart(3, "0")}`, positioning));
}

// ── incidentProbability ────────────────────────────────────────────────────

test("incidentProbability: matcher basis-tabellen for kendte profiler (positioning=0 → ingen dæmpning)", () => {
  // Kalibrerede værdier (2026-07-12, #1176 S4-kalibreringslog i
  // simulateSeasonDryRun.js) — IKKE Worker A's oprindelige kandidat-tal;
  // asserter mod den LEVENDE tunings-flade (ikke hardkodede literals), så
  // testen ikke driver ud af sync med en fremtidig re-kalibrering af defaults.
  for (const [profile_type, expected] of Object.entries(RACE_V3_TUNING.INCIDENT_BASE_BY_PROFILE)) {
    if (profile_type === "_default") continue;
    const p = incidentProbability({ stageProfile: { profile_type }, positioning: null });
    assert.ok(Math.abs(p - expected) < 1e-12, `${profile_type}: forventet ${expected}, fik ${p}`);
  }
});

test("incidentProbability: ukendt profil → _default", () => {
  const p = incidentProbability({ stageProfile: { profile_type: "unknown_profile" }, positioning: null });
  assert.ok(Math.abs(p - RACE_V3_TUNING.INCIDENT_BASE_BY_PROFILE._default) < 1e-12);
});

test("incidentProbability: descent-finale ganger basis med DESCENT_FINALE_MULT", () => {
  const base = incidentProbability({ stageProfile: { profile_type: "mountain" }, positioning: null });
  const descent = incidentProbability({ stageProfile: { profile_type: "mountain", finale_type: "descent" }, positioning: null });
  assert.ok(Math.abs(descent - base * RACE_V3_TUNING.INCIDENT_DESCENT_FINALE_MULT) < 1e-12);
});

test("incidentProbability: anden finale end 'descent' påvirker IKKE p", () => {
  const base = incidentProbability({ stageProfile: { profile_type: "mountain" }, positioning: null });
  const longClimb = incidentProbability({ stageProfile: { profile_type: "mountain", finale_type: "long_climb" }, positioning: null });
  assert.ok(Math.abs(base - longClimb) < 1e-12);
});

test("incidentProbability: positioning dæmper lineært, max ved 99, ingen dæmpning ved 0/manglende", () => {
  const stageProfile = { profile_type: "cobbles" };
  const base = incidentProbability({ stageProfile, positioning: 0 });
  const missing = incidentProbability({ stageProfile, positioning: null });
  const max = incidentProbability({ stageProfile, positioning: 99 });
  const half = incidentProbability({ stageProfile, positioning: 49.5 });
  assert.equal(base, missing, "manglende positioning skal give samme p som positioning=0");
  assert.ok(Math.abs(max - base * (1 - RACE_V3_TUNING.INCIDENT_POSITIONING_MAX_REDUCTION)) < 1e-9);
  assert.ok(max < half && half < base, "monoton dæmpning: højere positioning → lavere p");
});

test("incidentProbability: positioning clampes til [0,99] (overshoot rører ikke resultatet ud over grænsen)", () => {
  const stageProfile = { profile_type: "cobbles" };
  const at99 = incidentProbability({ stageProfile, positioning: 99 });
  const over = incidentProbability({ stageProfile, positioning: 150 });
  assert.ok(Math.abs(at99 - over) < 1e-12);
});

// ── rollIncidents: determinisme ────────────────────────────────────────────

test("rollIncidents: samme seed + samme felt → identisk output (determinisme)", () => {
  const entrants = field(60, 30);
  const stageProfile = { profile_type: "cobbles" };
  const a = rollIncidents({ entrants, stageProfile, stageSeed: 12345 });
  const b = rollIncidents({ entrants, stageProfile, stageSeed: 12345 });
  assert.deepEqual(a, b);
});

test("rollIncidents: forskellig seed → (næsten sikkert) forskelligt udfald over et stort felt", () => {
  const entrants = field(120, 30);
  const stageProfile = { profile_type: "cobbles" };
  const a = rollIncidents({ entrants, stageProfile, stageSeed: 1 });
  const b = rollIncidents({ entrants, stageProfile, stageSeed: 2 });
  assert.notDeepEqual(a, b);
});

test("rollIncidents: input-rækkefølgen af entrants påvirker IKKE resultatet (stabil rider_id-sortering internt)", () => {
  const entrants = field(40, 30);
  const stageProfile = { profile_type: "cobbles" };
  const forward = rollIncidents({ entrants, stageProfile, stageSeed: 77 });
  const shuffled = [...entrants].reverse();
  const reversed = rollIncidents({ entrants: shuffled, stageProfile, stageSeed: 77 });
  const sortByRider = (arr) => [...arr].sort((x, y) => x.rider_id.localeCompare(y.rider_id));
  assert.deepEqual(sortByRider(forward), sortByRider(reversed));
});

test("rollIncidents: per-rytter-uafhængighed — at fjerne én rytter ændrer IKKE en andens udfald", () => {
  const entrants = field(50, 30);
  const stageProfile = { profile_type: "cobbles" };
  const full = rollIncidents({ entrants, stageProfile, stageSeed: 999 });
  const withoutFirst = rollIncidents({ entrants: entrants.slice(1), stageProfile, stageSeed: 999 });
  const byId = new Map(full.map((h) => [h.rider_id, h]));
  for (const h of withoutFirst) {
    assert.deepEqual(byId.get(h.rider_id), h, `${h.rider_id}: udfald ændrede sig da en ANDEN rytter blev fjernet`);
  }
});

test("rollIncidents: p<=0 (fx ttt+høj positioning-dæmpning force-nulstillet via tuning) → ingen hits, ingen kastede fejl", () => {
  const entrants = field(20, 50);
  const tuning = { ...RACE_V3_TUNING, INCIDENT_BASE_BY_PROFILE: { ...RACE_V3_TUNING.INCIDENT_BASE_BY_PROFILE, itt: 0 } };
  const hits = rollIncidents({ entrants, stageProfile: { profile_type: "itt" }, stageSeed: 1, tuning });
  assert.deepEqual(hits, []);
});

test("rollIncidents: manglende stageSeed (ikke heltal) kaster", () => {
  assert.throws(() => rollIncidents({ entrants: field(5), stageProfile: { profile_type: "flat" }, stageSeed: undefined }));
});

// ── rollIncidents: outcome/kind-split + magnitude-bounds (høj tvunget p via tuning) ──

const HIGH_P_TUNING = {
  ...RACE_V3_TUNING,
  INCIDENT_BASE_BY_PROFILE: { ...RACE_V3_TUNING.INCIDENT_BASE_BY_PROFILE, flat: 0.5 },
  // Cap slås fra (100% felt) så vi kan observere den RÅ outcome/kind-fordeling.
  INCIDENT_MAX_FIELD_SHARE: 1,
};

test("rollIncidents: outcome-split nærmer sig INCIDENT_ABANDON_SHARE over mange ryttere/seeds", () => {
  let abandons = 0, total = 0;
  for (let seed = 0; seed < 40; seed++) {
    const hits = rollIncidents({ entrants: field(60, 0), stageProfile: { profile_type: "flat" }, stageSeed: seed, tuning: HIGH_P_TUNING });
    total += hits.length;
    abandons += hits.filter((h) => h.outcome === "abandon").length;
  }
  assert.ok(total > 500, `for få hits til en meningsfuld andel (${total})`);
  const share = abandons / total;
  assert.ok(Math.abs(share - HIGH_P_TUNING.INCIDENT_ABANDON_SHARE) < 0.05, `abandon-andel ${share} langt fra ${HIGH_P_TUNING.INCIDENT_ABANDON_SHARE}`);
});

test("rollIncidents: kind-split nærmer sig INCIDENT_MECHANICAL_SHARE over mange ryttere/seeds", () => {
  let mechanical = 0, total = 0;
  for (let seed = 0; seed < 40; seed++) {
    const hits = rollIncidents({ entrants: field(60, 0), stageProfile: { profile_type: "flat" }, stageSeed: seed, tuning: HIGH_P_TUNING });
    total += hits.length;
    mechanical += hits.filter((h) => h.kind === "mechanical").length;
  }
  assert.ok(total > 500, `for få hits til en meningsfuld andel (${total})`);
  const share = mechanical / total;
  assert.ok(Math.abs(share - HIGH_P_TUNING.INCIDENT_MECHANICAL_SHARE) < 0.05, `mechanical-andel ${share} langt fra ${HIGH_P_TUNING.INCIDENT_MECHANICAL_SHARE}`);
});

test("rollIncidents: magnitude-bounds — time_loss_seconds ∈ [MIN,MAX], injury_days ∈ [MIN,MAX], aldrig begge sat", () => {
  for (let seed = 0; seed < 20; seed++) {
    const hits = rollIncidents({ entrants: field(80, 0), stageProfile: { profile_type: "flat" }, stageSeed: seed, tuning: HIGH_P_TUNING });
    for (const h of hits) {
      if (h.outcome === "time_loss") {
        assert.equal(h.injury_days, null);
        assert.ok(h.time_loss_seconds >= HIGH_P_TUNING.INCIDENT_TIME_LOSS_MIN_S && h.time_loss_seconds <= HIGH_P_TUNING.INCIDENT_TIME_LOSS_MAX_S,
          `time_loss_seconds ${h.time_loss_seconds} uden for [${HIGH_P_TUNING.INCIDENT_TIME_LOSS_MIN_S},${HIGH_P_TUNING.INCIDENT_TIME_LOSS_MAX_S}]`);
      } else {
        assert.equal(h.time_loss_seconds, null);
        assert.ok(h.injury_days >= HIGH_P_TUNING.INCIDENT_INJURY_MIN_DAYS && h.injury_days <= HIGH_P_TUNING.INCIDENT_INJURY_MAX_DAYS,
          `injury_days ${h.injury_days} uden for [${HIGH_P_TUNING.INCIDENT_INJURY_MIN_DAYS},${HIGH_P_TUNING.INCIDENT_INJURY_MAX_DAYS}]`);
      }
      assert.ok(["crash", "mechanical"].includes(h.kind));
      assert.ok(["time_loss", "abandon"].includes(h.outcome));
    }
  }
});

// ── rollIncidents: CAP-håndhævelse ─────────────────────────────────────────

test("rollIncidents: CAP — antal hits overstiger ALDRIG ⌈INCIDENT_MAX_FIELD_SHARE × felt⌉", () => {
  const tuning = { ...RACE_V3_TUNING, INCIDENT_BASE_BY_PROFILE: { ...RACE_V3_TUNING.INCIDENT_BASE_BY_PROFILE, flat: 0.9 }, INCIDENT_MAX_FIELD_SHARE: 0.1 };
  const entrants = field(50, 0);
  const maxAllowed = Math.ceil(0.1 * entrants.length);
  for (let seed = 0; seed < 15; seed++) {
    const hits = rollIncidents({ entrants, stageProfile: { profile_type: "flat" }, stageSeed: seed, tuning });
    assert.ok(hits.length <= maxAllowed, `seed ${seed}: ${hits.length} hits > cap ${maxAllowed}`);
  }
});

test("rollIncidents: CAP-udvalget er deterministisk (samme kørsel → samme beholdte ryttere) og beholder de LAVESTE u-værdier", () => {
  const tuning = { ...RACE_V3_TUNING, INCIDENT_BASE_BY_PROFILE: { ...RACE_V3_TUNING.INCIDENT_BASE_BY_PROFILE, flat: 0.9 }, INCIDENT_MAX_FIELD_SHARE: 0.08 };
  const entrants = field(80, 0);
  const uncapped = rollIncidents({ entrants, stageProfile: { profile_type: "flat" }, stageSeed: 5, tuning: { ...tuning, INCIDENT_MAX_FIELD_SHARE: 1 } });
  const capped = rollIncidents({ entrants, stageProfile: { profile_type: "flat" }, stageSeed: 5, tuning });
  const maxAllowed = Math.ceil(0.08 * entrants.length);
  assert.equal(capped.length, maxAllowed);
  const expectedIds = new Set(
    [...uncapped].sort((a, b) => a.u - b.u || a.rider_id.localeCompare(b.rider_id)).slice(0, maxAllowed).map((h) => h.rider_id)
  );
  assert.deepEqual(new Set(capped.map((h) => h.rider_id)), expectedIds);
  // Determinisme: en anden kørsel med samme input giver samme beholdte sæt.
  const cappedAgain = rollIncidents({ entrants, stageProfile: { profile_type: "flat" }, stageSeed: 5, tuning });
  assert.deepEqual(capped, cappedAgain);
});

// ── loadAbandonedRiderIds ───────────────────────────────────────────────────

function makeSupabaseStub(rows) {
  return {
    from(table) {
      assert.equal(table, "race_incidents");
      const b = {
        select() { return b; },
        eq() { return b; },
        then(resolve) { return Promise.resolve({ data: rows, error: null }).then(resolve); },
      };
      return b;
    },
  };
}

test("loadAbandonedRiderIds: returnerer et Set af rider_id for abandon-rækker", async () => {
  const supabase = makeSupabaseStub([{ rider_id: "a" }, { rider_id: "b" }]);
  const set = await loadAbandonedRiderIds({ supabase, raceId: "race-1" });
  assert.deepEqual(set, new Set(["a", "b"]));
});

test("loadAbandonedRiderIds: ingen rækker → tomt Set", async () => {
  const supabase = makeSupabaseStub([]);
  const set = await loadAbandonedRiderIds({ supabase, raceId: "race-1" });
  assert.deepEqual(set, new Set());
});

test("loadAbandonedRiderIds: DB-fejl → kaster", async () => {
  const supabase = {
    from() {
      const b = {
        select() { return b; },
        eq() { return b; },
        then(resolve) { return Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve); },
      };
      return b;
    },
  };
  await assert.rejects(() => loadAbandonedRiderIds({ supabase, raceId: "race-1" }), /boom/);
});
