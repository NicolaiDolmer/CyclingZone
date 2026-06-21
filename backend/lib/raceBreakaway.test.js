// backend/lib/raceBreakaway.test.js
// #1307: udbruds-mekanik — seeded, kun egnede profiler, 1-3 escapees, hunter-vægt.
import test from "node:test";
import assert from "node:assert/strict";
import { simulateStage, aggressionScore, breakawayMaxBonus, deriveBreakawayStatus, BREAKAWAY_BONUS, BREAKAWAY_TOP_EXCLUDED } from "./raceSimulator.js";

const ab = (over = {}) => ({
  climbing: 50, time_trial: 50, sprint: 50, punch: 50, endurance: 50,
  cobblestone: 50, acceleration: 50, recovery: 50, tactics: 50, positioning: 50,
  ...over,
});
const demand = { sprint: 0.8, endurance: 0.2, randomness: 0.5 };
const makeEntrants = (n) =>
  Array.from({ length: n }, (_, i) => ({
    rider_id: `r${String(i).padStart(3, "0")}`,
    team_id: `t${i % 4}`,
    // Spredning: r000 stærkest, r0NN svagest → bund-kandidater findes.
    abilities: ab({ sprint: 90 - i * 2, tactics: 40 + (i % 30) }),
  }));

test("aggressionScore vægter tactics/endurance/acceleration", () => {
  const high = aggressionScore(ab({ tactics: 99, endurance: 99, acceleration: 99 }));
  const low = aggressionScore(ab({ tactics: 1, endurance: 1, acceleration: 1 }));
  assert.ok(high > low);
  assert.ok(high <= 99 && low >= 0);

  // Relativ vægtning: tactics (0.5) vejer tungere end acceleration (0.2).
  // En rytter med tactics=99 (resten 50) skal score højere end en med acceleration=99 (resten 50).
  const highTactics = aggressionScore(ab({ tactics: 99 }));
  const highAcceleration = aggressionScore(ab({ acceleration: 99 }));
  assert.ok(
    highTactics > highAcceleration,
    `tactics-tung (${highTactics}) skal > acceleration-tung (${highAcceleration}) — tactics har 0.5 vs 0.2 vægt`,
  );
});

test("udbrud: kun på egnede profiler", () => {
  const entrants = makeEntrants(30);
  const itt = simulateStage({ entrants, stageProfile: { profile_type: "itt", demand_vector: demand }, seed: 7 });
  assert.ok(itt.ranked.every((r) => (r.components.breakaway ?? 0) === 0), "itt må ikke have udbrud");
  const flat = simulateStage({ entrants, stageProfile: { profile_type: "flat", demand_vector: demand }, seed: 7 });
  const escapees = flat.ranked.filter((r) => r.components.breakaway > 0);
  assert.ok(escapees.length >= 1 && escapees.length <= 3, `1-3 escapees, fik ${escapees.length}`);
});

test("udbrud: deterministisk — samme seed giver samme escapees og bonus", () => {
  const entrants = makeEntrants(30);
  const profile = { profile_type: "rolling", demand_vector: demand };
  const a = simulateStage({ entrants, stageProfile: profile, seed: 42 });
  const b = simulateStage({ entrants: [...entrants].reverse(), stageProfile: profile, seed: 42 });
  assert.deepEqual(
    a.ranked.map((r) => [r.rider_id, r.components.breakaway]),
    b.ranked.map((r) => [r.rider_id, r.components.breakaway]),
  );
});

test("udbrud: escapees kommer fra den lavere-rangerede del (uden hunter)", () => {
  const entrants = makeEntrants(40);
  const profile = { profile_type: "flat", demand_vector: demand };
  // Terrain-rang: r000 er stærkest. Escapee må ikke være blandt top-40 %.
  // Med kalibreret cut (BREAKAWAY_TOP_EXCLUDED 0.05) udelukkes kun de absolut øverste — den reelle
  // lavere-rank-garanti måles i race:gate-harness (escapee-pick-percentiler), ikke her.
  for (let seed = 1; seed <= 20; seed++) {
    const { ranked } = simulateStage({ entrants, stageProfile: profile, seed });
    for (const r of ranked.filter((x) => x.components.breakaway > 0)) {
      const idx = Number(r.rider_id.slice(1));
      assert.ok(idx >= Math.floor(40 * BREAKAWAY_TOP_EXCLUDED), `escapee ${r.rider_id} er i den beskyttede top`);
    }
  }
});

test("hunter: markant forhøjet escapee-chance", () => {
  const base = makeEntrants(30);
  let hunterPicked = 0, samePicked = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const withHunter = base.map((e) => e.rider_id === "r015" ? { ...e, race_role: "hunter" } : e);
    const a = simulateStage({ entrants: withHunter, stageProfile: { profile_type: "flat", demand_vector: demand }, seed });
    if (a.ranked.find((r) => r.rider_id === "r015").components.breakaway > 0) hunterPicked++;
    const b = simulateStage({ entrants: base, stageProfile: { profile_type: "flat", demand_vector: demand }, seed });
    if (b.ranked.find((r) => r.rider_id === "r015").components.breakaway > 0) samePicked++;
  }
  assert.ok(hunterPicked > samePicked * 1.5, `hunter ${hunterPicked} vs uden ${samePicked}`);
});

test("BREAKAWAY_BONUS dækker de udbruds-egnede terræner (ikke itt/ttt/classic)", () => {
  assert.deepEqual(
    Object.keys(BREAKAWAY_BONUS).sort(),
    ["cobbles", "flat", "high_mountain", "hilly", "mountain", "rolling"],
  );
  for (const t of ["itt", "ttt", "classic"]) {
    assert.equal(breakawayMaxBonus(t, "solo_tt"), 0, `${t} må ikke have udbrud`);
  }
});

// ── #1021 Fase 1: finale-gradient-bevidst bonus ──────────────────────────────
test("breakawayMaxBonus: summit-finale undertrykker udbruddet (favoritterne afgør)", () => {
  assert.ok(breakawayMaxBonus("mountain", "long_climb") <= 0.08);
  assert.ok(breakawayMaxBonus("high_mountain", "long_climb") <= 0.08);
});

test("breakawayMaxBonus: descent-finale beskytter udbruddet", () => {
  assert.ok(breakawayMaxBonus("mountain", "descent") >= 0.40);
  assert.ok(breakawayMaxBonus("high_mountain", "descent") >= 0.30);
});

test("breakawayMaxBonus: hilly er udbruds-venlig (var hård 0)", () => {
  assert.ok(breakawayMaxBonus("hilly", "punch") >= 0.30);
});

test("breakawayMaxBonus: flad lav; itt/ttt giver intet udbrud", () => {
  assert.ok(breakawayMaxBonus("flat", "bunch_sprint") <= 0.32);
  assert.equal(breakawayMaxBonus("itt", "solo_tt"), 0);
  assert.equal(breakawayMaxBonus("ttt", "solo_tt"), 0);
});

test("breakawayMaxBonus: ukendt profil → 0; manglende finale → profil-default", () => {
  assert.equal(breakawayMaxBonus("nonsense", "whatever"), 0);
  assert.ok(breakawayMaxBonus("mountain", undefined) > 0); // _default-sti
});

// ── #1499: deskriptiv udbruds-status (deriveBreakawayStatus) ─────────────────
// Ren read af motorens output — verificér at den IKKE ændrer rang/score (balance-neutral)
// og at survived/caught-reglen matcher den gate-målte "holdt hjem"-definition.

const ranked = (rows) =>
  // rows: [rider_id, rank, breakaway] → minimal ranked-form
  rows.map(([rider_id, rank, breakaway]) => ({ rider_id, rank, components: { breakaway } }));

test("#1499: in_breakaway = components.breakaway > 0", () => {
  const status = deriveBreakawayStatus(ranked([
    ["esc1", 1, 0.3], ["esc2", 2, 0.2], ["peloton1", 3, 0], ["peloton2", 4, 0],
  ]));
  assert.equal(status.get("esc1").in_breakaway, true);
  assert.equal(status.get("esc2").in_breakaway, true);
  assert.equal(status.get("peloton1").in_breakaway, false);
  assert.equal(status.get("peloton2").in_breakaway, false);
});

test("#1499: udbrud holdt hjem (alle escapees foran feltet) → ingen caught", () => {
  // esc1+esc2 finishede 1-2, første ikke-escapee er rank 3 → begge holdt hjem.
  const status = deriveBreakawayStatus(ranked([
    ["esc1", 1, 0.3], ["esc2", 2, 0.2], ["peloton1", 3, 0], ["peloton2", 4, 0],
  ]));
  assert.equal(status.get("esc1").breakaway_caught, false);
  assert.equal(status.get("esc2").breakaway_caught, false);
});

test("#1499: escapee bag en ikke-escapee → caught", () => {
  // Feltet (peloton1, rank 1) slugte esc2 (rank 3): esc1 holdt hjem, esc2 caught.
  const status = deriveBreakawayStatus(ranked([
    ["peloton1", 1, 0], ["esc1", 2, 0.3], ["esc2", 3, 0.2], ["peloton2", 4, 0],
  ]));
  // bedste ikke-escapee = rank 1 → esc1 (rank 2) > 1 → caught; esc2 (rank 3) > 1 → caught.
  assert.equal(status.get("esc1").in_breakaway, true);
  assert.equal(status.get("esc1").breakaway_caught, true);
  assert.equal(status.get("esc2").breakaway_caught, true);
  // ikke-escapees er aldrig caught.
  assert.equal(status.get("peloton1").breakaway_caught, false);
});

test("#1499: delvist hold — escapee foran feltet survived, escapee bag caught", () => {
  // esc1 vinder (rank 1), feltet kommer på rank 2, esc2 caught bagved (rank 5).
  const status = deriveBreakawayStatus(ranked([
    ["esc1", 1, 0.3], ["peloton1", 2, 0], ["peloton2", 3, 0], ["peloton3", 4, 0], ["esc2", 5, 0.2],
  ]));
  assert.equal(status.get("esc1").breakaway_caught, false); // rank 1 < bedste ikke-escapee (2)
  assert.equal(status.get("esc2").breakaway_caught, true);  // rank 5 > 2
});

test("#1499: ingen escapees → alt false; tom liste → tom map", () => {
  const none = deriveBreakawayStatus(ranked([["a", 1, 0], ["b", 2, 0]]));
  assert.equal(none.get("a").in_breakaway, false);
  assert.equal(none.get("a").breakaway_caught, false);
  assert.equal(deriveBreakawayStatus([]).size, 0);
  assert.equal(deriveBreakawayStatus().size, 0);
});

test("#1499: deriveBreakawayStatus matcher simulateStage-output (vinder-holdt-hjem ⇔ in_breakaway & ikke caught)", () => {
  // Mod den ÆGTE motor: hver gang vinderen er escapee skal status sige in_breakaway && !caught.
  const ab = (over = {}) => ({
    climbing: 50, time_trial: 50, sprint: 50, punch: 50, endurance: 50,
    cobblestone: 50, acceleration: 50, recovery: 50, tactics: 50, positioning: 50, ...over,
  });
  const entrants = Array.from({ length: 40 }, (_, i) => ({
    rider_id: `r${String(i).padStart(3, "0")}`,
    abilities: ab({ sprint: 90 - i * 1.5, tactics: 40 + (i % 30) }),
  }));
  const dem = { sprint: 0.6, endurance: 0.3, randomness: 0.5 };
  let checkedWinners = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { ranked: r } = simulateStage({ entrants, stageProfile: { profile_type: "flat", finale_type: "bunch_sprint", demand_vector: dem }, seed });
    const status = deriveBreakawayStatus(r);
    // Balance-neutral: status dækker præcis de samme ryttere, rang/score urørt.
    assert.equal(status.size, r.length);
    const winner = r[0];
    if ((winner.components.breakaway || 0) > 0) {
      checkedWinners++;
      assert.equal(status.get(winner.rider_id).in_breakaway, true);
      assert.equal(status.get(winner.rider_id).breakaway_caught, false, `escapee-vinder ${winner.rider_id} må ikke være caught`);
    }
    // Hver caught escapee SKAL have mindst én ikke-escapee foran sig.
    for (const row of r) {
      const st = status.get(row.rider_id);
      if (st.breakaway_caught) {
        const aheadNonEsc = r.some((x) => x.rank < row.rank && !((x.components.breakaway || 0) > 0));
        assert.ok(aheadNonEsc, `caught ${row.rider_id} skal have ikke-escapee foran`);
      }
    }
  }
  assert.ok(checkedWinners > 0, "mindst én escapee-vinder forventet over 60 seeds");
});

test("#1021: mountain descent-finale giver flere escapee-sejre end summit-finale", () => {
  const mtDemand = { climbing: 0.5, tempo: 0.12, endurance: 0.14, randomness: 0.1 };
  const entrants = Array.from({ length: 60 }, (_, i) => ({
    rider_id: `r${String(i).padStart(3, "0")}`,
    abilities: ab({ climbing: 90 - i, endurance: 50, tempo: 50 }),
  }));
  let descentBreak = 0, summitBreak = 0;
  for (let s = 1; s <= 200; s++) {
    const d = simulateStage({ entrants, stageProfile: { profile_type: "mountain", finale_type: "descent", demand_vector: mtDemand }, seed: s });
    const m = simulateStage({ entrants, stageProfile: { profile_type: "mountain", finale_type: "long_climb", demand_vector: mtDemand }, seed: s });
    if ((d.ranked[0].components.breakaway || 0) > 0) descentBreak++;
    if ((m.ranked[0].components.breakaway || 0) > 0) summitBreak++;
  }
  assert.ok(descentBreak > summitBreak, `descent ${descentBreak} skal slå summit ${summitBreak}`);
});
