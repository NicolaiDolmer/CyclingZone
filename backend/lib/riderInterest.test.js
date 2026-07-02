import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRiderInterest } from "./riderInterest.js";

const SCOUTS = [
  { team_id: "t1", created_at: "2026-06-20T10:00:00Z", team: { id: "t1", name: "Helios CC" }, season: { number: 2 } },
  { team_id: "t1", created_at: "2026-06-25T10:00:00Z", team: { id: "t1", name: "Helios CC" }, season: { number: 2 } },
  { team_id: "t2", created_at: "2026-06-22T10:00:00Z", team: { id: "t2", name: "Atlas Racing" }, season: { number: 2 } },
];
const WATCHES = [
  { created_at: "2026-06-24T09:00:00Z" },
  { created_at: "2026-06-18T09:00:00Z" },
];

test("ejer ser scout-liste med niveau (antal slots) + seneste dato", () => {
  const out = buildRiderInterest({ scoutRows: SCOUTS, watchRows: WATCHES, isOwner: true });
  assert.equal(out.scouted_by_count, 2);
  assert.equal(out.scouts.length, 2);
  const helios = out.scouts.find((s) => s.team_id === "t1");
  assert.equal(helios.level, 2, "2 scout-handlinger = niveau 2");
  assert.equal(helios.last_at, "2026-06-25T10:00:00Z");
  assert.equal(helios.season, 2);
  assert.equal(out.scouts[0].team_id, "t1", "senest aktive scout først");
});

test("ikke-ejer: scouts=null og feed-events anonymiseres (ingen team-navne)", () => {
  const out = buildRiderInterest({ scoutRows: SCOUTS, watchRows: WATCHES, isOwner: false });
  assert.equal(out.scouts, null);
  assert.equal(out.scouted_by_count, 2, "antallet er ikke hemmeligt — kun hvem");
  for (const e of out.feed.filter((e) => e.type === "scout")) {
    assert.equal(e.team_name, null, "team-navn maa aldrig laekke til ikke-ejere");
  }
});

test("feed fletter scout- og watchlist-events, nyeste først, cap 8", () => {
  const out = buildRiderInterest({ scoutRows: SCOUTS, watchRows: WATCHES, isOwner: true });
  assert.deepEqual(out.feed.map((e) => e.type), ["scout", "watch", "scout", "scout", "watch"]);
  const many = buildRiderInterest({
    scoutRows: [],
    watchRows: Array.from({ length: 12 }, (_, i) => ({ created_at: `2026-06-${String(i + 1).padStart(2, "0")}T00:00:00Z` })),
    isOwner: false,
  });
  assert.equal(many.feed.length, 8);
});

test("ejerholdets egne gamle scout-handlinger filtreres ud (scoutede-så-købte)", () => {
  const out = buildRiderInterest({ scoutRows: SCOUTS, watchRows: [], isOwner: true, ownerTeamId: "t1" });
  assert.equal(out.scouted_by_count, 1);
  assert.deepEqual(out.scouts.map((s) => s.team_id), ["t2"]);
  assert.equal(out.feed.filter((e) => e.type === "scout").length, 1);
});

test("tom input giver tomt-men-gyldigt svar", () => {
  const out = buildRiderInterest({});
  assert.deepEqual(out, { scouted_by_count: 0, scouts: null, feed: [] });
  const ownEmpty = buildRiderInterest({ isOwner: true });
  assert.deepEqual(ownEmpty.scouts, []);
});
