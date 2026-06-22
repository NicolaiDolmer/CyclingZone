import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #1569 / #1140 — onboarding-konsolidering. Dashboardet havde TO onboarding-UI'er:
// det redundante 3-korts OnboardingModal (auth-namespace) OG OnboardingProgressCard.
// For en ny spiller var det dobbelt-arbejde + modstridende signaler. Vi gør
// OnboardingProgressCard til den ENESTE kanoniske dashboard-onboarding og stopper
// med at RENDER OnboardingModal (filen beholdes, men monteres ikke på dashboardet).
//
// Desuden: progress-guiden må IKKE kunne dismisses PERMANENT ved <4/4 trin — et
// fejlklik på X ved 0/4 må ikke dræbe den eneste guide for altid. Dismiss er
// session-scoped (sessionStorage); kun completion-kortet (4/4) beholder permanent
// localStorage-dismiss.
//
// Repoet kører `node --test` uden DOM-renderer, så invarianterne guardes
// kildekode-strukturelt (samme mønster som DashboardPage.boardGating.test.js).

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "DashboardPage.jsx"), "utf8");

test("#1140 OnboardingModal renderes IKKE længere på dashboardet (konsolideret væk)", () => {
  // Selve <OnboardingModal .../>-monteringen skal være væk. Importen må gerne
  // forblive eller fjernes; det afgørende er at komponenten ikke renderes.
  assert.doesNotMatch(
    source,
    /<OnboardingModal\b/,
    "OnboardingModal må ikke længere renderes — OnboardingProgressCard er den kanoniske onboarding-UI",
  );
});

test("#1140 OnboardingProgressCard er den kanoniske progress-UI (renderes betinget på completed<total)", () => {
  assert.match(
    source,
    /<OnboardingProgressCard\b/,
    "OnboardingProgressCard skal stadig renderes som den kanoniske progress-UI",
  );
  assert.match(
    source,
    /onboardingProgress\.completed_count\s*<\s*onboardingProgress\.total_count[\s\S]*?<OnboardingProgressCard/,
    "progress-kortet skal gates på completed_count < total_count",
  );
});

test("#1140 CompletionCard renderes betinget på completed===total", () => {
  assert.match(
    source,
    /onboardingProgress\.completed_count\s*===\s*onboardingProgress\.total_count[\s\S]*?<OnboardingCompletionCard/,
    "completion-kortet skal gates på completed_count === total_count",
  );
});

test("#1569 progress-dismiss er SESSION-scoped (sessionStorage), ikke permanent localStorage", () => {
  // Init-state og dismiss-handler skal begge bruge sessionStorage for progress-
  // nøglen, så et dismiss ved 0/4 ikke overlever en genindlæsning.
  assert.match(
    source,
    /sessionStorage\.getItem\("cz-dashboard-onboarding-dismissed"\)/,
    "progress-dismiss-init skal læse fra sessionStorage (ikke localStorage)",
  );
  assert.match(
    source,
    /sessionStorage\.setItem\("cz-dashboard-onboarding-dismissed"/,
    "dismissOnboarding skal skrive til sessionStorage (ikke localStorage)",
  );
  // Forward-guard: progress-nøglen må ALDRIG ende i localStorage (= permanent).
  assert.doesNotMatch(
    source,
    /localStorage\.(get|set)Item\("cz-dashboard-onboarding-dismissed"/,
    "progress-dismiss må aldrig bruge localStorage — det ville gøre et 0/4-fejlklik permanent",
  );
});

test("#1569 completion-dismiss forbliver permanent (localStorage)", () => {
  assert.match(
    source,
    /localStorage\.setItem\("cz-dashboard-onboarding-completion-dismissed"/,
    "completion-kortet (4/4) skal beholde permanent localStorage-dismiss",
  );
});
