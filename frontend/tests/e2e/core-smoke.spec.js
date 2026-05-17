import { expect, test } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";

// i18n Fase 3+: oversatte sider skal bruge regex der matcher BÅDE DA + EN,
// så testen ikke break'er afhængigt af LanguageDetector's valg (localStorage/
// navigator.language varierer mellem CI-runs). Ikke-oversatte sider beholder
// hardcoded DK-tekst indtil deres i18n-fase lander.
const CORE_PAGES = [
  { path: "/dashboard", heading: "E2E Racing", snapshot: "dashboard.png" },
  { path: "/riders", heading: "Rytterdatabase", snapshot: "riders.png" },
  { path: "/auctions", heading: /^(Auktioner|Auctions)$/, snapshot: "auctions.png" },
  { path: "/team", heading: "E2E Racing", snapshot: "team.png" },
  { path: "/finance", heading: "Finanser", snapshot: "finance.png" },
  { path: "/board", heading: "Bestyrelse", snapshot: "board.png" },
  { path: "/seasons", heading: /Sæson/, snapshot: "seasons.png" },
  // Inbox har meget dynamisk indhold (notifikations-list med timestamps, count-
  // badges, ulæst-prikker) der falder uden for `main`-text-masken og naturligt
  // varierer mellem CI-runs. Højere threshold dækker mobile-webkit-flaky uden
  // at miste blank-screen-detektion. Hvis trusler fra fremtidige layout-changes
  // sneaker forbi, kig på inbox-actual.png attachment i Playwright-report.
  { path: "/notifications", heading: "Indbakke", snapshot: "inbox.png", maxDiffPixelRatio: 0.12 },
];

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

test("login redirects authenticated manager to dashboard", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "E2E Racing" })).toBeVisible();
});

test("root path redirects to dashboard", async ({ page }) => {
  await login(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard$/);
});

// WebKit + Vite HMR + Playwright route-mocks producerer dev-only-noise (dynamic
// module imports, mock-CORS-quirks) der ikke reproducerer på prod iOS Safari.
// Filtrér dem fra page-errors så vi stadig fanger ægte JS-exceptions.
const WEBKIT_DEV_NOISE = [
  /Importing a module script failed/i,
  /due to access control checks/i,
];

// Tekst-elementer maskeres i pixel-snapshots så testen fanger LAYOUT-regressions
// (cards forsvinder, kolonner kollapser, billeder mangler) uden at fejle på copy-
// eller i18n-ændringer. Indhold valideres via expect-assertions + i18n-key-coverage,
// ikke pixel-diff. Forward-guard mod #412 i18n-snapshot-treadmill — se
// `.claude/learnings/2026-05-17-visual-snapshots-layout-only.md`.
const TEXT_MASK_SELECTOR = "main :is(h1,h2,h3,h4,h5,h6,p,span,a,button,li,td,th,label,time,strong,em,dt,dd)";

test("core manager pages render without blank screens", async ({ page }, testInfo) => {
  const isWebkit = testInfo.project.name.includes("webkit");
  const pageErrors = [];
  page.on("pageerror", error => {
    if (isWebkit && WEBKIT_DEV_NOISE.some(p => p.test(error.message))) return;
    pageErrors.push(error.message);
  });

  await login(page);

  for (const spec of CORE_PAGES) {
    await page.goto(spec.path);
    await expect(page.getByRole("heading", { name: spec.heading }).first()).toBeVisible();
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("VITE_API_URL is not set");
    await expect(page).toHaveScreenshot(spec.snapshot, {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      mask: [page.locator(TEXT_MASK_SELECTOR)],
      // Tekst er masket → kun layout-pixels tæller. Lille buffer til mask-edge
      // anti-aliasing når elementer auto-sizer efter masked tekst-længde.
      // Per-spec override hvis siden har meget dynamisk indhold (fx inbox).
      maxDiffPixelRatio: spec.maxDiffPixelRatio ?? 0.05,
    });
  }

  expect(pageErrors).toEqual([]);
});
