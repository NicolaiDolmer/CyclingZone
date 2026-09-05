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
  assert.match(source, /<BoardroomPage data=\{roomData\}/);
});

test("#4557 enabled:false (og fejl/ingen session) falder tilbage til den eksisterende BoardPage uændret", () => {
  assert.match(source, /setStatus\("legacy"\)/);
  assert.match(source, /return <LegacyBoardPage \/>;/);
  // Fejl/netværksfejl/manglende session skal ALLE lande i "legacy" — aldrig en
  // hængende loading-tilstand eller en ny fejlflade for et rent flag-tjek.
  assert.match(source, /catch \(e\) \{[\s\S]{0,120}setStatus\("legacy"\)/);
  assert.match(source, /if \(!res\.ok\) \{ if \(!isReload\) setStatus\("legacy"\); return; \}/);
});

test("#4557 BoardroomRoute modtager legacy-siden som prop (BoardPage lazy-importeres kun i App.jsx)", () => {
  assert.match(source, /export default function BoardroomRoute\(\{\s*LegacyBoardPage\s*\}\)/);
  assert.doesNotMatch(source, /import BoardPage/, "BoardPage skal ikke re-importeres/lazy-splittes her — kun modtages som prop");
});

// #4557 (overblik + faner) · Siden kan nu UDLOESE handlinger (accepteret
// bonustilbud, valgt klub-DNA) og skal se resultatet med det samme. Ruten ejer
// stadig det ENE kald til /api/board/room; `onReload` genbruger praecis samme
// loader. En fejlet GENhentning maa aldrig kaste manageren over paa legacy-
// siden midt i en session - derfor er hver setStatus("legacy") betinget af
// !isReload.
test("#4557 onReload genbruger den samme loader (ingen ny fetch-sti) og kan ikke degradere til legacy", () => {
  assert.match(source, /onReload=\{\(\) => loadRoom\(\{ isReload: true \}\)\}/);
  const legacyFlips = source.match(/setStatus\("legacy"\)/g) || [];
  const guarded = source.match(/if \(!isReload\) setStatus\("legacy"\)/g) || [];
  assert.equal(legacyFlips.length, guarded.length + 1, "alle legacy-flip undtagen den i else-grenen skal vaere isReload-guardede");
  assert.match(source, /\} else if \(!isReload\) \{/);
});
