import { test } from "node:test";
import assert from "node:assert/strict";
import { POOL_ALL, matchesPoolTab } from "./standingsPoolFilter.js";

// #2879 — regression fra #2864: en <select>'s onChange giver poolTab som string
// ("7"), mens rowPoolId(s) er integer fra Supabase (league_divisions.id/
// team.league_division_id). Strict-equality mellem de to fejlede altid → pulje-
// fanen viste "No data" selvom vælgeren korrekt talte holdene i puljen.
// matchesPoolTab enhedstestes uafhængigt af React-renderet, så type-driften
// fanges igen hvis den sniger sig ind (fx en fremtidig refactor der genindfører
// en rå === -sammenligning et af de tre steder StandingsPage bruger denne).

function row(poolId) {
  return { team: { league_division_id: poolId } };
}

test("#2879 matchesPoolTab: string-poolTab fra <select> matcher integer rowPoolId", () => {
  // rowPoolId(s) === 7 (integer, som Supabase leverer), poolTab === "7" (string,
  // som e.target.value altid giver) — dette er PRÆCIS den bug der gjorde puljefanen tom.
  assert.equal(matchesPoolTab(7, "7", true), true);
  assert.equal(matchesPoolTab(7, 7, true), true); // også robust hvis poolTab nogensinde er numerisk
});

test("#2879 matchesPoolTab: forskellig pulje filtreres fra uanset type", () => {
  assert.equal(matchesPoolTab(7, "8", true), false);
  assert.equal(matchesPoolTab(7, 8, true), false);
});

test("#2879 matchesPoolTab: POOL_ALL viser alt uanset hasPoolSubtabs", () => {
  assert.equal(matchesPoolTab(7, POOL_ALL, true), true);
  assert.equal(matchesPoolTab(null, POOL_ALL, true), true);
});

test("#2879 matchesPoolTab: uden pulje-sub-faner (hasPoolSubtabs=false) filtreres der aldrig", () => {
  // Tieren har kun én pulje — poolTab er irrelevant, alle rækker skal med.
  assert.equal(matchesPoolTab(7, "anything-else", false), true);
});

test("#2879 forward-guard: filtrering af en fuld rækkeliste giver ikke-tom resultat for den valgte pulje", () => {
  // Reproducerer StandingsPage's divStandingsBase-filter (fane-valg fra en ægte
  // <select>, altså string poolTab) mod en blandet rækkeliste på tværs af puljer.
  const standings = [row(7), row(7), row(8), row(9), row(7)];
  const poolTabFromSelect = "7"; // e.target.value
  const filtered = standings.filter(
    (s) => matchesPoolTab(s.team.league_division_id, poolTabFromSelect, true),
  );
  assert.equal(filtered.length, 3, "puljen med 3 hold skal IKKE filtreres til tom — det var #2879-bugget");
});
