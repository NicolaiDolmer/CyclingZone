// #5306 — NPS-cooldownen maa foerst starte naar spilleren faktisk SER prompten.
//
// Hooket selv kan ikke koeres her: repoet har bevidst ingen jsdom/React-loader
// (samme grund som useSelectionReminder.test.ts), og hooket importerer Supabase-
// klienten og samtykke-contexten (.jsx). Derfor to lag:
//
//   1. Adfaerd: beslutningen og engangs-skrivningen bor i lib/npsExposure.ts som
//      ren logik, og den koeres her gennem de tilstande en rigtig session har
//      (samtykke-banneret aabent -> lukket, release-banneret tager bundkanten,
//      samtykke genaabnet).
//   2. Kontrakt: kilde-assertions paa hooket og baren, saa en senere
//      refaktorering ikke stille kan flytte skrivningen tilbage til gaten.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createNpsExposureMarker, isNpsPromptShown } from "../lib/npsExposure.ts";

const USER = "user-a";

function recorder() {
  const writes: Array<{ userId: string; at: string }> = [];
  const marker = createNpsExposureMarker(
    (userId, at) => writes.push({ userId, at }),
    () => new Date("2026-09-23T10:00:00.000Z"),
  );
  return { writes, marker };
}

// --- 1. adfaerd ---------------------------------------------------------------

test("synlig kraever gate + intet samtykke-banner + bund-slotten", () => {
  assert.equal(isNpsPromptShown({ eligible: true, bannerOpen: false, slotGranted: true }), true);
  assert.equal(isNpsPromptShown({ eligible: true, bannerOpen: true, slotGranted: true }), false, "samtykke-banneret skjuler");
  assert.equal(isNpsPromptShown({ eligible: true, bannerOpen: false, slotGranted: false }), false, "release-banneret har kanten");
  assert.equal(isNpsPromptShown({ eligible: false, bannerOpen: false, slotGranted: true }), false, "gaten sagde nej");
});

test("#5306 tilstand 1: gaten aabner MENS samtykke-banneret staar -> INGEN skrivning", () => {
  const { writes, marker } = recorder();
  assert.equal(marker.observe({ eligible: true, bannerOpen: true, slotGranted: true, userId: USER }), false);
  assert.equal(writes.length, 0, "90 dage maa ikke braendes paa en prompt spilleren aldrig saa");
  assert.equal(marker.marked, false);
});

test("#5306 tilstand 2: samtykke-banneret lukkes -> baren er synlig -> ÉN skrivning", () => {
  const { writes, marker } = recorder();
  marker.observe({ eligible: true, bannerOpen: true, slotGranted: true, userId: USER });
  assert.equal(marker.observe({ eligible: true, bannerOpen: false, slotGranted: true, userId: USER }), true);
  assert.deepEqual(writes, [{ userId: USER, at: "2026-09-23T10:00:00.000Z" }]);
  assert.equal(marker.marked, true);
});

test("#5306 skriver hoejst én gang pr. mount, ogsaa naar baren skjules og vises igen", () => {
  const { writes, marker } = recorder();
  marker.observe({ eligible: true, bannerOpen: false, slotGranted: true, userId: USER });
  // Samtykke genaabnet fra footeren, og lukket igen.
  marker.observe({ eligible: true, bannerOpen: true, slotGranted: true, userId: USER });
  marker.observe({ eligible: true, bannerOpen: false, slotGranted: true, userId: USER });
  // Release-banneret tager kanten og slipper den igen.
  marker.observe({ eligible: true, bannerOpen: false, slotGranted: false, userId: USER });
  marker.observe({ eligible: true, bannerOpen: false, slotGranted: true, userId: USER });
  assert.equal(writes.length, 1);
});

test("#5440 release-banneret har bundkanten hele tiden -> ingen skrivning", () => {
  const { writes, marker } = recorder();
  marker.observe({ eligible: true, bannerOpen: false, slotGranted: false, userId: USER });
  marker.observe({ eligible: true, bannerOpen: false, slotGranted: false, userId: USER });
  assert.equal(writes.length, 0);
});

test("uden bruger-id skrives intet (gaten er ikke evalueret for nogen)", () => {
  const { writes, marker } = recorder();
  assert.equal(marker.observe({ eligible: true, bannerOpen: false, slotGranted: true, userId: null }), false);
  assert.equal(writes.length, 0);
  assert.equal(marker.marked, false, "markoeren er stadig ubrugt naar bruger-id'et kommer");
});

test("en skrivning der kaster vaelter ikke UI'et", () => {
  const marker = createNpsExposureMarker(() => {
    throw new Error("netvaerk nede");
  });
  assert.doesNotThrow(() => marker.observe({ eligible: true, bannerOpen: false, slotGranted: true, userId: USER }));
  assert.equal(marker.marked, true, "best-effort: ingen gen-skrivning i samme mount");
});

// --- 2. kontrakt ----------------------------------------------------------------

const HOOK = readFileSync(new URL("./useNpsPrompt.js", import.meta.url), "utf8");
const BAR = readFileSync(new URL("../components/NpsPrompt.jsx", import.meta.url), "utf8");
const GATING = readFileSync(new URL("../lib/npsGating.js", import.meta.url), "utf8");

test("#5306 hooket skriver IKKE cooldownen i gate-evalueringen", () => {
  const writes = HOOK.match(/nps_last_prompted_at:/g) ?? [];
  assert.equal(writes.length, 1, "præcis ét skrivested");
  const writerStart = HOOK.indexOf("function writeLastPrompted(");
  const writeAt = HOOK.indexOf("nps_last_prompted_at:");
  const hookStart = HOOK.indexOf("export function useNpsPrompt(");
  assert.ok(writerStart > -1 && hookStart > -1);
  assert.ok(writerStart < writeAt && writeAt < hookStart, "skrivningen bor i writeLastPrompted, ikke i hooket");
  const evalStart = HOOK.indexOf("const decision = shouldPromptNps(");
  const evalEnd = HOOK.indexOf("}, [teamId]);");
  assert.ok(evalStart > -1 && evalEnd > evalStart);
  const evaluation = HOOK.slice(evalStart, evalEnd);
  assert.doesNotMatch(evaluation, /\.update\(/, "gaten maa ikke opdatere users-raekken");
  assert.match(evaluation, /setEligible\(true\)/);
});

test("#5306 skrivningen sker i en effect der foelger synligheden (gate, samtykke, bund-slot)", () => {
  assert.match(HOOK, /createNpsExposureMarker\(writeLastPrompted\)/);
  assert.match(
    HOOK,
    /useEffect\(\(\) => \{\s*exposureMarker\.observe\(\{ eligible, bannerOpen, slotGranted, userId: userIdRef\.current \}\);\s*\}, \[exposureMarker, eligible, bannerOpen, slotGranted\]\);/,
  );
  assert.match(HOOK, /const slotGranted = useBottomSlot\("nps", eligible\);/);
  assert.match(HOOK, /return \{ visible: shown,/);
});

test("#5306 ejer-beslutningerne er uroerte: 90-dages-throttle og hasResponded", () => {
  assert.match(GATING, /export const NPS_THROTTLE_DAYS = 90;/);
  assert.match(GATING, /if \(hasResponded\) return false;/);
  assert.match(HOOK, /hasResponded: Array\.isArray\(existing\) && existing\.length > 0,/);
});

test("#5440 barens reload-blokering foelger KLADDEN, ikke synligheden", () => {
  // En bar der er skjult af release-banneret, har stadig spillerens kladde.
  // Fulgte blokeringen `visible`, ville porten aabne og release-watcheren
  // genindlaese oven i den.
  assert.match(BAR, /useReloadBlock\(\s*Boolean\(!done && \(score !== null \|\| reason\)\),\s*RELOAD_BLOCK_REASONS\.DIRTY,\s*\);/);
  assert.doesNotMatch(BAR, /Boolean\(visible && !done/);
  // Luk og Faerdig rydder kladden, saa en lukket bar aldrig holder porten.
  assert.match(BAR, /function handleDismiss\(scoreSelected\) \{\s*clearDraft\(\);/);
  assert.match(BAR, /function handleClose\(\) \{\s*clearDraft\(\);/);
  assert.doesNotMatch(BAR, /onClick=\{onClose\}/);
  assert.doesNotMatch(BAR, /onClick=\{\(\) => onDismiss\(/);
});
