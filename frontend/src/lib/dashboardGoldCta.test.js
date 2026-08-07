import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDashboardGoldCta } from "./dashboardGoldCta.js";

// #3509 — TeamSelectionCtaCard og SeasonWrapNudgeCard kunne begge rendere gold
// primary samtidig lige efter et sæsonskifte (recap ikke dismisset OG ny
// sæsons holdudtagelse mangler — to uafhængige betingelser). Design-reglen
// (docs/design/PAGE_TEMPLATES.md) tillader maks ÉN gold primary-knap pr. view.
//
// Denne test dækker ALLE 8 kombinationer af de tre boolske input og
// verificerer at højst ét kort er "primary" i hver.

const BOOL = [false, true];

function countPrimary({ firstRaceMomentActive, squadCtaActive, seasonWrapVisible, seasonWrapPrimary }) {
  // MyLatestResultCard renderer sin egen gold CTA når firstRaceMomentActive er
  // sand (ubetinget — den ejer altid guld når den er aktiv, jf. DashboardPage.jsx).
  // TeamSelectionCtaCard renderer intet uden en manglende-udtagelse-race, men her
  // tester vi kun selve prioritetslogikken (squadCtaActive = "ville have fået guld").
  // SeasonWrapNudgeCard renderer kun når seasonWrapVisible er sand.
  let count = 0;
  if (firstRaceMomentActive) count += 1;
  if (squadCtaActive) count += 1;
  if (seasonWrapVisible && seasonWrapPrimary) count += 1;
  return count;
}

test("#3509 alle 8 kombinationer af (firstRaceMoment, squadCtaEligible, seasonWrapVisible) giver højst ét gold primary-kort", () => {
  for (const firstRaceMomentActive of BOOL) {
    for (const squadCtaEligible of BOOL) {
      for (const seasonWrapVisible of BOOL) {
        const result = computeDashboardGoldCta({
          firstRaceMomentActive,
          squadCtaEligible,
          seasonWrapVisible,
        });

        const primaryCount = countPrimary({
          firstRaceMomentActive,
          squadCtaActive: result.squadCtaActive,
          seasonWrapVisible,
          seasonWrapPrimary: result.seasonWrapPrimary,
        });

        assert.ok(
          primaryCount <= 1,
          `firstRaceMomentActive=${firstRaceMomentActive} squadCtaEligible=${squadCtaEligible} ` +
            `seasonWrapVisible=${seasonWrapVisible} gav ${primaryCount} gold primary-kort (forventet højst 1)`,
        );
      }
    }
  }
});

test("#3509 first-race-moment vinder ALTID guldet når det er aktivt", () => {
  for (const squadCtaEligible of BOOL) {
    for (const seasonWrapVisible of BOOL) {
      const result = computeDashboardGoldCta({
        firstRaceMomentActive: true,
        squadCtaEligible,
        seasonWrapVisible,
      });
      assert.equal(result.squadCtaActive, false, "squad-CTA skal nedgraderes når first-race-moment er aktivt");
      assert.equal(result.seasonWrapPrimary, false, "season-wrap skal nedgraderes når first-race-moment er aktivt");
    }
  }
});

test("#3509 squad-CTA vinder over season-wrap når first-race-moment er inaktivt", () => {
  const result = computeDashboardGoldCta({
    firstRaceMomentActive: false,
    squadCtaEligible: true,
    seasonWrapVisible: true,
  });
  assert.equal(result.squadCtaActive, true, "squad-CTA skal have guld");
  assert.equal(result.seasonWrapPrimary, false, "season-wrap skal nedgraderes til sekundær");
});

test("#3509 season-wrap får guld når hverken first-race-moment eller squad-CTA er aktive", () => {
  const result = computeDashboardGoldCta({
    firstRaceMomentActive: false,
    squadCtaEligible: false,
    seasonWrapVisible: true,
  });
  assert.equal(result.squadCtaActive, false);
  assert.equal(result.seasonWrapPrimary, true, "season-wrap er eneste kandidat og skal beholde guld");
});

test("#3509 season-wrap er ikke primary når den slet ikke er synlig (uanset de andre inputs)", () => {
  for (const firstRaceMomentActive of BOOL) {
    for (const squadCtaEligible of BOOL) {
      const result = computeDashboardGoldCta({
        firstRaceMomentActive,
        squadCtaEligible,
        seasonWrapVisible: false,
      });
      assert.equal(result.seasonWrapPrimary, false);
    }
  }
});

test("#3509 falsy/undefined inputs behandles som false (ingen krasj, ingen falsk positiv)", () => {
  const result = computeDashboardGoldCta({});
  assert.equal(result.firstRaceMoment, false);
  assert.equal(result.squadCtaActive, false);
  assert.equal(result.seasonWrapPrimary, false);
});
