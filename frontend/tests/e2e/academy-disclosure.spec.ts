import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, login, json, RIDERS, TEST_TEAM } from "./fixtures.js";
import { SEED_ACADEMY, SEED_SCOUT_ESTIMATES } from "../../src/preview/seedData.js";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const coachCopy = JSON.parse(readFileSync(new URL("../../public/locales/da/academy.json", import.meta.url), "utf8")).graduationDay.coach;
const fixedNow = new Date("2026-10-20T12:00:00Z");
const stages = [
  { stage: "learning", daysOnTeam: 0, nextStageDays: 1, band: null },
  { stage: "broad", daysOnTeam: 1, nextStageDays: 3, band: { role: "sprinter", lo: 31, hi: 57 } },
  { stage: "narrow", daysOnTeam: 2, nextStageDays: 2, band: { role: "sprinter", lo: 36, hi: 52 } },
  { stage: "final", daysOnTeam: 3, nextStageDays: null, band: { role: "sprinter", lo: 39, hi: 49 } },
];
const shots = process.env.ACADEMY_DISCLOSURE_SHOTS;
const before = process.env.ACADEMY_DISCLOSURE_BEFORE === "1";
for (const width of [1440, 375]) {
  // Separate stages keep CI WebKit page loads within each test budget.
  for (const stage of (before ? [stages[0]] : stages)) {
    test(`academy ${stage.stage} knowledge matches on all surfaces at ${width}px`, async ({ page }) => {
      test.setTimeout(120000);
      await page.setViewportSize({ width, height: 900 });
      await installNetworkMocks(page);
      await stabilizePage(page);
      await page.clock.setFixedTime(fixedNow);
      const prognosis = stage;
      const rider = { ...RIDERS[0], birthdate: "2003-04-12", is_academy: true, squad: "u23" };
      await page.route("**/rest/v1/riders?**", (route) => {
        const url = new URL(route.request().url());
        const id = url.searchParams.get("id");
        if (id && id !== "eq.rider-1") return route.fallback();
        const object = route.request().headers().accept?.includes("object");
        return json(route, object ? rider : [rider]);
      });
      await page.route("**/api/scouting/estimates", route => json(route, {
        teamId: TEST_TEAM.id, maxLevel: 3,
        estimates: { ...SEED_SCOUT_ESTIMATES, "rider-1": before ? SEED_SCOUT_ESTIMATES["rider-1"] : { academyPrognosis: prognosis } },
      }));
      await page.route("**/api/riders/rider-1/scouting-report", route => {
        if (before) return route.fallback();
        return json(route, { own: true, academyPrognosis: prognosis });
      });
      await page.route("**/api/academy/me**", route => json(route, {
        ...SEED_ACADEMY, roster: [{ ...rider, prognosis }],
        graduations: [{ ...SEED_ACADEMY.graduations[0], riderId: rider.id, name: "Ada Pedersen",
          age: 23, fromSquad: "u23", toSquad: "senior", nationality_code: rider.nationality_code,
          salary: rider.salary, market_value: rider.market_value, contract_end_season: rider.contract_end_season,
          primary_type: rider.primary_type, secondary_type: rider.secondary_type,
          rider_derived_abilities: rider.rider_derived_abilities }],
      }));
      await login(page);
      for (const [surface, path] of [["team", "/team"], ["development", "/team?tab=development"], ["hero", "/riders/rider-1"], ["scouting", "/riders/rider-1?tab=scouting"], ["academy", "/academy"], ["training", "/training?tab=development"], ["graduation", "/academy/graduation"]]) {
        await test.step(surface, async () => {
          await page.goto(path);
          if (surface === "development") await expect(page.getByRole("tab", { name: /^(Development|Udvikling)$/i })).toHaveAttribute("aria-selected", "true");
          if (surface === "team" && width === 375) {
            const chip = page.getByRole("button", { name: /^(Potential|Potentiale)$/i }).first();
            await expect(chip).toBeVisible();
            if (await chip.getAttribute("aria-pressed") !== "true") await chip.click();
          }
          if (!before || surface === "academy") {
            const cells = page.getByTestId(stage.band ? "academy-prognosis-band" : "academy-prognosis-learning");
            if (surface === "scouting") await expect(cells).toHaveCount(1);
            const cell = cells.first();
            await expect(cell).toBeVisible();
            await cell.scrollIntoViewIfNeeded();
            if (stage.band) await expect(cell).toContainText(`${stage.band.lo}–${stage.band.hi}`);
            await expect(page.locator("[data-potential-band]")).toHaveCount(0);
            if (surface === "scouting") await expect(page.locator("[data-type]")).toHaveCount(0);
            if (surface === "scouting") {
              const report = page.getByTestId("academy-scouting-prognosis");
              await expect(report.getByRole("heading", { name: "Akademiprognose", exact: true })).toBeVisible();
              const progress = report.getByRole("list", { name: "Prognosens trin" });
              await expect(progress.getByRole("listitem")).toHaveCount(4);
              await expect(progress.locator('[aria-current="step"]')).toHaveAttribute("data-stage", stage.stage);
              await expect(progress.getByRole("listitem")).toHaveText(["1Lærer", "2Groft", "3Skarpere", "4Endeligt"]);
              await expect(report.getByTestId("academy-scouting-band")).toHaveText(stage.band ? `${stage.band.lo}–${stage.band.hi} rating-point` : "Intet bud endnu");
              await expect(report.getByTestId("academy-scouting-next")).toHaveText(stage.nextStageDays == null ? "Alle trin nået" : `${stage.nextStageDays} trænings- eller løbsdag${stage.nextStageDays === 1 ? "" : "e"}`);
              await expect(report.getByRole("link", { name: "Læs mere" })).toHaveAttribute("href", "/help?section=academy");
              await expect(report).toContainText("Registrerede trænings- og løbsdage gør prognosen skarpere. Kalenderdage alene tæller ikke.");
              await report.scrollIntoViewIfNeeded();
              const bounds = await report.boundingBox();
              expect(bounds).not.toBeNull();
              expect(bounds!.x).toBeGreaterThanOrEqual(0);
              expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
            }
          } else if (surface === "training") {
            await expect(page.getByText(/40.*48/).first()).toBeVisible();
          } else if (surface === "development") {
            await expect(page.getByText("40–48", { exact: true })).toBeVisible();
          } else {
            await expect(page.locator("[data-potential-band]").first()).toBeVisible();
            if (surface === "scouting") await page.locator("[data-type]").first().scrollIntoViewIfNeeded();
          }
          if (surface === "graduation") {
            const verdict = before || stage.stage === "final" ? "climbing" : stage.band ? "unproven" : "unknown";
            await expect(page.getByTestId("graduation-coach-verdict")).toHaveText(coachCopy[verdict]);
          }
          if (shots && stage.stage === "learning") {
            mkdirSync(resolve(shots), { recursive: true });
            await page.screenshot({ path: resolve(shots, `${before ? "before" : "after"}-${surface}-${width}.png`), fullPage: false });
          }
        });
      }
    });
  }
}
