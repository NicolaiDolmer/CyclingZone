import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #3509 — maks ÉN gold primary-knap pr. view (docs/design/PAGE_TEMPLATES.md).
// TeamSelectionCtaCard og SeasonWrapNudgeCard kunne begge rendere gold primary
// samtidig lige efter et sæsonskifte. Selve prioritetslogikken dækkes
// kombinatorisk i lib/dashboardGoldCta.test.js; denne fil verificerer
// kildekode-struktur at DashboardPage.jsx faktisk bruger den delte funktion
// til at style begge kort (samme mønster som DashboardPage.boardGating.test.js
// — repoet kører `node --test` uden DOM-renderer).

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "DashboardPage.jsx"), "utf8");

test("#3509 DashboardPage bruger den delte computeDashboardGoldCta i stedet for egen dupliceret prioritetslogik", () => {
  assert.match(
    source,
    /import \{ computeDashboardGoldCta \} from "\.\.\/lib\/dashboardGoldCta\.js";/,
    "skal importere den delte, testede prioritetsfunktion",
  );
  assert.match(
    source,
    /const \{ squadCtaActive, seasonWrapPrimary \} = computeDashboardGoldCta\(\{/,
    "skal udlede begge flags fra computeDashboardGoldCta",
  );
});

test("#3509 TeamSelectionCtaCard's primary-prop er styret af prioritetskæden, ikke kun firstRaceMomentActive", () => {
  assert.match(
    source,
    /<TeamSelectionCtaCard[\s\S]{0,400}?primary=\{squadCtaActive\}/,
    "TeamSelectionCtaCard skal modtage primary={squadCtaActive} (nedgraderes bag first-race-moment)",
  );
});

test("#3509 SeasonWrapNudgeCard modtager en primary-prop fra prioritetskæden", () => {
  assert.match(
    source,
    /<SeasonWrapNudgeCard[\s\S]{0,600}?primary=\{seasonWrapPrimary\}/,
    "SeasonWrapNudgeCard skal modtage primary={seasonWrapPrimary} — den må ikke altid rendere gold",
  );
});
