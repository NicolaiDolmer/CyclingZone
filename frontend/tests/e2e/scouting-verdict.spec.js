import { test, expect } from "@playwright/test";
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

test("#3667 loftet vises som tal og ALTID som et interval, aldrig ét loft-tal", async ({ page }, testInfo) => {
  collectBrowserErrors(page, testInfo);
  await login(page);
  await page.goto(`/riders/${OWN_RIDER}?tab=scouting`);

  const rows = page.locator("[data-type]");
  await expect(rows).toHaveCount(8);

  // help.json påstod at potentiale "aldrig" vises som et tal. Det gør det.
  // Guarden holder den rettede tekst ærlig: hvis tallene nogensinde fjernes
  // herfra, skal hjælpen skrives om igen — og så fejler denne test først.
  for (const key of ["sprinter", "climber"]) {
    await expect(page.locator(`[data-type="${key}"]`)).toHaveText(/\d+\s*·\s*\d+[–-]\d+/);
  }

  // #1543/#1162 anti-inversion: loftet må aldrig kollapse til ét tal. Hver række
  // skal have lo < hi, ellers er sandheden aflæselig direkte fra skærmen.
  const bounds = await rows.evaluateAll((nodes) => nodes.map((n) => {
    const m = n.textContent.match(/(\d+)\s*[–-]\s*(\d+)\s*$/);
    return m ? [Number(m[1]), Number(m[2])] : null;
  }));
  expect(bounds.filter(Boolean)).toHaveLength(8);
  for (const [lo, hi] of bounds) {
    expect(hi, `loft-båndet kollapsede til ét tal (${lo}), hvilket gør det inverterbart`).toBeGreaterThan(lo);
  }
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

  await expect(page.getByText(/Ikke scoutet/i).first()).toBeVisible();
  await expect(page.locator("[data-type]")).toHaveCount(0);
  await expect(page.getByText(/Fuldt scoutet|Delvist scoutet|Knap nok scoutet/)).toHaveCount(0);
  // Intet gratis lo-hi-spænd må slippe ud før et scout-slot er brugt.
  await expect(page.getByText(/ikke en kendsgerning/i)).toHaveCount(0);
});
