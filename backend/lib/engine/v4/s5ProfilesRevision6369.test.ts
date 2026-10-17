// backend/lib/engine/v4/s5ProfilesRevision6369.test.ts
// #6369 Fase 0: regel-revisionen s5_profiles_v1 er TOM. Indtil Spor 2 bygger S5-motoren
// bag den, skal en etape under s5_profiles_v1 give byte-identisk output med samme etape
// under official_times_v4 (dens forgaenger i arvelinjen). Testen koerer alle motor-
// fixtures under begge revisioner og sammenligner hele StageOutput.
//
// #6363: Spor 2 har lagt adfaerd bag isS5ProfilesV1OrLater; testen er indsnaevret til
// de fixtures adfaerden ikke rammer (s5Untouched nedenfor), ikke slettet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { simulateStageV4 } from "./index.ts";
import { normalizeRulesRevision } from "./segmentLoop.ts";
import type { StageInput } from "./types.ts";
import { S5_PROFILES_TUNING } from "./tuning.ts";
import { lateAttackChance } from "./mechanics/lateAttack.ts";
import { isMassFinishRoute } from "./finale.ts";

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
  assert.throws(() => normalizeRulesRevision("s5_profiles_v3")); // #6156: s5_profiles_v2 er kendt
});

// #6363 (Spor 2): S5-adfaerden rammer kun mur/bakke/stigende spurt/flad spurt, mellembjerg,
// den afskaffede udbrudsfinale og det sene angrebs terraen. Fixtures uden noget af det skal
// stadig give samme StageOutput under s5_profiles_v1 som under official_times_v4.
function s5Untouched(input: StageInput): boolean {
  const route = input.route;
  if (route.profile_type === "medium_mountain" || route.finale_type === "breakaway") return false;
  // #6645: enkeltstartens evne er tidskoerselsevnen under s5_profiles_v1 (individualTimeTrial.ts).
  if (route.profile_type === "itt" || route.profile_type === "itt_hilly") return false;
  if (route.finale_type && (S5_PROFILES_TUNING.finaleBase[route.finale_type] || S5_PROFILES_TUNING.finishGaps[route.finale_type])) return false;
  // #6648: under s5_profiles_v1 kommer tiden i maal paa enhver selektiv afslutning af loebet (finishGaps).
  if (!isMassFinishRoute(route)) return false;
  if (route.finale_type === "flat_sprint" || route.finale_type === "wall_finish" || route.finale_type === "uphill_sprint") return false;
  return lateAttackChance(route) === 0;
}

test("#6369: s5_profiles_v1 er tom - samme StageOutput som official_times_v4 paa alle motor-fixtures", () => {
  const fixtures = fixtureInputs().filter(({ input }) => s5Untouched(input));
  // #6648: alle selektive afslutninger er nu S5-adfaerd; massespurten er tilbage som vagt.
  assert.ok(fixtures.length >= 1, `forventede motor-fixtures i ${FIXTURES_DIR}`);
  for (const { name, input } of fixtures) {
    const v4 = simulateStageV4({ ...input, rules_revision: "official_times_v4" });
    const s5 = simulateStageV4({ ...input, rules_revision: "s5_profiles_v1" });
    assert.deepEqual(s5, v4, `${name}: s5_profiles_v1 afviger fra official_times_v4`);
  }
});
