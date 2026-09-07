// #5013 · Abonnér/afmeld pr. forum-kategori (ejer-direktiv 3/9, #4751).
//
// Accept-kriterierne fra issuet, som de kan ses i browseren:
//  1. Slå en kategori fra -> ingen ulæst-markering fra den, og forum-badget i
//     navigationen slukker når den var den eneste kilde til ulæst.
//  2. Slå til igen -> ulæst-markeringen er tilbage, uændret adfærd.
//
// Mock-seedet (src/preview/mockHandlers.js) har to ulæste tråde, begge i
// "general" (forum-post-2 og forum-post-4). Derfor er general den kategori der
// slås fra her: den er den eneste kilde til nav-prikken, så testen kan se
// prikken forsvinde og komme tilbage i stedet for kun at se på ét kort.
//
// Tekster læses fra locale-filerne (samme mønster som de øvrige forum-specs),
// så en omformulering af copy'en ikke brækker testen.
import { readFileSync } from "node:fs";
import { test, expect } from "./e2e-base.js";
import { stabilizePage, installNetworkMocks, login } from "./fixtures.js";

const daForum = JSON.parse(
  readFileSync(new URL("../../public/locales/da/forum.json", import.meta.url), "utf8"),
);
const daProfile = JSON.parse(
  readFileSync(new URL("../../public/locales/da/profile.json", import.meta.url), "utf8"),
);

const TOGGLE = "[data-testid=forum-category-subscription-toggle]";

// exact: "Ulæst" er ogsaa en delstreng af hint-teksten under kategori-navnet
// ("Ingen ulæst-markering ..."), og getByText matcher substring uden den.
function unreadMarks(page) {
  return page.getByText(daForum.list.unread, { exact: true });
}

async function openForumCategory(page, category) {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await login(page);
  await page.goto(`/forum?category=${category}`);
  await expect(page.locator(TOGGLE)).toBeVisible();
}

test.describe("Forum — abonnement pr. kategori", () => {
  test("kategori-hovedet slår ulæst-markeringen fra og til igen", async ({ page }) => {
    await openForumCategory(page, "general");

    // Udgangspunkt: opt-out-modellen betyder at en frisk konto følger ALT.
    const toggle = page.locator(TOGGLE);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle).toContainText(daForum.subscription.following);
    await expect(unreadMarks(page).first()).toBeVisible();

    // Slå fra: knappen skifter tilstand og ulæst-markeringerne forsvinder.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(toggle).toContainText(daForum.subscription.muted);
    await expect(unreadMarks(page)).toHaveCount(0);

    // Tråden er der stadig — kun signalet er væk, ikke indholdet.
    await expect(page.getByRole("link", { name: /Deadline Day/ })).toBeVisible();

    // Slå til igen: uændret adfærd.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(unreadMarks(page).first()).toBeVisible();
  });

  test("kontrollen findes ikke på 'Alle' og ikke på arkivet (#4492)", async ({ page }) => {
    await stabilizePage(page);
    await installNetworkMocks(page);
    await login(page);

    await page.goto("/forum");
    await expect(page.getByRole("heading", { name: daForum.list.latestHeading })).toBeVisible();
    await expect(page.locator(TOGGLE)).toHaveCount(0);

    await page.goto("/forum?category=archive");
    await expect(page.locator(TOGGLE)).toHaveCount(0);
  });

  test("indstillingerne viser alle kategorier og deler valget med forumsiden", async ({ page }) => {
    await stabilizePage(page);
    await installNetworkMocks(page);
    await login(page);

    await page.goto("/profile");
    const card = page.getByText(daProfile.forumCategories.title, { exact: true });
    await expect(card).toBeVisible();

    // Toggle.jsx gemmer selve inputtet (peer + sr-only), saa klikket skal ramme
    // labelen — et forceret klik paa det skjulte input flipper ikke i WebKit.
    const generalToggle = page.locator("#forum-category-general");
    await expect(generalToggle).toBeChecked();
    await page.locator('label[for="forum-category-general"]').click();
    await expect(generalToggle).not.toBeChecked();

    // Samme valg skal gælde på forumsiden — de to flader deler tilstanden.
    await page.goto("/forum?category=general");
    await expect(page.locator(TOGGLE)).toHaveAttribute("aria-pressed", "false");
    await expect(unreadMarks(page)).toHaveCount(0);
  });
});
