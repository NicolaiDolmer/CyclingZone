import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, json, corsHeaders } from "./fixtures.js";

// #2826 — bekræftelses-skærmen er der frafaldet sker. Målt mod prod 2026-07-25:
// 8 af 170 konti står ubekræftede, ALLE 8 havde udfyldt hele formularen (hold-
// og managernavn i metadata), ingen af dem har nogensinde logget ind, og ingen
// af dem har et hold. Samtidig skete INGEN af 148 bekræftelser efter mere end
// en time (median 21s). Kommer spilleren ikke videre i selve sessionen, kommer
// de aldrig ind.
//
// Denne test låser de tre veje videre fast, så de ikke stille forsvinder igen:
//   1. adressen står synligt (en konto blev oprettet på "gmal.com")
//   2. resend har en nedtælling i stedet for en rate-limit-fejl
//   3. der er en vej tilbage til formularen UDEN at miste det udfyldte

const TEAM_NAME = "Recovery Racing";
const MANAGER_NAME = "Test Manager";
const TYPO_EMAIL = "rytter@gmal.com";

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);

  // Holdnavnet skal være ledigt: LoginPage slår op med .single() før signUp,
  // og fixtures' generiske rest-mock ville ellers svare med et eksisterende hold.
  await page.route("**/rest/v1/teams**", route => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, null);
  });

  // GoTrue svarer med et rent user-objekt (ingen access_token) når email-
  // bekræftelse er slået til. supabase-js oversætter det til session: null,
  // hvilket er præcis den gren der viser bekræftelses-skærmen.
  await page.route("**/auth/v1/signup**", route => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, {
      id: "00000000-0000-4000-8000-00000000e2e6",
      aud: "authenticated",
      role: "",
      email: TYPO_EMAIL,
      confirmation_sent_at: "2026-07-25T10:00:00.000Z",
      created_at: "2026-07-25T10:00:00.000Z",
      updated_at: "2026-07-25T10:00:00.000Z",
    });
  });
});

async function submitSignup(page, email = TYPO_EMAIL) {
  await page.goto("/login?mode=signup");
  await page.locator("#auth-team-name").fill(TEAM_NAME);
  await page.locator("#auth-manager-name").fill(MANAGER_NAME);
  await page.locator("#auth-email").fill(email);
  await page.locator("#auth-password").fill("hunter2test");
  await page.getByRole("button", { name: /Create account and team|Opret konto og hold/i }).click();
}

test("bekræftelses-skærmen viser adressen, spam-hint og en vej tilbage (#2826)", async ({ page }, testInfo) => {
  await submitSignup(page);

  // Adressen SKAL stå der: den er eneste måde en spiller kan opdage en tastefejl.
  await expect(page.getByText(TYPO_EMAIL, { exact: false })).toBeVisible();
  // Spam-hintet skal stå med det samme, ikke først efter et resend.
  await expect(page.getByText(/spam/i)).toBeVisible();
  // Vejen tilbage til formularen.
  await expect(page.getByRole("button", { name: /Change your email|Ret din email/i })).toBeVisible();
  // Og resend-muligheden.
  await expect(page.getByRole("button", { name: /Send it again|Send den igen/i })).toBeVisible();

  await page.screenshot({
    path: testInfo.outputPath(`2826-confirm-${testInfo.project.name}.png`),
    fullPage: true,
  });
});

test("ret-din-email fører tilbage til formularen med holdnavn og managernavn intakt (#2826)", async ({ page }, testInfo) => {
  await submitSignup(page);

  await page.getByRole("button", { name: /Change your email|Ret din email/i }).click();

  // Kernen i fixet: intet skal udfyldes igen. Uden det ville en spiller med en
  // forkert adresse skulle starte HELE tilmeldingen forfra.
  await expect(page.locator("#auth-team-name")).toHaveValue(TEAM_NAME);
  await expect(page.locator("#auth-manager-name")).toHaveValue(MANAGER_NAME);
  await expect(page.locator("#auth-password")).toHaveValue("hunter2test");
  await expect(page.locator("#auth-email")).toHaveValue(TYPO_EMAIL);

  await page.screenshot({
    path: testInfo.outputPath(`2826-fix-email-${testInfo.project.name}.png`),
    fullPage: true,
  });
});

test("domæne-tastefejl foreslås rettet og forslaget kan klikkes ind (#2826)", async ({ page }) => {
  await page.goto("/login?mode=signup");
  await page.locator("#auth-email").fill(TYPO_EMAIL);

  const suggestion = page.getByRole("button", { name: /rytter@gmail\.com/ });
  await expect(suggestion).toBeVisible();
  await suggestion.click();

  await expect(page.locator("#auth-email")).toHaveValue("rytter@gmail.com");
  // Forslaget forsvinder når adressen er rettet — ellers ville det se ud som om
  // rettelsen ikke virkede.
  await expect(page.locator("#auth-email-suggestion")).toHaveCount(0);
});

test("resend viser nedtælling i stedet for en rate-limit-fejl (#2826)", async ({ page }, testInfo) => {
  await page.route("**/auth/v1/resend**", route => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, {});
  });

  await submitSignup(page);

  await page.getByRole("button", { name: /Send it again|Send den igen/i }).click();

  // Efter et send: kvittering + nedtælling, og knappen er væk indtil cooldownen
  // er ovre. Før #2826 forsvandt knappen for altid efter første send.
  await expect(page.getByText(/Sent\.|Sendt\./)).toBeVisible();
  await expect(page.getByText(/You can send a new link in|Du kan sende et nyt link om/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Send it again|Send den igen/i })).toHaveCount(0);

  await page.screenshot({
    path: testInfo.outputPath(`2826-cooldown-${testInfo.project.name}.png`),
    fullPage: true,
  });
});
