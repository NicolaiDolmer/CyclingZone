import test from "node:test";
import assert from "node:assert/strict";

import { SCOUTING_CONFIG, deriveScoutState, canScout } from "./scouting.js";

// ── deriveScoutState ──────────────────────────────────────────────────────────

test("deriveScoutState: tomme rows → fulde slots, ingen niveauer", () => {
  const s = deriveScoutState([], "season-2");
  assert.equal(s.slots.total, SCOUTING_CONFIG.slotsPerSeason);
  assert.equal(s.slots.used, 0);
  assert.equal(s.slots.remaining, SCOUTING_CONFIG.slotsPerSeason);
  assert.deepEqual(s.levels, {});
});

test("deriveScoutState: niveau = antal rows pr. rytter (capped på maxLevel)", () => {
  const rows = [
    { rider_id: "r1", season_id: "s2" },
    { rider_id: "r1", season_id: "s2" },
    { rider_id: "r1", season_id: "s2" },
    { rider_id: "r1", season_id: "s2" }, // 4 > maxLevel(3) → cappes
    { rider_id: "r2", season_id: "s2" },
  ];
  const s = deriveScoutState(rows, "s2");
  assert.equal(s.levels.r1, SCOUTING_CONFIG.maxLevel);
  assert.equal(s.levels.r2, 1);
});

test("deriveScoutState: slots tæller KUN handlinger i den aktive sæson", () => {
  const rows = [
    { rider_id: "r1", season_id: "s1" }, // gammel sæson — tæller ikke i used
    { rider_id: "r2", season_id: "s2" },
    { rider_id: "r3", season_id: "s2" },
  ];
  const s = deriveScoutState(rows, "s2");
  assert.equal(s.slots.used, 2);
  assert.equal(s.slots.remaining, SCOUTING_CONFIG.slotsPerSeason - 2);
  // men niveau (viden) bevares på tværs af sæsoner:
  assert.equal(s.levels.r1, 1);
});

test("deriveScoutState: remaining bunder ud i 0 (aldrig negativ)", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ rider_id: `r${i}`, season_id: "s2" }));
  const s = deriveScoutState(rows, "s2");
  assert.equal(s.slots.remaining, 0);
});

// ── canScout ──────────────────────────────────────────────────────────────────

test("canScout: ok når slots tilbage og under maxLevel", () => {
  assert.deepEqual(canScout(0, 3), { ok: true, reason: null });
  assert.deepEqual(canScout(2, 1), { ok: true, reason: null });
});

test("canScout: blokeret ved fuldt niveau", () => {
  assert.deepEqual(canScout(SCOUTING_CONFIG.maxLevel, 3), { ok: false, reason: "max_level" });
});

test("canScout: blokeret ved ingen slots", () => {
  assert.deepEqual(canScout(1, 0), { ok: false, reason: "no_slots" });
});

test("canScout: max_level vinder over no_slots", () => {
  assert.deepEqual(canScout(SCOUTING_CONFIG.maxLevel, 0), { ok: false, reason: "max_level" });
});
