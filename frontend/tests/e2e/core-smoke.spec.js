import { expect, test } from "@playwright/test";
import {
  installNetworkMocks,
  login,
  stabilizePage,
  corsHeaders,
  json,
  TEST_TEAM,
  TEXT_MASK_SELECTOR,
  waitForPageReady,
} from "./fixtures.js";

// i18n Fase 3+: oversatte sider skal bruge regex der matcher BÅDE DA + EN,
// så testen ikke break'er afhængigt af LanguageDetector's valg (localStorage/
// navigator.language varierer mellem CI-runs). Ikke-oversatte sider beholder
// hardcoded DK-tekst indtil deres i18n-fase lander.
const CORE_PAGES = [
  { path: "/dashboard", heading: "E2E Racing", snapshot: "dashboard.png" },
  { path: "/riders", heading: "Rytterdatabase", snapshot: "riders.png" },
  // auctions namespace bundles inline i `i18n/index.js` (Refs #412) → t() resolver
  // instant på first paint, ingen race med HttpBackend lazy-load. Route-specifik
  // readiness-gate bor nu i ROUTE_READINESS["/auctions"] (#1272) — den kendt-flaky
  // route (#646/#512) deler gate på tværs af alle 3 playwright-projekter.
  { path: "/auctions", heading: /^(Auktioner|Auctions)$/, snapshot: "auctions.png" },
  { path: "/team", heading: "E2E Racing", snapshot: "team.png" },
  { path: "/finance", heading: /^(Finanser|Finance)$/, snapshot: "finance.png" },
  { path: "/board", heading: "Bestyrelse", snapshot: "board.png" },
  { path: "/seasons", heading: /^(Sæson|Season)/, snapshot: "seasons.png" },
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
const WEBKIT_DEV_NOISE = [/Importing a module script failed/i, /due to access control checks/i];

// Snapshot-stabiliserings-helpers (TEXT_MASK_SELECTOR + waitForStableSnapshotTarget)
// bor i fixtures.js (#1076) så board-interactive.spec.js kan genbruge dem.
const TRANSLATED_PAGE_SMOKE = [
  {
    path: "/dashboard",
    en: [/Active auctions/i, /Transfers & Offers/i],
    da: [/Aktive auktioner/i, /Transfers & tilbud/i],
    rawKeys: ["dashboard:cards.transfers.title", "cards.transfers.title", "cards.auctions.title"],
  },
  {
    path: "/riders",
    en: [/Rider Database/i, /Value/i],
    da: [/Rytterdatabase/i, /Værdi/i],
    rawKeys: ["riders:page.title", "page.title", "table.value"],
  },
  {
    path: "/auctions",
    en: [/Auctions/i, /not involved in any active auctions/i],
    da: [/Auktioner/i, /Du er ikke involveret/i],
    rawKeys: ["auctions:page.title", "page.title", "empty.notInvolved"],
  },
  {
    // #678 Track 4: AuctionHistoryPage var divergeret (hardcodet dansk). Stat-kort-
    // labels renderer data-uafhængigt → stabile canaries uden mock-afhængighed.
    path: "/auctions/history",
    en: [/Bought/i, /Spent/i, /Earned/i],
    da: [/Brugt/, /Tjent/],
    rawKeys: ["auctions:history.statSpent", "history.statSpent", "history.statEarned"],
  },
  {
    path: "/team",
    en: [/Transfer window open/i, /Squad \(/i],
    da: [/Transfervindue åbent/i, /Trup \(/i],
    rawKeys: ["team:page.windowOpen", "page.windowOpen", "tabs.squad"],
  },
  {
    path: "/finance",
    en: [/Finance/i, /Active loans/i],
    da: [/Finanser/i, /Aktive lån/i],
    rawKeys: ["finance:page.title", "page.title", "loans.active.title"],
  },
  {
    path: "/board",
    en: [/Board/i, /The board is observing your first season/i],
    da: [/Bestyrelse/i, /Bestyrelsen observerer din første sæson/i],
    rawKeys: ["board:page.title", "page.title", "baseline.title"],
  },
  {
    path: "/notifications",
    en: [/Inbox/i, /No notifications in this category/i],
    da: [/Indbakke/i, /Ingen notifikationer i denne kategori/i],
    rawKeys: ["notifications:page.title", "page.title", "empty.noneUnread"],
  },
];

async function forceEnglish(page) {
  await page.evaluate(async () => {
    window.localStorage.setItem("cz_lang", "en");
    if (window.__i18n) await window.__i18n.changeLanguage("en");
  });
  await expect.poll(() => page.evaluate(() => window.__i18n?.language)).toBe("en");
}

test("core manager pages render without blank screens", async ({ page }, testInfo) => {
  const isWebkit = testInfo.project.name.includes("webkit");
  const pageErrors = [];
  page.on("pageerror", (error) => {
    if (isWebkit && WEBKIT_DEV_NOISE.some((p) => p.test(error.message))) return;
    pageErrors.push(error.message);
  });

  await login(page);

  for (const spec of CORE_PAGES) {
    await page.goto(spec.path);
    // #1272: ét readiness-kald — generisk surface-gate + route-specifik gate
    // (ROUTE_READINESS) + snapshot-overflade-stabilisering — så screenshot ikke
    // lander mid-render på data-drevne sider.
    await waitForPageReady(page, spec);
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

test("translated manager pages do not leak raw i18n keys or hardcoded Danish in English", async ({
  page,
}) => {
  await login(page);

  for (const spec of TRANSLATED_PAGE_SMOKE) {
    await page.goto(spec.path);
    await forceEnglish(page);
    await expect(page.locator("main")).toBeVisible();

    for (const canary of spec.en) {
      await expect(page.locator("main")).toContainText(canary);
    }

    const mainText = await page.locator("main").innerText();
    for (const rawKey of spec.rawKeys) {
      expect(mainText, `${spec.path} leaked raw i18n key "${rawKey}"`).not.toContain(rawKey);
    }
    for (const hardcodedDanish of spec.da) {
      expect(mainText, `${spec.path} leaked hardcoded Danish ${hardcodedDanish}`).not.toMatch(
        hardcodedDanish
      );
    }
  }
});

// #917/#694 · Standard-fixturen er baseline-fase (is_baseline_phase:true), så det
// interaktive board (bestyrelsesmedlemmer + arketype-copy) renderes ikke. Denne
// override leverer en non-baseline payload så medlems-grid'en (arketype-labels +
// beskrivelser via i18n-koder) faktisk rendres — forward-guard mod EN-leak i
// boardArchetypes-copy. Feedback-templates er unit-dækket i src/lib/boardCopy.test.js.
const NONBASELINE_BOARD_STATUS = {
  is_baseline_phase: false,
  setup_next_plan_type: null,
  plans: { "5yr": null, "3yr": null, "1yr": null },
  team: TEST_TEAM,
  riders: [],
  standing: null,
  identity_profile: null,
  auto_accept: null,
  active_loans_count: 0,
  team_dna: {
    key: "skandinavisk_udvikling",
    emoji: "🌱",
    label_key: "dna.skandinavisk_udvikling.label",
    short_description_key: "dna.skandinavisk_udvikling.shortDescription",
    long_description_key: "dna.skandinavisk_udvikling.longDescription",
    label: "Skandinavisk udviklingshold",
    short_description: "Ungdom, balance og nordisk arv",
    long_description: "",
  },
  team_members: [
    {
      archetype_key: "sponsoraten", selection_kind: "identity", alignment_score: 8, is_chairman: true,
      label_key: "archetypes.sponsoraten.label", label: "Sponsoraten", emoji: "💰",
      short_description_key: "archetypes.sponsoraten.shortDescription", short_description: "Vogter sponsorforhold og økonomisk disciplin",
      long_description_key: "archetypes.sponsoraten.longDescription", long_description: "",
    },
    {
      archetype_key: "talentspejderen", selection_kind: "identity", alignment_score: 6, is_chairman: false,
      label_key: "archetypes.talentspejderen.label", label: "Talentspejderen", emoji: "🔭",
      short_description_key: "archetypes.talentspejderen.shortDescription", short_description: "Tror på langsigtet ungdomsudvikling",
      long_description_key: "archetypes.talentspejderen.longDescription", long_description: "",
    },
    {
      archetype_key: "gc_elsker", selection_kind: "wildcard", alignment_score: 4, is_chairman: false,
      label_key: "archetypes.gc_elsker.label", label: "GC-elsker", emoji: "⛰️",
      short_description_key: "archetypes.gc_elsker.shortDescription", short_description: "Tre uger eller intet, Tour er alt",
      long_description_key: "archetypes.gc_elsker.longDescription", long_description: "",
    },
  ],
  active_consequences: [],
  bonus_offer: null,
  dna_suggestions: [],
};

test("interactive board renders archetype copy in English without Danish leak", async ({ page }) => {
  await login(page);

  // Override registreret efter fixtures → højere prioritet for board/status.
  await page.route("**/api/board/status**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(route.request()) });
    }
    if (route.request().method() !== "GET") return route.fallback();
    return json(route, NONBASELINE_BOARD_STATUS);
  });

  await page.goto("/board");
  await forceEnglish(page);
  await expect(page.locator("main")).toBeVisible();

  // Medlems-grid'en renderer arketype-label + kort beskrivelse via i18n-koder.
  await expect(page.locator("main")).toContainText("The Sponsor Director");
  await expect(page.locator("main")).toContainText("Guards sponsor relationships");

  const mainText = await page.locator("main").innerText();
  // Råtekst-nøgler må aldrig lække.
  for (const rawKey of ["archetypes.sponsoraten.label", "archetypes.gc_elsker.label"]) {
    expect(mainText, `leaked raw i18n key "${rawKey}"`).not.toContain(rawKey);
  }
  // Hardcodet dansk arketype-copy må ikke vises i EN-mode.
  for (const danish of [/Sponsoraten/, /Vogter sponsorforhold/, /Talentspejderen/, /Tre uger eller intet/]) {
    expect(mainText, `leaked hardcoded Danish ${danish}`).not.toMatch(danish);
  }
});

test("rider profile value header stays contained on mobile", async ({ page }) => {
  await page.route("**/rest/v1/riders?**", async (route) => {
    const request = route.request();
    const origin = request.headers().origin || "*";
    const url = request.url();
    if (!url.includes("id=eq.rider-1")) {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "access-control-allow-origin": origin,
        "access-control-allow-credentials": "true",
        "access-control-expose-headers": "Content-Range",
        "Content-Range": "0-0/1",
      },
      body: JSON.stringify({
        id: "rider-1",
        firstname: "Ada",
        lastname: "Pedersen",
        team_id: "team-e2e",
        team: { id: "team-e2e", name: "E2E Racing" },
        nationality_code: "dk",
        birthdate: "2002-04-12",
        market_value: 123456789012,
        salary: 42000,
        prize_earnings_bonus: 0,
        is_u25: true,
        stat_fl: 74,
        stat_bj: 68,
        stat_kb: 70,
        stat_bk: 72,
        stat_tt: 66,
        stat_prl: 64,
        stat_bro: 58,
        stat_sp: 76,
        stat_acc: 78,
        stat_ned: 71,
        stat_udh: 73,
        stat_mod: 69,
        stat_res: 67,
        stat_ftr: 75,
      }),
    });
  });

  await login(page);
  await page.goto("/riders/rider-1");

  const value = page.getByTestId("rider-value-amount");
  await expect(page.getByRole("heading", { name: "Ada Pedersen" })).toBeVisible();
  await expect(value).toBeVisible();
  await expect(value).toHaveText("123.456.789.012");
  await expect(value).toHaveAttribute("title", "123.456.789.012 CZ$");

  const layout = await value.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const styles = window.getComputedStyle(el);
    return {
      viewportWidth: window.innerWidth,
      left: rect.left,
      right: rect.right,
      width: rect.width,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      textOverflow: styles.textOverflow,
      whiteSpace: styles.whiteSpace,
      wordBreak: styles.wordBreak,
    };
  });

  expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.left).toBeGreaterThanOrEqual(0);
  expect(layout.width).toBeGreaterThan(0);
  expect(layout.clientWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.textOverflow).toBe("ellipsis");
  expect(layout.whiteSpace).toBe("nowrap");
  expect(layout.wordBreak).not.toBe("break-all");

  await page.evaluate(() => window.__i18n.changeLanguage("en"));
  await expect(value).toHaveText("123,456,789,012");
  await expect(value).toHaveAttribute("title", "123,456,789,012 CZ$");
});
