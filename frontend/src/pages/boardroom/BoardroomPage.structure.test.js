import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Kildekode-struktur-guards (samme mønster som DashboardPage.errorState.test.js
// / DashboardPage.onboardingConsolidation.test.js) — repoet kører node --test
// uden DOM-renderer.

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "BoardroomPage.jsx"), "utf8");

test("#4557 BoardroomPage renderer alle 4 kanoniske kort", () => {
  for (const tag of ["<ConfidenceCard", "<MandateCard", "<VisionCard", "<BoardCard"]) {
    assert.ok(source.includes(tag), `mangler ${tag}`);
  }
});

test("#4557 BoardroomPage tager den allerede-hentede payload som prop (ingen egen fetch)", () => {
  assert.doesNotMatch(source, /fetch\(/, "BoardroomPage må ikke selv fetche — data kommer fra BoardroomRoute");
  assert.match(source, /export default function BoardroomPage\(\{\s*data\s*\}\)/);
});

test("#4557 gold 'Enter annual meeting'-knappen renderes IKKE denne slice (årsmødet er S-M2c)", () => {
  assert.doesNotMatch(source, /meetingButton|Enter annual meeting/i);
  assert.doesNotMatch(source, /actions=/, "PageHeader skal kaldes uden actions-prop (ingen gold-knap)");
});

test("#4557 header bruger t() for titel/undertitel — ingen hardcodede strenge", () => {
  assert.match(source, /t\("boardroom\.header\.title"\)/);
  assert.match(source, /t\("boardroom\.header\.subtitle"/);
});
