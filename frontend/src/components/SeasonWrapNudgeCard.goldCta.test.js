import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #3509 — SeasonWrapNudgeCard renderede tidligere altid variant="primary"
// (gold), uanset om et højere-prioriteret kort (first-race-moment eller
// squad-selection-CTA) allerede ejede guldet. Kortet skal nu kunne nedgraderes
// via en `primary`-prop (default true, så DRAFT-preview-brugen i
// SeasonExperiencePreviewPage.jsx uændret viser gold).
//
// Repoet kører `node --test` uden DOM-renderer, så vi guard'er wiringen
// kildekode-strukturelt (samme mønster som DashboardPage.boardGating.test.js).

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "SeasonWrapNudgeCard.jsx"), "utf8");

test("#3509 SeasonWrapNudgeCard accepterer en primary-prop med default true", () => {
  assert.match(
    source,
    /primary = true,/,
    "primary-prop skal defaulte til true (bagudkompatibel med DRAFT-preview-brugen)",
  );
});

test("#3509 CTA-knappen skifter til sekundær variant når primary er false", () => {
  assert.match(
    source,
    /variant=\{primary \? "primary" : "secondary"\}/,
    'knappen skal bruge variant={primary ? "primary" : "secondary"} — ikke ubetinget variant="primary"',
  );
  assert.doesNotMatch(
    source,
    /<Button variant="primary"/,
    "den gamle ubetingede variant=\"primary\" skal være fjernet",
  );
});
