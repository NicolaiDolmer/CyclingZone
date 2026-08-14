// #2884: sælgeren vælger et KONKRET sluttidspunkt for sin auktion i stedet for
// at arve den globale varighed (prod kører duration_hours = 1, hvilket er
// forklaringen på at 93,3 % af spillerudbudte auktioner aldrig fik et bud).
//
// Ejer-beslutning 15/8: 1-48 timer frem, og kun sluttidspunkter inde i det åbne
// vindue (08-24). Natten gråtones IKKE til næste åbning — et valgt klokkeslæt
// der ikke er sandt, støder mod at spilleren skal kunne stole på det han ser.
//
// Testen dækker de tre veje spilleren kan gå: standardforslaget, et afvist
// nat-tidspunkt, og et afvist tidspunkt for langt frem. I alle afviste
// tilfælde skal Start-knappen være spærret, så fejlen fanges før POST'en.
import { test, expect } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage, evidenceShotPath } from "./fixtures.js";

const SELL_BUTTON = /^(Sell \/ Auction|Sælg \/ Auktion)$/;

test.describe("Auction custom end time (#2884)", () => {
  test.beforeEach(async ({ page }) => {
    await stabilizePage(page);
    await installNetworkMocks(page);
    await login(page);
    await page.goto("/team");
    await page.getByRole("button", { name: SELL_BUTTON }).first().click();
  });

  test("vælgeren har et gyldigt standardforslag inde i vinduet", async ({ page }) => {
    const input = page.getByTestId("team-auction-end-time-input");
    await expect(input).toBeVisible();

    const value = await input.inputValue();
    // "YYYY-MM-DDTHH:mm" — klokketimen skal ligge i det åbne vindue 08-24.
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    const hour = Number(value.slice(11, 13));
    expect(hour).toBeGreaterThanOrEqual(8);

    await expect(page.getByTestId("team-auction-end-time-error")).toHaveCount(0);
    await page.screenshot({ path: evidenceShotPath("pr-screens/2884-vaelger-standard.png") });
  });

  test("et sluttidspunkt om natten afvises og spærrer Start", async ({ page }) => {
    const input = page.getByTestId("team-auction-end-time-input");
    const current = await input.inputValue();
    // Samme dato som forslaget, men kl. 03:44 — uden for det åbne vindue.
    await input.fill(`${current.slice(0, 11)}03:44`);

    const error = page.getByTestId("team-auction-end-time-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText(/market is open|markedet er åbent/i);

    await expect(page.getByRole("button", { name: /^(Start)$/ })).toBeDisabled();
    await page.screenshot({ path: evidenceShotPath("pr-screens/2884-nat-afvist.png") });
  });

  test("et sluttidspunkt mere end 48 timer frem afvises", async ({ page }) => {
    const input = page.getByTestId("team-auction-end-time-input");
    const current = await input.inputValue();
    const far = new Date(`${current}:00`);
    far.setDate(far.getDate() + 5);
    await input.fill(`${far.toISOString().slice(0, 10)}T20:00`);

    const error = page.getByTestId("team-auction-end-time-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText(/48/);
    await expect(page.getByRole("button", { name: /^(Start)$/ })).toBeDisabled();
  });
});
