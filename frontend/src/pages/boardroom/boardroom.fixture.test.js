import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #4557 · Fixturen skal matche /api/board/room-kontrakten 1:1 (issue-prompten)
// og baere mockup'ens eksempeldata (Ellen Kjær, 71 confidence, 4 mål osv.).
// Ægte assertions mod parset JSON — repoet kører node --test uden DOM-renderer,
// saa dette er den reelle datakontrakt-verifikation for slicen.

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(__dirname, "__fixtures__", "boardRoom.json"), "utf8"));

test("#4557 fixture: top-level kontraktform", () => {
  assert.equal(fixture.enabled, true);
  assert.ok(fixture.team);
  assert.ok(fixture.confidence);
  assert.ok(fixture.mandate);
  assert.ok(fixture.vision);
  assert.ok(fixture.board);
  assert.ok(Array.isArray(fixture.minutes));
});

test("#4570-afstemning: team.dnaKey og vision.titleKey peger på gyldige dna-nøgler", () => {
  const validDnaKeys = ["skandinavisk_udvikling", "italiensk_klassiker", "sprint_kommerciel", "fransk_klatrer", "britisk_allrounder"];
  assert.ok(validDnaKeys.includes(fixture.team.dnaKey), "team.dnaKey skal matche en kendt DNA-nøgle");
  assert.equal(fixture.vision.titleKey, `vision.title.${fixture.team.dnaKey}`);
});

test("#4557 fixture: confidence matcher mockup'ens nøgletal (71, 4 kategorier)", () => {
  assert.equal(fixture.confidence.value, 71);
  assert.equal(fixture.confidence.weekDelta, 3);
  assert.ok(fixture.confidence.updatedAt);
  const keys = fixture.confidence.categories.map((c) => c.key).sort();
  assert.deepEqual(keys, ["economy", "identity", "ranking", "results"]);
  for (const cat of fixture.confidence.categories) {
    assert.ok(Number.isFinite(cat.score), `category ${cat.key} skal have et numerisk score`);
  }
  assert.equal(typeof fixture.confidence.consequence.active, "boolean");
});

test("#4557 fixture: mandate har 4 mål med fuld receipt-kvittering (spec-princip 2)", () => {
  assert.equal(fixture.mandate.seasonNumber, 3);
  assert.ok(fixture.mandate.signedAt);
  assert.equal(fixture.mandate.goals.length, 4);
  for (const goal of fixture.mandate.goals) {
    assert.ok(goal.id, "hvert mål skal have et id");
    // #4570-afstemning: titlen resolves via type (den type-styrede resolver)
    // ELLER labelKey (fallback) — mindst ét af de to skal være sat, aldrig ingen.
    assert.ok(goal.type != null || goal.labelKey != null, "hvert mål skal have enten type eller labelKey (mål-titel-resolveren kræver mindst ét)");
    assert.ok(goal.achievedDisplay != null, "achievedDisplay skal være sat");
    assert.ok(goal.targetDisplay != null, "targetDisplay skal være sat");
    assert.ok(["on_track", "at_risk", "behind", "achieved", "failed"].includes(goal.status));
    assert.ok(goal.owner?.initials, "hvert mål skal have en ejer med initialer");
    assert.ok(goal.receipt, "hvert mål i fixturen bærer en kvittering (spec-princip 2)");
    // #4570-afstemning: backend kan endnu ikke levere "Last movement" — fixturen
    // afspejler den nuværende backend-begrænsning eksplicit (aldrig en halv kvittering).
    assert.equal(goal.receipt.lastMovementAt, null, "lastMovementAt skal være null indtil backend leverer den");
    assert.equal(goal.receipt.lastMovementKey, null);
  }
  const typedGoals = fixture.mandate.goals.filter((g) => g.type != null);
  const fallbackGoals = fixture.mandate.goals.filter((g) => g.type == null);
  assert.ok(typedGoals.length > 0, "fixturen skal øve type-styret titel-resolution (mindst ét mål)");
  assert.ok(fallbackGoals.length > 0, "fixturen skal øve labelKey-fallback-stien (mindst ét mål uden type)");
  for (const g of fallbackGoals) assert.ok(g.labelKey, "et mål uden type SKAL have labelKey som fallback");
  const stretchGoal = fixture.mandate.goals.find((g) => g.isStretch);
  assert.ok(stretchGoal, "fixturen skal indeholde mindst ét Stretch-mål (mockup-parity)");
});

test("#4557 fixture: vision har 4 milepæle, netop én markeret som current", () => {
  assert.equal(fixture.vision.startSeason, 3);
  assert.equal(fixture.vision.endSeason, 6);
  assert.equal(fixture.vision.milestones.length, 4);
  const current = fixture.vision.milestones.filter((m) => m.isCurrentSeason);
  assert.equal(current.length, 1, "netop ét milepæl skal være markeret som indeværende sæson");
  assert.equal(current[0].status, "current");
});

test("#4557 fixture: board har 5 medlemmer, netop én chair, chairmanQuote sat", () => {
  assert.equal(fixture.board.members.length, 5);
  const chairs = fixture.board.members.filter((m) => m.role === "chair");
  assert.equal(chairs.length, 1);
  assert.equal(chairs[0].name, "Ellen Kjær");
  for (const member of fixture.board.members) {
    assert.ok(member.archetypeKey);
    assert.ok(member.initials);
    assert.ok(["positive", "neutral", "negative"].includes(member.mood));
  }
  assert.ok(fixture.board.chairmanQuote?.textKey);
  assert.equal(fixture.board.chairmanQuote.memberName, "Ellen Kjær");
  // #4570-afstemning: sinceSeason er et OPTIONELT felt — fixturen skal øve
  // BEGGE stier (sat for nogle medlemmer, fraværende for mindst ét).
  const withSince = fixture.board.members.filter((m) => m.sinceSeason != null);
  const withoutSince = fixture.board.members.filter((m) => m.sinceSeason == null);
  assert.ok(withSince.length > 0, "mindst ét medlem skal have sinceSeason sat");
  assert.ok(withoutSince.length > 0, "mindst ét medlem skal MANGLE sinceSeason (øver udeladt-linje-stien)");
});

test("#4557 fixture: minutes-feed rækker bærer delta + textKey + attribution", () => {
  assert.ok(fixture.minutes.length >= 3);
  for (const m of fixture.minutes) {
    assert.ok(m.id);
    assert.ok(Number.isFinite(m.delta));
    assert.ok(m.textKey);
    assert.ok(m.memberName);
    assert.ok(m.occurredAt);
  }
  // MemberPanel's "in his own words" skal kunne udlede mindst 2 citater for
  // Jørgen Brandt fra det delte feed (mockup-parity, Member.dc.html).
  const jbQuotes = fixture.minutes.filter((m) => m.memberName === "Jørgen Brandt");
  assert.ok(jbQuotes.length >= 2);
});
