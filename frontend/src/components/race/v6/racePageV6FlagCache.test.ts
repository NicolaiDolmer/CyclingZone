// #7865 punkt 7 · Den sidst kendte værdi af race_page_v6 til første billede.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RACE_PAGE_V6_LAST_KEY, readLastRacePageV6, rememberedFromFlags, writeLastRacePageV6 } from "./racePageV6FlagCache.ts";

function memory() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } };
}

test("uden husket vaerdi er kontakten slukket: den gamle side tegnes straks, ingen ventetid", () => {
  assert.equal(readLastRacePageV6(memory()), false);
  assert.equal(readLastRacePageV6(null), false);
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(readLastRacePageV6(broken), false);
  assert.doesNotThrow(() => writeLastRacePageV6(true, broken));
});

test("en beta-tester faar v6-rammen fra foerste billede naeste gang (intet hop fra den gamle side)", () => {
  const s = memory();
  writeLastRacePageV6(true, s);
  assert.equal(s.getItem(RACE_PAGE_V6_LAST_KEY), "1");
  assert.equal(readLastRacePageV6(s), true);
  writeLastRacePageV6(false, s);
  assert.equal(readLastRacePageV6(s), false);
});

test("kun et kendt svar huskes; en fejl ({}) slukker nu uden at overskrive det huskede", () => {
  assert.equal(rememberedFromFlags({ race_page_v6: true }, "race_page_v6"), true);
  assert.equal(rememberedFromFlags({ race_page_v6: false }, "race_page_v6"), false);
  assert.equal(rememberedFromFlags({}, "race_page_v6"), null);
  assert.equal(rememberedFromFlags(null, "race_page_v6"), null);
  const hook = readFileSync(new URL("./racePageV6Flag.ts", import.meta.url), "utf8");
  assert.match(hook, /useState\(\(\) => readLastRacePageV6\(\)\)/, "foerste billede bruger den huskede vaerdi");
  assert.match(hook, /if \(remembered !== null\) writeLastRacePageV6\(remembered\)/);
  assert.match(hook, /setEnabled\(remembered === true\)/, "serverens svar vinder bagefter");
});
