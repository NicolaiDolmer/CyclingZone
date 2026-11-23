import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, login, collectBrowserErrors, evidenceShotPath } from "./fixtures.js";

// #3667 — Scouting-fanen på rytterprofilen havde INGEN e2e-dækning overhovedet.
// Mocken fandtes (mockHandlers: `/scouting-report` → SEED_SCOUTING_REPORT, #3334),
// men ingen spec åbnede nogensinde fanen. Derfor kunne to usandheder stå på den
// i månedsvis uden at nogen gate fangede dem:
//
//   • help.json lovede at potentiale "aldrig" vises som et tal — men
//     RiderScoutingTab printer `{now} · {ceilLo}–{ceilHi}` pr. ryttertype.
//   • chippen sagde "Høj tillid" om et bånd der kan være 10 rating-point bredt,
//     fordi buildVerdict's `confidence` måler hvor FULDT scoutet rytteren er,
//     ikke hvor præcist estimatet er (scoutEngine.minHalfWidthByScoutRating:
//     gulvet er 5,0 ved spejder-overall 40, som 149 af 202 hold har).
//
// Assertions herunder er bevidst bundet til FORM frem for til seedets tal, så
// specen ikke knækker hvis SEED_SCOUTING_REPORT justeres af andre grunde.

const OWN_RIDER = "rider-1";
const RIVAL_RIDER = "rider-2";

test.beforeEach(async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
});

test("#3667 chippen beskriver scouting-graden, ikke tillid — og forklarer at bredden hænger på spejderen", async ({ page }, testInfo) => {
  collectBrowserErrors(page, testInfo);
  await login(page);
  await page.goto(`/riders/${OWN_RIDER}?tab=scouting`);

  const chip = page.getByText(/^Fuldt scoutet$/);
  await expect(chip).toBeVisible();

  // Selve fejlen: mærkatet må ikke love tillid eller præcision, fordi feltet
  // ikke måler nogen af delene.
  await expect(page.getByText(/tillid/i)).toHaveCount(0);

  // Rettelsen: titlen skal pege på spejderens rating som det der styrer bredden.
  await expect(chip).toHaveAttribute("title", /spejders rating/i);

  // Dommen står ikke længere som en kendsgerning.
  await expect(page.getByText(/ikke en kendsgerning/i)).toBeVisible();

  await testInfo.attach("3667-verdict-kort", {
    body: await page.locator("main").screenshot(),
    contentType: "image/png",
  });
  await page.screenshot({ path: evidenceShotPath("pr-screens/3667-scouting-verdict-desktop.png"), fullPage: false });
});

test("#3667/#8645 hver ryttertype viser nu-tal og ét prognosetal, aldrig et interval", async ({ page }, testInfo) => {
  collectBrowserErrors(page, testInfo);
  await login(page);
  await page.goto(`/riders/${OWN_RIDER}?tab=scouting`);

  const rows = page.locator("[data-type]");
  await expect(rows).toHaveCount(8);

  // help.json påstod at potentiale "aldrig" vises som et tal. Det gør det.
  // #8645 (ejer 23/11): "det skal bare ikke være et bånd der viser prognosen herinde heller".
  // Hver række har et nu-tal og ét prognosetal; intet interval. Prognosen regnes på serveren
  // fra holdets skøn og farten (samme regel som den samlede Prognose, #8523), så tallet røber
  // aldrig det rå potentiale; den sikring testes i backend (potentialEstimateRead.test.js).
  await expect(page.locator('[data-type="sprinter"]')).toHaveText(/\d+[\s\S]*\d+/);
  await expect(page.locator('[data-type="climber"]')).toHaveText(/\d+\s*·\s*\d+/);
  const texts = await rows.allTextContents();
  for (const text of texts) {
    expect(text, "ingen række viser et interval").not.toMatch(/\d+\s*[–-]\s*\d+/);
  }

  // #5435/#6853: med bedste rolle nu som eneste visning står loft-tallet ikke
  // længere på scouting-fanen (ejer 21/9).
  await expect(page.locator('[data-testid="scouting-primary-loft"]')).toHaveCount(0);
});

// Denne test navigerer til en RIGTIG rival-rytter. Det kunne den ikke før:
// REST-mocken filtrerede aldrig på `id=eq.`, så /riders/rider-2 serverede
// rider-1 og testen ville have været grøn uden nogensinde at se en rival.
// Filteret er rettet i mockHandlers.restRows — uden den rettelse er denne
// test meningsløs, og det er hele pointen med at have den her.
test("#1543 uscoutet RIVAL-rytter viser intet potentiale — hverken bånd, tal eller chip", async ({ page }, testInfo) => {
  collectBrowserErrors(page, testInfo);
  await login(page);
  await page.goto(`/riders/${RIVAL_RIDER}?tab=scouting`);

  // Guard mod at mock-filteret regredierer: rammer vi ved et uheld vores egen
  // rytter igen, tester resten af denne spec ingenting.
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(/Ada Pedersen/i);

  // #7932 (ejer 12/11): uscoutet viser kun Scout-knappen, aldrig teksten "Ikke scoutet".
  await expect(page.getByRole("button", { name: /Scout|Send spejder/i }).first()).toBeVisible();
  await expect(page.getByText(/Ikke scoutet/i)).toHaveCount(0);
  await expect(page.locator("[data-type]")).toHaveCount(0);
  await expect(page.getByText(/Fuldt scoutet|Delvist scoutet|Knap nok scoutet/)).toHaveCount(0);
  // Intet gratis lo-hi-spænd må slippe ud før et scout-slot er brugt.
  await expect(page.getByText(/ikke en kendsgerning/i)).toHaveCount(0);
});
