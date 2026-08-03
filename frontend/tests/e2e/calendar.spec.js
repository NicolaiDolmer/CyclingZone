// Race Calendar (#in-game-race-calendar) — verificerer at den spiller-vendte
// kalender renderer fra GET /api/races/calendar via preview-seedet (SEED_CALENDAR),
// uafhængigt af race-engine-flaget. Stabiliseret med DA-locale (login-fixturen).
// #3102 etape 3 (PR 3): kalenderen er Kalender-fanen i Planlægnings-hubben
// (/planning?tab=calendar); /calendar redirecter (dækket i race-distribution).
import { test, expect } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";

async function gotoCalendar(page) {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await login(page);
  await expect(async () => {
    await page.goto("/planning?tab=calendar");
    expect(page.url()).toMatch(/\/planning\?tab=calendar$/);
  }).toPass({ timeout: 15000 });
}

test("kalenderen renderer som hub-fane med eyebrow, faner, måneds-grid og legend", async ({ page }) => {
  await gotoCalendar(page);

  // Hubben ejer h1'en (PR 3); kalender-fanen er valgt, og eyebrow'en
  // ("Sæson N · X løbsdage") flyttede fra PageHeader-subtitlen til kontrolrækken.
  await expect(page.getByRole("heading", { name: /^(Planning|Planlægning)$/i })).toBeVisible();
  await expect(page.getByRole("tab", { name: /^(Calendar|Kalender)$/i })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText(/Sæson 1 · 60 løbsdage/)).toBeVisible();

  // Faner (Mit hold default, Alle hold, Divisioner).
  const tablist = page.getByRole("tablist", { name: /^(Race calendar|Løbskalender)$/i });
  await expect(tablist.getByRole("tab")).toHaveCount(3);
  await expect(page.getByRole("tab", { name: "Mit hold" })).toHaveAttribute("aria-selected", "true");

  // Weekday-header (mandag-først, dansk).
  await expect(page.getByText("MAN", { exact: true })).toBeVisible();
  await expect(page.getByText("SØN", { exact: true })).toBeVisible();

  // Holdets egne løb vises som klikbare per-etape-chips (#1946). Chip-navnet trunkeres
  // visuelt i smalle celler (især mobil), så vi asserter på chip'ens tilgængelige navn
  // (aria-label "Åbn planlægning for {navn}"), der altid bærer hele løbsnavnet — og på at
  // chip'en linker ind på løbets planlægningsside.
  const namurChip = page.getByRole("link", { name: /Grand Prix de Namur/ }).first();
  await expect(namurChip).toBeVisible();
  await expect(namurChip).toHaveAttribute("href", "/races/cal-1");
  // Etapeløbet vises også som en klikbar chip.
  await expect(page.getByRole("link", { name: /Tour des Hauts Plateaux/ }).first()).toBeVisible();

  // Legend med terræn-typer. Enkeltstart (ITT) og Holdstart (TTT) er nu distinkte
  // legend-poster med hver sin glyf (#1953). Brosten har sin egen legend-post + glyf
  // (#2605 — var tidligere umulig at skelne fra en flad sprint-etape).
  await expect(page.getByText("Bjerge", { exact: true })).toBeVisible();
  await expect(page.getByText("Brosten", { exact: true })).toBeVisible();
  await expect(page.getByText("Enkeltstart", { exact: true })).toBeVisible();
  await expect(page.getByText("Holdstart", { exact: true })).toBeVisible();

  // Brosten-løbet (E3 Saxo Classic, seedet #2605) vises som en klikbar chip med
  // det distinkte brosten-ikon (ikke det generiske sprint-ikon).
  await expect(page.getByRole("link", { name: /E3 Saxo Classic/ }).first()).toBeVisible();
});

test("'Alle hold'-fanen viser andre divisioners løb (dæmpet)", async ({ page }) => {
  await gotoCalendar(page);
  await page.getByRole("tab", { name: "Alle hold" }).click();
  await expect(page.getByRole("tab", { name: "Alle hold" })).toHaveAttribute("aria-selected", "true");
  // Mit holds-løb-filteret dukker op på ikke-"mit hold"-faner.
  await expect(page.getByText("Mit holds løb")).toBeVisible();
  // Flere instanser af samme løbsnavn (egen pulje + andre divisioner) → flere chips.
  await expect(page.getByRole("link", { name: /Grand Prix de Namur/ }).first()).toBeVisible();
  expect(await page.getByRole("link", { name: /Grand Prix de Namur/ }).count()).toBeGreaterThan(1);
});

test("snapshot: kalender-flade", async ({ page }) => {
  await gotoCalendar(page);
  await expect(page.getByRole("link", { name: /Grand Prix de Namur/ }).first()).toBeVisible();
  await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
  await expect(page.locator("main")).toHaveScreenshot("calendar-page.png", {
    maxDiffPixelRatio: 0.02,
  });
});
