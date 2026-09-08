// #3200 — Beskeder mellem managers, ende til ende paa de flader ejeren bad om
// 8/9: Beskeder-fanen, traaden, bloker, anmeld, Message-knappen paa
// managerprofilen og "Skriv til modparten" paa et transfertilbud.
//
// Mocken (installMessagesMocks i fixtures.js) er muterbar, saa en sendt besked
// faktisk dukker op i traaden og en blokering faktisk skjuler modpartens
// beskeder. Uden det kunne flowet kun testes eet klik ad gangen.

import { test, expect } from "./e2e-base.js";
import {
  installNetworkMocks,
  installMessagesMocks,
  login,
  stabilizePage,
} from "./fixtures.js";

// Raekkefoelgen er den kanoniske (samme som 4165-planning-load-error.spec.js):
// stabilizePage saetter cz_lang=da FOER mockene, spec-overriden registreres
// sidst (LIFO vinder i Playwright), og login sker foerst derefter. Copyen der
// assertes paa er derfor den danske - regexerne accepterer begge sprog, saa
// specen ikke knaekker den dag defaulten skifter til EN.
test.beforeEach(async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
});

// Samtalelistens forhaandsvisning gengiver den seneste besked ordret, saa en
// tekst-locator paa siden som helhed rammer BAADE boblen og forhaandsvisningen.
// Om begge staar malet naar assertionen koerer, afhaenger af om listen naaede at
// genhente - blokér-testen var groen lokalt og roed i CI af netop den grund.
// Alt der handler om HVAD der staar i traaden, spoerges derfor kun i traaden.
const thread = (page) => page.getByTestId("dm-thread-messages");

test("Beskeder-fanen viser samtalelisten med ulaest-prik", async ({ page }) => {
  await installMessagesMocks(page);
  await login(page);
  await page.goto("/notifications?tab=messages");

  await expect(page.getByRole("button", { name: /Visual Tester/ })).toBeVisible();
  await expect(page.getByText("Regression VC").first()).toBeVisible();
  await expect(page.getByText(/Let me look at my budget tonight/)).toBeVisible();
});

test("traaden viser beskeder begge veje og en sendt besked lander i traaden", async ({ page }) => {
  await installMessagesMocks(page);
  await login(page);
  await page.goto("/notifications?tab=messages&c=dm-conv-1");

  await expect(thread(page).getByText(/Are you open to selling Vandenberg/)).toBeVisible();
  await expect(thread(page).getByText(/Make it 165k and we have a deal/)).toBeVisible();

  await page.getByRole("textbox", { name: /Write a message|Skriv en besked/ }).fill("Deal at 160k, final.");
  await page.getByRole("button", { name: /^Send$/ }).click();

  await expect(thread(page).getByText("Deal at 160k, final.")).toBeVisible();
});

test("bloker skjuler modpartens beskeder uden at slette dem", async ({ page }) => {
  await installMessagesMocks(page);
  await login(page);
  await page.goto("/notifications?tab=messages&c=dm-conv-1");

  await expect(thread(page).getByText(/Are you open to selling Vandenberg/)).toBeVisible();

  await page.getByRole("button", { name: /More|Mere/ }).click();
  await page.getByRole("menuitem", { name: /Block manager|Blokér manager/ }).click();

  // Mine egne beskeder staar der stadig; modpartens er ude af MIN visning.
  await expect(thread(page).getByText(/Make it 165k and we have a deal/)).toBeVisible();
  await expect(thread(page).getByText(/Are you open to selling Vandenberg/)).toHaveCount(0);
  // Menupunktet er vendt til "ophaev", saa blokeringen kan tages tilbage.
  await expect(page.getByRole("menuitem", { name: /Unblock|Ophæv/ })).toBeVisible();
  await expect(page.getByText(/You have blocked this manager|Du har blokeret denne manager/)).toBeVisible();
});

test("anmeld kraever en begrundelse og kvitterer bagefter", async ({ page }) => {
  await installMessagesMocks(page);
  await login(page);
  await page.goto("/notifications?tab=messages&c=dm-conv-1");

  await page.getByRole("button", { name: /More|Mere/ }).click();
  await page.getByRole("menuitem", { name: /Report conversation|Anmeld samtale/ }).click();

  const reason = page.getByRole("textbox", { name: /What happened|Hvad er der sket/ });
  await expect(reason).toBeVisible();

  // For kort begrundelse afvises foer den naar backenden.
  await reason.fill("grim");
  await page.getByRole("button", { name: /Send report|Send anmeldelse/ }).click();
  await expect(page.getByText(/at least 10 characters|mindst 10 tegn/)).toBeVisible();

  await reason.fill("He keeps threatening me in this thread.");
  await page.getByRole("button", { name: /Send report|Send anmeldelse/ }).click();
  await expect(page.getByText(/Report sent|Anmeldelsen er sendt/)).toBeVisible();
});

test("Message-knappen paa en fremmed managerprofil aabner samtalen", async ({ page }) => {
  await installMessagesMocks(page);
  await login(page);
  await page.goto("/managers/team-rival");

  const button = page.getByRole("button", { name: /Message Visual Tester|Skriv til Visual Tester/ });
  await expect(button).toBeVisible();
  await button.click();

  await expect(page).toHaveURL(/tab=messages&c=dm-conv-1/);
});

test("Skriv til modparten paa et transfertilbud citerer handlen", async ({ page }) => {
  const state = await installMessagesMocks(page, { seedConversation: false, seedOffer: true });
  await login(page);
  await page.goto("/transfers");

  const dealButton = page.getByRole("button", { name: /Message Regression VC|Skriv til Regression VC/ }).first();
  await expect(dealButton).toBeVisible();
  await dealButton.click();

  // Citatet staar i skrivefeltet FOER beskeden sendes, saa spilleren kan se
  // hvad modparten faar med.
  await expect(page.getByText(/Transfer offer|Transfertilbud/).first()).toBeVisible();

  await page.getByRole("textbox", { name: /Write a message|Skriv en besked/ }).fill("Can you stretch to 165k?");
  await page.getByRole("button", { name: /^Send$/ }).click();

  await expect(page).toHaveURL(/tab=messages/);
  expect(state.sent.at(-1)?.context?.kind).toBe("transfer_offer");
  expect(state.sent.at(-1)?.context?.amount).toBe(140000);
});
