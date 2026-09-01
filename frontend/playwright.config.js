import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRuntimePort } from "./playwright.ports.js";

// Port pr. worktree: main-checkout = 4173 (CI uændret), linked worktrees får en
// deterministisk hash-afledt port, PW_PORT overrider. Se playwright.ports.js
// for hvorfor (false-green via delt port, bidt 2026-05-31 + 2026-06-10).
const FRONTEND_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = resolveRuntimePort(FRONTEND_ROOT);

// #3429: mobile-webkit kører i CI igen. Historikken, fordi den forklarer hvorfor
// den var væk og hvad der skal holdes i live for at den bliver:
//
//   #1342 (maj) droppede webkit fra CI: webServer-kommandoen var dengang
//   `npm run build && npm run preview` i ÉN kommando, hvilket efterlod en
//   forældreløs preview-proces på windows-runneren som Playwright ikke kunne
//   dræbe. Webkit-workeren kunne ikke exit'e og jobbet hang i 48 min.
//
//   Den rodårsag findes ikke længere: playwright-smoke.yml bygger frontend i sit
//   EGET step, så webServer i CI kun starter `vite preview` (én proces, se det
//   steps kommentar). Derfor er #1342's antagelse gen-testet her — og jobbet har
//   nu også `timeout-minutes` som backstop, så et fremtidigt hæng fejler hurtigt
//   i stedet for at æde en runner.
//
// Prisen ved at lade webkit blive ude var større end hængets: den er den ENESTE
// mobil-Safari-dækning der findes, og uden CI kunne dens snapshots drive uset.
// Det skete: planner-snapshottet drev 5/8 (#3378) og blev først opdaget 6/8 —
// og rettet ved et tilfælde af en anden PR's snapshot-refresh. Se #3429.
const ALL_PROJECTS = [
  {
    name: "desktop-chromium",
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: 1280, height: 900 },
    },
  },
  {
    name: "mobile-chromium",
    use: {
      ...devices["Pixel 5"],
      viewport: { width: 393, height: 852 },
    },
  },
  {
    name: "mobile-webkit",
    use: {
      ...devices["iPhone 13"],
    },
  },
];
// Ingen CI-filtrering: lokal pre-flight og CI kører præcis de samme tre
// projekter. Divergensen mellem de to var selve fejlen i #3429.
const PROJECTS = ALL_PROJECTS;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.js",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  expect: {
    // #2960: assertion-budgettet paa CI er 10s, ikke Playwright-defaulten 5s.
    // React 19's scheduling flytter marginale assertions over 5s-graensen paa
    // den 2-kernede windows-runner under fuld suite-belastning: 3 CI-koersler
    // gav 4 FORSKELLIGE roede specs (sponsor-ui, board-plan-tabs,
    // season-honours, season-start-guide), alle 5s-timeouts, nul overlap -
    // mens 330/330 gentagne koersler var groenne paa en 8-kernet maskine.
    // En aegte broken flade dukker heller ikke op ved 10s, saa graensen
    // skjuler ingen regressioner. Lokalt beholdes 5s.
    timeout: process.env.CI ? 10000 : 5000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.001,
    },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    actionTimeout: 10000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: PROJECTS,
  webServer: {
    // #1342: e2e kører mod en statisk preview-build, ikke vite dev-server.
    // Dev-serverens on-demand dep-reoptimering gav ChunkLoadError midt i et run,
    // og HMR-websockets efterlod åbne handles → webkit-worker'en (3. projekt)
    // kunne ikke exit'e på Windows og blev force-killed efter 300s (exit 1
    // selvom alle tests bestod). Preview er statisk: ingen HMR, ingen
    // reoptimering → deterministisk teardown. Reproduceret + verificeret lokalt.
    //
    // CI vs. lokalt: `npm run build && npm run preview` startede en CHILD-shell
    // der kørte build, derefter preview — på windows-runneren efterlod den en
    // forældreløs preview-proces Playwright ikke kunne dræbe → jobbet hang 48 min
    // (#1342, draft-fix-forsøg 1). I CI bygges frontend i et separat
    // workflow-step FØR Playwright, så webServer-kommandoen er ÉN dræbelig proces
    // (`vite preview`). Lokalt beholder vi `build && preview` for bekvemmelighed.
    // --strictPort: hellere højlydt bind-fejl end at vite hopper til nabo-port
    // mens baseURL stadig peger på den fremmede server.
    command: process.env.CI
      ? `npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`
      : `npm run build && npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180000,
    env: {
      // #1342: eksponér window.__i18n i preview-build (import.meta.env.DEV er
      // false her) så core-smoke's sprog-skift-helper virker. Kun e2e, ikke prod.
      VITE_E2E: "1",
      VITE_API_URL: `http://127.0.0.1:${PORT}`,
      VITE_SUPABASE_URL: "https://cycling-zone-e2e.supabase.co",
      VITE_SUPABASE_ANON_KEY: "e2e-anon-key",
      VITE_PUBLIC_APP_URL: `http://127.0.0.1:${PORT}`,
    },
  },
});
