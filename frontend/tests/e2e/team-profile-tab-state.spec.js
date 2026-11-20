import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, json, login, stabilizePage, TEST_TEAM, RIVAL_TEAM } from "./fixtures.js";

// #3916 — to defekter paa "andres hold"-siden (TeamProfilePage.jsx):
//
// 1) Fane-state laekkede mellem to forskellige holds sider naar man navigerede
//    direkte fra én holdside til en anden (samme /teams/:id-route, andet id) —
//    React Router genbruger komponent-instansen, saa useState-initializeren
//    (som laeser ?tab= ved FOERSTE mount) koerte ikke igen.
// 2) Fane-valget stod ikke i URL'en, saa browser-tilbage fra fx en rytterprofil
//    landede altid paa default-fanen igen, ikke den fane brugeren kom fra.
//
// Testen reproducerer defekt 1 via TeamTransferHistoryTab's counterparty-link
// (SEED_TRANSFER_HISTORY, seedData.js — samme seed alle team-sider deler) — det
// ER netop den slags in-app-link (fra ÉN holdside direkte til ET ANDET hold)
// der udloeste den oprindelige fejl, i modsaetning til en fuld page.goto som
// altid ville remounte komponentet og maskere defekten.

test("andres holds side aabner paa trup, resetter fane ved hold-til-hold-navigation, og bevarer fane ved browser-tilbage (#3916)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await login(page);

  // Start paa TEST_TEAMs transferhistorik-fane (ikke default) via URL — samme
  // deep-link-kontrakt som ranglistens holdnavn-link (#824).
  await page.goto(`/teams/${TEST_TEAM.id}?tab=transfers`);
  await expect(page.getByRole("heading", { name: "Transferhistorik" })).toBeVisible();

  // Klik modparts-linket i transferhistorikken — navigerer DIREKTE til et andet
  // holds side (samme route, andet :id) uden mellemliggende side.
  const counterpartyLink = page.getByRole("link", { name: RIVAL_TEAM.name }).first();
  await expect(counterpartyLink).toBeVisible();
  await counterpartyLink.click();

  // Defekt 1: det NYE hold skal aabne paa trup (default), ikke arve "transfers"
  // fra det forrige hold — og URL'en skal ikke baere det gamle ?tab=transfers med.
  await expect(page).toHaveURL(new RegExp(`/teams/${RIVAL_TEAM.id}(?:\\?.*)?$`));
  await expect(page).not.toHaveURL(/tab=transfers/);
  await expect(page.getByRole("heading", { name: /Trup \(\d+ ryttere\)/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Transferhistorik" })).toHaveCount(0);

  // Defekt 2: browser-tilbage skal lande PRAECIS paa den fane brugeren kom fra
  // (transfers), ikke resette til trup igen.
  await page.goBack();
  await expect(page).toHaveURL(/tab=transfers/);
  await expect(page.getByRole("heading", { name: "Transferhistorik" })).toBeVisible();
});

test("faneskift skriver til URL'en med replace (ingen historik-spam)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await login(page);

  await page.goto(`/teams/${TEST_TEAM.id}`);
  // Default (ingen ?tab=) = trup.
  await expect(page).not.toHaveURL(/tab=/);
  await expect(page.getByRole("heading", { name: /Trup \(\d+ ryttere\)/ })).toBeVisible();

  await page.getByRole("tab", { name: "Transferhistorik" }).click();
  await expect(page).toHaveURL(/tab=transfers/);
  await expect(page.getByRole("heading", { name: "Transferhistorik" })).toBeVisible();

  await page.getByRole("tab", { name: /Trup \(\d+\)/ }).click();
  // Tilbage til default-fanen renser ?tab= igen (samme "hold URL'en ren"-regel
  // som RaceDetailPage.jsx's changeTab for ?stage=N).
  await expect(page).not.toHaveURL(/tab=/);

  // Replace-navigation: ét klik-par (transfers → squad) skal IKKE laegge to
  // ekstra historik-poster oveni landingen paa siden — én page.goBack() skal
  // derfor forlade holdsiden helt, ikke lande paa en mellemliggende fane-URL.
  await page.goBack();
  await expect(page).not.toHaveURL(new RegExp(`/teams/${TEST_TEAM.id}`));
});

test("#7659: holdhistorikken viser siden efter de første 1.000 resultater", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await login(page);

  const race = { id: "history-race", name: "Testløb", race_type: "single", squad: "senior" };
  const result = (id, riderName, overrides = {}) => ({
    id, rank: 1, result_type: "gc", stage_number: null, points_earned: 0,
    prize_money: 0, rider_name: riderName, rider: null, race, ...overrides,
  });
  const firstPage = Array.from({ length: 999 }, (_, index) =>
    result("hidden-" + index, "Ungdomsresultat", {
      result_type: "young",
      race: { ...race, squad: "u23" },
    }));
  firstPage.push(result("first", "Første rytter"));
  const requests = [];
  await page.route("**/rest/v1/rpc/get_team_result_history_page?*", (route) => {
    const args = route.request().postDataJSON();
    requests.push(args);
    const data = args.p_offset === 0 ? firstPage
      : args.p_offset === 1000 ? [result("next", "Næste rytter")] : [];
    return json(route, data);
  });

  await page.goto(`/teams/${RIVAL_TEAM.id}?tab=results`);
  await page.locator("select").filter({ has: page.locator('option[value="all"]') }).selectOption("all");
  await expect(page.getByRole("cell", { name: "Første rytter" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Næste rytter" })).toBeVisible();
  expect(requests[0]).toEqual({ p_team_id: RIVAL_TEAM.id, p_offset: 0, p_page_size: 1000 });
  expect(requests).toContainEqual({ p_team_id: RIVAL_TEAM.id, p_offset: 1000, p_page_size: 1000 });
});
