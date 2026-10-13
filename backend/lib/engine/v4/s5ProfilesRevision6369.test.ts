// backend/lib/engine/v4/s5ProfilesRevision6369.test.ts
// #6369 Fase 0: regel-revisionen s5_profiles_v1 er TOM. Indtil Spor 2 bygger S5-motoren
// bag den, skal en etape under s5_profiles_v1 give byte-identisk output med samme etape
// under official_times_v4 (dens forgaenger i arvelinjen). Testen koerer alle motor-
// fixtures under begge revisioner og sammenligner hele StageOutput.
//
// Naar Spor 2 laegger adfaerd bag isS5ProfilesV1OrLater, skal denne test indsnaevres til
// de fixtures adfaerden ikke rammer (fx dem uden de nye finaler), ikke slettes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { simulateStageV4 } from "./index.ts";
import { normalizeRulesRevision } from "./segmentLoop.ts";
import type { StageInput } from "./types.ts";

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

function fixtureInputs(): Array<{ name: string; input: StageInput }> {
  return readdirSync(FIXTURES_DIR)
    .filter((name) => statSync(path.join(FIXTURES_DIR, name)).isDirectory())
    .sort()
    .map((name) => ({
      name,
      input: JSON.parse(readFileSync(path.join(FIXTURES_DIR, name, "input.json"), "utf8")) as StageInput,
    }));
}

test("#6369: motoren kender s5_profiles_v1 (ingen kast), ukendte revisioner kaster stadig", () => {
  assert.equal(normalizeRulesRevision("s5_profiles_v1"), "s5_profiles_v1");
  assert.throws(() => normalizeRulesRevision("s5_profiles_v2"));
});

test("#6369: s5_profiles_v1 er tom - samme StageOutput som official_times_v4 paa alle motor-fixtures", () => {
  const fixtures = fixtureInputs();
  assert.ok(fixtures.length >= 3, `forventede motor-fixtures i ${FIXTURES_DIR}`);
  for (const { name, input } of fixtures) {
    const v4 = simulateStageV4({ ...input, rules_revision: "official_times_v4" });
    const s5 = simulateStageV4({ ...input, rules_revision: "s5_profiles_v1" });
    assert.deepEqual(s5, v4, `${name}: s5_profiles_v1 afviger fra official_times_v4`);
  }
});
