// #5012: offentligt Discord-brugernavn paa managerprofilen (ejer-direktiv 3/9, #4751).
//
// To flader testes:
//  1. Indstillinger (ProfilePage) — feltet kan saettes, ryddes og validerer
//     Discords brugernavn-regler (2-32 tegn, smaa bogstaver/tal/./_).
//  2. Den offentlige managerprofil — Discord-linjen vises KUN naar
//     discord_handle er sat (seedet i den delte preview-mock, mockHandlers.js
//     managerProfile()), og klik-adfaerden afhaenger af om et gyldigt
//     discord_id findes fra den eksisterende bot-DM-kobling (#2161): TEST_TEAM
//     har begge felter og faar et direkte discord.com/users/-link, RIVAL_TEAM
//     har kun brugernavnet og faar i stedet en kopi-knap.
//
// Tekster laeses fra locale-filerne (samme moenster som manager-profile.spec.js)
// saa en omformulering af copy'en ikke braekker testen.
import { readFileSync } from "node:fs";
import { test, expect } from "./e2e-base.js";
import { stabilizePage, installNetworkMocks, login, TEST_TEAM, RIVAL_TEAM } from "./fixtures.js";

const daProfile = JSON.parse(
  readFileSync(new URL("../../public/locales/da/profile.json", import.meta.url), "utf8"),
);
const daTeam = JSON.parse(
  readFileSync(new URL("../../public/locales/da/team.json", import.meta.url), "utf8"),
);

async function openManagerProfile(page, teamId) {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await login(page);
  await page.waitForLoadState("networkidle");
  const target = new RegExp(`/managers/${teamId}$`);
  await page.goto(`/managers/${teamId}`);
  if (!target.test(page.url())) {
    await page.goto(`/managers/${teamId}`);
  }
  await expect(page).toHaveURL(target);
  await expect(page.getByRole("tab", { name: /Overblik/ })).toBeVisible();
}

test.describe("Managerprofil — Discord-kontaktlinje", () => {
  test("gyldigt discord_id fra bot-koblingen giver et direkte discord.com-link", async ({ page }) => {
    await openManagerProfile(page, TEST_TEAM.id);

    const link = page.getByRole("link", { name: new RegExp(daTeam.manager.discordOpenAria.replace("{handle}", "nicolai\\.dolmer")) });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "https://discord.com/users/123456789012345678");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(link).toHaveText("nicolai.dolmer");
  });

  test("intet discord_id giver en kopi-knap i stedet for et link", async ({ page, context }, testInfo) => {
    await openManagerProfile(page, RIVAL_TEAM.id);

    const button = page.getByRole("button", { name: new RegExp(daTeam.manager.discordCopyAria.replace("{handle}", "peloton_pete")) });
    await expect(button).toBeVisible();
    await expect(button).toHaveText("peloton_pete");
    // Ingen <a href>-variant må findes samtidig — kun én af de to grene ad gangen.
    await expect(page.getByRole("link", { name: /peloton_pete/i })).toHaveCount(0);

    // Clipboard-permissions er kun stabile i Chromium-baserede Playwright-projekter
    // (desktop-chromium/mobile-chromium) — WebKit understøtter ikke grantPermissions
    // for clipboard-* og ville gøre resten af assertionen flaky. Selve knappens
    // tilstedeværelse/tekst er allerede verificeret ovenfor for alle 3 projekter.
    if (testInfo.project.name.includes("chromium")) {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await button.click();
      await expect(page.getByText(daTeam.manager.discordCopied, { exact: true })).toBeVisible();
      const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboardText).toBe("peloton_pete");
    }
  });
});

test("indstillinger: offentligt Discord-brugernavn kan gemmes, ryddes og valideres", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await login(page);
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: daProfile.header.title })).toBeVisible();

  const input = page.locator("#profile-discord-handle");
  await expect(input).toBeVisible();
  // Hjaelpeteksten naevner at feltet er offentligt (per opgavens krav).
  await expect(page.getByText(daProfile.discord.handleHelp)).toBeVisible();

  const saveButton = page.getByRole("button", { name: daProfile.discord.handleSave });

  // Ugyldigt input (versaler er ikke tilladt i et Discord-brugernavn) → fejlbesked,
  // intet gemt-kald forventes at ændre synlig tilstand.
  await input.fill("NICOLAI");
  await saveButton.click();
  // #5012: samme msg-state renderes to steder på siden (Account-kortet +
  // Team-kortet, se ProfilePage's renderMessageBanner-kald) — .first() undgår
  // Playwrights strict-mode-fejl uden at teste FÆRRE ting (begge viser samme tekst).
  await expect(page.getByText(daProfile.discord.handleError).first()).toBeVisible();

  // Gyldigt input gemmes.
  await input.fill("nicolai.dolmer");
  await saveButton.click();
  await expect(page.getByText(daProfile.discord.handleSaved).first()).toBeVisible();

  // Tomt felt = ryd (Accept #1: "Felt kan saettes og ryddes").
  await input.fill("");
  await saveButton.click();
  await expect(page.getByText(daProfile.discord.handleCleared).first()).toBeVisible();
});
