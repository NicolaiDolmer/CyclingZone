import type { Page } from "@playwright/test";
import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json, TEST_USER, evidenceShotPath } from "./fixtures.js";

// #2761 (ejer-go 23/9 "Ret foerst", foer backfill-udsendelsen til alle
// managere): Discord-invitationskortet i indbakken var klikbart overalt, men
// havde ingen synlig knap og et person-ikon. Kortet skal nu have
//   1. en synlig, ikke-guld knap "Join Discord" / "Kom med paa Discord" der
//      aabner DISCORD_INVITE_URL i en ny fane,
//   2. Discord-maerket (stroke) i ikon-pladsen i stedet for person-ikonet,
//   3. een linje om manager-forummet (EN foerst, DA under) med link til /forum.
// Den godkendte besked fra 15/9 maa ikke aendres, saa den tjekkes ogsaa.
//
// Payloaden er den samme som discordWelcomeSweep.js (#5130) og
// sendDiscordInviteBackfill.mjs (#2761) sender via
// buildDiscordWelcomeNotification(), saa specen daekker begge afsendere.
// Discord selv stubbes paa context-niveau (popup'en arver routen), saa
// testen ikke afhaenger af discord.gg-redirects i CI.

const DISCORD_INVITE_URL = "https://discord.gg/ykysBrWUyC";

const DISCORD_WELCOME_ROW = {
  id: "notif-discord-welcome-2761",
  user_id: TEST_USER.id,
  type: "discord_welcome",
  title: "Come hang out on Discord",
  message: "I'm in there, and so are the other managers: ask me anything, swap tactics, and get the roadbook before anyone else.",
  related_id: null,
  is_read: false,
  created_at: "2026-09-23T18:00:00.000Z",
  metadata: {
    titleCode: "notif.discordWelcome.title",
    titleParams: {},
    messageCode: "notif.discordWelcome.message",
    messageParams: {},
    backfill: "2026-09",
  },
};

const COPY = {
  en: {
    title: "Hep! Come join us on Discord",
    messageStart: "Cycling Zone is more than the website. It is a community",
    forumLine: "Prefer to stay on the site? The manager forum is right here in the game.",
    forumLink: "manager forum",
    cta: "Join Discord",
  },
  da: {
    title: "Hep! Kom med på Discord",
    messageStart: "Cycling Zone er mere end hjemmesiden. Det er et fællesskab",
    forumLine: "Vil du hellere blive på siden? Managerforummet ligger lige her i spillet.",
    forumLink: "Managerforummet",
    cta: "Kom med på Discord",
  },
} as const;

type Lang = keyof typeof COPY;

async function openInbox(page: Page, lang: Lang) {
  await installNetworkMocks(page);
  await stabilizePage(page);
  await page.route("**/rest/v1/notifications**", route => {
    if (route.request().method() !== "GET") return json(route, []);
    return json(route, [DISCORD_WELCOME_ROW]);
  });
  await page.context().route("https://discord.gg/**", route =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>Discord stub</title>" }),
  );
  // login() kraever den danske login-side (stabilizePage laaser cz_lang=da).
  await login(page);
  if (lang === "en") {
    // Init-scripts koerer i raekkefoelge ved hver navigation, saa dette
    // overstyrer stabilizePage's "da" fra naeste sideindlaesning.
    await page.addInitScript(() => window.localStorage.setItem("cz_lang", "en"));
  }
  await page.goto("/notifications");
  const title = page.getByText(COPY[lang].title, { exact: true });
  await expect(title).toBeVisible();
  // Kortet er den naermeste klikbare container om titlen.
  const card = title.locator("xpath=ancestor::div[contains(@class,'rounded-cz') and contains(@class,'border')][1]");
  return card;
}

for (const lang of ["en", "da"] as const) {
  test(`discord_welcome-kortet har knap, Discord-ikon og forum-linje (${lang}) (#2761)`, async ({ page }) => {
    const card = await openInbox(page, lang);
    const copy = COPY[lang];

    // Den godkendte tekst fra 15/9 staar uaendret.
    await expect(card.getByText(copy.messageStart, { exact: false })).toBeVisible();

    // (3) Forum-linjen, EN/DA, med et internt link til /forum.
    await expect(card.getByText(copy.forumLine, { exact: true })).toBeVisible();
    const forumLink = card.getByRole("link", { name: copy.forumLink, exact: true });
    await expect(forumLink).toHaveAttribute("href", "/forum");

    // (1) Synlig knap med ekstern href, ny fane, noopener, og aldrig guld.
    const cta = card.getByRole("link", { name: copy.cta, exact: true });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", DISCORD_INVITE_URL);
    await expect(cta).toHaveAttribute("target", "_blank");
    await expect(cta).toHaveAttribute("rel", /noopener/);
    await expect(cta).not.toHaveClass(/bg-cz-accent/);

    // (2) Ikon-pladsen viser Discord-maerket (DiscordIcon's stroke-sti),
    // ikke UserIcon (cirkel r=3.5 + skulder-bue).
    await expect(card.locator('svg path[d^="M7.5 16.5C5.6"]').first()).toBeVisible();
    await expect(card.locator('svg circle[r="3.5"]')).toHaveCount(0);
  });
}

test("knappen aabner Discord i EEN ny fane, og kortet navigerer ikke vaek (#2761)", async ({ page }) => {
  const card = await openInbox(page, "da");
  const popups: Page[] = [];
  page.on("popup", p => popups.push(p));

  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    card.getByRole("link", { name: COPY.da.cta, exact: true }).click(),
  ]);
  await expect(popup).toHaveURL(DISCORD_INVITE_URL);
  // Klikket maa ikke boble op til kortets onClick, som ellers aabnede en
  // fane mere via window.open.
  await page.waitForTimeout(300);
  expect(popups).toHaveLength(1);
  await popup.close();
  await expect(page).toHaveURL(/\/notifications$/);
});

test("forum-linket gaar til /forum uden at aabne Discord (#2761)", async ({ page }) => {
  const card = await openInbox(page, "da");
  const popups: Page[] = [];
  page.on("popup", p => popups.push(p));
  await card.getByRole("link", { name: COPY.da.forumLink, exact: true }).click();
  await expect(page).toHaveURL(/\/forum$/);
  expect(popups).toHaveLength(0);
});

for (const lang of ["en", "da"] as const) {
  test(`skaermbillede: desktop 1440 (${lang}) (#2761)`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium", "skaermbilleder tages kun i desktop-chromium");
    await page.setViewportSize({ width: 1440, height: 900 });
    const card = await openInbox(page, lang);
    await expect(card.getByRole("link", { name: COPY[lang].cta, exact: true })).toBeVisible();
    await page.screenshot({
      path: evidenceShotPath(`pr-screens/2761-discord-invite-card-desktop-1440-${lang}.png`),
      fullPage: false,
    });
  });

  test(`skaermbillede: mobil 390 (${lang}) (#2761)`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "kun eet mobilt projekt behoever skaermbillederne");
    await page.setViewportSize({ width: 390, height: 844 });
    const card = await openInbox(page, lang);
    const cta = card.getByRole("link", { name: COPY[lang].cta, exact: true });
    await expect(cta).toBeVisible();
    // Knappen maa ikke flyde ud over kortet paa en smal skaerm.
    const [cardBox, ctaBox] = await Promise.all([card.boundingBox(), cta.boundingBox()]);
    expect(cardBox).not.toBeNull();
    expect(ctaBox).not.toBeNull();
    expect(ctaBox!.x + ctaBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width);
    await page.screenshot({
      path: evidenceShotPath(`pr-screens/2761-discord-invite-card-mobile-390-${lang}.png`),
      fullPage: false,
    });
  });
}
