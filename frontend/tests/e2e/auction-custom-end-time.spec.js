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
    // #3792: DATOEN SKAL RULLE MED, ellers tester den her noget andet end den tror.
    //
    // `getEndTimeIssue` validerer i rækkefølgen for-tidligt → for-sent → uden-for-
    // vindue, og returnerer ved FØRSTE brud. Den gamle udgave satte 03:44 på
    // forslagets EGEN dato. Forslaget er 12 timer frem, så dets dato er typisk i
    // dag, og 03:44 i dag ligger dermed i fortiden — testen fik `end_too_soon` i
    // stedet for `end_outside_window` og fejlede, uden at vindue-reglen
    // overhovedet var blevet afprøvet. Om den bestod afhang af hvad klokken var
    // da CI kørte, så den blokerede vilkårlige PR'er om morgenen.
    //
    // Dagen EFTER forslaget rammer altid 1-48-timers-vinduet (ca. 4-32 timer
    // frem, uanset hvor forslaget lander), så den første regel er tilfredsstillet
    // og valideringen når frem til den regel testen faktisk handler om.
    const night = new Date(`${current}:00`);
    night.setDate(night.getDate() + 1);
    const pad = (n) => String(n).padStart(2, "0");
    // Lokale getters, ikke toISOString(): sidstnævnte konverterer til UTC og kan
    // flytte datoen en dag alt efter tidszone og klokkeslæt.
    const nightWall = `${night.getFullYear()}-${pad(night.getMonth() + 1)}-${pad(night.getDate())}T03:44`;
    await input.fill(nightWall);

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
    // Samme rettelse som nat-testen (#3792): lokale getters, ikke toISOString(),
    // som konverterer til UTC og kan flytte datoen en dag. Her ville ±1 dag ikke
    // ændre udfaldet (5 dage er 120 timer, langt over 48), men den skrøbelighed
    // hører ikke hjemme i en test der skal kunne stoles på uanset tidszone.
    const pad = (n) => String(n).padStart(2, "0");
    await input.fill(`${far.getFullYear()}-${pad(far.getMonth() + 1)}-${pad(far.getDate())}T20:00`);

    const error = page.getByTestId("team-auction-end-time-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText(/48/);
    await expect(page.getByRole("button", { name: /^(Start)$/ })).toBeDisabled();
  });
});
