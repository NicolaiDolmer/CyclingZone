import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function runGuard(t, source, locales) {
  const root = mkdtempSync(join(tmpdir(), "i18n-key-coverage-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "scripts"));
  copyFileSync(new URL("./i18n-check-keys.mjs", import.meta.url), join(root, "scripts/i18n-check-keys.mjs"));
  mkdirSync(join(root, "frontend/src/components"), { recursive: true });
  writeFileSync(join(root, "frontend/src/components/Role.tsx"), source);
  for (const [language, namespaces] of Object.entries(locales)) {
    const dir = join(root, "frontend/public/locales", language);
    mkdirSync(dir, { recursive: true });
    for (const [ns, data] of Object.entries(namespaces)) writeFileSync(join(dir, ns + ".json"), JSON.stringify(data));
  }
  const result = spawnSync(process.execPath, [join(root, "scripts/i18n-check-keys.mjs")], { encoding: "utf8" });
  return { status: result.status, output: result.stdout + result.stderr };
}
const source = 'const ROLE_KEY = { captain: "captain", hunter: "hunter" }; const { t } = useTranslation("races"); t(`selection.${ROLE_KEY[role]}`);';
const complete = { races: { selection: { captain: "Captain", hunter: "Breakaway hunter" } } };

test("mapped dynamic key missing in BOTH languages fails despite locale parity (#5289)", (t) => {
  const missing = { races: { selection: { captain: "Captain" } } };
  const result = runGuard(t, source, { en: missing, da: missing });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /en\/races.*selection\.hunter/);
  assert.match(result.output, /da\/races.*selection\.hunter/);
});
test("all mapped roles resolve in both languages", (t) => {
  assert.equal(runGuard(t, source, { en: complete, da: complete }).status, 0);
});
test("a new map value is checked without extending a guard allowlist", (t) => {
  const result = runGuard(t, source.replace('hunter: "hunter"', 'hunter: "hunter", helper: "helper"'), { en: complete, da: complete });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /selection\.helper/);
});
test("explicit namespace wins over the hook default; nullish fallback is checked", (t) => {
  const explicit = source.replace('selection.${ROLE_KEY[role]}', 'races:selection.${ROLE_KEY[role] ?? "helper"}').replace('useTranslation("races")', 'useTranslation("common")');
  const result = runGuard(t, explicit, { en: { ...complete, common: {} }, da: { ...complete, common: {} } });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /races.*selection\.helper/);
});
test("key parity still catches a key missing in only one language", (t) => {
  const result = runGuard(t, source, { en: complete, da: { races: { selection: { captain: "Kaptajn" } } } });
  assert.equal(result.status, 1);
  assert.match(result.output, /selection\.hunter/);
});
test("commented calls do not create translation requirements", (t) => {
  assert.equal(runGuard(t, '// ' + source, { en: { races: {} }, da: { races: {} } }).status, 0);
});
