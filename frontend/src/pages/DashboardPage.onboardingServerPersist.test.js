import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #2439 — "Kom i gang"-onboarding-modulet re-triggerede for etablerede
// spillere. Rod-årsag: dismiss af OnboardingProgressCard var UDELUKKENDE
// session-scopet (sessionStorage, #1569), og de 4 onboarding-trin
// (first_bid_placed/first_training_run/first_squad_selected/board_plan_set)
// er ægte handlinger en veteran kan gå hele sæsoner uden at ramme (fx altid
// squad-auto-fill) — completed_count nåede derfor aldrig total_count, og
// sessionStorage-dismisset nulstillede sig selv ved hver ny fane/browser/
// enhed. Fix: server-persisteret dismiss (teams.onboarding_progress_
// dismissed_at) + et "etableret hold"-flag fra backend, begge læst fra
// GET /api/me/onboarding-progress og overstyrer det lokale onboardingDismissed-
// state, så et tidligere dismiss (eller et gammelt hold) holder sig væk uden
// et fornyet klik.
//
// Kildekode-struktur-guard (samme mønster som DashboardPage.onboardingConsolidation.test.js) —
// repoet kører node --test uden DOM-renderer.

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "DashboardPage.jsx"), "utf8");

test("#2439 dismissOnboarding kalder POST /api/me/onboarding-progress/dismiss (server-persisteret, ikke kun sessionStorage)", () => {
  assert.match(
    source,
    /me\/onboarding-progress\/dismiss/,
    "dismissOnboarding skal kalde det server-persisterede dismiss-endpoint",
  );
});

test("#2439 progress-fetch overstyrer lokal state fra server-svarets dismissed/established (cross-device/session sandhed)", () => {
  assert.match(
    source,
    /prog\.dismissed\s*\|\|\s*prog\.established/,
    "et tidligere server-dismiss eller et etableret hold skal sætte onboardingDismissed uden nyt klik",
  );
});
