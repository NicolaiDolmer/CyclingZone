import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, RIDERS, TEST_TEAM, json } from "./fixtures.js";
import { wantsObject } from "../../src/preview/mockHandlers.js";

// #5075 (spillerforslag @cybersimon 9/9, Discord #feedback-and-ideas): Stats-
// fanen under Mit hold manglede den til-/fravalg af akademiryttere som Trup-
// fanen allerede havde (#1929). Rettelsen genbruger PRÆCIS samme kontrol og
// samme state (løftet til TeamPage.jsx, se AcademySquadFilter.jsx) i stedet
// for at opfinde en ny variant — testen dækker derfor begge halvdele af
// kravet:
//   1) akademiryttere forsvinder fra Stats-tabellen når filteret slås fra
//   2) filter-valget er DELT state — et flip i den ene fane følger med til
//      den anden, i stedet for at hver fane holde sin egen kopi.
//
// `installNetworkMocks`s riders-fixture (seedData.js) har kun ÉN rytter på
// TEST_TEAM (Ada, ikke akademi) — ingen akademiryttere at teste filteret på.
// Overrides herunder tilføjer én akademirytter til TEST_TEAM, samme
// override-mønster som 4582-demote-keeps-contract.spec.js's mockU23OwnRider.

const SENIOR_RIDER = RIDERS.find((r) => r.id === "rider-1"); // Ada Pedersen — allerede is_academy: falsy.

const ACADEMY_RIDER = {
  ...SENIOR_RIDER,
  id: "rider-5075-academy",
  firstname: "Oskar",
  lastname: "Berg",
  nationality_code: "no",
  is_academy: true,
  is_u25: true,
  contract_end_season: 3,
  salary: 12000,
  base_value: 90000,
  market_value: 90000,
  rider_derived_abilities: undefined,
};
delete ACADEMY_RIDER.rider_derived_abilities;

async function mockAcademyRoster(page) {
  await page.route("**/rest/v1/riders**", (route) => {
    const request = route.request();
    if (request.method() !== "GET") return json(route, {});
    const url = request.url();
    const accept = request.headers().accept || "";
    const asSingle = (rows) => (wantsObject(accept) ? (rows[0] || {}) : rows);
    // TeamPage.jsx's "kommende trup"-query (pending_team_id=eq.<team>) — ingen
    // indgående ryttere nødvendige for dette filter-flow.
    if (url.includes("pending_team_id=eq.")) return json(route, asSingle([]));
    if (url.includes(`team_id=eq.${TEST_TEAM.id}`)) {
      return json(route, asSingle([SENIOR_RIDER, ACADEMY_RIDER]));
    }
    return json(route, asSingle(RIDERS));
  });
}

test.beforeEach(async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockAcademyRoster(page);
  await login(page);
  await page.goto("/team");
});

test("Stats-fanen deler akademi-filteret med Trup-fanen — akademiryttere forsvinder fra tabellen når filteret slås fra (#5075)", async ({ page }) => {
  // Trup-fanen (default) viser begge ryttere.
  await expect(page.getByRole("link", { name: "Ada Pedersen", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Oskar Berg", exact: true })).toBeVisible();

  // Skift til Stats-fanen — SAMME to ryttere skal være der, kontrollen skal
  // findes her, og den skal starte i samme default (begge til) som Trup-fanen.
  await page.getByRole("tab", { name: "Statistik" }).click();
  const statsAcademyToggle = page.getByRole("button", { name: "Akademi (1)" });
  await expect(statsAcademyToggle).toBeVisible();
  await expect(statsAcademyToggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("link", { name: "Ada Pedersen", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Oskar Berg", exact: true })).toBeVisible();

  // Slå akademi-visningen fra i Stats-fanen — akademirytteren forsvinder fra
  // TABELLEN, seniorrytteren og resten af UI'et er upåvirket.
  await statsAcademyToggle.click();
  await expect(statsAcademyToggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("link", { name: "Oskar Berg", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Ada Pedersen", exact: true })).toBeVisible();

  // DELT state (kernekravet i #5075): fravalget fulgte med til Trup-fanen —
  // ikke en ny, lokal kopi af filteret dér.
  await page.getByRole("tab", { name: /^Trup/ }).click();
  const squadAcademyToggle = page.getByRole("button", { name: "Akademi (1)" });
  await expect(squadAcademyToggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("link", { name: "Oskar Berg", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Ada Pedersen", exact: true })).toBeVisible();

  // Slå filteret til igen FRA Trup-fanen — Stats-fanen skal følge med tilbage.
  await squadAcademyToggle.click();
  await page.getByRole("tab", { name: "Statistik" }).click();
  await expect(page.getByRole("button", { name: "Akademi (1)" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("link", { name: "Oskar Berg", exact: true })).toBeVisible();
});
