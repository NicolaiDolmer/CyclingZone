// #3620 — bekræftelses-modalens påstand skal følge motoren, ikke en kopi.
//
// Verify-agenten fandt at PR'en rettede help.json men lod den IDENTISKE påstand
// stå i selve promote-modalen: "akademi-lønnen erstattes af senior-lønnen vist
// ovenfor". Efter #3620 er den kun sand for en rytter UDEN kontrakt. Foran et
// irreversibelt klik er det den værste slags usand tekst.
//
// Testen importerer backendens egen contractOnAcquirePatch og pinner
// frontendens betingelse mod den. Havde vi i stedet gentaget reglen som en
// literal her, ville testen være den tredje håndholdte kopi — præcis det
// anti-mønster #3681 er et backwards-check for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { keepsExistingContractOnPromote } from "./academyPromoteContract.js";
import { contractOnAcquirePatch } from "../../../backend/lib/contractSeed.js";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(dir, p), "utf8");

const SEASON = 4;

// Rytter-former der dækker alle kombinationer af de to felter patchen ser på.
// contract_end_season er ALTID med som nøgle — mangler den, kaster patchen med
// vilje (#3620's guard), og det er en anden test end denne.
const SHAPES = [
  { label: "løn + udløb sat", rider: { salary: 900, contract_end_season: 6 } },
  { label: "løn sat, udløb null", rider: { salary: 900, contract_end_season: null } },
  { label: "løn null, udløb sat", rider: { salary: null, contract_end_season: 6 } },
  { label: "begge null", rider: { salary: null, contract_end_season: null } },
  { label: "løn 0 (gratis-kontrakt)", rider: { salary: 0, contract_end_season: 6 } },
];

for (const { label, rider } of SHAPES) {
  test(`keepsExistingContractOnPromote matcher motoren: ${label}`, () => {
    const patch = contractOnAcquirePatch({ ...rider }, SEASON, { division: 2 });
    const engineKeepsContract = Object.keys(patch).length === 0;
    assert.equal(
      keepsExistingContractOnPromote(rider),
      engineKeepsContract,
      `modalen ville sige noget andet end motoren gør for: ${label}`,
    );
  });
}

test("en rytter uden felterne behandles som kontraktløs", () => {
  assert.equal(keepsExistingContractOnPromote({}), false);
  assert.equal(keepsExistingContractOnPromote(), false);
});

// Kilde-parity: reglen må ikke få en fjerde kopi. Begge flader der åbner
// promote-modalen skal kalde helperen — ikke gentage betingelsen.
test("begge promote-flader bruger den delte betingelse", () => {
  const academyPage = read("../pages/AcademyPage.jsx");
  const riderActions = read("../components/rider/RiderManageActions.jsx");
  for (const [name, src] of [["AcademyPage", academyPage], ["RiderManageActions", riderActions]]) {
    assert.match(src, /keepsExistingContractOnPromote/, `${name} skal bruge den delte betingelse`);
    assert.match(src, /keepsContract/, `${name} skal give modalen flaget`);
  }
});

test("modalen vaelger note ud fra flaget, ikke ubetinget", () => {
  const modal = read("../components/AcademyTransferConfirmModal.jsx");
  assert.match(modal, /promoteNoteKeepsContract/, "den sande note for en bevaret kontrakt skal findes");
  assert.match(modal, /keepsContract\s*\n?\s*\?\s*t\(/, "noten skal vælges af flaget");
});

test("begge sprog har den nye note og ingen em-dash", () => {
  for (const lang of ["en", "da"]) {
    const json = JSON.parse(read(`../../public/locales/${lang}/academy.json`));
    const note = json.transferModal?.promoteNoteKeepsContract;
    assert.ok(note, `${lang}: promoteNoteKeepsContract mangler`);
    assert.ok(!note.includes("—"), `${lang}: em-dash er forbudt i brugervendt tekst`);
    assert.ok(!/erstattes|replaced/i.test(note), `${lang}: noten må ikke love at lønnen erstattes`);
  }
});
