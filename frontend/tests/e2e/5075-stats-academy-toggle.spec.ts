import type { Page, Route } from "@playwright/test";
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, RIDERS, TEST_TEAM, json, evidenceShotPath } from "./fixtures.js";
import { wantsObject } from "../../src/preview/mockHandlers.js";

// #5075 (spillerforslag @cybersimon 9/9, Discord #feedback-and-ideas): Stats-
// fanen under Mit hold manglede den til-/fravalg af akademiryttere som Trup-
// fanen allerede havde (#1929). Rettelsen genbruger PRÆCIS samme kontrol og
// samme state (løftet til TeamPage.jsx, se AcademySquadFilter.tsx) i stedet
// for at opfinde en ny variant — testfilen dækker derfor tre ting:
//   1) akademiryttere forsvinder fra Stats-tabellen når filteret slås fra
//   2) filter-valget er DELT state — et flip i den ene fane følger med til
//      den anden, i stedet for at hver fane holde sin egen kopi.
//   3) rettespor 23/9: hold UDEN akademiryttere får ingen tom værktøjslinje
//      (streg foroven, ingen indhold) på Stats-fanen — DataTable's
//      `toolbar && (...)` var sand for selve React-elementet, også når
//      AcademySquadFilter selv rendererede null (148 af 258 menneskestyrede
//      hold i prod har ingen akademiryttere).
//
// `installNetworkMocks`s riders-fixture (seedData.js) har kun ÉN rytter på
// TEST_TEAM (Ada, ikke akademi) — det er default-tilstanden testcase 3 bruger
// UÆNDRET (intet akademi at filtrere på). Overrides herunder tilføjer én
// akademirytter til TEST_TEAM til testcase 1+2, samme override-mønster som
// 4582-demote-keeps-contract.spec.js's mockU23OwnRider.

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

async function mockAcademyRoster(page: Page) {
  await page.route("**/rest/v1/riders**", (route: Route) => {
    const request = route.request();
    if (request.method() !== "GET") return json(route, {});
    const url = request.url();
    const accept = request.headers().accept || "";
    const asSingle = (rows: any[]) => (wantsObject(accept) ? (rows[0] || {}) : rows);
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
  await login(page);
});

test("Stats-fanen deler akademi-filteret med Trup-fanen — akademiryttere forsvinder fra tabellen når filteret slås fra (#5075)", async ({ page }) => {
  await mockAcademyRoster(page);
  await page.goto("/team");

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

  // PR-bevis (#5075-scope: "Billeder desktop 1440 + mobil 390"). Kun skrevet
  // til repoet når CZ_WRITE_COMMITTED_SHOTS=1 (evidenceShotPath) — en normal
  // CI-/lokal-koersel lander i det ikke-committede test-results/evidence.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: evidenceShotPath("pr-screens/5075-stats-academy-toggle-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: evidenceShotPath("pr-screens/5075-stats-academy-toggle-mobile.png") });

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

test("Stats-fanen viser ingen tom værktøjslinje for hold uden akademiryttere (#5075 rettespor)", async ({ page }) => {
  // INGEN mockAcademyRoster her — default-fixturen (kun Ada, ikke akademi) ER
  // selve testcasen: holdet har akademiCount === 0 og seniorer er ikke skjult,
  // så AcademySquadFilter.tsx skal rendere null, og TeamStatsTab.jsx skal derfor
  // slet ikke sende et toolbar-element til DataTable.
  await page.goto("/team");
  await page.getByRole("tab", { name: "Statistik" }).click();
  await expect(page.getByRole("link", { name: "Ada Pedersen", exact: true })).toBeVisible();

  // Selve filter-kontrollen findes slet ikke (holdet har intet at filtrere på).
  await expect(page.getByRole("button", { name: /^Akademi/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Seniorer/ })).toHaveCount(0);

  // Rettelsens kerne: DataTable's toolbar-wrapper (den bjælke med border-b-
  // stregen foroven, DataTable.jsx linje ~188 og ~271) må ikke monteres
  // overhovedet, når der ikke er noget at vise i den. Før rettelsen var
  // wrapperen der uanset — tom, men med streg — fordi et React-element altid
  // er "sandt" for `toolbar && (...)`, selv når komponenten selv returnerer
  // null. Klasselisten er identisk på tværs af desktop- og mobil-render.
  const toolbarBar = page.locator(".border-b.border-cz-border.px-4.py-2\\.5");
  await expect(toolbarBar).toHaveCount(0);

  // Samme tjek på mobil (390 — samme bredde som PR-bevis-screenshottet ovenfor).
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("link", { name: "Ada Pedersen", exact: true })).toBeVisible();
  await expect(toolbarBar).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Akademi/ })).toHaveCount(0);
});
