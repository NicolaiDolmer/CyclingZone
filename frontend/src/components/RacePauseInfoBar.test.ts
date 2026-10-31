// #7335: info-bjaelken paa alle manager-sider. Repoet koerer node --test uden jsdom,
// saa komponent-kontrakten pinnes paa kilden + den rene sti-logik testes direkte.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { racePauseInfoBarHiddenOnPath } from "../lib/racePause.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bar = readFileSync(join(__dirname, "RacePauseInfoBar.tsx"), "utf8");
const layout = readFileSync(join(__dirname, "Layout.jsx"), "utf8");

test("skjules kun paa dashboard (egen Pauset-flade), vises ellers", () => {
  assert.equal(racePauseInfoBarHiddenOnPath("/dashboard"), true);
  assert.equal(racePauseInfoBarHiddenOnPath("/races/abc-123"), false);
  assert.equal(racePauseInfoBarHiddenOnPath("/races"), false);
  assert.equal(racePauseInfoBarHiddenOnPath("/riders"), false);
  assert.equal(racePauseInfoBarHiddenOnPath("/team"), false);
  assert.equal(racePauseInfoBarHiddenOnPath("/races/abc/results"), false);
});

test("Layout monterer bjaelken lige efter RaceControlBanner", () => {
  const a = layout.indexOf("<RaceControlBanner />");
  const b = layout.indexOf("<RacePauseInfoBar />");
  assert.ok(a > 0 && b > a);
});

test("loebssiden viser kun den globale bjaelke, ikke ogsaa det gamle Pauset-banner (ingen dobbelt-besked)", () => {
  const raceDetail = readFileSync(join(__dirname, "../pages/RaceDetailPage.jsx"), "utf8");
  assert.doesNotMatch(raceDetail, /RacePausedBanner/);
  const pausedBanner = readFileSync(join(__dirname, "race/RacePausedBanner.tsx"), "utf8");
  assert.doesNotMatch(pausedBanner, /import useRacePause/,"Pauset-banneret henter ikke selv: kun dashboardet giver det pausen");
});

test("hooken udleder pausen automatisk (kontakt + valgfri notice), ikke kun fra race_pause_notice", () => {
  const hook = readFileSync(join(__dirname, "../hooks/useRacePause.ts"), "utf8");
  assert.match(hook, /fetchRacePauseInputs\(\)/);
  assert.match(hook, /resolveRacePause\(inputs, nowMs\)/);
});

test("bjaelken bruger pause-hooken og info-fladen, og rendrer intet uden aktiv pause", () => {
  assert.match(bar, /if \(!shouldAnnounceRacePause\(pause\) \|\| racePauseInfoBarHiddenOnPath\(pathname\)\) return null/);
  assert.match(bar, /bg-cz-info-bg/);
  assert.match(bar, /useRacePause\(true, pathname\)/);
});
