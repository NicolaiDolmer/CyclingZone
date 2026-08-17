import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTooltipPlacement } from "./onboardingTourPlacement.js";

// #3008: OnboardingTour.jsx brugte et fast heightEstimate = 160 til at
// beslutte over/under-placering og til top-beregningen. På 360px bredde er
// tooltip-teksten (fast 300px bred) ofte ombrudt over flere linjer, så den
// FAKTISKE højde langt overstiger 160 — for et 280px højt tooltip nær
// bunden af en 640px skærm dækkede overskuddet enten target'et (placeret
// over) eller blev klippet af mobilens 56px bund-nav (placeret under).

test("computeTooltipPlacement klemmer tooltip over viewport minus bund-nav-reserve på 360px", () => {
  // Target sidder langt nede på en kort mobil-skærm (640px høj), tooltip er
  // 280px høj (realistisk for et ombrudt 3-linjers step på 300px bredde).
  const rect = { top: 520, bottom: 560, left: 30, right: 330, width: 300, height: 40 };

  const result = computeTooltipPlacement({
    rect,
    height: 280,
    viewportW: 360,
    viewportH: 640,
    bottomReserve: 56, // MobileQuickNav
  });

  // Tooltip'ens bund skal blive inden for viewport minus bund-nav minus margin.
  assert.ok(result.tooltipTop + 280 <= 640 - 56 - 12 + 0.001, `tooltipTop ${result.tooltipTop} skubber tooltip'en bag bund-navigationen`);
  // Og den skal ikke skubbes op i negativt territorium.
  assert.ok(result.tooltipTop >= 12);
});

test("computeTooltipPlacement dækker IKKE target'et når den lægges over det (den gamle 160-gæt-bug)", () => {
  // #3008-reproduktion: target langt nede på en 640px skærm. Med det gamle
  // faste heightEstimate=160 beregner OnboardingTour placeBelow=false (samme
  // her) og sætter tooltipTop = rect.top - 160 - 12 = 308 — men elementet
  // rendrer stadig med sin RIGTIGE indholds-højde (280px, CSS er auto-height),
  // så det reelt optager 308-588, hvilket overlapper target'et (480-520).
  // computeTooltipPlacement skal bruge den faktiske højde og undgå overlappet.
  const rect = { top: 480, bottom: 520, left: 30, right: 330, width: 300, height: 40 };

  const result = computeTooltipPlacement({
    rect,
    height: 280,
    viewportW: 360,
    viewportH: 640,
    bottomReserve: 56,
  });

  assert.equal(result.placeBelow, false, "target sidder for langt nede til at der er plads under — skal placeres over");
  assert.ok(
    result.tooltipTop + 280 <= rect.top,
    `tooltip bund (${result.tooltipTop + 280}) overlapper target (rect.top=${rect.top}) — den gamle 160-bug`,
  );
});

test("computeTooltipPlacement lægger tooltip under target når der er plads (desktop, ingen bund-reserve)", () => {
  const rect = { top: 200, bottom: 240, left: 100, right: 400, width: 300, height: 40 };

  const result = computeTooltipPlacement({
    rect,
    height: 160,
    viewportW: 1280,
    viewportH: 800,
    bottomReserve: 0,
  });

  assert.equal(result.placeBelow, true);
  assert.equal(result.tooltipTop, rect.bottom + 12);
});

test("computeTooltipPlacement centrerer tooltip vandret over target, klemt til viewport-bredden", () => {
  // Target helt ude i venstre kant — tooltip må ikke gå ud over venstre margin.
  const rect = { top: 200, bottom: 240, left: 0, right: 40, width: 40, height: 40 };

  const result = computeTooltipPlacement({
    rect,
    height: 160,
    viewportW: 360,
    viewportH: 800,
    tooltipWidth: 300,
    margin: 12,
    bottomReserve: 0,
  });

  assert.equal(result.tooltipLeft, 12);
});
