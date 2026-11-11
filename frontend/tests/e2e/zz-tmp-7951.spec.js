// Midlertidig skaermbilled-spec for #7951. Maa aldrig committes.
import { test } from "./e2e-base.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { installNetworkMocks, login, stabilizePage, corsHeaders, json } from "./fixtures.js";
import { RIDERS, RIVAL_TEAM } from "../../src/preview/seedData.js";

const LABEL = process.env.SHOT_LABEL || "after";
const OUT = `C:/Dev/CyclingZone-worktrees/.wave-scratch/feat-7951-rytterside-top/shots/${LABEL}`;
mkdirSync(OUT, { recursive: true });

const BASE = RIDERS.find((r) => r.id === "rider-1");
const WOLF = {
  ...BASE, id: "rider-wolf", firstname: "Florian", lastname: "Wolf", nationality_code: "ch",
  team_id: RIVAL_TEAM.id, team: RIVAL_TEAM, salary: 82673, contract_end_season: 6, contract_length: 2,
  market_value: 1633484, uci_points: 2000,
};
const AI = { ...WOLF, id: "rider-ai", firstname: "Ivo", lastname: "Keller", team: { ...RIVAL_TEAM, is_ai: true } };
const CASES = [
  { name: "rival-listed", rider: WOLF, listing: { id: "l1", asking_price: 6500000 } },
  { name: "own", rider: BASE, listing: null },
  { name: "ai", rider: AI, listing: null },
];
const VIEWPORTS = [{ tag: "1280", width: 1280, height: 900 }, { tag: "375", width: 375, height: 812 }];

function pre(route) {
  const req = route.request();
  if (req.method() === "OPTIONS") { route.fulfill({ status: 204, headers: corsHeaders(req) }); return true; }
  return false;
}

test("shots", async ({ page }) => {
  test.setTimeout(240000);
  await stabilizePage(page);
  await installNetworkMocks(page);
  let current = CASES[0];
  await page.route("**/rest/v1/riders**", (route) => {
    if (pre(route)) return undefined;
    const req = route.request();
    if (req.method() !== "GET") return json(route, {});
    const wantsObj = (req.headers().accept || "").includes("vnd.pgrst.object");
    const hit = CASES.find((c) => req.url().includes(`id=eq.${c.rider.id}`));
    if (hit) return json(route, wantsObj ? hit.rider : [hit.rider]);
    return json(route, [current.rider]);
  });
  await page.route("**/rest/v1/transfer_listings**", (route) => {
    if (pre(route)) return undefined;
    const wantsObj = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    const l = current.listing;
    return json(route, wantsObj ? l : l ? [l] : []);
  });
  await page.route("**/rest/v1/auctions**", (route) => {
    if (pre(route)) return undefined;
    const wantsObj = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObj ? null : []);
  });
  await page.route("**/rest/v1/rider_derived_abilities**", (route) => {
    if (pre(route)) return undefined;
    const row = { rider_id: current.rider.id, formula_version: 2, ...BASE.rider_derived_abilities, ability_progress: {} };
    const wantsObj = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObj ? row : [row]);
  });
  await page.route("**/api/feature-flags**", (route) => {
    if (pre(route)) return undefined;
    return json(route, { flags: { champion_jerseys_7824: true, talent_marks_7879: true } });
  });
  await page.route("**/rest/v1/rider_talent_marks**", (route) => {
    if (pre(route)) return undefined;
    return json(route, [{ rider_id: "rider-wolf", mark: "top_talent", rider_type: "climber" }]);
  });
  await page.route("**/rest/v1/rider_champion_titles**", (route) => {
    if (pre(route)) return undefined;
    return json(route, [{ rider_id: "rider-wolf", title: "national", scope: "CH", season_number: 1 }]);
  });
  await page.route("**/api/scouting/estimates**", (route) => {
    if (pre(route)) return undefined;
    return json(route, { estimates: {
      "rider-wolf": { hidden: true, level: 0 },
      "rider-ai": { hidden: true, level: 0 },
      "rider-1": { lo: 4, hi: 5, level: 3, prog: { lo: 62, hi: 71 }, role: "climber" },
    } });
  });
  await page.route("**/api/riders/*/level-correction-receipt**", (route) => {
    if (pre(route)) return undefined;
    return json(route, { receipt: { old_value: 1800000, new_value: 1633484, c: 0.907, applied_at: "2026-11-01T10:00:00Z" } });
  });

  await login(page);
  const report = [];
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const c of CASES) {
      current = c;
      await page.goto(`/riders/${c.rider.id}`);
      const hero = page.locator("section").filter({ has: page.locator("h1") }).first();
      await hero.waitFor({ timeout: 20000 });
      await page.waitForTimeout(1800);
      await hero.screenshot({ path: `${OUT}/${c.name}-${vp.tag}.png` });
      report.push(await page.evaluate(({ name, tag }) => {
        const clipped = [...document.querySelectorAll("section *")]
          .filter((el) => el.children.length === 0 && el.textContent.trim() && (el.scrollWidth > el.clientWidth + 1) && getComputedStyle(el).overflowX !== "visible")
          .map((el) => el.textContent.trim().slice(0, 40));
        const value = document.querySelector('[data-testid="rider-value-amount"]');
        const box = value?.getBoundingClientRect();
        const section = document.querySelector("section").getBoundingClientRect();
        return {
          case: name, vp: tag,
          docOverflow: document.documentElement.scrollWidth - window.innerWidth,
          clipped,
          value: value?.textContent, valueInside: box ? box.right <= section.right && box.left >= section.left : null,
          notScouted: /Ikke scoutet/.test(document.querySelector("section").textContent),
          forSale: document.querySelector('[data-testid="rider-for-sale"]')?.innerText ?? null,
          marks: document.querySelector('[data-testid="rider-hero-marks"]')?.innerText ?? null,
          overDeltaColor: value ? getComputedStyle(document.querySelector('[data-testid="value-delta-badge"]') ?? document.body).color : null,
        };
      }, { name: c.name, tag: vp.tag }));
      if (LABEL === "after" && c.name === "rival-listed") {
        const mark = page.getByTestId("talent-mark-profile-top_talent");
        if (await mark.count()) {
          if (vp.tag === "1280") await mark.hover(); else await mark.click();
          await page.waitForTimeout(300);
          report.push({ tooltip: await page.getByRole("tooltip").first().innerText().catch(() => null), vp: vp.tag });
          await page.screenshot({ path: `${OUT}/${c.name}-${vp.tag}-tooltip.png` });
          await page.mouse.move(0, 0);
        }
      }
    }
  }
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
});
