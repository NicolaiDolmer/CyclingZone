import test from "node:test";
import assert from "node:assert/strict";

import {
  SCOUTING_CONFIG,
  deriveScoutState,
  canScout,
  seededUnit,
  estimatePotentialRange,
  buildScoutEstimate,
} from "./scouting.js";

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
  const rows = Array.from({ length: SCOUTING_CONFIG.slotsPerSeason + 5 }, (_, i) => ({ rider_id: `r${i}`, season_id: "s2" }));
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

// ── estimatePotentialRange (#1162 — flyttet fra frontend) ─────────────────────

test("seededUnit er deterministisk og ∈ [0,1)", () => {
  const a = seededUnit("scout:r1:t1");
  assert.equal(a, seededUnit("scout:r1:t1"));
  assert.notEqual(a, seededUnit("scout:r1:t2"));
  assert.ok(a >= 0 && a < 1);
});

test("estimatet er stabilt mellem kald (samme input → samme interval)", () => {
  const a = estimatePotentialRange(4.5, 1, 22, "r1", "t1", 3);
  const b = estimatePotentialRange(4.5, 1, 22, "r1", "t1", 3);
  assert.deepEqual(a, b);
});

test("fuldt scoutet (level == maxLevel) → rest-bånd, aldrig eksakt (#1543 beslutning 3)", () => {
  const r = estimatePotentialRange(4.0, 3, 22, "r1", "t1", 3);
  assert.equal(r.exact, false);
  assert.equal(r.scoutLevel, 3);
  assert.ok(r.hi - r.lo >= 0.5 && r.hi - r.lo <= 1.5, `rest-bånd forventet, fik ${r.lo}–${r.hi}`);
  assert.ok(r.lo <= 4.0 + 0.75 && r.hi >= 4.0 - 0.75, "båndet skal omslutte nabolaget af sandheden");
});

test("rest-båndets midtpunkt er IKKE altid sandheden (anti-inversion, #1543)", () => {
  let offCenter = 0;
  for (let i = 0; i < 50; i++) {
    const r = estimatePotentialRange(3.5, 3, 22, `r${i}`, "t1", 3);
    if ((r.lo + r.hi) / 2 !== 3.5) offCenter++;
  }
  assert.ok(offCenter > 10, `bias-spredning for lav: ${offCenter}/50 off-center`);
});

test("uscoutet ung rytter → bredt interval der indeholder et spænd", () => {
  const r = estimatePotentialRange(4, 0, 19, "r1", "t1", 3);
  assert.equal(r.exact, false);
  assert.ok(r.hi - r.lo > 1, `forventede bredt interval, fik ${r.lo}-${r.hi}`);
  assert.ok(r.lo >= 1 && r.hi <= 6);
});

test("scouting indsnævrer intervallet målbart (level 0 → 1 → 2)", () => {
  const w0 = estimatePotentialRange(4, 0, 19, "r1", "t1", 3);
  const w1 = estimatePotentialRange(4, 1, 19, "r1", "t1", 3);
  const w2 = estimatePotentialRange(4, 2, 19, "r1", "t1", 3);
  const width = (r) => r.hi - r.lo;
  assert.ok(width(w1) < width(w0), "level 1 smallere end 0");
  assert.ok(width(w2) < width(w1), "level 2 smallere end 1");
});

test("etableret rytter (≥28) starter smallere end ung", () => {
  const young = estimatePotentialRange(4, 0, 19, "r1", "t1", 3);
  const old = estimatePotentialRange(4, 0, 30, "r1", "t1", 3);
  assert.ok((old.hi - old.lo) < (young.hi - young.lo));
});

test("managere ser varierende intervaller for samme rytter (per-manager seed)", () => {
  // Egenskaben er at estimatet VARIERER på tværs af managere — ikke at hvert
  // vilkårligt par afviger (clamping ved 1–6 kan kollapse enkelte par).
  const seen = new Set(
    ["tA", "tB", "tC", "tD", "tE", "tF"].map((t) => {
      const r = estimatePotentialRange(4, 0, 19, "r1", t, 3);
      return `${r.lo}-${r.hi}`;
    })
  );
  assert.ok(seen.size > 1, "forventede mindst to forskellige intervaller på tværs af managere");
});

test("interval clampes til 1–6", () => {
  const hi = estimatePotentialRange(6, 0, 19, "rX", "tX", 3);
  const lo = estimatePotentialRange(1, 0, 19, "rY", "tY", 3);
  assert.ok(hi.hi <= 6 && hi.lo >= 1);
  assert.ok(lo.hi <= 6 && lo.lo >= 1);
});

test("ugyldig potentiale → null", () => {
  assert.equal(estimatePotentialRange(null, 0, 20, "r", "t", 3), null);
  assert.equal(estimatePotentialRange(undefined, 0, 20, "r", "t", 3), null);
});

// ── buildScoutEstimate (viewer-maskeret payload, #1162) ───────────────────────

const YEAR = 2026;

test("buildScoutEstimate: egen rytter → smalt bånd, ikke eksakt (#1543 beslutning 4)", () => {
  const rider = { id: "r1", potentiale: 4.0, birthdate: "2004-03-01", team_id: "tMe" };
  const est = buildScoutEstimate(rider, 0, "tMe", SCOUTING_CONFIG, YEAR);
  assert.equal(est.exact, undefined, "exact-feltet må ikke findes i outputtet (#2244 A3)");
  assert.equal(est.level, SCOUTING_CONFIG.maxLevel);
  assert.ok(est.hi > est.lo, "egen rytter skal have et bånd");
  assert.ok(est.hi - est.lo <= 1.5, "egen-rytter-båndet skal være smalt");
});

test("buildScoutEstimate: egen rytter smallere end fremmed fuldt scoutet (#2244 A3, min-bånd × 0.8)", () => {
  const own = buildScoutEstimate(
    { id: "r1", potentiale: 4.0, birthdate: "2004-03-01", team_id: "tMe" }, 0, "tMe", SCOUTING_CONFIG, YEAR,
  );
  const foreign = buildScoutEstimate(
    { id: "r1", potentiale: 4.0, birthdate: "2004-03-01", team_id: "tOther" }, SCOUTING_CONFIG.maxLevel, "tMe", SCOUTING_CONFIG, YEAR,
  );
  assert.ok((own.hi - own.lo) <= (foreign.hi - foreign.lo), "egen-rytter-bånd skal være ≤ fremmed fuldt scoutet bånd");
});

test("buildScoutEstimate: dårligere spejder (overall 40) giver bredere rest-bånd end topspejder (overall 99)", () => {
  const rider = { id: "r1", potentiale: 4.0, birthdate: "1998-03-01", team_id: "tOther" };
  const worseScout = buildScoutEstimate(rider, SCOUTING_CONFIG.maxLevel, "tMe", SCOUTING_CONFIG, YEAR, { overall: 40 });
  const bestScout = buildScoutEstimate(rider, SCOUTING_CONFIG.maxLevel, "tMe", SCOUTING_CONFIG, YEAR, { overall: 99 });
  assert.ok((worseScout.hi - worseScout.lo) >= (bestScout.hi - bestScout.lo), "overall 40 skal give ≥ bånd end overall 99");
});

test("buildScoutEstimate: fremmed uscoutet rytter → SKJULT (#1543), intet lo/hi-spænd", () => {
  // #1543: potentiale er skjult indtil rytteren er scoutet. Et level-0-estimat
  // for en fremmed rytter må IKKE indeholde et lo–hi-interval (intet gratis hint).
  const rider = { id: "r1", potentiale: 4.5, birthdate: "2006-03-01", team_id: "tOther" };
  const est = buildScoutEstimate(rider, 0, "tMe", SCOUTING_CONFIG, YEAR);
  assert.deepEqual(est, { hidden: true, level: 0 });
  assert.equal(est.lo, undefined, "hidden-estimat må ikke lække lo");
  assert.equal(est.hi, undefined, "hidden-estimat må ikke lække hi");
});

test("buildScoutEstimate: fremmed rytter scoutet (level 1) → usikkert interval, intet exact-felt", () => {
  // Post-scout (level > 0) afsløres estimatet uændret som før (#1543 rører kun level 0).
  const rider = { id: "r1", potentiale: 4.5, birthdate: "2006-03-01", team_id: "tOther" };
  const est = buildScoutEstimate(rider, 1, "tMe", SCOUTING_CONFIG, YEAR);
  assert.equal(est.exact, undefined);
  assert.equal(est.level, 1);
  assert.ok(est.hi - est.lo > 0, "scoutet rytter skal have spænd");
});

test("buildScoutEstimate: fuldt scoutet fremmed rytter → rest-bånd (#1543 beslutning 3)", () => {
  const rider = { id: "r1", potentiale: 3.5, birthdate: "1998-03-01", team_id: "tOther" };
  const est = buildScoutEstimate(rider, SCOUTING_CONFIG.maxLevel, "tMe", SCOUTING_CONFIG, YEAR);
  assert.equal(est.exact, undefined);
  assert.equal(est.level, SCOUTING_CONFIG.maxLevel);
  assert.ok(est.hi > est.lo, "fuldt scoutet skal stadig have et rest-bånd");
});

test("buildScoutEstimate: rytter uden potentiale → null", () => {
  const rider = { id: "r1", potentiale: null, birthdate: "2004-03-01", team_id: "tOther" };
  assert.equal(buildScoutEstimate(rider, 0, "tMe", SCOUTING_CONFIG, YEAR), null);
});

test("buildScoutEstimate: payloaden indeholder ALDRIG rå potentiale-felt (og ikke `exact`, #2244 A3)", () => {
  const rider = { id: "r1", potentiale: 4.5, birthdate: "2006-03-01", team_id: "tOther" };
  const est = buildScoutEstimate(rider, 1, "tMe", SCOUTING_CONFIG, YEAR);
  assert.deepEqual(Object.keys(est).sort(), ["hi", "level", "lo"]);
});
