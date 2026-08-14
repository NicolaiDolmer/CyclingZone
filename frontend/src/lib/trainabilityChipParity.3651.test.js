import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// #3651 — "Limited upside for this rider type" skal stå BEGGE steder.
//
// @cybersimon (Discord #feedback-and-ideas 11/8): chippen fandtes kun på
// trænings-fladens roster-tabel, ikke i træningssektionen på rytterprofilen —
// altså ikke dér hvor fokusset faktisk vælges. Rettelsen genbruger den
// EKSISTERENDE nøgle og den EKSISTERENDE betingelse i stedet for at duplikere
// dem, så de to flader ikke kan komme til at sige forskellige ting om samme
// rytter (én ændring af tier-reglen rammer begge).
//
// Source-string-guards (samme mønster som silentFailureContract.2465.test.js —
// ingen jsdom i denne kodebase).
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const trainingPage = read("../pages/TrainingPage.jsx");
const riderTrainingTab = read("../components/rider/profile/RiderTrainingTab.jsx");

// Nøglerne må kun optræde i helperen. Står de inline i en flade, er dubletten
// tilbage, og de to steder kan drive fra hinanden igen.
const CHIP_KEYS = [
  "trainabilityChipLimited",
  "trainabilityChipLimitedTitle",
  "trainabilityChipBlocked",
  "trainabilityChipBlockedTitle",
];

test("begge flader afleder chippen fra focusTrainabilityNotice", () => {
  for (const [name, src] of [["TrainingPage", trainingPage], ["RiderTrainingTab", riderTrainingTab]]) {
    assert.match(src, /focusTrainabilityNotice/, `${name} bruger ikke helperen`);
    assert.match(src, /from "\.[./]*\/lib\/trainingReport\.js"|from "\.\.\/lib\/trainingReport\.js"/,
      `${name} importerer ikke fra trainingReport.js`);
    assert.match(src, /trainabilityNotice\.titleKey/, `${name} bruger ikke helperens titleKey`);
    assert.match(src, /trainabilityNotice\.level === "blocked"/, `${name} farvekoder ikke på helperens level`);
  }
});

test("ingen flade hardcoder chip-nøglerne eller tier-betingelsen selv", () => {
  for (const [name, src] of [["TrainingPage", trainingPage], ["RiderTrainingTab", riderTrainingTab]]) {
    for (const key of CHIP_KEYS) {
      assert.ok(!src.includes(key), `${name} hardcoder ${key} — skal komme fra focusTrainabilityNotice`);
    }
    assert.doesNotMatch(src, /=== "limited" \|\| .*=== "blocked"/,
      `${name} har en parallel tier-betingelse`);
  }
});

test("chip-nøglerne findes i BÅDE en og da (training-navnerummet)", () => {
  const en = JSON.parse(read("../../public/locales/en/training.json"));
  const da = JSON.parse(read("../../public/locales/da/training.json"));
  for (const key of CHIP_KEYS) {
    assert.ok(en[key], `en/training.json mangler ${key}`);
    assert.ok(da[key], `da/training.json mangler ${key}`);
  }
  // Ordlyden er den EKSISTERENDE — ingen ny formulering opfundet til profil-fladen.
  assert.equal(en.trainabilityChipLimited, "Limited upside for this rider type");
});

test("rytterprofilens fane har adgang til trainability-signalet fra useTraining", () => {
  // Uden det felt ville chippen aldrig kunne rendere på profilen, uanset markup.
  assert.match(riderTrainingTab, /savingId, capped, trainability \} = training/);
  assert.match(riderTrainingTab, /focusTrainabilityNotice\(focus, trainability\?\.\[rider\.id\]\)/);
  const useTraining = read("./useTraining.js");
  assert.match(useTraining, /trainability,/, "useTraining eksponerer ikke trainability");
});
