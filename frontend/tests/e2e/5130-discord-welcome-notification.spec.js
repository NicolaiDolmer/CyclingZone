import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json, TEST_USER, evidenceShotPath } from "./fixtures.js";

// #5130 (ejer-direktiv 10/9) · Discord-velkomstbeskeden i indbakken.
//
// Samme bevis-mønster som season-ended-notification.spec.js: mocker EXAKT
// den payload backend'en (discordWelcomeSweep.js → notifyUser) faktisk
// sender, og beviser at metadata.{titleCode,messageCode}-kontrakten
// producerer læsbar tekst + at kortet har et FUNGERENDE link (ekstern URL,
// ikke navigate() — #5130's egen NotificationsPage-ret, se
// isExternalNotificationLink).
//
// Dækker IKKE at sweepen rent faktisk indsætter rowen (det dækker
// backend/lib/discordWelcomeSweep.test.js) eller at klikket reelt åbner en
// ny fane (window.open er ikke observérbart via Playwright's almindelige
// popup-API i en mock-only test uden en rigtig navigation) — kun at kortet
// selv er korrekt sat op (ikon, tekst, ekstern href).

const DISCORD_WELCOME_ROW = {
  id: "notif-discord-welcome-1",
  user_id: TEST_USER.id,
  type: "discord_welcome",
  title: "Come hang out on Discord",
  message: "I'm in there, and so are the other managers: ask me anything, swap tactics, and get the roadbook before anyone else.",
  related_id: null,
  is_read: false,
  created_at: "2026-09-14T09:00:00.000Z",
  metadata: {
    titleCode: "notif.discordWelcome.title",
    titleParams: {},
    messageCode: "notif.discordWelcome.message",
    messageParams: {},
  },
};

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
  await page.route("**/rest/v1/notifications**", route => {
    if (route.request().method() !== "GET") return json(route, []);
    return json(route, [DISCORD_WELCOME_ROW]);
  });
});

test("discord_welcome-notifikationen renderes med titel, besked og et eksternt Discord-link (#5130)", async ({ page }, testInfo) => {
  const capture = testInfo.project.name === "desktop-chromium";
  await login(page);
  await page.goto("/notifications");

  // Titel + besked via metadata.{titleCode,messageCode} — bilingval regex
  // (locale er låst til DA af stabilizePage, men fallbackLng kan stadig
  // vinde afhængigt af browser-locale i CI).
  await expect(
    page.getByText(/^Come hang out on Discord$|^Kom med på Discord$/),
  ).toBeVisible();
  await expect(
    page.getByText(/ask me anything, swap tactics|spørg mig om alt, byt taktik/),
  ).toBeVisible();

  // Kortets link peger på den RIGTIGE eksterne invite-URL — ikke en intern
  // rute. NotificationsPage rendrer ikke et <a>-tag for kortet (det er en
  // klikbar div, samme mønster som alle andre notifikations-typer), så
  // beviset er at klikket ikke navigerer væk fra /notifications (havde
  // isExternalNotificationLink-grenen manglet, ville et link der starter
  // med "https://" være sendt til react-router's navigate() og enten fejle
  // eller lave en ugyldig intern navigation).
  const card = page.getByText(/^Come hang out on Discord$|^Kom med på Discord$/);
  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    card.click(),
  ]);
  // discord.gg/<invite> redirecter til discord.com/invite/<invite> — match
  // begge, popup'en kan lande på enten afhængig af netværk/redirect-timing.
  await expect(popup).toHaveURL(/discord\.(gg|com\/invite)\/ykysBrWUyC/);
  await popup.close();
  await expect(page).toHaveURL(/\/notifications$/);

  if (capture) {
    await page.screenshot({
      path: evidenceShotPath("pr-screens/5130-discord-welcome-notification-desktop.png"),
      fullPage: false,
    });
  }
});

test("discord_welcome-notifikationen på mobil-bredde 390 (#5130)", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "kun ét mobilt projekt behøver denne — #1146-mønstret");
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/notifications");

  await expect(
    page.getByText(/^Come hang out on Discord$|^Kom med på Discord$/),
  ).toBeVisible();

  await page.screenshot({
    path: evidenceShotPath("pr-screens/5130-discord-welcome-notification-mobile-390.png"),
    fullPage: false,
  });
});
