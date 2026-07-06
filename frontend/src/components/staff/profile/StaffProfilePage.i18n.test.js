import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..", "..");
const en = JSON.parse(readFileSync(join(root, "public/locales/en/staff.json"), "utf8"));
const da = JSON.parse(readFileSync(join(root, "public/locales/da/staff.json"), "utf8"));

function keys(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]);
}
test("en/da staff.json har identiske nøgler", () => {
  assert.deepEqual(keys(en).sort(), keys(da).sort());
});
