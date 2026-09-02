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
//
// [epic #4592 del 3] SeasonSignupCard tilføjet som 3. forbruger — se
// dashboardGoldCta.js's egen prioritetskommentar for rangordenen.

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
    /const \{ squadCtaActive, seasonSignupPrimary, seasonWrapPrimary \} = computeDashboardGoldCta\(\{/,
    "skal udlede alle tre flags fra computeDashboardGoldCta",
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

test("[epic #4592] SeasonSignupCard modtager en primary-prop fra prioritetskæden", () => {
  assert.match(
    source,
    /<SeasonSignupCard[\s\S]{0,400}?primary=\{seasonSignupPrimary\}/,
    "SeasonSignupCard skal modtage primary={seasonSignupPrimary} — den må ikke altid rendere gold",
  );
});
