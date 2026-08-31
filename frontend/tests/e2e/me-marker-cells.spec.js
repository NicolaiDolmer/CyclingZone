import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, login, json, TEST_TEAM } from "./fixtures.js";

// Forward-guard for #2795-opfoelgningen.
//
// Markeringen "det her er dit hold" laa foer som
//   inset 0 0 0 1.5px rgb(var(--me-ring) / 0.5)
// paa selve <tr>. Den var i praksis usynlig af to grunde, og ingen af dem var
// farven: box-shadow paa en <tr> males ikke paalideligt i en border-collapse-
// tabel, og cellerne maler deres egen baggrund oven paa raekkens - DataTables
// sticky navnecelle er bevidst opak (bg-cz-card, dataTableStyles.js:75, fordi
// kolonnerne scroller ind UNDER den).
//
// Foerste forsoeg flyttede markeringen til cellerne som en background-color.
// Det gjorde den synlig, men reglen ERSTATTEDE saa cellernes egen baggrund i
// stedet for at laegge sig ovenpaa (adversarisk review 31/8). Derfor maaler
// specen nu BEGGE dele: at markeringen naar frem, OG at den ikke spiser noget.
//
// Mekanikken i selve CSS'en er laast separat i src/meMarkerCss.test.js.

// --alpha ud af en computed rgb()/rgba()-streng. 1 = helt opak.
function alphaOf(color) {
  const m = /^rgba?\(([^)]+)\)$/.exec(color.trim());
  if (!m) return null;
  const parts = m[1].split(/[,\s/]+/).filter(Boolean);
  return parts.length > 3 ? Number(parts[3]) : 1;
}

test.describe("Egen-hold-markering sidder paa cellerne (#2795)", () => {
  test.beforeEach(async ({ page }) => {
    await stabilizePage(page);
    await installNetworkMocks(page);
  });

  test("rytterranglisten markerer egne ryttere synligt", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-tabellen; mobil bruger kort.");

    await login(page);
    await page.goto("/standings?tab=riders");
    await expect(page.locator("main")).toBeVisible();

    // Ada Pedersen koerer for E2E Racing (testholdet); Mikkel Hansen goer ikke.
    const mine = page.locator("table tbody tr", { hasText: "Ada Pedersen" }).first();
    const theirs = page.locator("table tbody tr", { hasText: "Mikkel Hansen" }).first();

    await expect(mine).toHaveClass(/cz-me/);
    await expect(theirs).not.toHaveClass(/cz-me/);

    // Selve renderingen, ikke bare klassenavnet: foerste celle SKAL have en
    // box-shadow. Var markeringen stadig paa <tr>, ville den her vaere "none".
    const shadow = await mine.locator("td").first()
      .evaluate(el => getComputedStyle(el).boxShadow);
    expect(shadow).not.toBe("none");
    expect(shadow.trim()).not.toBe("");

    const theirShadow = await theirs.locator("td").first()
      .evaluate(el => getComputedStyle(el).boxShadow);
    expect(theirShadow).toBe("none");

    // Den pinnede navnecelle SKAL forblive opak - kolonnerne scroller ind
    // under den. Da toningen var en background-color, blev netop den her celle
    // 95 % gennemsigtig paa egne raekker, saa tallene kunne ses gennem navnet.
    const myBg = await mine.locator("td").first()
      .evaluate(el => getComputedStyle(el).backgroundColor);
    expect(alphaOf(myBg)).toBe(1);
    // Og den skal se ud som de andres sticky-celler, ikke have sin egen farve.
    const theirBg = await theirs.locator("td").first()
      .evaluate(el => getComputedStyle(el).backgroundColor);
    expect(myBg).toBe(theirBg);
  });

  test("stillingen markerer eget hold uden at spise leder-guldet", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-tabellen.");

    await login(page);
    await page.goto("/standings");
    await expect(page.locator("main")).toBeVisible();

    const mine = page.locator("table tbody tr", { hasText: "E2E Racing" }).first();

    await expect(mine).toHaveClass(/cz-me/);

    const shadow = await mine.locator("td").first()
      .evaluate(el => getComputedStyle(el).boxShadow);
    expect(shadow).not.toBe("none");

    const myBg = await mine.locator("td").first()
      .evaluate(el => getComputedStyle(el).backgroundColor);
    expect(alphaOf(myBg)).toBe(1);
  });
});

// Standard-mocken har mit hold som nr. 2 af 3 i én pulje - altsaa hverken leder
// eller i en zone. Netop den kombination (leder OG op-rykningszone) er den der
// gik i stykker, saa den skal have sin egen mock. Uden den laa leder-assertionen
// i en `if (leaderIsMine)` der aldrig var sand: samme fejlklasse som
// .claude/learnings/2026-08-28-groent-flueben-der-intet-verificerede.md.
test.describe("Eget hold som divisionsleder i op-rykningszonen (#2795)", () => {
  const POOL = "div3-pool-me";
  const POOLS = [{ id: POOL, tier: 3, pool_index: 0, label: "Pool A" }];

  // 8 hold, faldende point, mit hold OEVERST: leder (guld) og top-2 (op-zone).
  const TEAMS = Array.from({ length: 8 }, (_, i) => ({
    id: i === 0 ? TEST_TEAM.id : `rival-${i}`,
    name: i === 0 ? TEST_TEAM.name : `Rival ${i}`,
    division: 3,
    league_division_id: POOL,
    is_ai: false,
    pts: 1200 - i * 40,
  }));

  const STANDING_ROWS = TEAMS.map(t => ({
    id: `ss-${t.id}`,
    team_id: t.id,
    season_id: "season-e2e",
    total_points: t.pts,
    penalty_points: 0,
    stage_wins: 0,
    podiums: 0,
    league_division_id: POOL,
    team: { id: t.id, name: t.name, division: 3, is_ai: false, league_division_id: POOL },
    pool: POOLS[0],
  }));

  test.beforeEach(async ({ page }) => {
    await stabilizePage(page);
    await installNetworkMocks(page);
    await page.route("**/rest/v1/teams*", route => {
      const accept = route.request().headers().accept || "";
      if (accept.includes("vnd.pgrst.object")) {
        return json(route, { ...TEST_TEAM, division: 3, league_division_id: POOL });
      }
      return json(route, TEAMS.map(t => ({
        id: t.id, name: t.name, division: t.division, league_division_id: t.league_division_id,
      })));
    });
    await page.route("**/rest/v1/season_standings*", route => json(route, STANDING_ROWS));
    await page.route("**/rest/v1/league_divisions*", route => json(route, POOLS));
  });

  test("beholder BAADE leder-guld, zone-tint og dig-markering", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "Desktop-tabellen.");

    await login(page);
    await page.goto("/standings");
    await expect(page.getByRole("table")).toBeVisible();
    await page.getByRole("combobox", { name: "Division" }).selectOption("3");

    const mine = page.locator("table tbody tr", { hasText: TEST_TEAM.name }).first();
    const neighbour = page.locator("table tbody tr", { hasText: "Rival 1" }).first();

    // Mocken SKAL faktisk stille mig oeverst - ellers tester resten ingenting.
    await expect(mine).toBeVisible();
    const rank = await mine.locator("td").nth(0).innerText();
    expect(rank).toContain("1");

    // Leder-raekker faar kun kanten, aldrig den toningsgivende .cz-me: toningen
    // ville ellers ligge oven paa leder-guldet.
    await expect(mine).toHaveClass(/cz-me-bar/);
    await expect(mine).not.toHaveClass(/cz-me(?!-bar)/);

    // Dig-markeringen naar frem til rendering.
    const shadow = await mine.locator("td").first()
      .evaluate(el => getComputedStyle(el).boxShadow);
    expect(shadow).not.toBe("none");
    // Navy-striben, ikke bare en vilkaarlig skygge.
    const meRing = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--me-ring").trim().split(/\s+/).join(", "));
    expect(shadow).toContain(`rgb(${meRing})`);

    // Sticky navnecelle forbliver opak.
    const myBg = await mine.locator("td").first()
      .evaluate(el => getComputedStyle(el).backgroundColor);
    expect(alphaOf(myBg)).toBe(1);

    // Zone-tinten overlever paa MIN raekke: en scrollende celle skal have samme
    // baggrund som naboen i samme op-rykningszone. Da toningen var en
    // background-color, var min raekke den eneste farveloese i zonen.
    const myZoneCell = await mine.locator("td").nth(1)
      .evaluate(el => getComputedStyle(el).backgroundColor);
    const theirZoneCell = await neighbour.locator("td").nth(1)
      .evaluate(el => getComputedStyle(el).backgroundColor);
    expect(myZoneCell).toBe(theirZoneCell);
  });
});
