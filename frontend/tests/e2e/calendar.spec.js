// Race Calendar (#in-game-race-calendar) — verificerer at den spiller-vendte
// kalender renderer fra GET /api/races/calendar via preview-seedet (SEED_CALENDAR),
// uafhængigt af race-engine-flaget. Stabiliseret med DA-locale (login-fixturen).
// #3102 etape 3 (PR 3): kalenderen er Kalender-fanen i Planlægnings-hubben
// (/planning?tab=calendar); /calendar redirecter (dækket i race-distribution).
import { test, expect } from "./e2e-base.js";
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

test("#2756: pulje-vælgeren viser en anden divisions/gruppes fulde program (scouting)", async ({ page }) => {
  await gotoCalendar(page);
  await page.getByRole("tab", { name: "Divisioner" }).click();
  await expect(page.getByRole("tab", { name: "Divisioner" })).toHaveAttribute("aria-selected", "true");

  // Skift til Division 3, hvor spilleren IKKE selv har hold — den fulde bevisbyrde
  // for scouting-issuet (thelamba 20/7: "kan ikke vælge fx 'Division 2 A'").
  await page.getByLabel("Division", { exact: true }).selectOption({ label: "Division 3" });
  const poolSelect = page.getByLabel("Pulje", { exact: true });
  await expect(poolSelect).toBeVisible();

  // "Division 3 — A" har det seedede 5-løbs-overflow-dag (#2756 dækning nedenfor);
  // "Division 3 — B" har Giro Veneto (cal-9) i stedet. De to grupper skal give
  // synligt FORSKELLIGE programmer — det var netop umuligt før dette issue.
  await poolSelect.selectOption({ label: "Division 3 — A" });
  await expect(page.getByRole("link", { name: /Roc d'Azur/ }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Giro Veneto/ })).toHaveCount(0);

  await poolSelect.selectOption({ label: "Division 3 — B" });
  await expect(page.getByRole("link", { name: /Giro Veneto/ }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Roc d'Azur/ })).toHaveCount(0);
});

test("#2756: '+N more' folder dagens fulde program ud i stedet for tavs afkortning", async ({ page }) => {
  await gotoCalendar(page);
  await page.getByRole("tab", { name: "Divisioner" }).click();
  await page.getByLabel("Division", { exact: true }).selectOption({ label: "Division 3" });
  await page.getByLabel("Pulje", { exact: true }).selectOption({ label: "Division 3 — A" });

  // Dagcellen sorterer alfabetisk (ingen klokkeslæt seedet) og viser kun de
  // første 4 af de 5 seedede løb: Coppa Bernocchi/Faun-Ardèche/Japan Cup/Roc
  // d'Azur er synlige med det samme, "Tro-Bro Léon" (sidst alfabetisk) er
  // afkortet bag en interaktiv "+1 flere".
  await expect(page.getByRole("link", { name: /Tro-Bro Léon/ })).toHaveCount(0);
  const moreButton = page.getByRole("button", { name: "+1 flere" });
  await expect(moreButton).toBeVisible();

  await moreButton.click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  // Modalen viser HELE dagens program, inkl. det tidligere skjulte 5. løb.
  for (const name of ["Roc d'Azur", "Tro-Bro Léon", "Faun-Ardèche Classic", "Japan Cup", "Coppa Bernocchi"]) {
    await expect(modal.getByRole("link", { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })).toBeVisible();
  }

  await page.keyboard.press("Escape");
  await expect(modal).not.toBeVisible();
});

test("snapshot: kalender-flade", async ({ page }) => {
  await gotoCalendar(page);
  await expect(page.getByRole("link", { name: /Grand Prix de Namur/ }).first()).toBeVisible();
  await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
  await expect(page.locator("main")).toHaveScreenshot("calendar-page.png", {
    maxDiffPixelRatio: 0.02,
  });
});
