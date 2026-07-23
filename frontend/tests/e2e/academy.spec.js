// academy.spec.js — Playwright smoke-test for AcademyPage (#1308, UX-rework #2796).
//
// Verificerer at siden renderer intake-kandidater + sign-knapper + slot-tæller
// via mock-data fra fixtures.js (academy/me-respons med 3 kandidater + 2 roster-
// ryttere + 1 pending graduate), og at #2796-fladen faktisk er der: signeringspris,
// udløbsfrist, ryttertype og sorterbare roster-kolonner.

import { expect, test } from "@playwright/test";
import {
  installNetworkMocks,
  login,
  stabilizePage,
} from "./fixtures.js";

test.beforeEach(async ({ page }) => {
  await installNetworkMocks(page);
  await stabilizePage(page);
});

test("academy page renders intake candidates, slot counter, and roster", async ({ page }) => {
  await login(page);
  await page.goto("/academy");

  // Slot-tæller
  await expect(page.locator("main")).toContainText(/Academy.*2.*\/.*8|Akademi.*2.*\/.*8/i);

  // Intake-sektion — kandidaterne selv er sprog-uafhængige.
  await expect(page.getByRole("link", { name: /Emil Kristiansen/i })).toBeVisible();

  // Serious prospect-badge (Emil Kristiansen er is_serious=true)
  await expect(page.locator("main")).toContainText(/Serious|Seriøs/i);

  // Sign + Reject-knapper (mindst én af hvert)
  await expect(page.getByRole("button", { name: /Sign|Signér/i }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Reject|Afvis/i }).first()).toBeVisible();

  // Roster-sektion — Jonas Svensson + Luca Morel
  await expect(page.locator("main")).toContainText(/Roster|roster|Akademihold/i);

  // #1524: akademiryttere er klikbare → rytterprofil (samme som førsteholdet).
  const riderLink = page.getByRole("link", { name: /Jonas Svensson/i });
  await expect(riderLink).toBeVisible();
  await expect(riderLink).toHaveAttribute("href", /\/riders\//);

  // #2456: fri-agent-butikken er FJERNET — sektionen må ikke rendere længere.
  await expect(page.locator("main")).not.toContainText(/Free youth agents|Frie ungdomsryttere/i);
});

test("intake candidates show price and expiry before the irreversible click (#2796)", async ({ page }) => {
  await login(page);
  await page.goto("/academy");

  // Signeringspris: Emil koster 50.000 CZ$ (25% af 200.000). Vises FØR man klikker
  // Signér — det var netop det kortet manglede (Discord 22/7).
  await expect(page.locator("main")).toContainText(/Signing fee|Signeringspris/i);
  await expect(page.locator("main")).toContainText(/50[.,]000/);

  // Udløbsfrist: tilbud løber 7 dage; seed'et har ét på 6 dage (1 dag tilbage) og
  // ét på 1 dag (6 tilbage), så nedtællingen skal være synlig.
  await expect(page.locator("main")).toContainText(/\dd left|\dd tilbage|Expires today|Udløber i dag/i);

  // Ryttertype er med på kortene (RiderTypeBadge) — manglede helt før.
  // Baroudeur er samme ord på EN og DA, så assertionen er sprog-uafhængig.
  await expect(page.locator("main")).toContainText(/Baroudeur/i);
});

test("academy roster is a sortable design-system table (#2796)", async ({ page }) => {
  await login(page);
  await page.goto("/academy");

  const table = page.locator("main table[data-sortable]");
  await expect(table).toBeVisible();

  // Værdi-kolonnen er ny — markedsværdien var ikke på akademi-fladen før.
  await expect(table).toContainText(/180[.,]000/);

  // Klik på en sorterbar header sætter aria-sort (den kanoniske Th-mekanisme).
  const valueHeader = table.locator("th", { hasText: /^(Value|Værdi)$/ }).first();
  await valueHeader.click();
  await expect(valueHeader).toHaveAttribute("aria-sort", /ascending|descending/);
});

test("academy page shows disabled state gracefully when flag is off", async ({ page }) => {
  // Override academy/me til at returnere 409 academy_disabled.
  await page.route("**/api/academy/me**", route => {
    const req = route.request();
    if (req.method() === "OPTIONS") {
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "academy_disabled" }),
    });
  });

  await login(page);
  await page.goto("/academy");

  // Graceful disabled state — ingen JS-crash, heading vises
  await expect(page.locator("main")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Academy|Akademi/i })).toBeVisible();
  // Ingen intake-kandidat-grid rendret
  await expect(page.getByRole("button", { name: /Sign|Signér/i })).toHaveCount(0);
});

test("a backend failure reads as an error, not as 'coming soon' (#2796)", async ({ page }) => {
  await page.route("**/api/academy/me**", route => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204 });
    return route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "boom" }),
    });
  });

  await login(page);
  await page.goto("/academy");

  await expect(page.getByRole("heading", { name: /Academy|Akademi/i })).toBeVisible();
  // En 500'er efterlod før enabled=false → spilleren fik "Akademiet kommer snart".
  await expect(page.locator("main")).not.toContainText(/coming soon|kommer snart/i);
  await expect(page.locator("main")).toContainText(/Could not load|Kunne ikke hente/i);
});
