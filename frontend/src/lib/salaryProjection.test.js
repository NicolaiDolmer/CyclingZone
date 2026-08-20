import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { SALARY_RATE_PRODUCTION, projectSeniorSalary, projectYouthSalary } from "./marketValues.js";

// #3989 forward-guard (afløser salaryProjectionDivision.test.js).
//
// Historik: promote-dialogen på akademi-siden viste 161 CZ$ som senior-løn for
// ENHVER rytter i uger (postmortem 2026-07-23, #2796). Årsagen var TO defaults
// der hver for sig er korrekte — den globale sats når `division` manglede, og
// base 1000 når `current_production_value` manglede — men som tilsammen gav et
// velformet, plausibelt og forkert tal. Ingen exception, intet log, ingen Sentry.
//
// Den gamle guard krævede at hvert kald-site huskede at sende `division`.
// #3989 fjernede division-benet HELT: satsen er global, og parameteren findes
// ikke længere. Den halvdel af fejlklassen kan altså ikke opstå igen.
//
// Tilbage står den ANDEN halvdel — et rytter-objekt uden
// current_production_value — og den er stadig lige så tavs. Denne fil vogter
// den, plus selve division-blindheden.

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..");

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    else if (/\.(jsx|js)$/.test(entry) && !/\.test\.js$/.test(entry)) yield full;
  }
}

test("#3989 · projektionen er division-blind (parameteren findes ikke længere)", () => {
  const rider = { current_production_value: 100_000 };
  const expected = Math.round(100_000 * SALARY_RATE_PRODUCTION);
  assert.equal(projectSeniorSalary(rider), expected);
  assert.equal(projectYouthSalary(rider), expected);

  // Et ekstra argument må ikke kunne flytte tallet — hverken nu eller hvis nogen
  // senere "genindfører" division ved at sende det med i håb om at det virker.
  assert.equal(projectSeniorSalary(rider, { division: 1 }), expected);
  assert.equal(projectSeniorSalary(rider, { division: 4 }), expected);
});

test("#3989 · promote/demote deler præcis samme formel", () => {
  for (const cpv of [0, 1, 5_000, 250_000, 3_000_000]) {
    const rider = { current_production_value: cpv };
    assert.equal(
      projectSeniorSalary(rider), projectYouthSalary(rider),
      `promote og demote divergerede ved cpv ${cpv} — ét fælles løn-system (#2083)`,
    );
  }
});

test("#2796 · den plausible fallback opstår stadig uden current_production_value", () => {
  // Dokumenterer symptomet så en fremtidig læser genkender det: base-fallback
  // 1000 × satsen. Samme værdi for enhver rytter, uanset hvor god han er.
  const fallback = Math.max(1, Math.round(1000 * SALARY_RATE_PRODUCTION));
  assert.equal(projectSeniorSalary({}), fallback);
  assert.equal(projectSeniorSalary({ current_production_value: null }), fallback);
  assert.notEqual(
    fallback, projectSeniorSalary({ current_production_value: 100_000 }),
    "fallbacken skal afvige fra en rigtig projektion — ellers kan fejlen ikke ses",
  );
});

test("#2796 · intet kald-site kalder projicerings-funktionerne på et objekt uden current_production_value i sit SELECT", () => {
  // Kan ikke tjekkes statisk pr. rytter-objekt; i stedet vogter vi at kald-sites
  // ikke sender et LITERAL-objekt uden feltet (den form fejlen tog i #3784).
  const offenders = [];
  for (const file of sourceFiles(SRC)) {
    if (file.endsWith("marketValues.js")) continue; // definerer funktionerne selv
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/project(?:Senior|Youth)Salary\s*\(\s*\{([^}]*)\}/g)) {
      if (!/current_production_value/.test(m[1])) {
        const line = source.slice(0, m.index).split("\n").length;
        offenders.push(`${relative(SRC, file).replace(/\\/g, "/")}:${line} → ${m[0]}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "Et literal-objekt uden current_production_value giver base-fallbacken 1000 og viser " +
      "et forkert (men plausibelt) beløb i en bekræftelses-dialog:\n  " + offenders.join("\n  "),
  );
});
