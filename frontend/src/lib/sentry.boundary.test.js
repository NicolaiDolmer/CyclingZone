import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "sentry.jsx"), "utf8");

test("boundary er altid-aktiv (ingen !ENABLED early-return der dropper boundary)", () => {
  assert.ok(
    !/if\s*\(\s*!ENABLED\s*\)\s*return\s+children/.test(src),
    "SentryBoundary maa ikke kortslutte til children naar Sentry er disabled — saa white-screener crashes i dev/preview"
  );
  assert.match(src, /Sentry\.ErrorBoundary/);
});

test("fallback genbruger ErrorState + Button via DIREKTE imports (ikke barrel)", () => {
  assert.match(src, /import\s+ErrorState\s+from\s+["']\.\.\/components\/ui\/ErrorState\.jsx["']/);
  assert.match(src, /import\s+Button\s+from\s+["']\.\.\/components\/ui\/Button\.jsx["']/);
  assert.ok(
    !/from\s+["']\.\.\/components\/ui\/index\.js["']/.test(src),
    "importér primitiver direkte, ikke via barrel (undgaa at trække hele ui-laget ind i main-bundlen, #479)"
  );
  assert.match(src, /<ErrorState/);
  assert.match(src, /<Button/);
});

test("fallback er on-spec (rounded-cz container, ingen rounded-lg/shadow-sm slop)", () => {
  assert.ok(!/rounded-lg/.test(src), "brug rounded-cz, ikke rounded-lg");
  assert.ok(!/shadow-sm/.test(src), "ingen shadow paa fallback-overflade (hairline)");
});

test("bevarer statisk EN/DA-copy (ingen i18n-runtime i boundary, #1170)", () => {
  assert.match(src, /getPreferredLanguage/);
  assert.ok(
    !/useTranslation|react-i18next/.test(src),
    "boundary maa ikke afhaenge af i18n-runtime (kan ramme foer i18n er init)"
  );
  // Bevaret statisk copy (begge sprog) — render-fejl-titler.
  assert.match(src, /The page could not be shown/);
  assert.match(src, /Siden kunne ikke vises/);
});

test("bevarer chunk-reload-recovery + reset", () => {
  assert.match(src, /shouldAttemptChunkReload/);
  assert.match(src, /resetError/);
});

test("eventId vises kun naar Sentry er ENABLED (deterministisk fallback)", () => {
  assert.match(src, /ENABLED\s*&&\s*eventId/);
});
