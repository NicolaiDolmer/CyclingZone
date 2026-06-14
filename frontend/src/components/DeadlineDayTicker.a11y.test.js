import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #1355 — Deadline Day-tickeren scrollede uafbrudt (>5s bevægelse) uden mulighed
// for at stoppe den, og ignorerede `prefers-reduced-motion` (WCAG 2.2.2 Pause,
// Stop, Hide). Fixet tilføjer (1) en synlig pause/resume-knap og (2) respekt for
// reduced-motion (start pauset + ingen animation). Testene her holder os ærlige
// hvis bevægelses-kontrollen fjernes igen:
//   1) komponenten har et pause-state med en toggle (bevægelsen KAN stoppes)
//   2) animate-ticker er gated bag "ikke stoppet" — bevægelsen forsvinder når
//      pauset eller reduced-motion er aktivt
//   3) prefers-reduced-motion aflæses og initialiserer pause-state
//   4) pause/resume-copy findes i BÅDE en og da (key-parity, jf. #410-guarden)

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "DeadlineDayTicker.jsx"), "utf8");

test("DeadlineDayTicker har et pause-state med en toggle (#1355)", () => {
  assert.match(
    source,
    /const\s*\[\s*paused\s*,\s*setPaused\s*\]\s*=\s*useState/,
    "tickeren skal have et `paused`-state — uden det kan bevægelsen ikke stoppes (WCAG 2.2.2)",
  );
  assert.match(
    source,
    /onClick=\{\s*\(\)\s*=>\s*setPaused\(\s*p\s*=>\s*!p\s*\)\s*\}/,
    "der skal være en knap der toggler `paused` — pause/resume-kontrollen (WCAG 2.2.2)",
  );
});

test("DeadlineDayTicker fjerner animate-ticker når bevægelsen er stoppet (#1355)", () => {
  // animate-ticker må KUN gælde når animationen ikke er stoppet.
  assert.match(
    source,
    /animationStopped\s*\?\s*"overflow-x-auto"\s*:\s*"animate-ticker"/,
    "animate-ticker skal være gated bag animationStopped — ellers fortsætter bevægelsen trods pause/reduced-motion (#1355)",
  );
  assert.match(
    source,
    /const\s+animationStopped\s*=\s*paused\s*\|\|\s*reducedMotion/,
    "animationStopped skal være sand når enten brugeren har pauset ELLER reduced-motion er aktivt (#1355)",
  );
});

test("DeadlineDayTicker respekterer prefers-reduced-motion (#1355)", () => {
  assert.match(
    source,
    /prefers-reduced-motion:\s*reduce/,
    "tickeren skal aflæse `prefers-reduced-motion: reduce` via matchMedia (WCAG 2.2.2)",
  );
  assert.match(
    source,
    /useState\(\s*prefersReducedMotion\s*\)/,
    "pause-state skal initialiseres fra reduced-motion-præferencen — animationen må ikke starte uden samtykke (#1355)",
  );
});

test("common.json har deadlineTicker pause/resume i både en og da (#1355)", () => {
  const localesDir = join(__dirname, "..", "..", "public", "locales");
  for (const lng of ["en", "da"]) {
    const commonJson = JSON.parse(readFileSync(join(localesDir, lng, "common.json"), "utf8"));
    const dt = commonJson?.deadlineTicker;
    assert.ok(dt, `${lng}/common.json mangler deadlineTicker-sektionen — pause/resume-knappen viser så rå i18n-nøgler`);
    for (const key of ["pause", "resume"]) {
      assert.equal(
        typeof dt[key],
        "string",
        `${lng}/common.json mangler deadlineTicker.${key} — pause/resume-knappen viser så rå i18n-nøgle`,
      );
      assert.ok(
        !dt[key].includes("—"),
        `${lng}/common.json deadlineTicker.${key} indeholder em-dash — forbudt i nye keys jf. TONE_OF_VOICE.md`,
      );
    }
  }
});
