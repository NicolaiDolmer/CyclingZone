// #5944: fravælg U23-/juniorløb pr. trup ("Enter races" / "Train only").
//
// Spillervejen på U23-siden: standard er "Enter races" (assistenten har udtaget
// tre kommende løb) → vælg "Train only" → PUT gemmes, noten vises med dagen
// valget gælder fra, og Calendar viser løbene som "Not entered · training".
// Desktop (1440): valget står i sidehovedet. Mobil (390): fuld bredde under titlen.
// Uden migrationen (available=false) skjules valget helt, siden er som før.
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";
import { EFFECTIVE_FROM_DAY, RACES, installOptOutMocks, type OptOutMockState } from "./5944-mocks.ts";

const SIZES = [
  { tag: "1440", width: 1440, height: 900, control: "youth-race-opt-out-header", hidden: "youth-race-opt-out-mobile" },
  { tag: "390", width: 390, height: 844, control: "youth-race-opt-out-mobile", hidden: "youth-race-opt-out-header" },
];

for (const size of SIZES) {
  test(`#5944 ${size.tag}: Train only gemmes, noten vises og kalenderen siger training`, async ({ page }) => {
    const state: OptOutMockState = { available: true, trainOnly: false, puts: [] };
    await page.setViewportSize({ width: size.width, height: size.height });
    await stabilizePage(page);
    await installNetworkMocks(page);
    await installOptOutMocks(page, state);
    await login(page);
    await page.goto("/squads/u23");

    const control = page.getByTestId(size.control);
    await expect(control).toBeVisible();
    await expect(page.getByTestId(size.hidden)).toBeHidden();
    const enter = control.getByRole("button", { name: /Enter races|Kør løb/ });
    const trainOnly = control.getByRole("button", { name: /Train only|Kun træning/ });
    await expect(enter).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("youth-race-opt-out-note")).toHaveCount(0);

    // Før: kalenderen viser assistentens udtagelse.
    await page.getByRole("tablist").getByRole("tab", { name: /Calendar|Kalender/ }).click();
    await expect(page.getByTestId(`youth-race-row-${RACES[0].id}`)).toContainText(/auto-picked|auto-udtaget/);

    await trainOnly.click();
    await expect(trainOnly).toHaveAttribute("aria-pressed", "true");
    expect(state.puts).toEqual([{ squad: "u23", mode: "train_only" }]);

    const note = page.getByTestId("youth-race-opt-out-note");
    await expect(note).toBeVisible();
    await expect(note).toContainText(String(EFFECTIVE_FROM_DAY));
    await expect(note.getByRole("link")).toHaveAttribute("href", /\/help\?section=youthSquads/);
    for (const race of RACES) {
      await expect(page.getByTestId(`youth-race-row-${race.id}`)).toContainText(/Not entered · training|Ikke tilmeldt · træner/);
    }

    if (size.tag === "390") {
      // Fuld bredde under titlen: kontrollen fylder (næsten) hele indholdsbredden.
      const box = await control.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThan(size.width - 64);
    }

    // Skift tilbage: noten forsvinder igen.
    await enter.click();
    await expect(enter).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("youth-race-opt-out-note")).toHaveCount(0);
    expect(state.puts.at(-1)).toEqual({ squad: "u23", mode: "enter" });
  });
}

test("#5944: før migrationen skjules valget, og siden er som i dag", async ({ page }) => {
  const state: OptOutMockState = { available: false, trainOnly: false, puts: [] };
  await stabilizePage(page);
  await installNetworkMocks(page);
  await installOptOutMocks(page, state);
  await login(page);
  await page.goto("/squads/u23");
  await expect(page.getByTestId("squad-page-u23")).toBeVisible();
  await expect(page.getByTestId("youth-race-opt-out-header")).toHaveCount(0);
  await expect(page.getByTestId("youth-race-opt-out-mobile")).toHaveCount(0);
});
