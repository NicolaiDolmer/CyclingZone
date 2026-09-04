import { expect, test } from "./e2e-base.js";
import {
  installNetworkMocks,
  login,
  stabilizePage,
  corsHeaders,
  json,
  TEST_TEAM,
  TEXT_MASK_SELECTOR,
  waitForPageReady,
  collectPageErrors,
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
  // S5 Season Planner — data-drevet SVG-bræt (deterministisk mock: fast "i dag" +
  // seed-peaks). Højere threshold dækker cross-engine AA på de tynde form-kurver +
  // brackets uden at miste blank-screen-detektion. Readiness-gate i ROUTE_READINESS.
  // #3102 etape 3: bor på Planlægnings-hubbens Formplan-fane (hubben ejer h1'en).
  { path: "/planning?tab=form", heading: /^(Planning|Planlægning)$/, snapshot: "planner.png", route: "/planning", maxDiffPixelRatio: 0.03 },
  { path: "/seasons", heading: /^(Sæson|Season)/, snapshot: "seasons.png" },
  // Inbox har meget dynamisk indhold (notifikations-list med timestamps, count-
  // badges, ulæst-prikker) der falder uden for `main`-text-masken og naturligt
  // varierer mellem CI-runs. Højere threshold dækker mobile-webkit-flaky uden
  // at miste blank-screen-detektion. Hvis trusler fra fremtidige layout-changes
  // sneaker forbi, kig på inbox-actual.png attachment i Playwright-report.
  { path: "/notifications", heading: "Indbakke", snapshot: "inbox.png", maxDiffPixelRatio: 0.12 },
  // Patch notes-h1 er sprog-uafhængig ("Patch notes" i begge sprog).
  // skipSnapshot: siden får en NY version-blok øverst ved hver brugerrettet PR, så
  // et pixel-snapshot driver hver gang (layout-shift fra tilføjede blokke — text-
  // masken hjælper ikke). Formålet her er blank-screen-detektion, dækket af
  // waitForPageReady's heading-gate + den eksplicitte heading-assertion i loopet.
  // (v6.63/#2210 gav 0.17 pixel-diff på alle 3 projekter → blokerede auto-merge.)
  { path: "/patch-notes", heading: "Patch notes", skipSnapshot: true },
  // #3199: forum-listen (pinned ejer-poll + spiller-opslag fra mock-seed).
  { path: "/forum", heading: "Forum", snapshot: "forum.png" },
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

// Snapshot-stabiliserings-helpers (TEXT_MASK_SELECTOR + waitForStableSnapshotTarget)
// bor i fixtures.js (#1076) så board-interactive.spec.js kan genbruge dem.
const TRANSLATED_PAGE_SMOKE = [
  {
    path: "/dashboard",
    // #4647: canary'erne var "Transfers & Offers" / "Transfers & tilbud" og
    // matchede ikke laengere copyen. Dashboardet blev bygget om i #4625, hvor
    // kortet fik sentence case og "and"/"og" i stedet for "&"
    // (locales/{en,da}/dashboard.json -> cards.transfers.title). Testen var
    // dermed roed paa main, ikke kun her - samme klasse som #4548.
    en: [/Active auctions/i, /Transfers and offers/i],
    da: [/Aktive auktioner/i, /Transfers og tilbud/i],
    rawKeys: ["dashboard:cards.transfers.title", "cards.transfers.title", "cards.auctions.title"],
  },
  {
    path: "/riders",
    en: [/Rider Database/i, /Value/i],
    da: [/Rytterdatabase/i, /Værdi/i],
    rawKeys: ["riders:page.title", "page.title", "table.value"],
  },
  {
    // #1569: /auctions defaulter nu til 'All'-fanen for nye spillere (tom
    // 'My auctions'), så empty.noInvolvementMySituation-copyen er ikke længere
    // garanteret synlig. Canaries flyttet til de altid-renderede filter-tab-
    // labels (My auctions / Mine auktioner, #228-omdøbt fra My situation/
    // Min situation) — stadig en ægte EN-renders + ingen-DA-leak-guard,
    // uafhængig af hvilken fane der er aktiv.
    path: "/auctions",
    en: [/Auctions/i, /My auctions/i],
    da: [/Auktioner/i, /Mine auktioner/i],
    rawKeys: ["auctions:page.title", "page.title", "filter.mySituation"],
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
    en: [/Squad \(/i],
    da: [/Trup \(/i],
    rawKeys: ["tabs.squad"],
  },
  {
    path: "/finance",
    en: [/Finance/i, /Active loans/i],
    da: [/Finanser/i, /Aktive lån/i],
    rawKeys: ["finance:page.title", "page.title", "loans.active.title"],
  },
  {
    // #4519: preview-mocken for /api/board/status skiftede fra baseline-fase
    // (alle planer null) til en aktiv 1-årsplan med request_options, så
    // board-request-preview-flowet (BoardRequestPanel) rent faktisk har noget
    // at rendere. "The board is observing your first season" hørte til
    // baseline-fasen og vises ikke længere som standard — canary'en peger nu
    // på "Se forslaget"-knappen (request.preview), som er selve indgangen til
    // den nye bekræftelsesdialog (Accept / Behold nuværende plan).
    path: "/board",
    en: [/Board/i, /See suggestion/i],
    da: [/Bestyrelse/i, /Se forslaget/i],
    rawKeys: ["board:request.preview", "request.preview", "requestDefs.lower_results_pressure.label"],
    // Mocken har kun 1yr konfigureret (5yr/3yr er null) → siden lander som
    // standard på 5-års-fanen, som er tom ("Configured automatically...").
    // BoardRequestPanel/canary'en herover bor under 1-års-fanens "Show
    // details"-udvidelse (DashboardPlanPanel's detailOpen, lukket by default).
    beforeAssert: async (page) => {
      await page.getByRole("tab", { name: /1-year plan/i }).click();
      await page.getByRole("button", { name: /Show details/i }).click();
    },
  },
  {
    path: "/notifications",
    en: [/Inbox/i, /No notifications in this category/i],
    da: [/Indbakke/i, /Ingen notifikationer i denne kategori/i],
    rawKeys: ["notifications:page.title", "page.title", "empty.noneUnread"],
  },
  {
    // #3102 etape 3: planneren er Formplan-fanen i Planlægnings-hubben.
    // Hub-h1'en kommer fra races:hub.title; filteret er stadig plannerens.
    path: "/planning?tab=form",
    en: [/Planning/i, /My races/i],
    da: [/Planlægning/i, /Mine løb/i],
    rawKeys: ["races:hub.title", "hub.tabForm", "filter.mine"],
  },
  {
    // OnlineBadge-leak-guard: badgen (delt af TeamProfilePage + ManagerProfilePage)
    // havde hardcodet dansk ("Online nu"/"aldrig"/"X min siden") som lækkede i EN,
    // fordi ingen af siderne var dækket her. Mocken serverer teams uden
    // manager:user_id-embed → lastSeen null → badgen rammer netop "never"-stien.
    path: `/teams/${TEST_TEAM.id}`,
    en: [/Manager: Playwright Manager/i, /Never/],
    da: [/aldrig/i, /Online nu/],
    rawKeys: ["team:profile.managerLabel", "profile.managerLabel", "time.never"],
  },
  // #2849 bølge 4-regression: help/rules/patchnotes lazy-loades via HttpBackend
  // (INLINE_EXEMPT). Uden `partialBundledLanguages: true` kalder i18next ALDRIG
  // backenden når `resources` er sat inline → namespaces "loader" som tomme,
  // `ready` flipper true og siderne renderer rå nøgler (help crashede på
  // returnObjects). Slap gennem lokalt fordi INGEN spec asserterede indhold på
  // de tre sider — disse tre entries er guarden mod hele klassen.
  {
    path: "/help",
    en: [/Everything you need to know about Cycling Zone Manager/i, /Getting started/i],
    da: [/Alt du skal vide om Cycling Zone Manager/i, /Kom i gang/i],
    rawKeys: ["help:page.title", "page.subtitle", "sections.start.label"],
  },
  {
    path: "/rules",
    en: [/limits, rates and formulas/i, /Squad cap/i],
    da: [/grænser, satser og formler/i, /Trup-loft|Truploft|Truppens/i],
    rawKeys: ["rules:page.title", "page.intro", "sections.squad.label"],
  },
  {
    path: "/patch-notes",
    en: [/What's new in Cycling Zone Manager/i],
    da: [/Hvad er nyt i Cycling Zone Manager/i],
    rawKeys: ["patchnotes:title", "search.placeholder", "category.all"],
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
  const pageErrors = collectPageErrors(page, testInfo);

  await login(page);

  for (const spec of CORE_PAGES) {
    await page.goto(spec.path);
    // #1272: ét readiness-kald — generisk surface-gate + route-specifik gate
    // (ROUTE_READINESS) + snapshot-overflade-stabilisering — så screenshot ikke
    // lander mid-render på data-drevne sider.
    await waitForPageReady(page, spec);
    // skipSnapshot-sider (fx patch notes) ændrer layout by design ved hver release,
    // så der findes intet stabilt pixel-snapshot. Blank-screen-detektion sikres i
    // stedet af waitForPageReady + denne eksplicitte heading-assertion.
    if (spec.skipSnapshot) {
      await expect(page.getByRole("heading", { name: spec.heading })).toBeVisible();
      continue;
    }
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
    // #4519: per-side setup FØR canary-assertions (fx skift til en anden
    // fane) for sider hvor den ønskede copy ikke er på standard-visningen.
    if (spec.beforeAssert) await spec.beforeAssert(page);

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

// #1681: holdudtagelse var begravet 3 klik nede. Dashboard-CTA'en skal vise sig
// når der findes et kommende (scheduled) løb og linke MANAGEREN DIREKTE til det
// løbs detalje-side, hvor RaceSelectionPanel bor. Default-fixturen returnerer
// ingen løb (races → []), så kortet er skjult — denne test overrider races-
// queryen med ét scheduled løb og verificerer både synlighed og routing.
test("dashboard team-selection CTA links to the next selectable race", async ({ page }) => {
  const SCHEDULED_RACE = {
    id: "race-next-1",
    name: "Tour Test Prologue",
    race_type: "one_day",
    race_class: "Class1",
    stages: 1,
    status: "scheduled",
    season_id: "season-e2e",
    pool_race: { date_text: "5/7" },
  };

  // Override OVEN PÅ installNetworkMocks (senest registrerede route vinder).
  await page.route("**/rest/v1/races?**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    if (request.method() !== "GET") return route.fallback();
    return json(route, [SCHEDULED_RACE]);
  });

  await login(page);
  await page.goto("/dashboard");
  await forceEnglish(page);

  const cta = page.getByTestId("team-selection-cta");
  await expect(cta).toBeVisible();
  await expect(cta).toContainText(/Pick your race squad/i);
  await expect(cta).toContainText(/Tour Test Prologue/);

  await cta.getByRole("link", { name: /Set your line-up/i }).click();
  // #2288 F: lander nu PÅ udtagelses-panelet (#selection-anchor) i stedet for
  // øverst på race-siden.
  await expect(page).toHaveURL(/\/races\/race-next-1#selection$/);
});

test("dashboard shows per-pool race-days counter incl. in-progress (#1829)", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard");
  // POOL_RACES (fixtures): completede ETAPER = 1+1+2 = 4, total = 11, igangværende = 2
  // → tælleren viser "4/11 ... · 2 live/i gang" (per-pulje, ikke det sæson-globale 0/28).
  // #4245: tælleren summerer races.stages, så copyen siger etaper, ikke løbsdage.
  await expect(page.getByText(/4\/11/).first()).toBeVisible();
  await expect(page.getByText(/2\s+(live|i gang)/i).first()).toBeVisible();
});

test("dashboard marks an in-progress stage race as Live with stage progress (#1828)", async ({ page }) => {
  const LIVE_RACE = {
    id: "race-live", name: "La Corsa dei Due Mari", race_type: "stage_race", race_class: "OtherWorldTourA",
    stages: 7, stages_completed: 3, status: "scheduled", season_id: "season-e2e",
    league_division_id: 2, pool_race: { date_text: "24/6" },
  };
  // Override OVEN PÅ installNetworkMocks: alle races-queries → ét igangværende etapeløb.
  await page.route("**/rest/v1/races?**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() !== "GET") return route.fallback();
    return json(route, [LIVE_RACE]);
  });
  // #3751: "Kommende løb"-kortet filtrerer nu på holdets egne race_entries —
  // holdet ER tilmeldt dette synteticerede igangværende løb (etableret hold,
  // testen dækker Live-badge + etape-fremdrift, ikke tilmeldings-filteret).
  await page.route("**/rest/v1/race_entries?**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() !== "GET") return route.fallback();
    return json(route, [{ race_id: LIVE_RACE.id, rider_id: "rider-1", team_id: TEST_TEAM.id, is_auto_filled: false, race_role: "leader" }]);
  });
  // Næste etape (4) langt ude i fremtiden → countdown rendrer uden at være tids-skørt.
  await page.route("**/rest/v1/race_stage_schedule?**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    if (request.method() !== "GET") return route.fallback();
    return json(route, [{ race_id: "race-live", stage_number: 4, scheduled_at: "2099-06-24T13:00:00Z" }]);
  });

  await login(page);
  await page.goto("/dashboard");
  await forceEnglish(page);

  await expect(page.getByText("La Corsa dei Due Mari")).toBeVisible();
  // Live-badge + 3/7 etape-fremdrift i "Kommende løb"-kortet (scoped til løb-rækken).
  const row = page.locator("text=La Corsa dei Due Mari").locator("xpath=ancestor::a");
  await expect(row.getByText(/Live/i)).toBeVisible();
  await expect(row.getByText("3/7")).toBeVisible();
});
