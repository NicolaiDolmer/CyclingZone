// #5404 · BetaBadge.tsx traekker JSX/React ind og kan ikke importeres i en
// almindelig node --test (Node's indbyggede type-stripping daekker .ts,
// IKKE .tsx — verificeret: `node --test` fejler med ERR_UNKNOWN_FILE_EXTENSION
// paa enhver .tsx-fil, ogsaa som testfil, ogsaa med --experimental-transform-types).
// Samme moenster som chip.source.test.js / badgeStyles.test.js: kilde-assertions
// mod .tsx-komponentens raa tekst. Selve TESTEN er derfor .test.ts, ikke .tsx —
// den indeholder ingen JSX og koerer normalt under node --test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "BetaBadge.tsx"), "utf8");

test("BetaBadge renderer intet uden for praecis stadiet \"beta\"", () => {
  assert.match(src, /stage !== "beta"/, "skal returnere null naar stage ikke er praecis \"beta\"");
  assert.match(src, /return null/);
});

test("BetaBadge bruger i18n-noeglen betaBadge, ingen hardkodet engelsk streng", () => {
  assert.match(src, /t\("betaBadge"\)/);
});

test("BetaBadge foelger TASTE.md: hairline + 5px radius, ingen emoji, ikke guld-accent", () => {
  assert.match(src, /rounded-cz\b/, "5px radius (rounded-cz), ikke rounded-lg/xl/2xl");
  assert.match(src, /border-cz-border/, "hairline-kant, ikke skygge");
  assert.doesNotMatch(src, /rounded-(2xl|xl|lg|md|\[)/, "kun rounded-cz — ingen radius-drift");
  assert.doesNotMatch(src, /shadow-/, "kort er hairlines, ikke svaevende plader");
  assert.doesNotMatch(src, /cz-accent/, "guld er rationeret til primaer-knap + ledermarkoerer, ikke denne badge");
  // Stroke-ikoner, aldrig emoji (TASTE.md bindende regel).
  assert.doesNotMatch(src, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, "ingen emoji i komponentens kilde");
});

test("BetaBadge tager stage som prop og fetcher intet selv", () => {
  assert.match(src, /stage\??:\s*FlagStage/, "stage skal vaere typet som FlagStage (off|beta|on)");
  assert.doesNotMatch(src, /fetch\(|apiFetch\(/, "komponenten skal vaere ren/statslos, ikke hente flag-data selv");
});
