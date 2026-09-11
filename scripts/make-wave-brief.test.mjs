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

test("instruerer draft-PR ved foerste push og gh pr ready som sidste handling (CodeRabbit-attempts, 7/9)", () => {
  const brief = generateBrief(baseConfig);
  assert.match(brief, /--draft/);
  assert.match(brief, /gh pr ready/);
});

test("instruerer CodeRabbit CLI-review foer gh pr ready", () => {
  const brief = generateBrief(baseConfig);
  assert.match(brief, /coderabbit review --base main --committed/);
  assert.match(brief, /Ret aegte fund/);
  assert.match(brief, /koer CLI-reviewet igen paa den endelige committed diff/);
  assert.match(brief, /maa IKKE markeres klar foer et rent/);
  const cliIdx = brief.indexOf("coderabbit review --base main --committed");
  const readyIdx = brief.indexOf("gh pr ready <N>");
  assert.ok(cliIdx > 0 && readyIdx > cliIdx, "CLI-review skal staa FOER gh pr ready");
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

// ===== Orkestrator-standard v2 (#5142) =====
// Hver af disse svarer til en konkret fejl fra 11/9-boelgen. De er tests og
// ikke prosa, fordi praecis den slags regler er dem der forsvinder naar en
// brief skrives i haanden under tidspres.

test("kraever draft-PR inden 30 min", () => {
  const brief = generateBrief(baseConfig);
  assert.match(brief, /Draft-PR'en SKAL eksistere senest 30 min/);
});

test("giver lanen sin egen scratch-mappe og en commit-besked-fil med branch-slug uden for worktreet", () => {
  const brief = generateBrief(baseConfig);
  // Egen mappe pr. lane (11/9: to workers delte scratchpad-sti).
  assert.match(brief, /SCRATCH-MAPPE \(kun din\): C:\\Dev\\CyclingZone-worktrees\\\.wave-scratch\\chore-4918-wave-ops/);
  // Slug i filnavnet, og filen ligger IKKE under selve worktreet.
  assert.match(brief, /msg-chore-4918-wave-ops\.txt/);
  assert.doesNotMatch(brief, /CyclingZone-worktrees\\chore-4918-wave-ops\\msg-/);
  assert.match(brief, /commit -F "C:\\Dev\\CyclingZone-worktrees\\\.wave-scratch\\chore-4918-wave-ops\\msg-chore-4918-wave-ops\.txt"/);
});

test("tvinger tunge kommandoer gennem verifikations-semaforen", () => {
  const brief = generateBrief(baseConfig);
  assert.match(brief, /verify-lock\.ps1" -Max 2 -Timeout 1800 --/);
  assert.match(brief, /Maks 2 saadanne koerer ad gangen/);
  // Preflight er tung og skal vaere wrappet.
  const preflightLine = brief.split("\n").find((l) => l.includes("preflight-pr.ps1") && l.includes("foer push"));
  assert.ok(preflightLine && preflightLine.includes("verify-lock.ps1"), "preflight skal koeres gennem semaforen");
});

test("forbyder baggrundsjob og 'vent paa monitoren'", () => {
  const brief = generateBrief(baseConfig);
  assert.match(brief, /INGEN baggrundsjob/);
  assert.match(brief, /FORGRUNDEN/);
  assert.match(brief, /venter paa monitoren/);
});

test("TARGETED forbyder fuld e2e og verify-local", () => {
  const brief = generateBrief(baseConfig);
  assert.match(brief, /FORBUDT paa TARGETED/);
  assert.match(brief, /npm run test:e2e/);
  assert.match(brief, /verify-local\.ps1/);
});

test("npm install er forbudt som default, tilladt med ownNodeModules", () => {
  const uden = generateBrief(baseConfig);
  assert.match(uden, /`npm install`\/`npm ci` er FORBUDT i dette worktree/);
  assert.doesNotMatch(uden, /du MAA installere dependencies/);

  const med = generateBrief({ ...baseConfig, ownNodeModules: true });
  assert.match(med, /du MAA installere dependencies/);
  assert.doesNotMatch(med, /`npm install`\/`npm ci` er FORBUDT/);
});

test("scratchRoot kan overstyres", () => {
  const brief = generateBrief({ ...baseConfig, scratchRoot: "D:\\scratch" });
  assert.match(brief, /D:\\scratch\\chore-4918-wave-ops/);
});
