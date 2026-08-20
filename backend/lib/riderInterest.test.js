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
  assert.deepEqual(out, { scouted_by_count: 0, scouts: null, feed: [], viewer_scouted: false });
  const ownEmpty = buildRiderInterest({ isOwner: true });
  assert.deepEqual(ownEmpty.scouts, []);
});

// #4036: spiller-rapport 20/8 — "Scouted by ... rival team" / "A rival scouted
// him" blev vist selv når det var VIEWERENS EGET hold. Vieweren skal se sine
// egne handlinger tydeligt, uden at scouting-fog'en (#2798) lækker HVILKE
// rivaler der scouter.
test("viewerens eget scout-hold markeres self:true + team_name, uden at afsloere andre", () => {
  const out = buildRiderInterest({ scoutRows: SCOUTS, watchRows: [], isOwner: false, viewerTeamId: "t1" });
  assert.equal(out.viewer_scouted, true, "vieweren er selv blandt de talte");
  assert.ok(out.feed.some((e) => e.self), "mindst ét self-markeret event");
  for (const e of out.feed.filter((e) => e.type === "scout")) {
    if (e.self) {
      assert.equal(e.team_name, "Helios CC", "eget team-navn er ikke en lækage");
    } else {
      assert.equal(e.team_name, null, "rivalens team-navn maa stadig ikke laekke");
    }
  }
});

test("viewer der ikke selv har scoutet faar viewer_scouted:false", () => {
  const out = buildRiderInterest({ scoutRows: SCOUTS, watchRows: [], isOwner: false, viewerTeamId: "t9" });
  assert.equal(out.viewer_scouted, false);
  assert.ok(out.feed.every((e) => e.self === false));
});

test("viewerens eget watchlist-event markeres self:true, andres forbliver anonyme", () => {
  const watchRowsWithUser = [
    { created_at: "2026-06-24T09:00:00Z", user_id: "u-viewer" },
    { created_at: "2026-06-18T09:00:00Z", user_id: "u-other" },
  ];
  const out = buildRiderInterest({ scoutRows: [], watchRows: watchRowsWithUser, isOwner: false, viewerUserId: "u-viewer" });
  const watchEvents = out.feed.filter((e) => e.type === "watch");
  assert.equal(watchEvents.length, 2);
  assert.equal(watchEvents.find((e) => e.date === "2026-06-24T09:00:00Z").self, true);
  assert.equal(watchEvents.find((e) => e.date === "2026-06-18T09:00:00Z").self, false);
});
