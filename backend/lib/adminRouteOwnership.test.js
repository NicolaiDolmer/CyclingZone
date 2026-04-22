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

  assert.match(apiSource, /router\.post\(\s*"\/admin\/import-results"/);
  assert.match(apiSource, /router\.post\(\s*"\/admin\/seasons\/:id\/start"/);
  assert.match(apiSource, /router\.post\(\s*"\/admin\/seasons\/:id\/end"/);
});
