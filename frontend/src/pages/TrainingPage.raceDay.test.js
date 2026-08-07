import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #3459 V3 — løbsdags-badge på trænings-siden (ejer-godkendt mockup 7/8). Kun én
// visuel kontrakt: badge (stroke flag-ikon + kort tekst i fremhævet farve) ERSTATTER
// rytme-meta-linjen, intensitets-knapperne DÆMPES men forbliver AKTIVE, tooltip
// forklarer mekanikken. Feltet er PRÆCIS den samme gate (racingToday-objektets
// tilstedeværelse pr. rytter, leveret kun bag flag af backend — se
// apiTrainingMeRaceDay.routes.test.js) — samme source-string-guard-mønster som
// TrainingPage.wiring.test.js.
const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "TrainingPage.jsx"), "utf8");

test("#3459 racingToday hentes fra useTraining (ingen ny fetch/config-endpoint på siden)", () => {
  assert.match(src, /racingToday,\s*\n?\s*\} = training;/, "skal destrukturere racingToday fra useTraining()");
  assert.match(src, /const raceToday = racingToday\[rider\.id\] \?\? null;/, "tilstedeværelse pr. rytter er hele gaten");
});

test("#3459 badge bruger FlagIcon (stroke-ikon, ingen emoji) + de rette i18n-nøgler", () => {
  assert.match(src, /FlagIcon/, "skal importere/bruge FlagIcon fra ui-kittet");
  assert.match(src, /t\("raceDayBadge"\)/);
  assert.match(src, /t\("raceDayTooltip",/);
  // Ingen emoji-tegn i selve komponentkilden nær badgen (repo-krav: stroke-ikoner, aldrig emoji).
  assert.doesNotMatch(src, /🚩|🏁|🚴/);
});

test("#3459 løbsdags-linjen ERSTATTER (ikke supplerer) den normale weekRhythmTodayShort-linje", () => {
  assert.match(
    src,
    /\{raceToday \? \(/,
    "skal branche på raceToday FØR teamRhythmActive-grenen",
  );
  assert.match(
    src,
    /\) : teamRhythmActive && \(/,
    "den gamle rytme-linje skal stå i else-grenen, ikke som et separat sideordnet villkor",
  );
});

test("#3459 intensitets-knapperne dæmpes (opacity) på løbsdage, men forbliver AKTIVE (ingen ny disabled-betingelse)", () => {
  assert.match(
    src,
    /className=\{`inline-flex rounded-cz border border-cz-border overflow-hidden \$\{raceToday \? "opacity-\[0\.55\]" : ""\}`\}/,
    "intensitets-gruppen skal dæmpes visuelt når raceToday er sat",
  );
  // disabled-betingelsen på selve knapperne er UÆNDRET (kun busy) — raceToday må
  // ALDRIG optræde i disabled-udtrykket, ellers er planen ikke længere "urørt".
  assert.match(src, /disabled=\{busy\}/);
  assert.doesNotMatch(src, /disabled=\{busy\s*\|\|\s*raceToday/);
  assert.doesNotMatch(src, /disabled=\{raceToday/);
});

test("#3459 planen (fokus/intensitet-handlers) kaldes uændret — badgen rører ALDRIG handlePlanChange", () => {
  assert.doesNotMatch(
    src,
    /raceToday[\s\S]{0,80}handlePlanChange/,
    "raceToday må ikke optræde i nærheden af et handlePlanChange-kald (G5-invarianten: planen muteres aldrig af motoren/UI'et)",
  );
});
