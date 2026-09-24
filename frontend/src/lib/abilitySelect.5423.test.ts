import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ABILITY_KEYS } from "./abilities.js";

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sources(path)
      : /\.[jt]sx?$/.test(path) && !/\.test\./.test(path) ? [path] : [];
  });
}

test("direct ability reads use the registry instead of handwritten ability columns", () => {
  const offenders: string[] = [];
  const root = fileURLToPath(new URL("../", import.meta.url));
  for (const file of sources(root)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\.from\(["']rider_derived_abilities["']\)\s*\.select\(([\s\S]*?)\)\s*\./g)) {
      const select = match[1];
      const handwritten = ABILITY_KEYS.some((key: string) => new RegExp(`\\b${key}\\b`).test(select));
      if (handwritten || /["'`]\s*\*\s*["'`]/.test(select)) offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [], "use ABILITY_KEYS or a shared select constant");
});
