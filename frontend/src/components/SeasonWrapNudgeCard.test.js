import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #5755 — "Board confidence {n} %"-linjen på SeasonWrapNudgeCard, hentet
// best-effort fra GET /api/board/verdict/{seasonId}.
//
// Repoet kører `node --test` uden DOM-renderer, så vi guard'er wiringen
// kildekode-strukturelt (samme mønster som SeasonWrapNudgeCard.goldCta.test.js
// og DashboardPage.boardGating.test.js).

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "SeasonWrapNudgeCard.jsx"), "utf8");

test("#5755 henter board-verdict for seasonId, ikke en anden id", () => {
  assert.match(
    source,
    /\/api\/board\/verdict\/\$\{seasonId\}/,
    "kaldet skal ramme GET /api/board/verdict/{seasonId}",
  );
});

test("#5755 linjen kræver BÅDE enabled:true og et brugbart confidenceAfter-tal", () => {
  assert.match(
    source,
    /verdict\?\.enabled\s*&&\s*Number\.isFinite\(verdict\.confidenceAfter\)/,
    "enabled:false eller et ikke-numerisk confidenceAfter må ALDRIG sætte linjen",
  );
});

test("#5755 et 404/fejlet kald returnerer null og viser INGEN linje", () => {
  assert.match(source, /if \(!res\.ok\) return null;/, "!ok (inkl. 404) skal give null, ikke kaste");
  assert.match(source, /catch \{\s*return null;\s*}/, "netværksfejl skal fanges og give null, ikke kaste");
});

test("#5755 verdict-kaldet går gennem den centrale apiFetch-indpakning, ikke et bart fetch()", () => {
  assert.match(
    source,
    /apiFetch\(`\/api\/board\/verdict\/\$\{seasonId\}`/,
    "skal bruge apiFetch (Retry-After-respekt, #5089/#5242), ikke et bart fetch(`${API}...`)",
  );
});

test("#5755 fejl-stien logger højst en debug-besked, aldrig console.error", () => {
  assert.match(source, /console\.debug\(/, "et fejlet/manglende verdict skal kun logges som debug");
  assert.doesNotMatch(
    source,
    /console\.error\(/,
    "et manglende board-verdict er ikke en fejltilstand for kortet — ingen console.error",
  );
});

test("#5755 boardConfidencePercent defaulter til null (ingen linje før data er hentet)", () => {
  assert.match(
    source,
    /useState\(null\)/,
    "boardConfidencePercent skal starte som null, så linjen ikke flasher tomt indhold",
  );
});

test("#5755 linjen renderes betinget og ligger EFTER rank-linjen, FØR stats-linjen", () => {
  const rankIdx = source.indexOf("seasonWrap.rankLine");
  const confidenceGuardIdx = source.indexOf("boardConfidencePercent != null");
  const confidenceTextIdx = source.indexOf("seasonWrap.boardConfidence");
  const statsIdx = source.indexOf("seasonWrap.statsLine");
  assert.notEqual(rankIdx, -1);
  assert.notEqual(confidenceGuardIdx, -1);
  assert.notEqual(confidenceTextIdx, -1);
  assert.notEqual(statsIdx, -1);
  assert.ok(rankIdx < confidenceGuardIdx, "rank-linjen skal stå før confidence-linjens guard");
  assert.ok(confidenceGuardIdx < confidenceTextIdx, "guarden skal omslutte teksten");
  assert.ok(confidenceTextIdx < statsIdx, "confidence-linjen skal stå før stats-linjen");
});

// #3509-regressionen: denne PR må IKKE ændre gold-CTA-logikken. Samme
// assertion som SeasonWrapNudgeCard.goldCta.test.js — hvis DEN test stadig er
// grøn, er dette blot en ekstra guard mod at #5755 rørte ved den.
test("#5755 rørte ikke ved gold-CTA-variant-logikken (#3509)", () => {
  assert.match(source, /variant=\{primary \? "primary" : "secondary"\}/);
});
