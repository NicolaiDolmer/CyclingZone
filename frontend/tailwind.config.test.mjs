// #5150 — forward-guard for alpha-capable farvetokens.
//
// Tailwind erstatter `<alpha-value>` med opacity-modifieren (`bg-cz-card/40`
// → 0.4). Et token defineret som rå `var(--x)` har ingen plads til den værdi,
// så Tailwind genererer slet ikke klassen: markup'en beder om en tone, og
// browseren får ingenting. Fejlen er tavs — ingen build-warning, ingen
// lint-fejl, kun en flade der mangler sin baggrund/kant.
//
// Guarden har to lag:
//   1. ALLE farvetokens i configen skal bære `<alpha-value>`, så et nyt token
//      ikke kan komme ind uden (issue-accept #5150).
//   2. Hver `xxx-cz-token/NN`-klasse i frontend/src skal ramme et token der
//      findes OG bærer `<alpha-value>` — fanger både nye tokens uden alpha og
//      opacity-brug på et token-navn der ikke eksisterer (typo).

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

/**
 * Længste token-navn der matcher, fordi `cz-accent-t` og `cz-accent` begge er
 * gyldige præfikser af den samme streng — en naiv match ville pege forkert.
 */
function resolveToken(name) {
  return Object.prototype.hasOwnProperty.call(colors, name) ? colors[name] : undefined;
}

test("#5150: alle farvetokens i tailwind.config.js bærer <alpha-value>", () => {
  const missing = Object.entries(colors)
    .filter(([, value]) => typeof value === "string" && !value.includes("<alpha-value>"))
    .map(([name, value]) => `${name}: ${value}`);

  assert.deepEqual(
    missing,
    [],
    `Farvetokens uden <alpha-value> — opacity-modifiere (fx bg-${missing[0]?.split(":")[0]}/40) ` +
      "genereres ALDRIG for dem. Brug alphaToken('--css-var') eller " +
      "'rgb(var(--css-var) / <alpha-value>)' i tailwind.config.js.",
  );
});

test("#5150: hver cz-token/NN i frontend/src rammer et token der findes og har <alpha-value>", () => {
  const problems = [];

  for (const file of collectFiles(SRC)) {
    const rel = relative(HERE, file).replace(/\\/g, "/");
    if (SKIP_FILES.has(rel)) continue;
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(OPACITY_USE)) {
      if (KNOWN_DEAD_CLASSES.has(match[0])) continue;
      const [, token] = match;
      const value = resolveToken(token);
      if (value === undefined) {
        problems.push(`${rel}: ${match[0]} — token "${token}" findes ikke i configen`);
      } else if (typeof value === "string" && !value.includes("<alpha-value>")) {
        problems.push(`${rel}: ${match[0]} — token "${token}" mangler <alpha-value>`);
      }
    }
  }

  assert.deepEqual(problems, [], `Opacity-klasser der ikke genererer CSS:\n${problems.join("\n")}`);
});

test("#5150: alphaToken-mønstret er identisk med kilden ved alpha = 1", () => {
  // Tailwind indsætter `1` når der ingen modifier er. Regnestykket skal give
  // 100 % af farven, ellers ville ALLE eksisterende kaldsteder uden `/NN`
  // skifte udseende af denne ændring.
  const value = colors["cz-card"];
  assert.match(value, /^color-mix\(in srgb, var\(--bg-card\) calc\(<alpha-value> \* 100%\), transparent\)$/);
  assert.equal(
    value.replace("<alpha-value>", "1"),
    "color-mix(in srgb, var(--bg-card) calc(1 * 100%), transparent)",
  );
});
