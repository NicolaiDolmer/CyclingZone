import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Forum-synlighed (#3199, variant B): "From the forum"-kortet skal stå
// EFTER NextActionsCard men FØR spil-kritiske advarsler/forecast-kortene
// nedenfor, og være valgfrit via customize (#1005) — samme kontrakt som
// søster-modulerne (goldCtaPriority-testen dækker CTA-kæden separat).

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "DashboardPage.jsx"), "utf8");

test("ForumHighlightsCard importeres som selv-hentende komponent", () => {
  assert.match(src, /import ForumHighlightsCard from "\.\.\/components\/ForumHighlightsCard";/);
});

test("kortet er gated bag isVisible(\"forumHighlights\") (customize-menu-mønster)", () => {
  assert.match(src, /\{isVisible\("forumHighlights"\) && <ForumHighlightsCard \/>\}/);
});

test("kortet står EFTER NextActionsCard-blokken og FØR squad-warning-blokken", () => {
  const nextActionsIdx = src.indexOf("<NextActionsCard");
  const forumCardIdx = src.indexOf('isVisible("forumHighlights")');
  const squadWarningIdx = src.indexOf("{/* Squad warning */}");
  assert.ok(nextActionsIdx !== -1 && forumCardIdx !== -1 && squadWarningIdx !== -1);
  assert.ok(nextActionsIdx < forumCardIdx, "forum-kortet skal stå EFTER NextActionsCard");
  assert.ok(forumCardIdx < squadWarningIdx, "forum-kortet skal stå FØR squad-warning-blokken");
});
