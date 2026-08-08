import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// projectYouthSalary importeres bevidst IKKE: den deler formel med
// projectSeniorSalary (salaryFromProduction), så adfærds-assertionerne nedenfor
// dækker begge. Kald-site-guarden matcher på kilde-tekst og rammer begge navne.
import { projectSeniorSalary, salaryRateForDivision, SALARY_ESTIMATE_COLUMN } from "./marketValues.js";

// #2796 forward-guard.
//
// Baggrund (postmortem 2026-07-23): promote-dialogen på akademi-siden viste
// 161 CZ$ som senior-løn for ENHVER rytter i uger. Årsagen var to defaults der
// hver for sig er korrekte — `salaryFromProduction` falder tilbage på den
// globale løn-sats når `division` mangler, og på base 1000 når
// `current_production_value` mangler — men som tilsammen gav et velformet,
// plausibelt og forkert tal. Ingen exception, intet log, ingen Sentry.
//
// Fallbacken FINDES med vilje (free agents har intet hold og dermed ingen
// division). Den er kun forkert når kald-siden KENDER divisionen og glemmer at
// sende den. Denne test kræver derfor ikke at fallbacken fjernes — den kræver
// at ingen kald-site kalder projicerings-funktionerne uden `division`.

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..");

function* jsxFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* jsxFiles(full);
    } else if (/\.(jsx|js)$/.test(entry) && !/\.test\.js$/.test(entry)) {
      yield full;
    }
  }
}

// #3360 opdaterede hvad fejlen ser ud som. Markedsgrundlaget er division-BLINDT
// (en rytter koster det samme uanset hold), så "division ændrer lønnen" gælder kun
// production-grundlaget. Selve fejlklassen — en plausibel konstant fordi et input
// mangler — er UÆNDRET, den hænger nu bare på værdi-feltet i stedet for divisionen.
test("den projicerede løn afhænger af det input det aktive grundlag læser", () => {
  if (SALARY_ESTIMATE_COLUMN === "market_value") {
    const lav = projectSeniorSalary({ market_value: 20_000 }, { division: 1 });
    const hoej = projectSeniorSalary({ market_value: 100_000 }, { division: 1 });
    assert.ok(hoej > lav, "markedsgrundlaget skal reagere på market_value");
    assert.equal(
      projectSeniorSalary({ market_value: 100_000 }, { division: 1 }),
      projectSeniorSalary({ market_value: 100_000 }, { division: 3 }),
      "markedsgrundlaget er division-blindt med vilje (#3360)",
    );
  } else {
    const rider = { current_production_value: 100_000 };
    assert.notEqual(projectSeniorSalary(rider, { division: 1 }), projectSeniorSalary(rider));
    assert.equal(projectSeniorSalary(rider, { division: 1 }), Math.round(100_000 * salaryRateForDivision(1)));
  }
});

test("en plausibel konstant opstår stadig når værdi-inputtet mangler", () => {
  // Dokumenterer symptomet så en fremtidig læser genkender det: ENHVER rytter får
  // samme velformede beløb, uden exception og uden log. Præcis den fejl der viste
  // 161 CZ$ i promote-dialogen i uger (#2796) og 161 CZ$/rytter i lønbyrde-
  // harnessen i to måneder (#3389).
  const konstant = projectSeniorSalary({});
  assert.equal(projectSeniorSalary({ current_production_value: null, market_value: null }), konstant);
  assert.equal(projectSeniorSalary({ firstname: "Ingen", lastname: "Værdi" }), konstant);
  assert.ok(konstant > 0, "fallbacken er et velformet tal — det er netop derfor den er farlig");
});

test("intet kald-site kalder projectSeniorSalary/projectYouthSalary uden division", () => {
  const offenders = [];
  for (const file of jsxFiles(SRC)) {
    // marketValues.js definerer funktionerne selv.
    if (file.endsWith("marketValues.js")) continue;
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/project(?:Senior|Youth)Salary\s*\(([^)]*)\)/g)) {
      if (!/division/.test(m[1])) {
        const line = source.slice(0, m.index).split("\n").length;
        offenders.push(`${relative(SRC, file).replace(/\\/g, "/")}:${line} → ${m[0]}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Kald uden division falder tilbage på den globale løn-sats og viser et forkert ` +
      `(men plausibelt) beløb i en bekræftelses-dialog. Send holdets division med:\n  ` +
      offenders.join("\n  "),
  );
});
