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

// Selve adfaerden (flaget betyder praecis "ingen genberegning", 17k->22k-sagen)
// testes i backend/lib/academyTransfer.test.js. Den kan ikke importeres herfra:
// academyTransfer.js traekker sentry.js ind, og @sentry/node er ikke installeret
// i frontend-build-jobbet i CI (ERR_MODULE_NOT_FOUND, PR #5378). Her pinnes kun
// kilde-parity: at flaget baeres uaendret fra backend til dialogen.
const dir = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(dir, p), "utf8");

// Kilde-parity: reglen maa ikke faa en frontend-kopi. Baade quote-routen og
// begge demote-flader skal baere backendens flag videre uden at regne selv.
test("quote-routen sender backendens eget praedikat med", () => {
  const api = read("../../../backend/routes/api.js");
  assert.match(api, /keepsContract:\s*hasCompleteContract\(rider\)/, "academy-demote-quote skal sende keepsContract fra hasCompleteContract");
});

// #5748: begge flader (rytterprofil + My Team) monterer nu SAMME MoveSquadDialog,
// som er det eneste sted der henter quoten og giver modalen flaget.
test("flyt-dialogen giver modalen flaget fra quoten, og begge flader bruger den", () => {
  const dialog = read("../components/MoveSquadDialog.tsx");
  assert.match(dialog, /keepsContract:\s*quote\?\.keepsContract/, "MoveSquadDialog skal laese flaget fra quoten, ikke regne selv");
  // Quoten hentes for det VALGTE maal (?squad=), ikke kun den naturlige trup.
  assert.match(dialog, /academy-demote-quote\?squad=\$\{target\}/, "quoten skal hentes for det valgte maal");
  // Frontend maa ALDRIG udlede arven ved at sammenligne de to loen-tal: to ens
  // tal kan lige saa godt vaere et sammenfald (en kontraktloes rytter kan lande
  // paa sin gamle loen) som en arvet kontrakt.
  const teamPage = read("../pages/TeamPage.jsx");
  const riderActions = read("../components/rider/RiderManageActions.jsx");
  for (const [name, src] of [["MoveSquadDialog", dialog], ["TeamPage", teamPage], ["RiderManageActions", riderActions]]) {
    assert.doesNotMatch(
      src,
      /newSalary\s*===?\s*(quote\?\.)?currentSalary|currentSalary\s*===?\s*(quote\?\.)?newSalary/,
      `${name} maa ikke udlede kontrakt-arv af at de to loen-tal er ens`,
    );
  }
  for (const [name, src] of [["TeamPage", teamPage], ["RiderManageActions", riderActions]]) {
    assert.match(src, /<MoveSquadDialog\b/, `${name} skal aabne den delte MoveSquadDialog (ingen kopi af reglen)`);
    assert.doesNotMatch(src, /academy-demote-quote/, `${name} maa ikke hente quoten selv`);
  }
});

test("den nye route og quote-parameteren findes i api.js", () => {
  const api = read("../../../backend/routes/api.js");
  assert.match(api, /router\.post\("\/riders\/:id\/squad"/, "POST /api/riders/:id/squad skal findes");
  assert.match(api, /demoteTargetSquad\(rider, await getActiveSeasonNumber\(\), requestedSquad\)/, "quoten skal bruge det valgte maal");
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
