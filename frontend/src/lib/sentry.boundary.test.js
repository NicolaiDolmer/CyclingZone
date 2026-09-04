import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "sentry.jsx"), "utf8");

// Kroppen af beforeSend, afgraenset paa indhold og ikke paa linjeskift: filen er
// CRLF, saa et "\n"-anker giver indexOf === -1 og en slice der spaender resten af
// filen. Det gjorde foerste udgave af vagten nedenfor gronn paa et falsk grundlag.
function beforeSendBody() {
  const start = src.indexOf("beforeSend(event)");
  const end = src.indexOf("started = true", start);
  assert.ok(start > -1 && end > start, "kunne ikke afgraense beforeSend i sentry.jsx");
  return src.slice(start, end);
}

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

// #4545: chunk-fejl blev droppet i beforeSend. Fallbacken viste et fejl-id for et
// event der aldrig blev sendt, og omfanget var umaaleligt — foerste signal paa
// haendelsen 1/9 var en spillerbesked, ikke dashboardet.
test("beforeSend dropper IKKE chunk-fejl laengere (#4545)", () => {
  const beforeSend = beforeSendBody();
  assert.ok(
    /ResizeObserver loop completed/.test(beforeSend),
    "den aegte stoej (ResizeObserver/NetworkError) skal stadig droppes",
  );
  const chunkBranch = beforeSend.slice(beforeSend.indexOf("isUnambiguousChunkLoadError"));
  assert.ok(
    !/return null/.test(chunkBranch),
    "chunk-fejl maa ikke returnere null — saa peger fejl-id'et i fallbacken paa ingenting",
  );
  assert.match(chunkBranch, /event\.fingerprint\s*=\s*\[CHUNK_ERROR_FINGERPRINT\]/);
  assert.match(chunkBranch, /event\.level\s*=\s*"warning"/);
});

test("kun UTVETYDIGE chunk-moenstre daempes i Sentry (#4545)", () => {
  // isChunkLoadError matcher ogsaa React.lazy-interne strenge som almindelig kode
  // kan producere. Bruges de til gruppering, forsvinder et aegte crash ned i en
  // arkiveret chunk-gruppe — praecis den fejl vi retter.
  // Kommentaren i beforeSend forklarer hvorfor det brede filter IKKE bruges, saa
  // vagten skal se paa kode og ikke paa prosa.
  const beforeSend = beforeSendBody().replace(/\/\/[^\n]*/g, "");
  assert.ok(
    !/isChunkLoadError\(/.test(beforeSend),
    "beforeSend skal bruge isUnambiguousChunkLoadError, ikke det brede filter",
  );
  assert.match(src, /function classifyFrontendError/);
  assert.match(src, /possible_chunk_load_error/);
});

test("fallbacken lover kun auto-reload naar et reload faktisk sker (#4545)", () => {
  // Loop-guarden tillader ét reload pr. release. Er den braendt, sker der intet,
  // og spilleren sad foer i en loekke med samme "vi genindlaeser automatisk".
  assert.match(src, /setRecoveryExhausted\(true\)/);
  assert.match(src, /const stuck = chunkError && recoveryExhausted/);
  // Stuck-copy paa begge sprog, med et skridt spilleren selv kan tage.
  assert.match(src, /The page could not be loaded/);
  assert.match(src, /Siden kunne ikke indlæses/);
  assert.match(src, /hold Shift and click Reload/);
  assert.match(src, /hold Shift nede, og klik Genindlæs/);
});
