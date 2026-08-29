import test from "node:test";
import assert from "node:assert/strict";

import {
  fetchLiveAcademyOffers,
  mayTeamAcquireRider,
  filterOutPromisedAcademyRiders,
} from "./academyOfferProtection.js";

// Mock af den ENE tabel helperen rører: academy_intake, læst gennem fetchAllRows
// (select → eq → order → range).
function makeMock({ intake = [] } = {}) {
  return {
    from(table) {
      assert.equal(table, "academy_intake", "helperen må kun læse academy_intake");
      const filters = [];
      const b = {
        select() { return b; },
        eq(col, val) { filters.push([col, val]); return b; },
        order() { return b; },
        range(from, to) {
          const out = intake.filter((r) => filters.every(([c, v]) => r[c] === v));
          return Promise.resolve({ data: out.slice(from, to + 1), error: null });
        },
      };
      return b;
    },
  };
}

test("fetchLiveAcademyOffers: kun 'offered' tæller som levende tilbud", async () => {
  const supabase = makeMock({
    intake: [
      { rider_id: "r1", team_id: "human-1", status: "offered" },
      { rider_id: "r2", team_id: "human-2", status: "signed" },
      { rider_id: "r3", team_id: "human-3", status: "rejected" },
    ],
  });

  const offers = await fetchLiveAcademyOffers(supabase);

  assert.equal(offers.size, 1);
  assert.equal(offers.get("r1"), "human-1");
  assert.equal(offers.has("r2"), false, "en signeret række er ikke et levende tilbud");
  assert.equal(offers.has("r3"), false, "en afvist række er ikke et levende tilbud");
});

test("mayTeamAcquireRider: et andet hold må ikke overtage en lovet rytter", () => {
  const offers = new Map([["r1", "human-1"]]);

  assert.equal(mayTeamAcquireRider(offers, "r1", "ai-team"), false);
  assert.equal(mayTeamAcquireRider(offers, "r1", "human-1"), true,
    "signeringen — holdet tilbuddet gik til — skal passere");
  assert.equal(mayTeamAcquireRider(offers, "fri-agent", "ai-team"), true,
    "en rytter uden levende tilbud er almindeligt fri vildt");
});

// Selve #4213-regressionen: free-agent-poolen sorterer på pris, og
// akademikandidater er de billigste ryttere i spillet. Uden filteret ligger de
// derfor ØVERST i købslisten — testen fikserer at de falder ud, og at
// rækkefølgen af de øvrige bevares.
test("filterOutPromisedAcademyRiders: billige akademikandidater falder ud af poolen", () => {
  const offers = new Map([
    ["akademi-1", "human-1"],
    ["akademi-2", "human-2"],
  ]);
  const pool = [
    { id: "akademi-1", market_value: 1281 },
    { id: "akademi-2", market_value: 4925 },
    { id: "senior-1", market_value: 230 },
    { id: "senior-2", market_value: 37956 },
  ];

  const { kept, blocked } = filterOutPromisedAcademyRiders(pool, offers, "ai-team");

  assert.deepEqual(kept.map((r) => r.id), ["senior-1", "senior-2"]);
  assert.deepEqual(blocked.map((r) => r.id), ["akademi-1", "akademi-2"]);
});

test("filterOutPromisedAcademyRiders: det tilbydende hold beholder sin egen kandidat", () => {
  const offers = new Map([["akademi-1", "human-1"]]);
  const pool = [{ id: "akademi-1", market_value: 1281 }, { id: "senior-1", market_value: 230 }];

  const { kept, blocked } = filterOutPromisedAcademyRiders(pool, offers, "human-1");

  assert.deepEqual(kept.map((r) => r.id), ["akademi-1", "senior-1"]);
  assert.equal(blocked.length, 0);
});

test("filterOutPromisedAcademyRiders: tom pool og ingen tilbud er trygge", () => {
  assert.deepEqual(filterOutPromisedAcademyRiders([], new Map(), "t").kept, []);
  const pool = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(
    filterOutPromisedAcademyRiders(pool, new Map(), "t").kept.map((r) => r.id),
    ["a", "b"]);
});
