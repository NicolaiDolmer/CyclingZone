import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Forum-synlighed (#3199): kilde-tekst-forward-guard for hookets kontrakt —
// ét kald, limit=2, fejl → status "error" (kortet renderer intet). Selve
// udvælgelses-logikken (merge pinned+items, sortér efter aktivitet) er
// udtrukket til lib/forumHighlights.js og node--testet der (rigtig
// unit-test, ikke kilde-scan) — se forumHighlights.test.js.

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "useForumHighlights.js"), "utf8");

test("ét HTTP-kald mod GET /api/forum/posts med limit=2 (ikke N+1, kun det nødvendige)", () => {
  const fetchCalls = [...src.matchAll(/fetch\(/g)];
  assert.equal(fetchCalls.length, 1, "hooket må kun kalde fetch præcis ét sted");
  assert.match(src, /\/api\/forum\/posts\?limit=\$\{HIGHLIGHT_COUNT\}/);
  assert.match(src, /const HIGHLIGHT_COUNT = 2;/);
});

test("manglende session/API eller ikke-OK svar → status \"error\", ikke en kastet/uhåndteret fejl", () => {
  assert.match(src, /if \(!headers \|\| !API\) throw new Error/);
  assert.match(src, /if \(!res\.ok\) throw new Error/);
  assert.match(src, /catch \(e\) \{[\s\S]*setState\(\{ status: "error", threads: \[\] \}\)/);
});

test("bruger den udtrukne, testede udvælgelses-funktion i stedet for inline merge/sort", () => {
  assert.match(src, /import \{ selectForumHighlights \} from "\.\.\/lib\/forumHighlights\.js"/);
  assert.match(src, /selectForumHighlights\(data\.pinned, data\.items, HIGHLIGHT_COUNT\)/);
});
