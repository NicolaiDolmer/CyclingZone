// #7326 (T1 i #7322): det fælles rollevokabular er ét grundlag for alle flader
// der viser en løbsrolle. Testene holder vokabularet ens med backendens og
// taktikfanens lister, kræver en eksisterende oversættelse for hver rolle i
// hvert sprog, og pinner at holdoversigten og efter-etape-oversigten bruger
// vokabularet frem for egne lister (repoet kører node --test uden DOM-renderer,
// så komponenterne pinnes på kilden).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STAGE_ROLES, isStageRole, roleLabelKey, roleRank, type StageRole } from "./stageRoleVocabulary.ts";
import { SELECTABLE_ROLES, EXCLUSIVE_ROLES } from "./stageRoleMatrixLogic.js";
import { VALID_RACE_ROLES } from "../../../backend/lib/raceRoles.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..");
const LOCALES = ["en", "da", "es", "fr", "nl"];

const sorted = (xs: readonly string[]) => [...xs].sort();

test("vokabularet er samme sæt som backendens VALID_RACE_ROLES", () => {
  assert.deepEqual(sorted(STAGE_ROLES), sorted(VALID_RACE_ROLES as readonly string[]));
});

test("vokabularet er samme sæt som taktikfanens SELECTABLE_ROLES", () => {
  assert.deepEqual(sorted(STAGE_ROLES), sorted(SELECTABLE_ROLES as readonly string[]));
  for (const role of EXCLUSIVE_ROLES as readonly string[]) assert.ok(isStageRole(role), `${role} mangler i vokabularet`);
});

test("delt kaptajn og luksushjælper er en del af vokabularet", () => {
  assert.ok(isStageRole("co_captain"));
  assert.ok(isStageRole("luxury_helper"));
});

test("hver rolle har sin egen eksisterende oversættelse i alle sprog", () => {
  const keys = new Set<string>();
  for (const role of STAGE_ROLES) {
    const key = roleLabelKey(role);
    assert.equal(key, `tacticsOrders.roleLabel.${role}`);
    keys.add(key as string);
  }
  assert.equal(keys.size, STAGE_ROLES.length, "to roller må ikke dele navn");
  for (const lng of LOCALES) {
    const races = JSON.parse(readFileSync(join(SRC, "..", "public", "locales", lng, "races.json"), "utf8"));
    for (const role of STAGE_ROLES) {
      const label = races?.tacticsOrders?.roleLabel?.[role];
      assert.equal(typeof label, "string", `${lng}: tacticsOrders.roleLabel.${role} mangler`);
      assert.ok(label.trim().length > 0, `${lng}: tom tekst for ${role}`);
    }
    const helper = races.tacticsOrders.roleLabel.helper;
    assert.notEqual(races.tacticsOrders.roleLabel.luxury_helper, helper, `${lng}: luksushjælper må ikke hedde det samme som hjælper`);
    assert.notEqual(races.tacticsOrders.roleLabel.co_captain, races.tacticsOrders.roleLabel.captain, `${lng}: delt kaptajn må ikke hedde det samme som kaptajn`);
  }
});

test("en ukendt eller manglende værdi bliver aldrig til en anden gyldig rolle", () => {
  for (const value of [null, undefined, "", "Captain", "co-captain", "leader", "toString", "__proto__", 3, {}]) {
    assert.equal(isStageRole(value), false, String(value));
    assert.equal(roleLabelKey(value), null, String(value));
    assert.equal(roleRank(value), STAGE_ROLES.length, String(value));
  }
});

test("rækkefølgen: kaptajnerne først, delt kaptajn efter kaptajn, luksushjælper før hjælper", () => {
  const byRank = [...STAGE_ROLES].sort((a, b) => roleRank(a) - roleRank(b));
  assert.deepEqual(byRank, ["captain", "co_captain", "sprint_captain", "hunter", "free_role", "luxury_helper", "helper"] satisfies StageRole[]);
  assert.equal(new Set(STAGE_ROLES.map(roleRank)).size, STAGE_ROLES.length, "hver rolle har sin egen plads");
});

test("holdoversigten (RaceTeamTab) viser rollen via vokabularet, uden egen rolleliste eller hjælper-fallback", () => {
  const src = readFileSync(join(SRC, "components", "race", "RaceTeamTab.jsx"), "utf8");
  assert.match(src, /import \{ roleLabelKey \} from "\.\.\/\.\.\/lib\/stageRoleVocabulary\.ts";/);
  assert.match(src, /roleLabel\(t, baseRoleForRider\(rider\)\)/);
  assert.doesNotMatch(src, /const ROLE_KEY\s*=/, "lokal rolleliste er tilbage");
  assert.doesNotMatch(src, /tacticsOrders\.roleLabel\.\$\{/, "rollenavnet bygges uden om vokabularet");
  assert.doesNotMatch(src, /\|\|\s*"helper"/, "ukendt rolle falder tavst tilbage til hjælper");
});

test("efter-etape-oversigten (StageOrdersRecap) viser rollen via vokabularet, uden egen whitelist", () => {
  const view = readFileSync(join(SRC, "components", "stageOrders", "StageOrdersRecap.tsx"), "utf8");
  assert.match(view, /import \{ roleLabelKey \} from "\.\.\/\.\.\/lib\/stageRoleVocabulary\.ts";/);
  assert.match(view, /const roleKey = roleLabelKey\(r\.role\)/);
  assert.doesNotMatch(view, /ROLE_KEYS/, "lokal rolle-whitelist er tilbage");
  assert.doesNotMatch(view, /tacticsOrders\.roleLabel\.\$\{/, "rollenavnet bygges uden om vokabularet");
  const model = readFileSync(join(SRC, "components", "stageOrders", "stageOrdersRecap.ts"), "utf8");
  assert.match(model, /import \{ roleRank \} from "\.\.\/\.\.\/lib\/stageRoleVocabulary\.ts";/);
  assert.doesNotMatch(model, /ROLE_ORDER/, "lokal rolle-rækkefølge er tilbage");
});
