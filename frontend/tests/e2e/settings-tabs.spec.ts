// #5402: Indstillinger (/profile) er delt i faner i stedet for een lang
// scroll-side (ejer-direktiv 18/9).
//
// Testen beviser:
//   1. Konto er standardfanen, og hver fane viser sine egne sektioner og ikke
//      de andres.
//   2. Et klik paa en fane skriver den i URL'en (?tab=), saa den kan deles og
//      overlever en genindlaesning.
//   3. Dyb-links virker: ?tab= aabner fanen direkte, og et anker (#discord)
//      aabner sektionens fane og ruller kortet frem.
//
// Tekster laeses fra locale-filerne, saa en omformulering ikke braekker testen.
// Login-fixturen er DA-laast.
import { readFileSync } from "node:fs";
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";
import type { Page } from "@playwright/test";

const da = JSON.parse(
  readFileSync(new URL("../../public/locales/da/profile.json", import.meta.url), "utf8"),
);

// Sektioner der altid vises (de betingede, abonnement for Pro og assistenten
// i opt_in, afhaenger af mock-tilstanden og testes i ProfilePage.test.ts).
const TABS: { key: string; headings: string[] }[] = [
  { key: "account", headings: [da.account.title] },
  { key: "notifications", headings: [da.selectionReminder.title, da.forumCategories.title, da.discord.title] },
  { key: "preferences", headings: [da.appearance.title] },
  { key: "privacy", headings: [da.privacy.title] },
  { key: "beta", headings: [da.beta.title] },
];

async function open(page: Page, path: string) {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await login(page);
  await page.goto(path);
  await expect(page.getByRole("heading", { name: da.header.title, level: 1 })).toBeVisible();
}

const tab = (page: Page, key: string) => page.getByRole("tab", { name: da.tabs[key], exact: true });
const heading = (page: Page, name: string) => page.getByRole("heading", { name, exact: true, level: 2 });

test("indstillinger: hver fane viser sine egne sektioner, og fanen staar i URL'en", async ({ page }) => {
  await open(page, "/profile");
  await expect(tab(page, "account")).toHaveAttribute("aria-selected", "true");

  for (const { key, headings } of TABS) {
    await tab(page, key).click();
    await expect(tab(page, key)).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(new RegExp(`[?&]tab=${key}(&|$)`));
    for (const name of headings) await expect(heading(page, name)).toBeVisible();
    // De andre faners sektioner er ikke rendret.
    for (const other of TABS.filter(t => t.key !== key)) {
      for (const name of other.headings) await expect(heading(page, name)).toHaveCount(0);
    }
  }

  // Fanen overlever en genindlaesning, fordi den bor i URL'en.
  await page.reload();
  await expect(tab(page, "beta")).toHaveAttribute("aria-selected", "true");
  await expect(heading(page, da.beta.title)).toBeVisible();
});

test("indstillinger: dyb-link med ?tab= aabner den fane", async ({ page }) => {
  await open(page, "/profile?tab=privacy");
  await expect(tab(page, "privacy")).toHaveAttribute("aria-selected", "true");
  await expect(heading(page, da.privacy.title)).toBeVisible();
});

test("indstillinger: et anker aabner sektionens fane og ruller kortet frem", async ({ page }) => {
  await open(page, "/profile#discord");
  await expect(tab(page, "notifications")).toHaveAttribute("aria-selected", "true");
  await expect(heading(page, da.discord.title)).toBeInViewport();
});
