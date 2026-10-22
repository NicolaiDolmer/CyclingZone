import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hasProFeatureAccess, proBenefitPath, parseProBenefit, PRO_BENEFITS } from "./proAccess.ts";
import { PRO_SAMPLE_SEASONS, PRO_SAMPLE_ABILITIES } from "./proSampleData.ts";

test("#2806 aktiv Pro faar funktionerne", () => {
  assert.equal(hasProFeatureAccess({ isPro: true, isFounder: false }), true);
  assert.equal(hasProFeatureAccess({ isPro: true, isFounder: true }), true);
});

test("#2806 Founder uden aktivt abonnement faar kun maerket, ikke funktionerne (ejer 13/10)", () => {
  assert.equal(hasProFeatureAccess({ isPro: false, isFounder: true }), false);
});

test("#2806 gratis spiller faar ikke funktionerne", () => {
  assert.equal(hasProFeatureAccess({ isPro: false, isFounder: false }), false);
  assert.equal(hasProFeatureAccess({ isPro: false }), false);
});

// Gemte filtre er ren localStorage (ingen backend-gate), saa komponenten ER
// haandhaevelsen. Guarden sikrer at begge Pro-flader bruger den ene regel.
const componentsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "components");
for (const rel of ["rider/SavedFiltersBar.jsx", "rider/profile/RiderAbilityHistoryPro.jsx"]) {
  test(`#2806 ${rel} gater paa hasProFeatureAccess, ikke isPro || isFounder`, () => {
    const src = readFileSync(join(componentsDir, rel), "utf8");
    assert.match(src, /hasProFeatureAccess\(\{ isPro, isFounder \}\)/);
    assert.doesNotMatch(src, /isPro \|\| isFounder/);
  });
}

test("#2806 opsalgslinket peger paa den rigtige fane paa /pro", () => {
  assert.equal(proBenefitPath("history"), "/pro?benefit=history");
  assert.equal(proBenefitPath("filters"), "/pro?benefit=filters");
});

test("#2806 ?benefit= parses; ukendt eller manglende giver foerste fane", () => {
  assert.equal(parseProBenefit("filters"), "filters");
  assert.equal(parseProBenefit("history"), "history");
  assert.equal(parseProBenefit(null), PRO_BENEFITS[0]);
  assert.equal(parseProBenefit(undefined), PRO_BENEFITS[0]);
  assert.equal(parseProBenefit("toString"), PRO_BENEFITS[0]);
  assert.equal(parseProBenefit(""), PRO_BENEFITS[0]);
});

test("#2806 eksempeldata: hver viste evne har en vaerdi i hver saeson, og sidste punkt er 'Now'", () => {
  for (const season of PRO_SAMPLE_SEASONS) {
    for (const key of PRO_SAMPLE_ABILITIES) {
      assert.equal(typeof season.abilities[key], "number", `${key} mangler i en eksempelsaeson`);
    }
  }
  const last = PRO_SAMPLE_SEASONS[PRO_SAMPLE_SEASONS.length - 1];
  assert.equal(last.live, true);
  assert.equal(last.season_number, null);
});
