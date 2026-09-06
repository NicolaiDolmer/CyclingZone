// backend/scripts/lib/headToHeadTeamPlay.test.js
// M16 holdspils-maalingen (#4246). Samme testform som headToHeadAnchors.test.js:
// syntetiske rows med KENDTE placeringer, saa maalingens regnestykke er laast
// uafhaengigt af motorernes faktiske tal.

import { test } from "node:test";
import assert from "node:assert/strict";

import { abilityRankInField, formatTeamPlay, measureTeamPlay } from "./headToHeadTeamPlay.js";

const ABILITIES = new Map([
  ["a", { climbing: 90 }],
  ["b", { climbing: 70 }],
  ["c", { climbing: 50 }],
  ["d", { climbing: 30 }],
]);

/** Row i runHeadToHead()-form med kendte placeringer for begge motorer. */
function row({ v3Order, v4Order, roles }) {
  return {
    raw: {
      roles: new Map(Object.entries(roles)),
      stageRow: { demand_vector: { climbing: 1 } },
      v3Output: { ranked: v3Order.map((rider_id, i) => ({ rider_id, rank: i + 1 })) },
      v4Output: { results: v4Order.map((rider_id, i) => ({ rider_id, rank: i + 1 })) },
    },
  };
}

test("abilityRankInField: rangerer paa demand_vector-vaegtet evne, ties paa rider_id", () => {
  const ranks = abilityRankInField(["d", "a", "c", "b"], ABILITIES, { climbing: 1 });
  assert.deepEqual([...ranks.entries()].sort((x, y) => x[1] - y[1]).map(([id]) => id), ["a", "b", "c", "d"]);
});

test("abilityRankInField: tom demand_vector giver en STABIL orden, ikke et kast", () => {
  const first = abilityRankInField(["d", "a", "c", "b"], ABILITIES, {});
  const second = abilityRankInField(["b", "c", "a", "d"], ABILITIES, {});
  assert.deepEqual([...first.entries()].sort(), [...second.entries()].sort());
});

test("delta = 0 for hver rolle naar placeringen praecis foelger evnen (ingen holdspil)", () => {
  const rows = [
    row({
      v3Order: ["a", "b", "c", "d"],
      v4Order: ["a", "b", "c", "d"],
      roles: { a: "captain", b: "helper", c: "helper", d: "free_role" },
    }),
  ];
  const { v3, v4 } = measureTeamPlay(rows, { abilitiesByRider: ABILITIES });
  assert.equal(v3.byRole.captain.meanDelta, 0);
  assert.equal(v3.byRole.helper.meanDelta, 0);
  assert.equal(v4.protectionGap, 0, "en motor uden holdspil har et beskyttelses-gab paa nul");
});

test("beskyttelses-gabet fanger BAADE kaptajnens loeft og hjaelperens pris", () => {
  // v4: kaptajnen (evne-rang 4) koerer i mål som nr. 1 => +3; hjaelperen
  // (evne-rang 1) falder til nr. 4 => -3. Gab = 3 - (-3) = 6.
  const rows = [
    row({
      v3Order: ["a", "b", "c", "d"],
      v4Order: ["d", "b", "c", "a"],
      roles: { d: "captain", a: "helper", b: "helper", c: "helper" },
    }),
  ];
  const { v3, v4 } = measureTeamPlay(rows, { abilitiesByRider: ABILITIES });
  assert.equal(v3.protectionGap, 0, "v3-rekkefolgen foelger evnen => intet gab");
  assert.equal(v4.byRole.captain.meanDelta, 3);
  assert.equal(v4.byRole.helper.meanDelta, -1, "gennemsnit over de tre hjaelpere: (-3 + 0 + 0)/3");
  assert.equal(v4.protectionGap, 4);
});

test("rows uden roller (orders=none) taelles ikke med", () => {
  const bare = [{ raw: { roles: null, stageRow: {}, v3Output: { ranked: [] }, v4Output: { results: [] } } }];
  const { v4 } = measureTeamPlay(bare, { abilitiesByRider: ABILITIES });
  assert.equal(v4.stages, 0);
  assert.equal(v4.protectionGap, null, "ingen data => n/a, ikke 0 (et gulv er ikke et maal)");
});

test("formatTeamPlay: rapporten navngiver begge motorer og udelader tomme roller", () => {
  const rows = [
    row({
      v3Order: ["a", "b", "c", "d"],
      v4Order: ["d", "b", "c", "a"],
      roles: { d: "captain", a: "helper", b: "helper", c: "helper" },
    }),
  ];
  const text = formatTeamPlay(measureTeamPlay(rows, { abilitiesByRider: ABILITIES }));
  assert.match(text, /Holdspil \(M16\)/);
  assert.match(text, /captain/);
  assert.match(text, /helper/);
  assert.doesNotMatch(text, /free_role/, "en rolle uden observationer fylder ikke i rapporten");
  assert.match(text, /Beskyttelses-gab/);
});
