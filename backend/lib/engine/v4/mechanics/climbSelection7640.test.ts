// backend/lib/engine/v4/mechanics/climbSelection7640.test.ts
// #7640 (KUN s5_profiles_v3 + kontakten split_attack_cause_7640, SLUKKET): et klatre-split
// der koerer FREM fra gruppen (alt ud-angrebet) faar aarsagen "attack" i stedet for
// "climb_deficit". Kun event-feltet cause aendres; grupper, huller, tider og resultater er
// de samme. Ingen balance-tal her (hard rule 17); kun hashes og kvalitative udfald.
//
// Slukket = bit-identisk med merge-basen FOER kontakten: __fixtures__/splitAttack7640Off.json
// er skrevet af merge-basens kode (sourceCommit i filen) med de samme scenarier
// (__fixtures__/splitAttack7640Scenarios.js) og genereres aldrig med den nye kode.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SPLIT_ATTACK_CAUSE_7640 } from "./climbSelection.ts";
import { loadRaceEngineV4 } from "../../../raceEngineV4Bridge.js";
import { CASES_7640, computeOffDigests7640, digest7640, run7640 } from "../../../__fixtures__/splitAttack7640Scenarios.js";

const FROZEN = JSON.parse(readFileSync(new URL("../../../__fixtures__/splitAttack7640Off.json", import.meta.url), "utf8"));

type SplitEvent = { type: string; km: number; params: { cause?: string; gap_seconds?: number; rider_ids?: string[] } };

function splitsOf(result: { timeline?: { events?: SplitEvent[] } | null }): SplitEvent[] {
  return (result.timeline?.events ?? []).filter((e) => e.type === "peloton_splits");
}

function frozenDigests(): Record<string, unknown> {
  const { sourceCommit: _s, note: _n, ...digests } = FROZEN;
  return digests;
}

test("#7640: aarsagen er en fast streng", () => {
  assert.equal(SPLIT_ATTACK_CAUSE_7640, "attack");
});

test("#7640 slukket: bit-identisk med den frosne merge-base (ingen kontakt sendt)", async () => {
  assert.match(String(FROZEN.sourceCommit), /^[0-9a-f]{40}$/, "fixturen naevner merge-basen");
  assert.deepEqual(await computeOffDigests7640(), frozenDigests());
});

test("#7640 slukket: kontakten eksplicit false er det samme som udeladt", async () => {
  const engine = await loadRaceEngineV4();
  for (const c of CASES_7640) {
    assert.deepEqual(digest7640(run7640(engine, c, { splitAttackCause7640: false })), FROZEN[c.key], c.key);
  }
});

test("#7640 slukket: fejlen findes i dag (angrebet frem staar som climb_deficit)", async () => {
  const engine = await loadRaceEngineV4();
  const ahead = splitsOf(run7640(engine, CASES_7640[0])).filter((e) => Number(e.params.gap_seconds) < 0);
  assert.ok(ahead.length > 0, "scenariet har et angreb frem paa stigningen");
  assert.ok(ahead.every((e) => e.params.cause === "climb_deficit"), "uden kontakten: den gamle aarsag");
});

test("#7640 taendt: angrebet frem faar aarsagen attack; kun cause-feltet aendres", async () => {
  const engine = await loadRaceEngineV4();
  let attacks = 0;
  for (const c of CASES_7640.filter((x) => x.revision === "s5_profiles_v3")) {
    const result = run7640(engine, c, { splitAttackCause7640: true });
    // Alt andet end aarsagen er bit for bit som merge-basen: grupper, huller, tider, resultater.
    assert.equal(digest7640(result).withoutCausesSha256, FROZEN[c.key].withoutCausesSha256, `${c.key}: kun cause aendres`);
    for (const e of splitsOf(result)) {
      const ahead = Number(e.params.gap_seconds) < 0;
      if (e.params.cause === SPLIT_ATTACK_CAUSE_7640) attacks += 1;
      assert.equal(e.params.cause === SPLIT_ATTACK_CAUSE_7640, ahead, `${c.key} km ${e.km}: angreb <=> frem (negativt hul)`);
    }
  }
  assert.ok(attacks > 0, "mindst et angreb i scenarierne");
});

test("#7640 taendt under s5_profiles_v2: ignoreres (bit-identisk)", async () => {
  const engine = await loadRaceEngineV4();
  for (const c of CASES_7640.filter((x) => x.revision !== "s5_profiles_v3")) {
    assert.deepEqual(digest7640(run7640(engine, c, { splitAttackCause7640: true })), FROZEN[c.key], c.key);
  }
});
