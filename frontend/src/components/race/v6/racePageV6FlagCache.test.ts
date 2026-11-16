// #7865 punkt 7 · Den sidst kendte værdi af race_page_v6 til første billede.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RACE_PAGE_V6_LAST_KEY, readLastRacePageV6, rememberedFor, rememberedFromFlags, writeLastRacePageV6 } from "./racePageV6FlagCache.ts";

function memory() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } };
}

test("uden husket vaerdi er kontakten slukket: den gamle side tegnes straks, ingen ventetid", () => {
  assert.deepEqual(readLastRacePageV6(memory()), { userId: null, on: false });
  assert.deepEqual(readLastRacePageV6(null), { userId: null, on: false });
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(readLastRacePageV6(broken).on, false);
  assert.doesNotThrow(() => writeLastRacePageV6({ userId: "u1", on: true }, broken));
  const junk = memory();
  junk.setItem(RACE_PAGE_V6_LAST_KEY, "1");
  assert.equal(readLastRacePageV6(junk).on, false, "ukendt format er slukket");
});

test("en beta-tester faar v6-rammen fra foerste billede naeste gang (intet hop fra den gamle side)", () => {
  const s = memory();
  writeLastRacePageV6({ userId: "u1", on: true }, s);
  assert.deepEqual(readLastRacePageV6(s), { userId: "u1", on: true });
  writeLastRacePageV6({ userId: "u1", on: false }, s);
  assert.equal(readLastRacePageV6(s).on, false);
  writeLastRacePageV6({ userId: null, on: true }, s);
  assert.equal(readLastRacePageV6(s).on, false, "uden kendt konto huskes intet 'til'");
});

test("Codex-fund: en anden konto i samme browser arver ikke den huskede vaerdi", () => {
  const remembered = { userId: "u1", on: true };
  assert.equal(rememberedFor(remembered, "u1"), true);
  assert.equal(rememberedFor(remembered, "u2"), false);
  assert.equal(rememberedFor(remembered, null), false, "logget ud: slukket");
  const hook = readFileSync(new URL("./racePageV6Flag.ts", import.meta.url), "utf8");
  assert.match(hook, /!rememberedFor\(remembered, userId\)\) setEnabled\(false\)/, "slukkes, saa snart sessionen er laest");
});

test("kun et kendt svar huskes; en fejl ({}) slukker nu uden at overskrive det huskede", () => {
  assert.equal(rememberedFromFlags({ race_page_v6: true }, "race_page_v6"), true);
  assert.equal(rememberedFromFlags({ race_page_v6: false }, "race_page_v6"), false);
  assert.equal(rememberedFromFlags({}, "race_page_v6"), null);
  assert.equal(rememberedFromFlags(null, "race_page_v6"), null);
  const hook = readFileSync(new URL("./racePageV6Flag.ts", import.meta.url), "utf8");
  assert.match(hook, /useState\(\(\) => readLastRacePageV6\(\)\)/, "foerste billede bruger den huskede vaerdi");
  assert.match(hook, /if \(known !== null\) writeLastRacePageV6\(/);
  assert.match(hook, /setEnabled\(known === true\)/, "serverens svar vinder bagefter");
});
