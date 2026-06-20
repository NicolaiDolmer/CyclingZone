import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "PatchNotesPage.jsx"), "utf8");

test("bruger aktivt sprog via i18n.language", () => {
  assert.match(src, /i18n\.language/);
});

test("renderer via runtime-lib (filterChanges + groupByDay)", () => {
  assert.match(src, /filterChanges/);
  assert.match(src, /groupByDay/);
});

test("renderer IKKE rå items direkte (ingen dobbelt-sprog)", () => {
  assert.doesNotMatch(src, /section\.items\.map/);
});

test("gemmer last-seen i localStorage", () => {
  assert.match(src, /cz_patchnotes_last_seen/);
});
