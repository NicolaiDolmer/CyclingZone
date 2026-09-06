// scripts/make-wave-brief.test.mjs
// ============================================================
// Tests for boelge-brief-generatoren (#4918). Sikrer at de faste,
// bindende blokke ALTID er med i en genereret brief - uanset input -
// saa en brief aldrig kan glemme livstegn-reglen eller heredoc-forbuddet
// slik det skete manuelt 5-6/9.
// Run: node --test scripts/make-wave-brief.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateBrief } from "./make-wave-brief.mjs";

const baseConfig = {
  issue: 4918,
  slug: "chore-4918-wave-ops",
  branch: "chore/4918-wave-ops",
  model: "sonnet",
  title: "[ops] Stall-watch hvert 15. min",
  scopeText: "Byg stall-watch paa branch-fremdrift.",
  ownership: ["scripts/wave-lane-watch.ps1"],
  tier: "TARGETED",
  verifyCommands: ["node --test scripts/wave-lane-watch.test.mjs"],
};

test("kraever paakraevede felter", () => {
  assert.throws(() => generateBrief({}), /issue/);
  assert.throws(() => generateBrief({ issue: 1 }), /slug/);
});

test("indeholder heredoc-forbuddet og guard-commit-kaeden", () => {
  const brief = generateBrief(baseConfig);
  assert.match(brief, /Heredoc er FORBUDT/);
  assert.match(brief, /guard-commit-branch\.sh/);
  assert.match(brief, /git commit -F/);
});

test("indeholder LIVSTEGN-blokken med 10-min og 15-min reglerne", () => {
  const brief = generateBrief(baseConfig);
  assert.match(brief, /# Livstegn/);
  assert.match(brief, /Inden 10 min/);
  assert.match(brief, /hvert 15\. minut/);
  assert.match(brief, /Tavshed >45 min/);
});

test("indeholder TIER WAVE-verifikationsblokken", () => {
  const brief = generateBrief(baseConfig);
  assert.match(brief, /Verifikation, niveau TIER WAVE/);
  assert.match(brief, /TARGETED/);
  assert.match(brief, /preflight-pr\.ps1/);
});

test("FULL-tier skifter verifikationsteksten men beholder e2e-slot-reglen", () => {
  const brief = generateBrief({ ...baseConfig, tier: "FULL" });
  assert.match(brief, /KUN én worker i boelgen maa have FULL/);
  assert.match(brief, /orkestratoren ejer e2e-slottet/);
});

test("indeholder PR-skabelon med Refs, ikke Closes", () => {
  const brief = generateBrief(baseConfig);
  assert.match(brief, /Brugerverifikation/);
  assert.match(brief, /Refs #4918/);
  assert.doesNotMatch(brief, /Closes #4918/);
});

test("indeholder forbud mod watchers/dev-servere og under-agenter", () => {
  const brief = generateBrief(baseConfig);
  assert.match(brief, /watcher eller dev-server/);
  assert.match(brief, /Spawn ALDRIG under-agenter/);
});

test("aldrig 'laes det store workflow-script foerst'", () => {
  const brief = generateBrief(baseConfig);
  assert.doesNotMatch(brief, /læs det store workflow-script/i);
  assert.doesNotMatch(brief, /laes det store workflow-script/i);
});

test("bruger den angivne worktrees-rod og branch i arbejdsmappen", () => {
  const brief = generateBrief({ ...baseConfig, repoWorktreesRoot: "D:\\wt" });
  assert.match(brief, /D:\\wt\\chore-4918-wave-ops/);
  assert.match(brief, /BRANCH: chore\/4918-wave-ops/);
});

test("optionelt ejerskab-afsnit medtages naar givet", () => {
  const brief = generateBrief(baseConfig);
  assert.match(brief, /# Ejerskab/);
  assert.match(brief, /scripts\/wave-lane-watch\.ps1/);
});
