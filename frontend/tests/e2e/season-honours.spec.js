import { expect, test } from "@playwright/test";
import {
  installNetworkMocks, login, stabilizePage, json,
  ACTIVE_SEASON, TEST_TEAM,
} from "./fixtures.js";

// #2863 · Sæsonens kåringer på /seasons.
//
// Spec'en kører mod den DELTE preview-mock (installNetworkMocks + det seedede
// get_season_honours-svar), ikke mod lokale route-overrides for selve kåringen.
// Det er med vilje: så beviser den samtidig at en Vercel-preview kan bære
// fladen, hvilket var hullet #2917 fandt på managerprofilen.
//
// Sproget er dansk fordi stabilizePage låser cz_lang=da.

const COMPLETED_SEASON = {
  ...ACTIVE_SEASON,
  id: "season-e2e-completed",
  status: "completed",
  number: 1,
  season_number: 1,
};

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

// Sæsonen kører stadig → ingen er kåret endnu. Blokken viser hvem der FØRER.
test("#2863 en igangværende sæson viser førende ryttere, ikke mestre", async ({ page }) => {
  await login(page);
  await page.goto("/seasons");

  await expect(page.getByRole("heading", { name: "Sæsonens kåringer" })).toBeVisible();
  await expect(page.getByText("Foreløbig")).toBeVisible();
  await expect(page.getByText("Fører på point")).toBeVisible();
  await expect(page.getByText("Fører på sejre")).toBeVisible();
  // Ingen titel er uddelt mens sæsonen kører.
  await expect(page.getByText("Verdensmester")).toHaveCount(0);
  await expect(page.getByText("Europamester")).toHaveCount(0);
});

test("#2863 en afsluttet sæson kårer verdensmester og europamester", async ({ page }) => {
  await page.route("**/rest/v1/seasons**", route => {
    const request = route.request();
    if (request.method() !== "GET") return route.fallback();
    const wantsOne = (request.headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsOne ? COMPLETED_SEASON : [COMPLETED_SEASON]);
  });

  await login(page);
  await page.goto("/seasons");

  await expect(page.getByRole("heading", { name: "Sæsonens kåringer" })).toBeVisible();
  await expect(page.getByText("Verdensmester")).toBeVisible();
  await expect(page.getByText("Europamester")).toBeVisible();

  // Flest point: seedets AI-ejede rytter. AI-badget SKAL være der, ellers ser
  // det ud som om en manager vandt titlen.
  await expect(page.getByRole("link", { name: "Mikkel Hansen" }).first()).toBeVisible();
  await expect(page.getByTitle(/AI/i).first()).toBeVisible();

  // Flest sejre: delt på 11, tie-breaket er point → Ada Pedersen får titlen, og
  // det skal stå i klar tekst i stedet for at se vilkårligt ud.
  await expect(page.getByRole("link", { name: "Ada Pedersen" }).first()).toBeVisible();
  await expect(page.getByText("Lige på sejre. Point afgør titlen.")).toBeVisible();

  // Noten forklarer hvad "sejre" tæller, så tallet kan afstemmes med ranglisten.
  await expect(page.getByText(/Sejre tæller etape, samlet klassement/)).toBeVisible();
});

test("#2863 vinderens navn linker til rytterprofilen", async ({ page }) => {
  await login(page);
  await page.goto("/seasons");

  await expect(page.getByRole("heading", { name: "Sæsonens kåringer" })).toBeVisible();
  await page.getByRole("link", { name: "Mikkel Hansen" }).first().click();
  await expect(page).toHaveURL(/\/riders\/rider-2$/);
});

// Sikkerhedsnettet: RPC'en applies EFTER merge. Indtil da svarer PostgREST
// PGRST202, og så skal siden bare undlade blokken. Resten af opsamlingen
// (sæson-vælger, kalender, slutstilling) skal stå fuldstændig uberørt tilbage.
test("#2863 en manglende RPC skjuler kun kåringen, resten af siden overlever", async ({ page }) => {
  await page.route("**/rest/v1/rpc/get_season_honours**", route => json(route, {
    code: "PGRST202",
    message: "Could not find the function public.get_season_honours(p_season_id) in the schema cache",
  }, 404));

  await login(page);
  await page.goto("/seasons");

  await expect(page.getByRole("heading", { name: "Sæsonens kåringer" })).toHaveCount(0);
  // Siden selv lever: overskrift + sæson-vælger er der.
  await expect(page.getByRole("heading", { name: /Sæson 1/ })).toBeVisible();
  await expect(page.getByLabel(/sæson|season/i).first()).toBeVisible();
});

// En ÆGTE fejl (timeout, RLS, netværk) må ikke skjules — den skal ses, med en
// retry der kun kører kåringens eget kald.
test("#2863 en ægte RPC-fejl vises som fejl-tilstand i kortet", async ({ page }) => {
  await page.route("**/rest/v1/rpc/get_season_honours**", route => json(route, {
    code: "57014",
    message: "canceling statement due to statement timeout",
  }, 500));

  await login(page);
  await page.goto("/seasons");

  await expect(page.getByRole("heading", { name: "Sæsonens kåringer" })).toBeVisible();
  await expect(page.getByText("Kunne ikke indlæse sæsonens kåringer.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Prøv igen" })).toBeVisible();
  // Slutstillingen bag kortet er upåvirket.
  await expect(page.getByRole("heading", { name: /Sæson 1/ })).toBeVisible();
});

// Skærmbilleder til PR'en. Kun desktop-chromium + et smalt 360px-vindue, så de
// to breakpoints ejeren beder om er dækket uden at pixel-låse fladen (ingen
// toHaveScreenshot-baseline: kåringen er ny copy og ville ellers starte en
// snapshot-tredemølle, jf. #412).
test("#2863 skærmbilleder: kåringen på desktop og 360px", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "skærmbilleder tages ét sted");

  await page.route("**/rest/v1/seasons**", route => {
    const request = route.request();
    if (request.method() !== "GET") return route.fallback();
    const wantsOne = (request.headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsOne ? COMPLETED_SEASON : [COMPLETED_SEASON]);
  });

  await login(page);
  await page.goto("/seasons");
  await expect(page.getByRole("heading", { name: "Sæsonens kåringer" })).toBeVisible();
  await expect(page.getByText("Verdensmester")).toBeVisible();
  if (page.evaluate) await page.evaluate(() => document.fonts?.ready);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: "test-results/2863/season-honours-desktop.png" });

  await page.setViewportSize({ width: 360, height: 900 });
  await expect(page.getByText("Verdensmester")).toBeVisible();
  await page.screenshot({ path: "test-results/2863/season-honours-360.png" });

  // Holdet skal stadig kunne slås op fra 360px (linket må ikke blive klemt væk).
  await expect(page.getByRole("link", { name: TEST_TEAM.name }).first()).toBeVisible();
});
