import { expect, test } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage, json, TEST_USER } from "./fixtures.js";

// #2745 · season_ended var en "død hook": frontend havde fuld rendering for
// typen (NotificationsPage TYPE_CONFIG + notif.seasonEnded-i18n), men ingen
// backend-kode indsatte nogensinde en row (prod 23/7: 0 rækker nogensinde).
// Denne test beviser at RENDERINGEN faktisk virker når en row findes — den
// dækker IKKE at backend opretter rowen (det dækker
// backend/lib/seasonEndedNotifications.test.js), men lukker det andet
// halve hul: at kontrakten mellem backend-metadata og frontend-visning
// (titleCode/messageCode/params) faktisk producerer læsbar tekst, ikke en
// rå i18n-nøgle eller en tom celle.
//
// #2164 (samme spec, samme root-fix-familie): oprykningsbeskeden var
// hardkodet dansk (ingen metadata) mens nedrykningsbeskeden allerede var
// oversat. Fixet tilføjede titleCode/messageCode til promotion-kaldet i
// economyEngine.js — testet her ved at mocke nøjagtig den payload
// notifyManager nu sender, og bekræfte den renderer på EN (fallback-sprog).

const SEASON_ENDED_ROW = {
  id: "notif-season-ended-1",
  user_id: TEST_USER.id,
  type: "season_ended",
  title: "Season 3 has ended",
  message: "The season is over. See the recap for final standings, promotions and relegations.",
  related_id: "00000000-0000-0000-0000-000000000003",
  is_read: false,
  created_at: "2026-07-26T20:00:00.000Z",
  metadata: {
    titleCode: "notif.seasonEnded.title",
    titleParams: { number: 3 },
    messageCode: "notif.seasonEnded.message",
    messageParams: { number: 3 },
  },
};

const DIVISION_PROMOTED_ROW = {
  id: "notif-promoted-1",
  user_id: TEST_USER.id,
  type: "board_update",
  title: "Promoted! 🎉",
  message: "Congratulations! Your team moves up to Division 2.",
  related_id: null,
  is_read: false,
  created_at: "2026-07-26T19:00:00.000Z",
  metadata: {
    titleCode: "notif.divisionPromoted.title",
    titleParams: {},
    messageCode: "notif.divisionPromoted.message",
    messageParams: { division: 2 },
  },
};

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

test("season_ended-notifikationen renderes med ikon, titel, besked og deep-link til /seasons (#2745)", async ({ page }) => {
  await page.route("**/rest/v1/notifications**", route => {
    if (route.request().method() !== "GET") return json(route, []);
    return json(route, [SEASON_ENDED_ROW, DIVISION_PROMOTED_ROW]);
  });

  await login(page);
  await page.goto("/notifications");

  // Titel + besked renderes via metadata.{titleCode,messageCode} — bilingual
  // regex fordi CI/lokal browser-locale kan afgøre fallbackLng-detection.
  await expect(page.getByText(/^Season 3 has ended$|^Sæson 3 er afsluttet$/)).toBeVisible();
  await expect(
    page.getByText(/final standings, promotions and relegations|den endelige stilling, oprykning og nedrykning/)
  ).toBeVisible();

  // #2164: oprykningsbeskeden var før hardkodet dansk uden metadata — nu
  // renderer den engelsk fallback ligesom season_ended, via samme
  // titleCode/messageCode-mønster som nedrykningen allerede brugte.
  await expect(page.getByText(/^Promoted! 🎉$|^Oprykket! 🎉$/)).toBeVisible();
  await expect(
    page.getByText(/moves up to Division 2|rykker op til Division 2/)
  ).toBeVisible();

  // Deep-link: klik på season_ended-rækken navigerer til /seasons (#2745 AC).
  await page.getByText(/^Season 3 has ended$|^Sæson 3 er afsluttet$/).click();
  await expect(page).toHaveURL(/\/seasons/);
});
