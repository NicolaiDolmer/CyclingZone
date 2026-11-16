// #7535 valg-skitser: billedsættet skal være til at aflæse for ejeren. Hvert punkt har 2-3
// varianter, præcis én er anbefalet, og hver caption siger både fordel og ulempe. Truppen er
// den samme i alle visninger (sidste runde viste andre ryttere i Taktik end i Trup).
import { test } from "node:test";
import assert from "node:assert/strict";
import { POINTS, VARIANTS, configFor } from "./variants.ts";
import { RACE, RIDERS, SELECTED, listCounts } from "./data.ts";

test("hvert af de 8 punkter har 2-3 varianter og præcis én anbefalet", () => {
  assert.deepEqual(Object.keys(POINTS).map(Number), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const p of Object.keys(POINTS).map(Number)) {
    const vs = VARIANTS.filter((v) => v.point === p);
    assert.ok(vs.length >= 2 && vs.length <= 3, `punkt ${p} har ${vs.length} varianter`);
    assert.equal(vs.filter((v) => v.recommended).length, 1, `punkt ${p} skal have én anbefalet`);
    assert.deepEqual(vs.map((v) => v.letter), ["A", "B", "C"].slice(0, vs.length));
  }
});

test("id'er er unikke og følger punkt + bogstav (filnavnene i pr-screens)", () => {
  const ids = VARIANTS.map((v) => v.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const v of VARIANTS) assert.equal(v.id, `${v.point}${v.letter.toLowerCase()}`);
});

test("hver caption er én sætning med både fordel og ulempe", () => {
  for (const v of VARIANTS) {
    assert.match(v.line, /^Fordel: .+; ulempe: .+\.$/, v.id);
    assert.ok(!/\.\s+\S/.test(v.line.replace(/\b(ca|pr)\. /g, "")), `${v.id} er mere end én sætning`);
  }
});

test("samme trup i alle visninger: præcis løbets antal udtaget, og kun de udtagne har rolle og plan", () => {
  assert.equal(SELECTED.length, RACE.squadSize);
  for (const r of RIDERS) {
    assert.equal(Boolean(r.role), r.selected, `${r.id} rolle`);
    assert.equal(Boolean(r.plan), r.selected, `${r.id} plan`);
  }
});

test("taktik-varianterne viser Taktik-visningen, og 8-varianterne har en ugemt trup", () => {
  for (const v of VARIANTS.filter((x) => x.point === 1 || x.point === 8)) assert.equal(configFor(v).view, "tactics");
  for (const v of VARIANTS.filter((x) => x.point === 8)) assert.equal(configFor(v).squadDirty, true);
});

test("løbslistens tællere passer til 3B's underlinje", () => {
  assert.deepEqual(listCounts(), { squad: 4, tactic: 3 });
});
