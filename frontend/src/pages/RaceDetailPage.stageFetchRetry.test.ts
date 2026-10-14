// #6570 (CodeRabbit, PR #6633): en fejlet per-etape-hentning af race_results maa
// ikke markere etapen som loaded. Foer slugte .catch() fejlen til [] og .then()
// lagde etapen i loadedStages, saa den aldrig blev hentet igen i samme besoeg.
//
// Repoet koerer node --test uden DOM-renderer, saa siden daekkes som
// kildekode-struktur-guards (samme moenster som RaceDetailPage.hasClassifications.test.js).
// Selve logikken er testet som rene funktioner i lib/raceResultsSelectors.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(__dirname, "RaceDetailPage.jsx"), "utf8");
const stagePageV2 = readFileSync(join(__dirname, "..", "components", "race", "stagePageV2", "StagePageV2.tsx"), "utf8");
const stageTabV2 = readFileSync(join(__dirname, "..", "components", "race", "stagePageV2", "StageTabV2.tsx"), "utf8");

function startStageFetchBody(): string {
  const start = page.indexOf("const startStageFetch = useCallback(");
  assert.ok(start >= 0, "startStageFetch findes");
  const end = page.indexOf("}, [raceId, loadedStages, failedStages]);", start);
  assert.ok(end > start, "startStageFetch afhaenger af failedStages");
  return page.slice(start, end);
}

test("#6570 startStageFetch sluger ikke en fejl til en tom liste", () => {
  const body = startStageFetchBody();
  assert.doesNotMatch(body, /\.catch\([^)]*\)\s*=>\s*\{[^}]*return \[\];/s, "ingen .catch(() => { ...; return []; })");
  assert.match(body, /settleStageFetch\(/, "udfaldet samles med settleStageFetch");
  assert.match(body, /shouldStartStageFetch\(/, "guarden springer en fejlet etape over");
});

test("#6570 kun et ok-svar markerer etapen loaded; en fejl markerer den failed", () => {
  const body = startStageFetchBody();
  const failIdx = body.indexOf("if (!outcome.ok)");
  const failedIdx = body.indexOf("setFailedStages(", failIdx);
  const returnIdx = body.indexOf("return;", failedIdx);
  const loadedIdx = body.indexOf("setLoadedStages(");
  assert.ok(failIdx >= 0 && failedIdx > failIdx && returnIdx > failedIdx, "fejl-grenen saetter failed og returnerer");
  assert.ok(loadedIdx > returnIdx, "setLoadedStages ligger efter fejl-grenens return");
});

test("#6570 begge etapeflader viser fejl + Try again for en fejlet etape", () => {
  assert.match(page, /const retryStageFetch = useCallback\(/);
  assert.match(page, /t\("detail\.loadError\.stageMessage"\)/);
  assert.match(page, /onClick=\{\(\) => retryStageFetch\(n\)\}/);
  // Resultater-fanens etape-visning
  assert.match(page, /stageFetchState\(n, \{ loaded: loadedStages, failed: failedStages \}\) === "failed"/);
  // Etapeside 2.0
  assert.match(page, /stageErrorSlot=\{stageFetchState\(v2SelectedStage,/);
  assert.match(stagePageV2, /stageErrorSlot=\{stageErrorSlot\}/);
  assert.match(stageTabV2, /\{stageErrorSlot \?\? \(/);
});

test("#6570 hentningen rydder kun op i sit eget in-flight-saet og dropper svar fra en tidligere generation", () => {
  const body = startStageFetchBody();
  // Saettet fanges FOER guarden og tilfoejelsen ...
  const captureIdx = body.indexOf("const inFlight = stageFetchInFlightRef.current;");
  assert.ok(captureIdx >= 0, "in-flight-saettet fanges i en lokal");
  assert.ok(body.indexOf("inFlight.add(n)") > captureIdx, "etapen tilfoejes det fangede saet");
  // ... og finally sletter fra DET saet, aldrig fra ref'ens (maaske nye) saet.
  assert.match(body, /\.finally\(\(\) => \{\s*inFlight\.delete\(n\);\s*\}\)/);
  assert.doesNotMatch(body, /stageFetchInFlightRef\.current\.delete\(/);
  // Et svar fra en erstattet generation (loadAll: nyt loeb eller "Proev igen") droppes.
  assert.match(body, /stageFetchInFlightRef\.current !== inFlight\) return;/);
});

test("#6570 loadAll nulstiller failed-saettet ved nyt loeb", () => {
  assert.match(page, /setLoadedStages\(new Set\(preloadStages\)\);\s*setFailedStages\(new Set\(\)\);/);
});
