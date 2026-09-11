// #5150 — forward-guard for alpha-capable farvetokens.
//
// Tailwind erstatter `<alpha-value>` med opacity-modifieren (`bg-cz-card/40`
// → 0.4). Et token defineret som rå `var(--x)` har ingen plads til den værdi,
// så Tailwind genererer slet ikke klassen: markup'en beder om en tone, og
// browseren får ingenting. Fejlen er tavs — ingen build-warning, ingen
// lint-fejl, kun en flade der mangler sin baggrund/kant.
//
// Guarden har tre lag:
//   1. ALLE farvetokens i configen skal reagere på en opacity-modifier, så et
//      nyt token ikke kan komme ind uden (issue-accept #5150).
//   2. Hver `xxx-cz-token/NN`-klasse i frontend/src skal ramme et token der
//      findes OG reagerer — fanger både nye tokens uden alpha og opacity-brug
//      på et token-navn der ikke eksisterer (typo).
//   3. Den BARE klasse (uden modifier) skal give præcis samme CSS-værdi som
//      før #5150, så en alpha-kapabel definition aldrig ændrer udseendet eller
//      serialiseringen af de tusinder af kaldsteder der ikke bruger `/NN`.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import tailwindConfig from "./tailwind.config.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SRC = join(HERE, "src");

const colors = tailwindConfig.theme.extend.colors;

/** Utilities der kan bære en farve + `/NN`-opacity-modifier. */
const COLOR_UTILITIES =
  "bg|text|border|stroke|fill|ring|ring-offset|divide|outline|shadow|accent|caret|decoration|placeholder|from|via|to";
const OPACITY_USE = new RegExp(
  `\\b(?:${COLOR_UTILITIES})-(cz-[a-z0-9-]+)\\/(\\d{1,3})\\b`,
  "g",
);

// patchNotes.js er changelog-PROSA, ikke markup: den citerer klassenavne
// (fx `bg-cz-info-bg0/20`) i beskrivelsen af tidligere rettelser. Den ville
// ellers rapportere sin egen historik som en fejl.
const SKIP_FILES = new Set(["src/data/patchNotes.js"]);

// Kendte typo-klasser der peger på et token der ALDRIG har eksisteret
// (`cz-warning` og `cz-card`/`cz-elevated` er de rigtige navne). De renderer
// heller ikke i dag, men at rette dem er en visuel ændring i admin-/forum-UI
// og hører ikke til i token-PR'en (#5150). Listen skal kun blive kortere.
const KNOWN_DEAD_CLASSES = new Set([
  "border-cz-warn/60", // RacePointModelSection.jsx, RacePointsAdminSection.jsx
  "bg-cz-surface/90", // ForumImagePicker.jsx
]);

/**
 * Samme opslag som Tailwind selv laver: en farve kan være en streng med
 * `<alpha-value>` eller en funktion der får opacity-modifieren ind.
 */
function resolveColor(value, opacityValue) {
  if (typeof value === "function") return value({ opacityValue, opacityVariable: "--tw-test-opacity" });
  return String(value).replace(/<alpha-value>/g, String(opacityValue));
}

/** Reagerer tokenet overhovedet på en modifier? Hvis ikke, dropper Tailwind klassen. */
function supportsAlpha(value) {
  return resolveColor(value, 0.4) !== resolveColor(value, 1);
}

function collectFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full));
    } else if (/\.(jsx?|tsx?)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

test("#5150: alle farvetokens reagerer på en opacity-modifier", () => {
  const missing = Object.entries(colors)
    .filter(([, value]) => !supportsAlpha(value))
    .map(([name]) => name);

  assert.deepEqual(
    missing,
    [],
    "Farvetokens der ignorerer opacity-modifieren — klasser som bg-<token>/40 " +
      "genereres ALDRIG for dem. Brug alphaToken('--css-var') eller " +
      "'rgb(var(--css-var) / <alpha-value>)' i tailwind.config.js.",
  );
});

test("#5150: hver cz-token/NN i frontend/src rammer et token der findes og reagerer", () => {
  const problems = [];

  for (const file of collectFiles(SRC)) {
    const rel = relative(HERE, file).replace(/\\/g, "/");
    if (SKIP_FILES.has(rel)) continue;
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(OPACITY_USE)) {
      if (KNOWN_DEAD_CLASSES.has(match[0])) continue;
      const token = match[1];
      if (!Object.prototype.hasOwnProperty.call(colors, token)) {
        problems.push(`${rel}: ${match[0]} — token "${token}" findes ikke i configen`);
      } else if (!supportsAlpha(colors[token])) {
        problems.push(`${rel}: ${match[0]} — token "${token}" ignorerer opacity-modifieren`);
      }
    }
  }

  assert.deepEqual(problems, [], `Opacity-klasser der ikke genererer CSS:\n${problems.join("\n")}`);
});

test("#5150: den bare klasse er uændret — color-mix rammer kun /NN-brug", () => {
  // Tailwind kalder farve-funktionen med `var(--tw-bg-opacity, 1)` for den
  // bare `bg-cz-card`. Den skal give præcis den rå var(--x) som før #5150:
  // ellers skifter computed value fra `rgb(252, 251, 247)` til `color(srgb …)`
  // på tværs af hele appen, og kode der læser backgroundColor som rgb bryder.
  for (const [name, cssVar] of [
    ["cz-card", "--bg-card"],
    ["cz-1", "--text-1"],
    ["cz-border", "--border"],
    ["cz-subtle", "--bg-subtle"],
    ["cz-warning-bg", "--warning-bg"],
  ]) {
    assert.equal(
      resolveColor(colors[name], "var(--tw-bg-opacity, 1)"),
      `var(${cssVar})`,
      `${name}: den bare klasse må ikke ændre CSS-værdi`,
    );
  }

  assert.equal(
    resolveColor(colors["cz-card"], 0.4),
    "color-mix(in srgb, var(--bg-card) calc(0.4 * 100%), transparent)",
  );
});
