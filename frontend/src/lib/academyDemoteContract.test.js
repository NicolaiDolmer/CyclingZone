// #4582 — demote-modalens paastand skal folge motoren, ikke en kopi.
//
// Soesterfil til academyPromoteContract.test.js (#3620), for den anden retning.
// Baggrunden er den samme fejlklasse, men et trin vaerre: backend holdt allerede
// op med at genberegne loennen ved demote (#4589), mens bekraeftelses-dialogen
// blev staaende med etiketten "Youth salary" over det UAENDREDE tal og en
// "Current salary"-raekke med praecis samme tal under. Rettelsen var usynlig
// netop dér hvor de 3 spillere (1/9) meldte tvivlen: i sekundet foer et
// irreversibelt klik.
//
// Forskellen fra promote-siden: promote udleder flaget frontend-side
// (keepsExistingContractOnPromote), fordi den har rytteren i hoenden. Demote kan
// IKKE det — dialogens rider-objekt kommer fra den side der aabnede den, og
// praecis dét var #3784's rod-aarsag (RiderStatsPage SELECTer aldrig
// current_production_value). Derfor er sandheden her backendens `keepsContract`
// fra academy-demote-quote. Testen pinner frontendens paastand mod backendens
// EGEN praedikat, saa vi ikke faar en frontend-kopi af reglen tilbage ad bagdoeren.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { hasCompleteContract, resolveDemoteSalary, demoteSalary } from "../../../backend/lib/academyTransfer.js";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(dir, p), "utf8");

// Rytter-former der daekker kombinationerne af de tre felter praedikatet ser paa.
// current_production_value er med overalt, saa demoteSalary() har noget at regne
// paa i de grene hvor en frisk akademi-loen faktisk beregnes.
const SHAPES = [
  { label: "komplet kontrakt", rider: { salary: 17000, contract_length: 3, contract_end_season: 5, current_production_value: 63000 } },
  { label: "loen sat, udloeb null", rider: { salary: 17000, contract_length: 3, contract_end_season: null, current_production_value: 63000 } },
  { label: "loen sat, laengde null", rider: { salary: 17000, contract_length: null, contract_end_season: 5, current_production_value: 63000 } },
  { label: "reelt kontraktloes", rider: { salary: null, contract_length: null, contract_end_season: null, current_production_value: 63000 } },
  { label: "loen 0 (gratis-kontrakt)", rider: { salary: 0, contract_length: 3, contract_end_season: 5, current_production_value: 63000 } },
];

// Kernen: flaget dialogen viser SKAL betyde praecis "loennen genberegnes ikke".
// Er de to ude af trit, lover dialogen enten en arv der ikke sker, eller
// fortier en der goer.
for (const { label, rider } of SHAPES) {
  test(`keepsContract betyder praecis "ingen genberegning": ${label}`, () => {
    const keeps = hasCompleteContract(rider);
    const resolved = resolveDemoteSalary(rider);
    if (keeps) {
      assert.equal(resolved, rider.salary, `${label}: flaget siger arv, men loennen blev aendret`);
    } else {
      assert.equal(resolved, demoteSalary(rider), `${label}: flaget siger ny beregning, men loennen blev arvet`);
    }
  });
}

test("en rytter uden felterne behandles som kontraktloes", () => {
  assert.equal(hasCompleteContract({}), false);
  assert.equal(hasCompleteContract(), false);
});

// #4589's rapporterede tal: en spirende ung rytter hvis produktions-afledte loen
// ligger OVER hans frosne kontrakt-loen. Uden arven stiger loennen ved en
// flytning NED i akademiet — det var hele bugget.
test("den rapporterede 17k->22k-sag: arven forhindrer stigningen", () => {
  const rider = { salary: 17000, contract_length: 3, contract_end_season: 5, current_production_value: 63000 };
  assert.ok(
    demoteSalary(rider) > rider.salary,
    "fixturen skal reproducere den situation hvor genberegning ville HAEVE loennen",
  );
  assert.equal(resolveDemoteSalary(rider), 17000);
  assert.equal(hasCompleteContract(rider), true, "dialogen skal kunne sige at kontrakten foelger med");
});

// Kilde-parity: reglen maa ikke faa en frontend-kopi. Baade quote-routen og
// begge demote-flader skal baere backendens flag videre uden at regne selv.
test("quote-routen sender backendens eget praedikat med", () => {
  const api = read("../../../backend/routes/api.js");
  assert.match(api, /keepsContract:\s*hasCompleteContract\(rider\)/, "academy-demote-quote skal sende keepsContract fra hasCompleteContract");
});

test("begge demote-flader giver modalen flaget fra quoten", () => {
  const teamPage = read("../pages/TeamPage.jsx");
  const riderActions = read("../components/rider/RiderManageActions.jsx");
  for (const [name, src] of [["TeamPage", teamPage], ["RiderManageActions", riderActions]]) {
    assert.match(src, /keepsContract:\s*quote\?\.keepsContract/, `${name} skal laese flaget fra quoten, ikke regne selv`);
  }
  // Frontend maa ALDRIG udlede arven ved at sammenligne de to loen-tal: to ens
  // tal kan lige saa godt vaere et sammenfald (en kontraktloes rytter kan lande
  // paa sin gamle loen) som en arvet kontrakt.
  for (const [name, src] of [["TeamPage", teamPage], ["RiderManageActions", riderActions]]) {
    assert.doesNotMatch(
      src,
      /newSalary\s*===?\s*(quote\?\.)?currentSalary|currentSalary\s*===?\s*(quote\?\.)?newSalary/,
      `${name} maa ikke udlede kontrakt-arv af at de to loen-tal er ens`,
    );
  }
});

test("modalen vaelger demote-note og loen-etiket ud fra flaget", () => {
  const modal = read("../components/AcademyTransferConfirmModal.jsx");
  assert.match(modal, /keepsContractOnDemote/, "demote-grenen skal have sin egen afledte betingelse");
  assert.match(modal, /demoteNoteKeepsContract\b/, "den sande note for en bevaret kontrakt skal findes");
  assert.match(modal, /demoteNoteKeepsContractOngoing/, "#3805-aksen maa ikke tabes naar kontrakt-aksen tilfoejes");
  assert.match(modal, /unchangedSalaryLabel/, "etiketten maa ikke blive staaende paa 'ungdomsloen'");
});

test("begge sprog har de nye demote-tekster og ingen em-dash", () => {
  for (const lang of ["en", "da"]) {
    const json = JSON.parse(read(`../../public/locales/${lang}/academy.json`));
    const m = json.transferModal ?? {};
    const required = ["demoteNoteKeepsContract", "demoteNoteKeepsContractOngoing", "unchangedSalaryLabel"];
    for (const key of required) {
      const value = m[key];
      assert.ok(value, `${lang}: ${key} mangler`);
      assert.ok(!value.includes("—"), `${lang}: ${key} - em-dash er forbudt i brugervendt tekst`);
    }
    // Noterne for en bevaret kontrakt maa ikke tale om en ungdoms-/ny loen.
    for (const key of ["demoteNoteKeepsContract", "demoteNoteKeepsContractOngoing"]) {
      assert.ok(
        !/youth (salary|wage)|ungdomsl/i.test(m[key]),
        `${lang}: ${key} maa ikke kalde den arvede loen en ungdomsloen`,
      );
    }
    // #3805-aksen skal stadig staa i den kombinerede note.
    assert.ok(
      /race|loeb|løb/i.test(m.demoteNoteKeepsContractOngoing),
      `${lang}: den kombinerede note skal stadig naevne loebs-konsekvensen`,
    );
  }
});
