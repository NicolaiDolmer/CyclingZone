import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Forum-synlighed (#3199, variant B) — kilde-tekst-tests for kortets
// canonical-states-kontrakt (samme mønster som NextActionsCard.*.test.js —
// ingen jsdom-harness i dette repo for komponent-render-tests, se den fils
// kommentar). Den reelle to-rækker/unread/poll-rendering er dækket visuelt
// via tests/e2e/shot-forum-highlights.mjs (PR-screenshots).

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "ForumHighlightsCard.jsx"), "utf8");

test("renderer INTET når hooket rapporterer status \"error\" (dashboardet må aldrig vise en forum-fejl)", () => {
  assert.match(src, /if \(status === "error"\) return null;/);
});

test("bruger EmptyState fra ./ui (PAGE_TEMPLATES-recipen), ikke et hjemmelavet tom-markup", () => {
  assert.match(src, /import \{[^}]*EmptyState[^}]*\} from "\.\/ui"/);
  assert.match(src, /<EmptyState/);
  assert.match(src, /t\("dashboard:forumHighlights\.emptyTitle"\)/);
  assert.match(src, /t\("dashboard:forumHighlights\.emptyDescription"\)/);
});

test("header: titel venstre + \"All threads\"-tekstlink højre (SectionAction, ingen knap)", () => {
  assert.match(src, /t\("dashboard:forumHighlights\.title"\)/);
  assert.match(src, /<SectionAction as=\{Link\} to="\/forum">/);
  assert.match(src, /t\("dashboard:forumHighlights\.allThreads"\)/);
});

test("ulæst-prik/halvfed titel er conditional på thread.is_unread (samme prik-mekanik som ForumPage)", () => {
  assert.match(src, /thread\.is_unread &&/);
  assert.match(src, /font-semibold.*font-medium/s);
});

test("poll-pill er conditional på thread.has_poll og bruger forum:list.poll", () => {
  assert.match(src, /thread\.has_poll &&/);
  assert.match(src, /t\("forum:list\.poll"\)/);
});

test("hver række linker til /forum/:id og viser svar-antal + relativ tid", () => {
  assert.match(src, /to=\{`\/forum\/\$\{thread\.id\}`\}/);
  assert.match(src, /t\("forum:list\.replies"/);
  assert.match(src, /formatRelativeTime\(/);
});

test("kortet bærer data-testid til e2e/screenshot-scriptet", () => {
  assert.match(src, /data-testid="forum-highlights-card"/);
});
