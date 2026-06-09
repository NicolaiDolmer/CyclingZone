import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ridersPageSource = readFileSync(join(__dirname, "RidersPage.jsx"), "utf8");
const statBarSource = ridersPageSource.match(
  /function StatBar\(\{ value \}\) \{([\s\S]*?)\n\}/,
)?.[1];

test("StatBar viser kun det farvede stat-tal uden redundant minibjælke (#1094)", () => {
  assert.ok(statBarSource, "StatBar-komponenten skal kunne findes");
  assert.match(statBarSource, /style=\{statStyle\(value \?\? 0\)\}/);
  assert.doesNotMatch(
    statBarSource,
    /width:\s*`\$\{pct\}%`/,
    "den smalle procent-bjælke fremstår som en uønsket prik ved hvert stat-tal",
  );
});
