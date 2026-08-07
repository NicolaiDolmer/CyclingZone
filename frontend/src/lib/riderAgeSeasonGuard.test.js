import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #3071 forward-guard. Root cause was TWO divergent age formulas: backend
// (riderProgressionEngine.js's ageForSeason, SÆSON-drevet) vs frontend
// (riderAge.js's getRiderAge, wall-clock `new Date().getFullYear()`). They
// agreed in season 1 (launch year) and silently diverged from season 2 —
// a player discovered it when riders stopped aging visually (skills/value
// dropped, one retired at 40) while the UI kept showing launch-season ages
// and U23/U25 badges. This guard scans every frontend source file for the
// wall-clock pattern re-appearing as an age source, so a future edit can't
// reintroduce it silently the way the original bug went unnoticed for a
// whole season.
//
// Scope mirrors the issue's own audit list (grep for getRiderAge, `new
// Date().getFullYear()`, CURRENT_YEAR, birthdate) generalized to the whole
// frontend tree, same walking pattern as zIndexScale.test.js's forward-guards.

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { walk(full, out); continue; }
    if (/\.jsx?$/.test(entry.name) && !entry.name.endsWith(".test.js")) out.push(full);
  }
  return out;
}

test("#3071: ingen wall-clock new Date().getFullYear() tilbage som alders-kilde", () => {
  const offenders = [];
  for (const file of walk(srcRoot)) {
    const src = readFileSync(file, "utf8");
    // Mønsteret fra buggen: `new Date().getFullYear() - ...getFullYear()` eller
    // en modul-/variabel-konstant der cacher wall-clock-året til alders-brug.
    // Sort-only ordinal-tricks (`-new Date(x.birthdate).getFullYear()`, uden en
    // efterfølgende subtraktion af et andet års-udtryk) er bevidst IKKE alder —
    // de bruges kun som stabil sorteringsnøgle og er dokumenteret som sådan.
    if (/new Date\(\)\.getFullYear\(\)\s*-\s*new Date\([^)]*\)\.getFullYear\(\)/.test(src)) {
      offenders.push(file.slice(srcRoot.length).replace(/\\/g, "/"));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Wall-clock alders-udregning (new Date().getFullYear() - fødselsår) fundet igen (#3071) — brug ageForSeason/getRiderAge med et sæson-referenceår (useActiveSeasonYear) i stedet:\n${offenders.join("\n")}`,
  );
});

test("#3071: ingen modul-niveau CURRENT_YEAR = new Date().getFullYear() tilbage", () => {
  const offenders = [];
  const MODULE_CURRENT_YEAR = /^\s*const\s+CURRENT_YEAR\s*=\s*new Date\(\)\.getFullYear\(\)/m;
  for (const file of walk(srcRoot)) {
    const src = readFileSync(file, "utf8");
    if (MODULE_CURRENT_YEAR.test(src)) {
      offenders.push(file.slice(srcRoot.length).replace(/\\/g, "/"));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Modul-niveau wall-clock CURRENT_YEAR fundet igen (#3071) — den fryser ALDRIG (module-load-time) og drifter fra sæsonens alder. Brug seasonYear-prop/useActiveSeasonYear:\n${offenders.join("\n")}`,
  );
});

// #3071 acceptkriterium: "PotentialeStars beregner ikke længere alder ved
// modul-load". Eksplicit navngivet guard så regressionen er let at spotte,
// selv efter den generelle CURRENT_YEAR-guard ovenfor.
//
// #3497 (ejer-beslutning, Discord 7/8): PotentialeStars beregner IKKE længere
// alder overhovedet — den tidligere isOld-gren (grå ved 30+) er fjernet, så
// seasonYear-prop'en herfra er væk. Guarden er derfor blevet til et generelt
// "ingen wall-clock" spot-tjek i stedet for et seasonYear-prop-krav.
test("#3071: PotentialeStars.jsx beregner ikke alder ved modul-load", () => {
  const src = readFileSync(join(srcRoot, "components", "PotentialeStars.jsx"), "utf8");
  assert.doesNotMatch(src, /new Date\(\)\.getFullYear\(\)/, "PotentialeStars.jsx må ikke længere kalde new Date().getFullYear() (wall-clock, fastfrosset ved modul-load)");
});

// #3497 forward-guard: grå/sølv stjerner for ryttere 30+ blev læst af spillerne
// som "færdigudviklet" i stedet for det de faktisk var (alder). Ejeren i
// Discord 7/8: "Så fjernes det i sin nuværende form med de grå stjerner...
// 5 stjerner, er 5 stjerner." Denne guard fejler hvis alders-betinget
// stjerne-farve (birthdate/seasonYear-prop eller en isOld-lignende gren)
// nogensinde genindføres i PotentialeStars.jsx.
test("#3497: PotentialeStars.jsx farvelægger ikke stjerner efter alder", () => {
  const src = readFileSync(join(srcRoot, "components", "PotentialeStars.jsx"), "utf8");
  assert.doesNotMatch(src, /\bbirthdate\b/, "PotentialeStars.jsx må ikke tage imod birthdate igen — stjerne-farven må ikke afhænge af alder (#3497)");
  assert.doesNotMatch(src, /\bseasonYear\b/, "PotentialeStars.jsx må ikke tage imod seasonYear igen — stjerne-farven må ikke afhænge af alder (#3497)");
  assert.doesNotMatch(src, /isOld/i, "PotentialeStars.jsx må ikke genindføre en alders-betinget isOld-gren (#3497)");
});
