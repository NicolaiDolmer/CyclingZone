// #5471 — ranglisten paa mobil: et hold med Founder-maerke maa aldrig miste sit
// navn. Spiller-rapport 21/9 (iPhone, portraet): "Pludselig fylder eet hold hele
// tabellen, men ikke noget navn" i D1 og D2, og kun for hold med maerket.
//
// Mekanikken (reproduceret her FOER rettelsen): mobil-navnecellen (D-047) er en
// flex-raekke med rang-knap, online-prik, holdnavn og badges. Badges er
// `shrink-0`, holdnavnet har `min-w-0` og cellen er smal (w-full + max-w-0 ved
// siden af tre talkolonner). Naar badges alene er bredere end cellen, ender
// holdnavnet med 0-15 px bredde, og `break-words` + normal whitespace braekker
// det saa tegn for tegn: en meget hoej raekke UDEN laesbart navn.
//
// Specen vogter spillerens loefte, ikke markuppen: holdnavnet staar paa een
// linje og er ikke klippet, raekken er ikke unormalt hoej, og intet stikker ud
// over siden, i 390 px portraet og 844 x 390 landscape.
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json, TEST_TEAM } from "./fixtures.js";
import type { Page, Route } from "@playwright/test";

const DIV = 2;

// Fiktive holdnavne (ingen rigtige spillerhold). Lange nok til at presse
// cellen, som de rigtige navne i D1/D2 goer.
const TEAMS = [
  { id: "f-lead", name: "Skybound Racing Collective", pts: 1240, founder: 1 },
  { id: "r-2", name: "Vortex Pro Cycling", pts: 1180, founder: null },
  { id: TEST_TEAM.id, name: TEST_TEAM.name, pts: 1120, founder: 7 },
  { id: "r-4", name: "Crest Continental", pts: 1060, founder: null },
  { id: "f-5", name: "Northern Lights Velo Club", pts: 990, founder: 12 },
  { id: "r-6", name: "Granite Riders", pts: 930, founder: null },
  { id: "r-7", name: "Hollow Tactics", pts: 870, founder: null },
  { id: "r-8", name: "Meridian Cycling Team", pts: 810, founder: null },
  { id: "f-9", name: "Blue Ridge Development", pts: 760, founder: 23 },
  { id: "r-10", name: "Tailwind Syndicate", pts: 700, founder: null },
  { id: "r-11", name: "Lowland Sprinters", pts: 650, founder: null },
  { id: "f-12", name: "Coastal Breakaway Squad", pts: 600, founder: 31 },
];

const TEAM_ROWS = TEAMS.map((t) => ({ id: t.id, name: t.name, division: DIV }));
const STANDING_ROWS = TEAMS.map((t) => ({
  id: `ss-${t.id}`,
  team_id: t.id,
  season_id: "season-e2e",
  total_points: t.pts,
  penalty_points: 0,
  stage_wins: 3,
  podiums: 5,
  team: { id: t.id, name: t.name, division: DIV, is_ai: false },
}));
const FOUNDERS = TEAMS.filter((t) => t.founder != null).map((t) => ({ team_id: t.id, founder_number: t.founder }));
// Praemiekolonnen med 7-cifrede beloeb, saa talkolonnerne er saa brede som de
// bliver midt i en saeson (fiktive tal). Med "0 CZ$" ville navnet faa mere
// plads end det faar i virkeligheden, og specen ville maale heldet.
const EXT_ROWS = TEAMS.map((t, i) => ({
  team_id: t.id,
  comp_wins: 1,
  comp_podiums: 2,
  podiums: 5,
  prize_earned: 1_480_000 - i * 95_000,
}));

const VIEWPORTS = [
  { name: "portrait 390", width: 390, height: 844 },
  { name: "landscape 844x390", width: 844, height: 390 },
];

async function openStandings(page: Page) {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/rest/v1/teams*", (route: Route) => {
    const request = route.request();
    const wantsObject = (request.headers().accept || "").includes("vnd.pgrst.object");
    if (/user_id=eq\.[^&]+/.test(request.url())) {
      const mine = { ...TEST_TEAM, division: DIV };
      return json(route, wantsObject ? mine : [mine]);
    }
    if (wantsObject) return json(route, { ...TEST_TEAM, division: DIV });
    return json(route, TEAM_ROWS);
  });
  await page.route("**/rest/v1/season_standings*", (route: Route) => json(route, STANDING_ROWS));
  await page.route("**/rest/v1/team_standings_ext_mv*", (route: Route) => json(route, EXT_ROWS));
  await page.route("**/rest/v1/rpc/founder_public_list*", (route: Route) => {
    if (route.request().method() === "OPTIONS") return route.fallback();
    return json(route, FOUNDERS);
  });
  await login(page);
  await page.goto("/standings");
  await expect(page.getByRole("table").first()).toBeVisible();
  // Maerket hentes asynkront (RPC) — vent til alle fem er tegnet.
  await expect(page.getByText(/^Founder$/)).toHaveCount(FOUNDERS.length);
}

type RowMetrics = {
  name: string;
  founder: boolean;
  rowHeight: number;
  linkWidth: number;
  linkClipped: boolean;
  linkLines: number;
};

async function measureRows(page: Page): Promise<RowMetrics[]> {
  return page.evaluate(() => {
    const out: RowMetrics[] = [];
    for (const tr of Array.from(document.querySelectorAll("table tbody tr"))) {
      const link = tr.querySelector<HTMLAnchorElement>('a[href^="/teams/"]');
      if (!link) continue;
      const rect = link.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(link).lineHeight) || 18;
      out.push({
        name: link.textContent ?? "",
        founder: Array.from(tr.querySelectorAll("span")).some((s) => s.textContent === "Founder"),
        rowHeight: tr.getBoundingClientRect().height,
        linkWidth: rect.width,
        linkClipped: link.scrollWidth > link.clientWidth + 1,
        linkLines: Math.round(rect.height / lineHeight),
      });
    }
    return out;
  });
}

for (const vp of VIEWPORTS) {
  test(`holdnavnet vises altid ved siden af Founder-maerket (${vp.name}, #5471)`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await openStandings(page);

    const rows = await measureRows(page);
    console.log(`REPRO ${vp.name}`, JSON.stringify(rows));
    await page.screenshot({ path: `test-results/repro-5471-${vp.width}x${vp.height}.png`, fullPage: true });
    expect(rows.length).toBe(TEAMS.length);
    const plain = rows.filter((r) => !r.founder);
    const founders = rows.filter((r) => r.founder);
    expect(founders.length).toBe(FOUNDERS.length);
    const plainMax = Math.max(...plain.map((r) => r.rowHeight));

    for (const row of founders) {
      // Navnet har reel bredde og er ikke klippet.
      expect(row.linkWidth, `${row.name}: bredde`).toBeGreaterThan(60);
      expect(row.linkClipped, `${row.name}: klippet`).toBe(false);
      // Hoejst to linjer (et langt navn maa bryde een gang, aldrig tegn for tegn).
      expect(row.linkLines, `${row.name}: linjer`).toBeLessThanOrEqual(2);
      // Raekken er ikke unormalt hoej i forhold til hold uden maerket.
      expect(row.rowHeight, `${row.name}: raekkehoejde`).toBeLessThanOrEqual(plainMax * 1.75);
    }

    // Intet stikker ud over siden.
    const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(pageOverflow).toBeLessThanOrEqual(1);
  });
}
