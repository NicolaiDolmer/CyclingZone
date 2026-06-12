import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(join(__dirname, "../server.js"), "utf8");
const apiSource = readFileSync(join(__dirname, "../routes/api.js"), "utf8");

test("admin season routes live only in the api router", () => {
  assert.doesNotMatch(serverSource, /app\.post\("\/api\/admin\/import-results"/);
  assert.doesNotMatch(serverSource, /app\.post\("\/api\/admin\/seasons\/:id\/start"/);
  assert.doesNotMatch(serverSource, /app\.post\("\/api\/admin\/seasons\/:id\/end"/);
  assert.doesNotMatch(serverSource, /app\.post\("\/api\/admin\/seasons\/:id\/rebuild-standings"/);

  assert.match(apiSource, /router\.post\(\s*"\/admin\/seasons\/:id\/start"/);
  assert.match(apiSource, /router\.post\(\s*"\/admin\/seasons\/:id\/end"/);
  assert.match(apiSource, /router\.post\(\s*"\/admin\/seasons\/:id\/rebuild-standings"/);
});

// #1180 pkt 3+4 / #1179 / #1207 (2026-06-12): manuel resultatimport (Excel + Sheets),
// dyn_cyclist-stats-sync og UCI-sheets-sync er pensioneret efter relaunch til fiktive
// ryttere med egen race-motor. PCM-importen (/admin/import-results-pcm) er den eneste
// bevidst bevarede import-fallback (epic #1105). Forward-guard: ruterne må ikke genopstå.
test("pensionerede import-/sync-routes må ikke genopstå (#1179/#1207)", () => {
  assert.doesNotMatch(apiSource, /router\.post\(\s*"\/admin\/import-results"\s*,/);
  assert.doesNotMatch(apiSource, /"\/admin\/import-results-sheets"/);
  assert.doesNotMatch(apiSource, /"\/admin\/sync-dyn-cyclist"/);
  assert.doesNotMatch(serverSource, /app\.post\("\/api\/admin\/sync-uci"/);
  assert.doesNotMatch(apiSource, /"\/admin\/sync-uci"/);

  // PCM-fallback skal bestå indtil #1021 (fuld motor) er modnet post-launch.
  assert.match(apiSource, /router\.post\(\s*"\/admin\/import-results-pcm"/);
});
