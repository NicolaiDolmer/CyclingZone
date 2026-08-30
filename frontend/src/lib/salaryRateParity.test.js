// #4479 co-SSOT-guard: løn-satsen kan ikke længere drifte mellem frontend og backend.
//
// Baggrund: `docs/ECONOMY_RULES.md` (§2 + §7) OG kommentarerne i BEGGE
// konstant-filer har siden #3989 lovet at netop denne fil håndhæver pariteten.
// Filen fandtes ikke. Det er værre end ingen vagt: tre kodesteder brugte den
// lovede test som BEGRUNDELSE for at duplikere satsen, så duplikeringen var
// utilsigtet ubevogtet mens den så bevogtet ud. Samme disciplin som
// staffSeverance.parity.test.js og clubMock.parity.test.js.
//
// Konsekvensen af drift er ikke kosmetisk: spilleren ser ét lønkrav på
// rytterkortet (frontend getRiderSalary) og betaler et andet ved kontrakt-
// indgåelse (backend computeFrozenSalary / resolveRiderSalary).
//
// Frontend og backend er separate npm-pakker og kan ikke dele et build-time
// import, men de ligger i samme git-repo og kan begge importeres fra en
// `node --test`-kørsel i frontend/ — samme mønster som rulesNumbers.test.js.
// Testfiler bundles ikke af vite, så bundle-grænsen er urørt.
import test from "node:test";
import assert from "node:assert/strict";

import { SALARY_RATE_PRODUCTION as BE_RATE } from "../../../backend/lib/economyConstants.js";
import { resolveRiderSalary as beResolveRiderSalary } from "../../../backend/lib/marketUtils.js";
import { computeFrozenSalary as beComputeFrozenSalary } from "../../../backend/lib/contractSeed.js";
import {
  SALARY_RATE_PRODUCTION as FE_RATE,
  getRiderSalary as feGetRiderSalary,
  projectSeniorSalary as feProjectSeniorSalary,
  projectYouthSalary as feProjectYouthSalary,
} from "./marketValues.js";

// CPV-værdier der dækker hele spektret fra prod-målingen 20/8 (6.051 → 232.432
// pr. overall-bin), plus randtilfældene: 0/negativ/manglende → fallback-basen,
// og en værdi hvor Math.round tipper (0,5-grænsen) så en afrundingsdrift fanges.
const CPV_SAMPLES = [0, -1, 1, 1000, 6051, 42_857, 100_000, 232_432, 1_000_000];

test("#4479: frontend og backend deler samme løn-sats (SALARY_RATE_PRODUCTION)", () => {
  assert.equal(
    FE_RATE,
    BE_RATE,
    "frontend/src/lib/marketValues.js og backend/lib/economyConstants.js er drevet fra hinanden — " +
      "rytterkortets lønestimat ville vise ét tal og kontrakten fryse et andet"
  );
});

test("#4479: lønestimatet for en fri agent er identisk i frontend og backend", () => {
  for (const cpv of CPV_SAMPLES) {
    const rider = { current_production_value: cpv, salary: null };
    assert.equal(
      feGetRiderSalary(rider),
      beResolveRiderSalary(rider),
      `getRiderSalary vs resolveRiderSalary for cpv=${cpv}`
    );
  }
  // Rytter uden CPV-nøgle overhovedet: begge sider skal ramme samme fallback.
  assert.equal(feGetRiderSalary({}), beResolveRiderSalary({}), "tom rytter");
});

test("#4479: den projicerede løn matcher den løn backend faktisk fryser", () => {
  // projectSeniorSalary/projectYouthSalary er de tal promote-/demote-dialogen
  // viser FØR spilleren trykker; backend computeFrozenSalary er det tal der
  // rent faktisk skrives i kontrakten. De to må aldrig kunne afvige.
  for (const cpv of CPV_SAMPLES) {
    const rider = { current_production_value: cpv };
    const frozen = beComputeFrozenSalary({ current_production_value: cpv });
    assert.equal(feProjectSeniorSalary(rider), frozen, `projectSeniorSalary for cpv=${cpv}`);
    assert.equal(feProjectYouthSalary(rider), frozen, `projectYouthSalary for cpv=${cpv}`);
  }
});

test("#4479: en frossen kontrakt-løn slår altid estimatet, på begge sider", () => {
  // salary:0 er en gyldig (gratis) kontrakt og må ikke falde tilbage til estimatet.
  for (const salary of [0, 1, 12_345]) {
    const rider = { salary, current_production_value: 100_000 };
    assert.equal(feGetRiderSalary(rider), salary, `frontend frossen løn ${salary}`);
    assert.equal(beResolveRiderSalary(rider), salary, `backend frossen løn ${salary}`);
  }
});
