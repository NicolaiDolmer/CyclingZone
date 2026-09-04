import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "BoardroomRoute.jsx"), "utf8");

test("#4557 BoardroomRoute kalder /api/board/room netop ét sted (ingen dobbelt-fetch)", () => {
  const matches = source.match(/fetch\(`\$\{API\}\/api\/board\/room`/g) || [];
  assert.equal(matches.length, 1, "wrapperen skal kalde /api/board/room netop én gang");
});

test("#4557 enabled:true render BoardroomPage med den allerede-hentede payload", () => {
  assert.match(source, /if \(data\?\.enabled\)/);
  assert.match(source, /<BoardroomPage data=\{roomData\} \/>/);
});

test("#4557 enabled:false (og fejl/ingen session) falder tilbage til den eksisterende BoardPage uændret", () => {
  assert.match(source, /setStatus\("legacy"\)/);
  assert.match(source, /return <LegacyBoardPage \/>;/);
  // Fejl/netværksfejl/manglende session skal ALLE lande i "legacy" — aldrig en
  // hængende loading-tilstand eller en ny fejlflade for et rent flag-tjek.
  assert.match(source, /catch \(e\) \{[\s\S]{0,120}setStatus\("legacy"\)/);
  assert.match(source, /if \(!res\.ok\) \{ if \(!cancelled\) setStatus\("legacy"\); return; \}/);
});

test("#4557 BoardroomRoute modtager legacy-siden som prop (BoardPage lazy-importeres kun i App.jsx)", () => {
  assert.match(source, /export default function BoardroomRoute\(\{\s*LegacyBoardPage\s*\}\)/);
  assert.doesNotMatch(source, /import BoardPage/, "BoardPage skal ikke re-importeres/lazy-splittes her — kun modtages som prop");
});
