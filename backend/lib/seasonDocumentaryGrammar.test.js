import test from "node:test";
import assert from "node:assert/strict";
import { buildSeasonDocumentary, buildSeasonDocumentaryParagraphs, __internal } from "./seasonDocumentaryGrammar.js";

const FULL_FACTS = {
  signings: [
    { amount: 452739, riderName: "Jack Holland", source: "auction" },
    { amount: 404612, riderName: "Yassine Benali", source: "auction" },
  ],
  biggestResult: {
    rider_name: "Yassine Benali",
    race_name: "Tour du Golfe",
    result_type: "gc",
    stage_number: 5,
    rank: 1,
  },
  bestRaceDay: { race_name: "Tour Arctique", total_points: 920, riders_scoring: 6 },
  rival: { team_name: "L'Échappée du Soleil", total_points: 16629, gap: 18, rank_in_division: 2, league_division_id: 5 },
  myStanding: { division: 3, league_division_id: 5, rank_in_division: 1, total_points: 16647, races_completed: 46, stage_wins: 10, gc_wins: 20 },
};

const CTX = { teamId: "8073fb4a-aee0-4d87-a90d-9472bd72c9fc", teamName: "Équipe Lorraine Acier", seasonNumber: 1 };

test("buildSeasonDocumentary is a pure function — same input, same output (idempotent regen)", () => {
  const a = buildSeasonDocumentary(FULL_FACTS, CTX);
  const b = buildSeasonDocumentary(FULL_FACTS, CTX);
  assert.deepEqual(a, b);
});

test("produces both languages, 5 non-empty paragraphs each", () => {
  const doc = buildSeasonDocumentary(FULL_FACTS, CTX);
  for (const lang of ["en", "da"]) {
    assert.equal(doc[lang].length, 5);
    for (const p of doc[lang]) {
      assert.equal(typeof p, "string");
      assert.ok(p.length > 0);
    }
  }
});

test("every stated fact traces back to the facts object (hallucination guard, coarse)", () => {
  const doc = buildSeasonDocumentaryParagraphs(FULL_FACTS, CTX, "en");
  const joined = doc.join(" ");
  assert.ok(joined.includes("Yassine Benali"));
  assert.ok(joined.includes("Tour du Golfe"));
  assert.ok(joined.includes("Tour Arctique"));
  assert.ok(joined.includes("L'Échappée du Soleil") || joined.includes("L’Échappée du Soleil"));
});

test("signing that also delivered the biggest result gets the payoff callback", () => {
  const doc = buildSeasonDocumentaryParagraphs(FULL_FACTS, CTX, "en");
  assert.match(doc[2], /paid off/i);
});

test("all fields empty/null still renders 4 non-empty fallback paragraphs, rival left out (v1 must always work alone)", () => {
  const emptyFacts = { signings: [], biggestResult: null, bestRaceDay: null, rival: null, myStanding: null };
  for (const lang of ["en", "da"]) {
    const doc = buildSeasonDocumentaryParagraphs(emptyFacts, CTX, lang);
    assert.equal(doc.length, 4);
    for (const p of doc) assert.ok(p.length > 0);
  }
});

test("same team+season always picks the same phrasing variant (deterministic, not random)", () => {
  const doc1 = buildSeasonDocumentaryParagraphs(FULL_FACTS, CTX, "en");
  const doc2 = buildSeasonDocumentaryParagraphs(FULL_FACTS, CTX, "en");
  assert.deepEqual(doc1, doc2);
});

test("teams commonly get different phrasing variants across the population (texture, not a single hardcoded template)", () => {
  const docA = buildSeasonDocumentaryParagraphs(FULL_FACTS, CTX, "en");
  // Sample several arbitrary team_ids — with 5 independent 2-way coin-flip
  // sections, SOME of these should land on a different combination than CTX
  // (a single fixed pair can coincidentally match on all 5, see #3402 fix-up).
  const sampleIds = Array.from({ length: 12 }, (_, i) => `00000000-0000-0000-0000-00000000${String(i).padStart(4, "0")}`);
  const anyDifferent = sampleIds.some((teamId) => {
    const doc = buildSeasonDocumentaryParagraphs(FULL_FACTS, { ...CTX, teamId }, "en");
    return JSON.stringify(doc) !== JSON.stringify(docA);
  });
  assert.ok(anyDifferent, "expected at least one sampled team_id to produce different phrasing than CTX");
});

test("formatAmount/formatNumber use locale-appropriate thousands separators", () => {
  assert.equal(__internal.formatAmount(452739, "en"), "452,739 CZ$");
  assert.equal(__internal.formatAmount(452739, "da"), "452.739 CZ$");
  assert.equal(__internal.formatNumber(16647, "en"), "16,647");
  assert.equal(__internal.formatNumber(16647, "da"), "16.647");
});

test("ordinal formats EN as 1st/2nd/3rd and DA as 1./2./3.", () => {
  assert.equal(__internal.ordinal(1, "en"), "1st");
  assert.equal(__internal.ordinal(2, "en"), "2nd");
  assert.equal(__internal.ordinal(3, "en"), "3rd");
  assert.equal(__internal.ordinal(11, "en"), "11th");
  assert.equal(__internal.ordinal(1, "da"), "1.");
});

test("no-signings team gets the fallback signings sentence, not an undefined-name sentence", () => {
  const noSignings = { ...FULL_FACTS, signings: [] };
  const doc = buildSeasonDocumentaryParagraphs(noSignings, CTX, "en");
  assert.match(doc[1], /No marquee signings/i);
  assert.ok(!doc[1].includes("undefined"));
});

// ── #8361: rivalen er en reel nabo i egen pulje, og teksten holder tonen ─────────

const POOL = 7;
const OTHER_POOL = 8;
const ME = { division: 2, league_division_id: POOL, rank_in_division: 2, total_points: 5000, races_completed: 40 };

function rivalParagraph(rival, lang = "en", standing = ME, ctx = CTX) {
  const doc = buildSeasonDocumentaryParagraphs({ ...FULL_FACTS, myStanding: standing, rival }, ctx, lang);
  return { doc, rivalText: doc.length === 5 ? doc[4] : null };
}

test("#8361: a rival from another pool in the same division is left out, not named", () => {
  // Fejlen fra prod: et hold fra en anden pulje med flere point blev kaldt rivalen.
  const crossPool = { team_name: "Hold Fra Anden Pulje", total_points: 5097, rank_in_division: 3, league_division_id: OTHER_POOL };
  for (const lang of ["en", "da"]) {
    const { doc, rivalText } = rivalParagraph(crossPool, lang);
    assert.equal(doc.length, 4, "rival-afsnittet udelades");
    assert.equal(rivalText, null);
    assert.ok(!doc.join(" ").includes("Hold Fra Anden Pulje"));
  }
});

test("#8361: a same-pool rival that is not directly above or below is left out", () => {
  const farAway = { team_name: "Hold C", total_points: 4100, rank_in_division: 4, league_division_id: POOL };
  assert.equal(rivalParagraph(farAway).rivalText, null);
});

test("#8361: facts without a pool on the rival (generated before the migration) give no rival sentence", () => {
  const legacy = { team_name: "Hold C", total_points: 4990, rank_in_division: 3, gap: 10 };
  assert.equal(rivalParagraph(legacy).rivalText, null);
});

test("#8361: a team without a pool gets no rival sentence", () => {
  const noPool = { ...ME, league_division_id: null };
  const rival = { team_name: "Hold C", total_points: 4990, rank_in_division: 3, league_division_id: null };
  assert.equal(rivalParagraph(rival, "en", noPool).rivalText, null);
});

test("#8361: the neighbour directly below is named with the correct direction and gap, on both languages", () => {
  const below = { team_name: "Hold B", total_points: 4903, rank_in_division: 3, league_division_id: POOL };
  for (const teamId of ["a", "b", "c", "d", "e", "f"]) {
    const ctx = { ...CTX, teamId };
    const en = rivalParagraph(below, "en", ME, ctx).rivalText;
    const da = rivalParagraph(below, "da", ME, ctx).rivalText;
    assert.ok(en.includes("Hold B") && da.includes("Hold B"));
    assert.match(en, /behind/);
    assert.match(en, /97/);
    assert.match(da, /bagved/);
    assert.match(da, /97/);
    assert.doesNotMatch(en, /ahead/);
    assert.doesNotMatch(da, /foran/);
  }
});

test("#8361: the neighbour directly above is named as ahead, never as chasing", () => {
  const above = { team_name: "Hold A", total_points: 5097, rank_in_division: 1, league_division_id: POOL };
  for (const teamId of ["a", "b", "c", "d", "e", "f"]) {
    const ctx = { ...CTX, teamId };
    const en = rivalParagraph(above, "en", ME, ctx).rivalText;
    const da = rivalParagraph(above, "da", ME, ctx).rivalText;
    assert.match(en, /ahead/);
    assert.match(da, /foran/);
    assert.doesNotMatch(en, /heels|behind/);
    assert.doesNotMatch(da, /hælene|bagved|nakken/);
  }
});

test("#8361: equal points read as level, not as zero points ahead", () => {
  const level = { team_name: "Hold B", total_points: 5000, rank_in_division: 3, league_division_id: POOL };
  assert.match(rivalParagraph(level, "en").rivalText, /level on points/);
  assert.match(rivalParagraph(level, "da").rivalText, /samme pointtal/);
});

test("#8361: a top result that was not a win is written as a placing, never as a win", () => {
  const placing = { ...FULL_FACTS.biggestResult, result_type: "gc", rank: 3 };
  for (const teamId of ["a", "b", "c", "d"]) {
    const ctx = { ...CTX, teamId };
    const en = buildSeasonDocumentaryParagraphs({ ...FULL_FACTS, biggestResult: placing }, ctx, "en")[2];
    const da = buildSeasonDocumentaryParagraphs({ ...FULL_FACTS, biggestResult: placing }, ctx, "da")[2];
    assert.match(en, /finished 3rd overall/);
    assert.match(da, /blev nummer 3 sammenlagt/);
    assert.doesNotMatch(en, /\bwon\b|paid off/);
    assert.doesNotMatch(da, /vandt|betalte sig/);
  }
});

test("#8361: a team classification result names the team, not a missing rider", () => {
  const teamResult = { race_name: "Tour Arctique", result_type: "team", rank: 1, rider_name: null };
  const en = buildSeasonDocumentaryParagraphs({ ...FULL_FACTS, biggestResult: teamResult }, CTX, "en")[2];
  assert.ok(en.includes(CTX.teamName));
  assert.ok(!en.includes("null") && !en.includes("undefined"));
});

// Alle varianter og alle grene: ingen lang tankestreg nogen steder, og ingen
// engelske låneord i den danske tekst (docs/TONE_OF_VOICE.md).
const TONE_CASES = [
  FULL_FACTS,
  { signings: [], biggestResult: null, bestRaceDay: null, rival: null, myStanding: null },
  { ...FULL_FACTS, signings: [FULL_FACTS.signings[0]] },
  { ...FULL_FACTS, signings: [{ ...FULL_FACTS.signings[0], source: "transfer" }] },
  { ...FULL_FACTS, biggestResult: { ...FULL_FACTS.biggestResult, result_type: "stage", rank: 4 } },
  { ...FULL_FACTS, myStanding: ME, rival: { team_name: "Hold A", total_points: 5097, rank_in_division: 1, league_division_id: POOL } },
  { ...FULL_FACTS, myStanding: ME, rival: { team_name: "Hold B", total_points: 4903, rank_in_division: 3, league_division_id: POOL } },
  { ...FULL_FACTS, myStanding: ME, rival: { team_name: "Hold B", total_points: 5000, rank_in_division: 3, league_division_id: POOL } },
];
const SAMPLE_TEAM_IDS = Array.from({ length: 24 }, (_, i) => `team-${i}`);

test("#8361: no long dash in any paragraph, in any variant, on either language", () => {
  for (const facts of TONE_CASES) {
    for (const teamId of SAMPLE_TEAM_IDS) {
      for (const ctx of [{ ...CTX, teamId }, { teamId, seasonNumber: 4 }]) {
        const doc = buildSeasonDocumentary(facts, ctx);
        for (const p of [...doc.en, ...doc.da]) {
          assert.doesNotMatch(p, /[—–]/, `tankestreg i: ${p}`);
        }
      }
    }
  }
});

test("#8361: the Danish text has no English loanwords from the old draft", () => {
  for (const facts of TONE_CASES) {
    for (const teamId of SAMPLE_TEAM_IDS) {
      const da = buildSeasonDocumentaryParagraphs(facts, { ...CTX, teamId }, "da").join(" ");
      assert.doesNotMatch(da, /\bsigning|\bmarquee|\brival(?:ry|ries)\b|\bgrind\b/i, da);
    }
  }
});
