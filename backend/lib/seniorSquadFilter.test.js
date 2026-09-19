// Tests for seniortruppens ÉNE prædikat (#4619, spec §5.1):
// squads.applySeniorSquadFilter (SQL) + squads.isSeniorSquadRider (JS), og
// riderEligibility's to konsumenter af dem.
//
// DET DER SKAL BEVISES HER
// Prædikatet skal opfylde TO krav på én gang, og det er hele grunden til at det
// spørger på BEGGE kolonner i stedet for bare `squad = 'senior'`:
//
//   1) I DAG, før backfill'en af `riders.squad` (ejer-gated, ikke kørt):
//      bit-identisk med det gamle `is_academy = false`. Migrationen gav ALLE
//      rækker `squad = 'senior'` via kolonnens DEFAULT, så en stor del af
//      bestanden står som akademiryttere MED squad='senior'. Et naivt skifte til
//      `.eq("squad","senior")` alene ville lukke netop dem ind i seniortruppen,
//      seniorløbene og markedet — en live-regression i samme klasse som
//      #1307/#1308 (264 akademiryttere auto-udtaget), bare den anden vej.
//
//   2) EFTER backfill: korrekt. En ungdomsrytter har da squad <> 'senior' og
//      fanges af trup-leddet uanset hvad is_academy siger.
//
// De fire rækketyper nedenfor er præcis de former der findes i prod i dag plus
// den form backfill'en skaber. Ingen tal fra prod i denne fil (repoet er
// offentligt, hard rule 17) — formerne er det der betyder noget, ikke antallet.

import test from "node:test";
import assert from "node:assert/strict";

import { applySeniorSquadFilter, isSeniorSquadRider, SENIOR_SQUAD_COLUMNS } from "./squads.js";
import { applyRosterVisibilityFilter, applyRiderEligibilityFilter, isEligibleRider } from "./riderEligibility.js";

// De rækketyper prædikatet skal kunne skelne. `expected` = hører han til
// seniortruppen?
const ROW_TYPES = [
  {
    name: "senior i dag (squad=senior, is_academy=false)",
    row: { squad: "senior", is_academy: false },
    expected: true,
  },
  {
    name: "akademirytter FØR backfill (squad=senior via DEFAULT, is_academy=true)",
    row: { squad: "senior", is_academy: true },
    expected: false,
  },
  {
    name: "junior (squad=junior, is_academy=true)",
    row: { squad: "junior", is_academy: true },
    expected: false,
  },
  {
    name: "u23 (squad=u23, is_academy=true)",
    row: { squad: "u23", is_academy: true },
    expected: false,
  },
];

// Formen backfill'en skaber, og formen en INKONSISTENT skrivning ville skabe.
const POST_BACKFILL_ROWS = [
  {
    name: "u23 efter en skrivning der glemte is_academy (squad=u23, is_academy=false)",
    row: { squad: "u23", is_academy: false },
    expected: false,
  },
  {
    name: "junior efter en skrivning der glemte is_academy",
    row: { squad: "junior", is_academy: false },
    expected: false,
  },
];

test("isSeniorSquadRider: de fire rækketyper der findes i dag", () => {
  for (const { name, row, expected } of ROW_TYPES) {
    assert.equal(isSeniorSquadRider(row), expected, name);
  }
});

test("isSeniorSquadRider er BIT-IDENTISK med det gamle is_academy-prædikat paa dagens data", () => {
  // Dagens data = hver eneste raekke har squad='senior' (kolonnens DEFAULT,
  // backfill ikke koert). Paa netop de raekker SKAL det nye praedikat give
  // praecis samme svar som det gamle `is_academy === false`.
  for (const is_academy of [true, false]) {
    const row = { squad: "senior", is_academy };
    assert.equal(
      isSeniorSquadRider(row),
      is_academy === false,
      `squad=senior, is_academy=${is_academy}: nyt praedikat skal matche det gamle`
    );
  }
});

test("isSeniorSquadRider bliver KORREKT efter backfill, ogsaa ved uenige kolonner", () => {
  for (const { name, row, expected } of POST_BACKFILL_ROWS) {
    assert.equal(isSeniorSquadRider(row), expected, name);
  }
});

test("isSeniorSquadRider: manglende squad i projektionen falder tilbage paa is_academy", () => {
  // Et kaldsted der glemmer at selecte `squad` maa ALDRIG kunne goere en
  // almindelig seniorrytter usynlig — det ville toemme startfelter. Uden
  // squad-kolonnen svarer praedikatet praecis som i dag.
  assert.equal(isSeniorSquadRider({ is_academy: false }), true);
  assert.equal(isSeniorSquadRider({ is_academy: true }), false);
  assert.equal(isSeniorSquadRider({ squad: undefined, is_academy: false }), true);
  assert.equal(isSeniorSquadRider(null), false);
  assert.equal(isSeniorSquadRider(undefined), false);
});

test("SENIOR_SQUAD_COLUMNS naevner begge kolonner praedikatet laeser", () => {
  assert.deepEqual([...SENIOR_SQUAD_COLUMNS].sort(), ["is_academy", "squad"]);
  assert.ok(Object.isFrozen(SENIOR_SQUAD_COLUMNS));
});

// ── SQL-siden ────────────────────────────────────────────────────────────────

// Minimal query-optager: registrerer hvert kaedet led, saa vi kan assertere paa
// det praecise filter der sendes til PostgREST (samme moenster som de oevrige
// filter-tests i backend/lib).
function recordingQuery() {
  const calls = [];
  const q = {
    calls,
    eq(col, val) { calls.push(["eq", col, val]); return q; },
    or(expr) { calls.push(["or", expr]); return q; },
    is(col, val) { calls.push(["is", col, val]); return q; },
  };
  return q;
}

test("applySeniorSquadFilter kraever BEGGE kolonner", () => {
  const q = recordingQuery();
  const out = applySeniorSquadFilter(q);
  assert.equal(out, q, "returnerer samme query saa den kan kaedes videre");
  assert.deepEqual(q.calls, [
    ["eq", "squad", "senior"],
    ["eq", "is_academy", false],
  ]);
});

test("applySeniorSquadFilter beholder det gamle is_academy-led (bit-identitet i overgangsperioden)", () => {
  // Fjernes dette led foer backfill'en er koert og verificeret, aabner filteret
  // for hele den gruppe der staar som akademiryttere med squad='senior'.
  const q = recordingQuery();
  applySeniorSquadFilter(q);
  assert.ok(
    q.calls.some(([op, col, val]) => op === "eq" && col === "is_academy" && val === false),
    "is_academy-leddet maa ikke fjernes foer backfill er koert"
  );
});

test("applyRosterVisibilityFilter: trup-led + pensionerings-led, intet andet", () => {
  const q = recordingQuery();
  applyRosterVisibilityFilter(q);
  assert.deepEqual(q.calls, [
    ["eq", "squad", "senior"],
    ["eq", "is_academy", false],
    ["or", "is_retired.is.null,is_retired.eq.false"],
  ]);
});

test("applyRiderEligibilityFilter: synlighedsfilteret PLUS pending_team_id", () => {
  const q = recordingQuery();
  applyRiderEligibilityFilter(q);
  assert.deepEqual(q.calls, [
    ["eq", "squad", "senior"],
    ["eq", "is_academy", false],
    ["or", "is_retired.is.null,is_retired.eq.false"],
    ["is", "pending_team_id", null],
  ]);
});

// ── JS-siden i løbs-stierne ──────────────────────────────────────────────────

test("isEligibleRider afviser ungdomstrupper og accepterer seniortruppen", () => {
  const teamId = "team-a";
  for (const { name, row, expected } of [...ROW_TYPES, ...POST_BACKFILL_ROWS]) {
    assert.equal(
      isEligibleRider({ ...row, team_id: teamId, is_retired: false }, { teamId }),
      expected,
      name
    );
  }
});

test("isEligibleRider: trup-leddet aendrer ikke de oevrige gates", () => {
  const teamId = "team-a";
  const senior = { squad: "senior", is_academy: false, team_id: teamId, is_retired: false };
  assert.equal(isEligibleRider(senior, { teamId }), true);
  assert.equal(isEligibleRider({ ...senior, is_retired: true }, { teamId }), false, "pensioneret falder stadig ud");
  assert.equal(isEligibleRider({ ...senior, team_id: "team-b" }, { teamId }), false, "andet hold falder stadig ud");
  assert.equal(isEligibleRider(senior, {}), true, "uden teamId tjekkes kun status");
  assert.equal(isEligibleRider(null, { teamId }), false);
});
