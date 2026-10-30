import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Regressions-anker for lånespærrens fejlkoder (i18n-nøgler). Overtog filen da
// auktions-spærren blev fjernet (#7336).

const __dirname = dirname(fileURLToPath(import.meta.url));

test("GET /finance/loans-relaterede fejlkoder for lånespærren findes i loanEngine (regressions-anker for i18n-nøgler)", async () => {
  const loanEngineSource = readFileSync(resolve(__dirname, "./loanEngine.js"), "utf8");
  for (const code of ["error.loanGateRaceDaysOnly", "error.loanGateAccountAgeOnly", "error.loanGateEither"]) {
    assert.match(loanEngineSource, new RegExp(code.replace(".", "\\.")), `${code} skal være en gyldig err.code i loanEngine.js`);
  }
});
