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

/**
 * Antal parallelle workers. Playwright tager enten et tal eller en
 * procent-streng ("50%" = halvdelen af kernerne), og PW_WORKERS skal kunne
 * begge dele uden at "50%" bliver til NaN.
 *
 * @returns {number | string}
 */
function resolveWorkers() {
  const override = process.env.PW_WORKERS?.trim();
  if (override) return override.endsWith("%") ? override : Number(override);
  return process.env.CI ? "100%" : "50%";
}

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.js",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // #4647: workers var 1 uden begrundelse siden filen blev oprettet, og suiten
  // voksede til 26-28 min pr. PR. Suiten ER parallel-sikker: API'et mockes pr.
  // side i Playwright-routes, ingen `serial`-describes, og webServer'en er en
  // statisk sirv-server uden delt tilstand (scripts/e2e-static-server.mjs).
  //
  //   CI  = "100%": hver CI-shard koerer KUN eet projekt (matrix i
  //         playwright-smoke.yml), saa hele runnerens kerner maa gaa til det ene
  //         projekt. Procent frem for et fast tal: runner-stoerrelsen kan aendre
  //         sig under os, og et hardcodet 2 ville stille gaa glip af den.
  //   lokalt = "50%": halvdelen af kernerne. Ejerens maskine skal kunne bruges
  //         til andet mens suiten koerer, og en overtegnet CPU er netop den
  //         belastning der foeder flake-klassen i #4292/#2960.
  //
  // PW_WORKERS overrider begge (fx `PW_WORKERS=1` for at isolere en flaky test,
  // eller "25%" paa en presset maskine).
  workers: resolveWorkers(),
  // #4647: test-timeout 60s i CI (Playwright-defaulten er 30s). Parallelle
  // workers deler runnerens CPU, saa den ENKELTE tests vaegur-tid stiger selv
  // om suitens samlede tid falder. Det ramte core-smoke's side-loop paa
  // mobile-webkit: den gaar mange sider igennem i EEN test og loeb toer for de
  // 30s ved 4 workers (2 forskellige overskrifter i to forsoeg - klassisk
  // "testen naaede ikke frem", ikke "siden var forkert"). Samme afvejning som
  // expect-timeouten i #2960: en aegte broken flade dukker ikke op ved 60s, saa
  // graensen skjuler ingen regressioner. Lokalt beholdes Playwright-defaulten.
  timeout: process.env.CI ? 60000 : 30000,
  // json-reporteren er inputtet til scripts/extract-e2e-flakes.mjs: den er den
  // eneste rapport der eksplicit maerker en test der fejlede foerst og bestod
  // ved retry som "flaky" (#4292's klasse). html-rapporten viser det for et
  // menneske, men kan ikke laeses af en gate.
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }], ["json", { outputFile: "playwright-report/results.json" }]]
    : [["list"]],
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
    // workflow-step FØR Playwright, så webServer-kommandoen er ÉN dræbelig proces.
    // Lokalt beholder vi `build && ...` for bekvemmelighed.
    //
    // #2960: `vite preview` erstattet af scripts/e2e-static-server.mjs (sirv-
    // biblioteket i egen tynd server). Hvorfor og hele stall-evidensen:
    // .claude/learnings/2026-09-01-vite-preview-ci-smoke-random-stalls.md.
    // Operationelt: serveren fejler HØJLYDT ved optaget port (strictPort-
    // erstatning), læser KUN argv (aldrig env PORT/HOST — worktree-isolationen
    // i playwright.ports.js), og serverer med etag+dev som vite preview gjorde.
    // `npm run` (ikke `npx`) holder præcis ÉT dræbeligt barn i process-træet.
    // NB: `--`-argumenterne appendes af npm til script-strengens SIDSTE kommando
    // — preview:e2e skal forblive én enkelt kommando.
    // NB: sirv har ingen middleware-hook som vites `configurePreviewServer`, så
    // worktreeIdPlugin (vite.config.js) servede ikke længere WORKTREE_ID_PATH —
    // "preview:e2e" (package.json) genererer den nu som en statisk fil i dist/
    // via scripts/write-worktree-id.mjs FØR sirv starter. Uden den fejlede
    // false-green-guarden (global-setup.js) højlydt på sirv selv.
    command: process.env.CI
      ? `npm run preview:e2e -- --host 127.0.0.1 --port ${PORT}`
      : `npm run build && npm run preview:e2e -- --host 127.0.0.1 --port ${PORT}`,
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
