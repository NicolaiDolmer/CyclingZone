import { expect, test } from "./e2e-base.js";
import {
  installNetworkMocks, login, stabilizePage, json,
  ACTIVE_SEASON, TEST_TEAM,
} from "./fixtures.js";

// #2863 · Sæsonens bedste ryttere på /seasons.
//
// Spec'en kører mod den DELTE preview-mock (installNetworkMocks + det seedede
// get_season_honours-svar), ikke mod lokale route-overrides for selve blokken.
// Det er med vilje: så beviser den samtidig at en Vercel-preview kan bære
// fladen, hvilket var hullet #2917 fandt på managerprofilen.
//
// Sproget er dansk fordi stabilizePage låser cz_lang=da.
//
// NAVNGIVNING (ejer-beslutning 26/7): labels er "Flest point" / "Flest sejre",
// ikke verdensmester/europamester. Assertionerne nedenfor holder BEGGE dele
// fast: at de rigtige labels står der, OG at mestertitlerne IKKE gør, så ordene
// ikke kan snige sig ind igen før #934 bygger rigtige mesterskaber.

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

// Sæsonen kører stadig → tallene kan flytte sig. Labels er de samme som efter
// sæsonslut; det er `Foreløbig`-chippen der bærer forskellen.
test("#2863 en igangværende sæson markeres Foreløbig med samme labels", async ({ page }) => {
  await login(page);
  await page.goto("/seasons");

  await expect(page.getByRole("heading", { name: "Sæsonens bedste ryttere" })).toBeVisible();
  await expect(page.getByText("Foreløbig")).toBeVisible();
  await expect(page.getByText("Flest point")).toBeVisible();
  await expect(page.getByText("Flest sejre")).toBeVisible();
});

test("#2863 en afsluttet sæson viser flest point og flest sejre", async ({ page }) => {
  await page.route("**/rest/v1/seasons**", route => {
    const request = route.request();
    if (request.method() !== "GET") return route.fallback();
    const wantsOne = (request.headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsOne ? COMPLETED_SEASON : [COMPLETED_SEASON]);
  });

  await login(page);
  await page.goto("/seasons");

  await expect(page.getByRole("heading", { name: "Sæsonens bedste ryttere" })).toBeVisible();
  await expect(page.getByText("Flest point")).toBeVisible();
  await expect(page.getByText("Flest sejre")).toBeVisible();

  // Ordene er reserveret til #934/#266 og må ALDRIG dukke op her, heller ikke
  // på en afsluttet sæson hvor fristelsen til at kåre nogen er størst.
  await expect(page.getByText(/mester/i)).toHaveCount(0);

  // Flest point: seedets AI-ejede rytter. AI-badget SKAL være der, ellers ser
  // det ud som om en manager stod øverst.
  await expect(page.getByRole("link", { name: "Mikkel Hansen" }).first()).toBeVisible();
  await expect(page.getByTitle(/AI/i).first()).toBeVisible();

  // Flest sejre: delt på 11, tie-breaket er point → Ada Pedersen står først, og
  // det skal stå i klar tekst i stedet for at se vilkårligt ud.
  await expect(page.getByRole("link", { name: "Ada Pedersen" }).first()).toBeVisible();
  await expect(page.getByText("Lige på sejre. Point afgør rækkefølgen.")).toBeVisible();

  // Noten forklarer hvad "sejre" tæller, så tallet kan afstemmes med ranglisten.
  await expect(page.getByText(/Sejre tæller etape, samlet klassement/)).toBeVisible();
});

test("#2863 nr. 1's navn linker til rytterprofilen", async ({ page }) => {
  await login(page);
  await page.goto("/seasons");

  await expect(page.getByRole("heading", { name: "Sæsonens bedste ryttere" })).toBeVisible();
  await page.getByRole("link", { name: "Mikkel Hansen" }).first().click();
  await expect(page).toHaveURL(/\/riders\/rider-2$/);
});

// Sikkerhedsnettet: RPC'en applies EFTER merge. Indtil da svarer PostgREST
// PGRST202, og så skal siden bare undlade blokken. Resten af opsamlingen
// (sæson-vælger, kalender, slutstilling) skal stå fuldstændig uberørt tilbage.
test("#2863 en manglende RPC skjuler kun blokken, resten af siden overlever", async ({ page }) => {
  await page.route("**/rest/v1/rpc/get_season_honours**", route => json(route, {
    code: "PGRST202",
    message: "Could not find the function public.get_season_honours(p_season_id) in the schema cache",
  }, 404));

  await login(page);
  await page.goto("/seasons");

  await expect(page.getByRole("heading", { name: "Sæsonens bedste ryttere" })).toHaveCount(0);
  // Siden selv lever: overskrift + sæson-vælger er der.
  await expect(page.getByRole("heading", { name: /Sæson 1/ })).toBeVisible();
  await expect(page.getByLabel(/sæson|season/i).first()).toBeVisible();
});

// En ÆGTE fejl (timeout, RLS, netværk) må ikke skjules — den skal ses, med en
// retry der kun kører blokkens eget kald.
test("#2863 en ægte RPC-fejl vises som fejl-tilstand i kortet", async ({ page }) => {
  await page.route("**/rest/v1/rpc/get_season_honours**", route => json(route, {
    code: "57014",
    message: "canceling statement due to statement timeout",
  }, 500));

  await login(page);
  await page.goto("/seasons");

  await expect(page.getByRole("heading", { name: "Sæsonens bedste ryttere" })).toBeVisible();
  await expect(page.getByText("Kunne ikke indlæse Sæsonens bedste ryttere.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Prøv igen" })).toBeVisible();
  // Slutstillingen bag kortet er upåvirket.
  await expect(page.getByRole("heading", { name: /Sæson 1/ })).toBeVisible();
});

// Skærmbilleder til PR'en. Kun desktop-chromium + et smalt 360px-vindue, så de
// to breakpoints ejeren beder om er dækket uden at pixel-låse fladen (ingen
// toHaveScreenshot-baseline: blokken er ny copy og ville ellers starte en
// snapshot-tredemølle, jf. #412).
test("#2863 skærmbilleder: blokken på desktop og 360px", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "skærmbilleder tages ét sted");

  await page.route("**/rest/v1/seasons**", route => {
    const request = route.request();
    if (request.method() !== "GET") return route.fallback();
    const wantsOne = (request.headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsOne ? COMPLETED_SEASON : [COMPLETED_SEASON]);
  });

  await login(page);
  await page.goto("/seasons");
  await expect(page.getByRole("heading", { name: "Sæsonens bedste ryttere" })).toBeVisible();
  await expect(page.getByText("Flest point")).toBeVisible();
  if (page.evaluate) await page.evaluate(() => document.fonts?.ready);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: "test-results/2863/season-honours-desktop.png" });

  await page.setViewportSize({ width: 360, height: 900 });
  await expect(page.getByText("Flest point")).toBeVisible();
  await page.screenshot({ path: "test-results/2863/season-honours-360.png" });

  // Holdet skal stadig kunne slås op fra 360px (linket må ikke blive klemt væk).
  await expect(page.getByRole("link", { name: TEST_TEAM.name }).first()).toBeVisible();
});
