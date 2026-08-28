import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, TEST_TEAM, RIVAL_TEAM } from "./fixtures.js";

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
