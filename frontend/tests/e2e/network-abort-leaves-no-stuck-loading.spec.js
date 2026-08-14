// #3628 · Backwards-check efter #3619: en TABT FORBINDELSE må ikke efterlade en
// spiller-handling i "loading".
//
// Hvorfor en e2e og ikke kun kilde-invarianterne i
// frontend/src/lib/networkErrorGuards.test.js: de invarianter beviser at koden
// HAR formen (try/catch + oprydning). De beviser ikke at spilleren faktisk kommer
// ud af tilstanden. Kun en afbrudt request gør det — `route.abort("failed")` får
// `fetch` til at REJECTE, præcis som mobil-WebKits "TypeError: Load failed" i
// CYCLINGZONE-4E.
//
// Forskellen fra board-sign.spec.js' "persistent proposal error" (#2463): den
// svarer 500. En HTTP-fejl er et normalt svar — `res.ok` er false og koden gik
// allerede den rigtige vej. Her når svaret aldrig frem, og det var netop den
// gren der manglede.
import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { evidenceShotPath, installNetworkMocks, installBoardStatusMock, login, makeBoardStatus, stabilizePage } from "./fixtures.js";

// Teksten læses fra locale-filen i stedet for at være hardkodet — samme grund som
// i manager-profile.spec.js: en omformulering af copy'en må ikke bryde testen, og
// testen må ikke påstå en tekst kilden ikke rendrer.
const daErrors = JSON.parse(
  readFileSync(new URL("../../public/locales/da/errors.json", import.meta.url), "utf8"),
);
const daProfile = JSON.parse(
  readFileSync(new URL("../../public/locales/da/profile.json", import.meta.url), "utf8"),
);
const NETWORK_ERROR_TEXT = daErrors.generic.networkError;
const TEAM_SAVING_TEXT = daProfile.team.saving;

test("bestyrelses-wizarden kommer ud af loading naar proposal-kaldet aldrig naar frem (#3628)", async ({ page }, testInfo) => {
  await stabilizePage(page);
  await installNetworkMocks(page);

  // Udløbet 5yr-plan → "Forhandl ny plan →" åbner wizardens trin 1, som straks
  // henter et proposal. Samme fixture-form som board-wizard-back.spec.js.
  const board = makeBoardStatus();
  board.plans["5yr"].is_expired = true;
  board.plans["5yr"].seasons_remaining = 0;
  await installBoardStatusMock(page, board);

  // Forbindelsen falder væk midt i kaldet: fetch REJECTER, den svarer ikke 500.
  let abortedCalls = 0;
  await page.route("**/api/board/proposal", (route) => {
    abortedCalls += 1;
    return route.abort("failed");
  });

  await login(page);
  await page.goto("/board");

  await page.getByRole("button", { name: "Forhandl ny plan →" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Kaldet blev rent faktisk forsøgt — ellers beviser resten af testen ingenting.
  await expect.poll(() => abortedCalls).toBeGreaterThan(0);

  // FØR #3628: den kastede fetch blev en unhandled rejection, previewLoading blev
  // aldrig sat tilbage, og trin 1 stod med en spinner for evigt.
  await expect(dialog.getByText(NETWORK_ERROR_TEXT)).toBeVisible();
  // Spinner.jsx rendrer <span role="status" class="spinner ...">.
  await expect(dialog.locator("span.spinner")).toHaveCount(0);

  // Bevis-screenshot til PR-body. Skrives til test-results/ som default; kun
  // CZ_WRITE_COMMITTED_SHOTS=1 opdaterer den committede sti (#3554).
  if (testInfo.project.name === "desktop-chromium") {
    await page.screenshot({ path: evidenceShotPath("pr-screens/3628-board-wizard-network-after.png") });
  }

  // Og spilleren er ikke fanget: wizarden kan lukkes igen.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Gem holdinfo forlader gemmer-tilstanden naar PUT'en aldrig naar frem (#3628)", async ({ page }, testInfo) => {
  await stabilizePage(page);
  await installNetworkMocks(page);

  // Forbindelsen falder væk på netop dette kald. Alt andet på siden svarer normalt,
  // så testen isolerer handlingen og ikke sidens indlæsning.
  let abortedCalls = 0;
  await page.route("**/api/teams/my", (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    abortedCalls += 1;
    return route.abort("failed");
  });

  await login(page);
  await page.goto("/profile");

  const saveButton = page.getByRole("button", {
    name: new RegExp(`^(${daProfile.team.save}|${daProfile.team.create})$`),
  });
  await expect(saveButton).toBeVisible();
  await saveButton.click();

  await expect.poll(() => abortedCalls).toBeGreaterThan(0);

  // FØR #3628: setSavingTeam(false) blev sprunget over, så knappen stod på
  // "Gemmer..." (og disabled) indtil spilleren genindlæste siden.
  // .first(): ProfilePage viser showMsg-beskeden BÅDE i side-banneret og inline
  // i sektionen, så teksten matcher to noder.
  await expect(page.getByText(NETWORK_ERROR_TEXT).first()).toBeVisible();
  await expect(page.getByRole("button", { name: TEAM_SAVING_TEXT })).toHaveCount(0);
  await expect(saveButton).toBeEnabled();

  if (testInfo.project.name === "desktop-chromium") {
    await page.screenshot({ path: evidenceShotPath("pr-screens/3628-profile-team-save-network-after.png") });
  }
});
