import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #1569 — anti-AI-slop: de første in-app onboarding-flader en ny spiller møder
// brugte emoji som eyebrow/markør (🚴 / 🎉 / 🔔🏛️📖 / 🏪🔨). Brand-reglen er
// 0 emoji i chrome. Vi erstatter dem med tekst eller en diskret accent-markør.
// Forward-guard: fanger hvis nogen genindfører emoji i disse komponenter.

const __dirname = dirname(fileURLToPath(import.meta.url));

// Idiomatisk emoji-detektion via Unicode-property-escape (Extended_Pictographic
// dækker pictographs/symboler/transport/dingbats) + VS16 (U+FE0F). Property-
// escapes undgår range-adjacency-lint (no-misleading-character-class).
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}]/u;

// ▸ ○ ✓ × → er bevidste tekst-markører (ikke emoji) i kortene — tillad dem.
// (✓ ▸ ○ er ikke Extended_Pictographic, men → og × er heller ikke emoji.)
const ALLOWED = /[▸○✓×→]/gu;

for (const file of [
  "OnboardingProgressCard.jsx",
  "OnboardingCompletionCard.jsx",
  "OnboardingModal.jsx",
]) {
  test(`${file} indeholder ingen emoji i chrome (#1569 anti-slop)`, () => {
    const raw = readFileSync(join(__dirname, file), "utf8");
    const stripped = raw.replace(ALLOWED, "");
    const match = stripped.match(EMOJI);
    assert.equal(
      match,
      null,
      `${file} må ikke indeholde emoji — fandt ${match ? JSON.stringify(match[0]) : ""}`,
    );
  });
}
