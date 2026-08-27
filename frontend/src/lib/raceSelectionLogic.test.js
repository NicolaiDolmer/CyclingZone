import test from "node:test";
import assert from "node:assert/strict";
import { toggleRider, validateSelectionClient, pickFallbackCaptain } from "./raceSelectionLogic.js";

test("toggleRider: tilføjer/fjerner og respekterer max + rydder roller for fjernet rytter", () => {
  const s0 = { riderIds: [], captainId: null, sprintCaptainId: null, hunterId: null };
  const s1 = toggleRider(s0, "a", 8);
  assert.deepEqual(s1.riderIds, ["a"]);
  const s2 = toggleRider({ ...s1, captainId: "a" }, "a", 8);
  assert.deepEqual(s2.riderIds, []);
  assert.equal(s2.captainId, null, "rolle ryddes når rytteren fravælges");
  const full = { riderIds: ["a", "b", "c", "d", "e", "f", "g", "h"], captainId: "a", sprintCaptainId: null, hunterId: null };
  assert.equal(toggleRider(full, "i", 8), full, "max nået → uændret state");
});

// #4295: klienten må ALDRIG afvise et gem serveren accepterer. Backendens
// validateSelection (backend/lib/raceSelection.js:25) afviser kun `riderIds.length >
// sizeRule.max` — der er intet minimum nogen steder i gem-stien. Disse tests er
// kontrakten mod den regel.
test("validateSelectionClient: ANTAL blokerer kun opad (spejl af backend raceSelection.js:25)", () => {
  // Enhver trupstørrelse fra 1 til size.max er lovlig, i alle tre feltstørrelser.
  const alle = ["a", "b", "c", "d", "e", "f", "g", "h"];
  for (const max of [6, 7, 8]) {
    for (let antal = 1; antal <= max; antal++) {
      const ids = alle.slice(0, antal);
      assert.deepEqual(
        validateSelectionClient({ riderIds: ids, captainId: ids[0], sprintCaptainId: null, hunterId: null, size: { min: max, max } }),
        [],
        `${antal} af ${max} skal kunne gemmes`
      );
    }
    // Én over feltstørrelsen er den ENESTE antals-fejl der er tilbage.
    const forMange = alle.slice(0, max).concat("x");
    assert.ok(
      validateSelectionClient({ riderIds: forMange, captainId: "a", sprintCaptainId: null, hunterId: null, size: { min: max, max } }).includes("selection_wrong_size"),
      `${max + 1} af ${max} skal afvises`
    );
  }
});

// #4295 (spiller-rapport 27/8, knud_r_flink: "I still cant save a team less than the
// total number of riders"): #4175's escape-ventil hvilede på `availableCount`, som er
// hele den raske trup og aldrig trækker bundne ryttere fra. Et hold med ryttere nok på
// papiret ramte derfor stadig blokeringen ved en FØRSTEGANGS-udtagelse (requireFull:
// !data.selection), altså præcis tilstanden efter "Ryd alt" eller en kalender-rebuild.
// Begge argumenter er væk. Denne test låser at de ikke kan snige sig ind igen.
test("validateSelectionClient: #4295 gamle requireFull/availableCount-argumenter kan ikke blokere", () => {
  const delvis = {
    riderIds: ["a", "b", "c", "d"], captainId: "a", sprintCaptainId: null, hunterId: null,
    size: { min: 7, max: 7 },
  };
  // Præcis spillerens case: 4 valgte til et 7-mands felt, 29 ryttere i truppen, ingen
  // gemt udtagelse endnu. Skal kunne gemmes.
  assert.deepEqual(validateSelectionClient(delvis), [], "delvis trup ved førstegangs-udtagelse er lovlig");
  // Sendes de gamle argumenter alligevel (gammel kalder, uopdateret test), ignoreres de.
  assert.deepEqual(
    validateSelectionClient({ ...delvis, availableCount: 29, requireFull: true }),
    [],
    "requireFull/availableCount må ALDRIG genindføre en antals-blokering"
  );
});

test("validateSelectionClient: kaptajn og rolle-overlap er uændret", () => {
  const fuld = { riderIds: ["a","b","c","d","e","f","g","h"], size: { min: 6, max: 8 } };
  assert.ok(validateSelectionClient({ ...fuld, captainId: null, sprintCaptainId: null, hunterId: null }).includes("selection_captain_required"));
  assert.ok(validateSelectionClient({ ...fuld, captainId: "a", sprintCaptainId: "a", hunterId: null }).includes("selection_role_overlap"));
  assert.ok(validateSelectionClient({ ...fuld, captainId: "a", sprintCaptainId: "b", hunterId: "b" }).includes("selection_role_overlap"));
  assert.deepEqual(validateSelectionClient({ ...fuld, captainId: "a", sprintCaptainId: "b", hunterId: "c" }), []);
});

// #4295: `selection_insufficient_riders` er slettet fra begge locales i samme PR. Ingen
// kodesti udsender den længere, så en assert på at den ikke dukker op igen holder
// i18n-nøglen og koden i takt.
test("validateSelectionClient: selection_insufficient_riders udsendes aldrig", () => {
  for (const antal of [0, 1, 4, 7, 9]) {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].slice(0, antal);
    const fejl = validateSelectionClient({
      riderIds: ids, captainId: ids[0] ?? null, sprintCaptainId: null, hunterId: null,
      size: { min: 7, max: 7 },
    });
    assert.ok(!fejl.includes("selection_insufficient_riders"), `${antal} ryttere må ikke give en død fejlkode`);
  }
});

test("pickFallbackCaptain: vælger højest suitability, ekskl. sprint/jæger (#2028)", () => {
  const suit = { a: 40, b: 90, c: 70, d: 95 };
  const suitabilityOf = (id) => suit[id];
  // d højest (95) men er jæger → ekskluderes; b næsthøjest (90) bliver kaptajn.
  assert.equal(pickFallbackCaptain({ riderIds: ["a", "b", "c", "d"], sprintId: null, hunterId: "d", suitabilityOf }), "b");
});

test("pickFallbackCaptain: tiebreak rider_id asc ved lige suitability (deterministisk)", () => {
  assert.equal(pickFallbackCaptain({ riderIds: ["c", "a", "b"], suitabilityOf: () => 50 }), "a");
});

test("pickFallbackCaptain: alle kandidater har anden rolle → fald tilbage til hele feltet", () => {
  const suit = { a: 30, b: 80 };
  assert.equal(pickFallbackCaptain({ riderIds: ["a", "b"], sprintId: "a", hunterId: "b", suitabilityOf: (id) => suit[id] }), "b");
});

test("pickFallbackCaptain: tom trup → null; manglende suitability → deterministisk (id asc)", () => {
  assert.equal(pickFallbackCaptain({ riderIds: [], suitabilityOf: () => 0 }), null);
  assert.equal(pickFallbackCaptain({ riderIds: ["b", "a"], suitabilityOf: () => undefined }), "a");
});
