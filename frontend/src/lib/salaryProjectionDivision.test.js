import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// projectYouthSalary importeres bevidst IKKE: den deler formel med
// projectSeniorSalary (salaryFromProduction), så adfærds-assertionerne nedenfor
// dækker begge. Kald-site-guarden matcher på kilde-tekst og rammer begge navne.
import { projectSeniorSalary, salaryRateForDivision } from "./marketValues.js";

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

test("division ændrer faktisk den projicerede løn (ellers er guarden meningsløs)", () => {
  const rider = { current_production_value: 100_000 };
  const d1 = projectSeniorSalary(rider, { division: 1 });
  const global = projectSeniorSalary(rider);
  assert.notEqual(d1, global, "D1-satsen skal afvige fra den globale — ellers kan fejlen ikke ses");
  assert.equal(d1, Math.round(100_000 * salaryRateForDivision(1)));
  assert.equal(global, Math.round(100_000 * salaryRateForDivision(undefined)));
});

test("den plausible konstant 161 opstår stadig når BEGGE inputs mangler", () => {
  // Dokumenterer symptomet så en fremtidig læser genkender det: base-fallback
  // 1000 × global sats 0,1606 = 161. Samme værdi for enhver rytter.
  assert.equal(projectSeniorSalary({}), 161);
  assert.equal(projectSeniorSalary({ current_production_value: null }), 161);
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
