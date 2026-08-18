import test from "node:test";
import assert from "node:assert/strict";
import { buildRatingTrajectory, trajectoryTrend } from "./riderRatingTrajectory.js";

// Simpel sprinter-opskrift-kompatibel evne-shape (sprint/acceleration/positioning/flat/durability).
const abilities = (sprint) => ({
  sprint, acceleration: sprint - 2, positioning: sprint - 4, flat: sprint - 2, durability: sprint - 5,
});

test("buildRatingTrajectory: filtrerer til seneste sæson, sorterer kronologisk", () => {
  const rows = [
    { rider_id: "r1", snapshot_date: "2026-08-10", season_number: 2, abilities: abilities(30) },
    { rider_id: "r1", snapshot_date: "2026-03-01", season_number: 1, abilities: abilities(10) }, // gammel sæson — ekskluderes
    { rider_id: "r1", snapshot_date: "2026-08-01", season_number: 2, abilities: abilities(25) },
  ];
  const traj = buildRatingTrajectory(rows, "sprinter");
  assert.equal(traj.length, 2);
  assert.equal(traj[0].date, "2026-08-01");
  assert.equal(traj[1].date, "2026-08-10");
  assert.ok(traj[1].rating > traj[0].rating);
});

test("buildRatingTrajectory: manglende primaryType eller tomme rows → []", () => {
  assert.deepEqual(buildRatingTrajectory([], "sprinter"), []);
  assert.deepEqual(buildRatingTrajectory(undefined, "sprinter"), []);
  assert.deepEqual(
    buildRatingTrajectory([{ snapshot_date: "2026-08-01", season_number: 1, abilities: abilities(30) }], null),
    []
  );
});

test("buildRatingTrajectory: ukendt rolle (ratingForRole → null) filtreres væk", () => {
  const rows = [{ snapshot_date: "2026-08-01", season_number: 1, abilities: abilities(30) }];
  assert.deepEqual(buildRatingTrajectory(rows, "not-a-real-role"), []);
});

test("trajectoryTrend: rising ved tydelig stigning", () => {
  assert.equal(trajectoryTrend([{ rating: 20 }, { rating: 25 }, { rating: 29 }]), "rising");
});

test("trajectoryTrend: declining ved tydeligt fald", () => {
  assert.equal(trajectoryTrend([{ rating: 30 }, { rating: 24 }]), "declining");
});

test("trajectoryTrend: steady ved lille udsving under tærsklen", () => {
  assert.equal(trajectoryTrend([{ rating: 25 }, { rating: 26 }]), "steady");
});

test("trajectoryTrend: under 2 punkter → null", () => {
  assert.equal(trajectoryTrend([{ rating: 25 }]), null);
  assert.equal(trajectoryTrend([]), null);
  assert.equal(trajectoryTrend(undefined), null);
});
