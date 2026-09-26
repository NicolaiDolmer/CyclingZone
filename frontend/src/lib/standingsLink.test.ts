// #5315 — "Full standings"-linket skal lande på managerens egen pulje/gruppe
// (samme division + samme pulje som holdet), ikke hele divisionen. Ren
// funktion, ingen React/Supabase-afhængigheder — se standingsLink.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { buildStandingsLink } from "./standingsLink.ts";

test("pulje kendt -> pulje-URL med division + pool", () => {
  assert.equal(
    buildStandingsLink(true, { id: 57, tier: 3 }),
    "/standings?division=3&pool=57",
  );
});

test("pulje kendt uden tier-felt -> pool alene i URL'en", () => {
  assert.equal(buildStandingsLink(true, { id: 12 }), "/standings?pool=12");
});

test("hasPoolSubtabs=false (tieren har kun én pulje) -> division-URL (fallback)", () => {
  assert.equal(buildStandingsLink(false, { id: 57, tier: 3 }), "/standings");
});

test("ownPoolRow null (helt nyt hold uden egen pulje endnu) -> division-URL (fallback)", () => {
  assert.equal(buildStandingsLink(true, null), "/standings");
});

test("ownPoolRow undefined -> division-URL (fallback)", () => {
  assert.equal(buildStandingsLink(true, undefined), "/standings");
});

test("ownPoolRow uden id -> division-URL (fallback, defensivt)", () => {
  // @ts-expect-error — id er påkrævet i typen, testes alligevel defensivt
  assert.equal(buildStandingsLink(true, { tier: 3 }), "/standings");
});

test("pool-id 0 er et gyldigt id og skal IKKE trigge fallback (kun == null tjekkes)", () => {
  assert.equal(buildStandingsLink(true, { id: 0, tier: 1 }), "/standings?division=1&pool=0");
});
