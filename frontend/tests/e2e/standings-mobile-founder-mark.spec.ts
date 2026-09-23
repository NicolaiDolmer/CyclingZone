// #5471 — ranglisten paa mobil: et hold med Founder-maerke maa aldrig miste sit
// navn. Spiller-rapport 21/9 (telefon, portraet): "Pludselig fylder eet hold
// hele tabellen, men ikke noget navn" i D1 og D2, og kun for hold med maerket.
//
// Mekanikken (reproduceret med denne spec FOER rettelsen, 390 px): mobil-
// navnecellen (D-047) var EEN flex-linje med rang-knap, online-prik, holdnavn og
// badges i en celle paa ca. 90 px. Badges er `shrink-0`, holdnavnet havde
// `min-w-0`, saa naar badges alene fyldte cellen, fik navnet 0 px bredde, og
// `break-words` braekkede det tegn for tegn: raekker paa 435-515 px uden
// laesbart navn. Hold uden maerke fik 23-50 px og braekkede midt i ord.
//
// Specen vogter spillerens loefte, ikke markuppen, i 390 px portraet og
// 844 x 390 landscape: holdnavnet har reel bredde og er ikke klippet, intet ord
// i navnet er braekket midt over, maerket staar i raekken, raekken er ikke
// unormalt hoej, og siden kan ikke scrolles vandret.
import { test, expect } from "./e2e-base.js";
import { evidenceShotPath } from "./fixtures.js";
import { openStandings, TEAMS, FOUNDERS } from "./lib/standings-mobile-mock.ts";
import type { Page } from "@playwright/test";

const VIEWPORTS = [
  { name: "portrait 390", width: 390, height: 844 },
  { name: "landscape 844x390", width: 844, height: 390 },
];

type RowMetrics = {
  name: string;
  founder: boolean;
  rowHeight: number;
  linkWidth: number;
  linkClipped: boolean;
  longestWord: number;
};

async function measureRows(page: Page): Promise<RowMetrics[]> {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const out: RowMetrics[] = [];
    for (const tr of Array.from(document.querySelectorAll("table tbody tr"))) {
      const link = tr.querySelector<HTMLAnchorElement>('a[href^="/teams/"]');
      if (!link) continue;
      const style = getComputedStyle(link);
      // Bredeste ORD i navnet, maalt med linkets egen font. Er det bredere end
      // linket, er et ord braekket midt over (break-words' sidste udvej).
      let longestWord = 0;
      if (ctx) {
        ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        for (const word of (link.textContent ?? "").split(/\s+/)) {
          longestWord = Math.max(longestWord, ctx.measureText(word).width);
        }
      }
      out.push({
        name: link.textContent ?? "",
        founder: Array.from(tr.querySelectorAll("span")).some((s) => s.textContent === "Founder"),
        rowHeight: tr.getBoundingClientRect().height,
        linkWidth: link.getBoundingClientRect().width,
        linkClipped: link.scrollWidth > link.clientWidth + 1,
        longestWord,
      });
    }
    return out;
  });
}

for (const vp of VIEWPORTS) {
  test(`holdnavnet vises altid ved siden af Founder-maerket (${vp.name}, #5471)`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await openStandings(page);

    const rows = await measureRows(page);
    expect(rows.length).toBe(TEAMS.length);
    const founders = rows.filter((r) => r.founder);
    const plain = rows.filter((r) => !r.founder);
    expect(founders.length).toBe(FOUNDERS.length);
    const plainMax = Math.max(...plain.map((r) => r.rowHeight));

    for (const row of rows) {
      // Navnet har reel bredde og er ikke klippet — heller ikke hos hold uden maerke.
      expect(row.linkWidth, `${row.name}: bredde`).toBeGreaterThan(60);
      expect(row.linkClipped, `${row.name}: klippet`).toBe(false);
      // Intet ord braekket midt over (+1 px for afrunding).
      expect(row.longestWord, `${row.name}: bredeste ord vs. linkets bredde`).toBeLessThanOrEqual(row.linkWidth + 1);
    }
    for (const row of founders) {
      // Maerket giver hoejst en ekstra linje, aldrig en raekke der fylder skaermen.
      expect(row.rowHeight, `${row.name}: raekkehoejde`).toBeLessThanOrEqual(plainMax * 1.75);
    }

    // Intet stikker ud over siden.
    const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(pageOverflow).toBeLessThanOrEqual(1);

    await page.screenshot({
      path: evidenceShotPath(`pr-screens/5471-standings-${vp.width}x${vp.height}-${testInfo.project.name}.png`),
      fullPage: true,
    });
  });
}
