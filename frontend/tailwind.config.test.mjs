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

// ---------------------------------------------------------------------------
// #5449 — forward-guard for `content`-globben.
//
// Samme fejlklasse som #5150 ovenfor: klassen står i markup'en, men findes ikke
// i CSS'en, og intet værktøj siger fra. Her var årsagen en anden — globben
// scannede kun `js`/`jsx`, mens hard rule 31 kræver at NYE frontend-filer
// skrives i `.ts`/`.tsx`. En klasse der kun fandtes i en `.tsx`-fil blev derfor
// aldrig genereret (træningsscorens sparkline mistede `fill-cz-subtle` +
// `stroke-cz-1` og blev tegnet som en sort klat af SVG-standardfyldet).
//
// Guarden er vendt om i forhold til en fast liste af endelser: den går ud fra
// FILERNE. Enhver fil under `src/` der indeholder `className`/`class=` SKAL
// matches af mindst én glob i `content`. Så snart en ny endelse dukker op
// (`.mts`, `.svelte`, `.astro`, …) fejler testen, uanset om nogen huskede at
// opdatere en liste her.
// ---------------------------------------------------------------------------

/** Filer der bærer Tailwind-klasser (JSX-attribut eller rå HTML/SVG-attribut). */
const MARKUP_HINT = /\bclassName\b|\bclass=/;

// node_modules kan ikke ligge under src, men en lokal build-artefakt kan; de
// hører aldrig til i scanningen og ville kun larme.
const IGNORED_DIRS = new Set(["node_modules", "dist", ".vite"]);

/**
 * Minimal glob → RegExp, kun de former `content` faktisk bruger:
 * `**` (vilkårligt dybt), `*` (ét segment), `{a,b}` (alternativer).
 * Bevidst hjemmelavet frem for en dependency: guarden må ikke kunne falde ud
 * af drift, fordi et hjælpebibliotek blev fjernet.
 */
function globToRegExp(glob) {
  const normalized = glob.replace(/\\/g, "/").replace(/^\.\//, "");
  let out = "";
  for (let i = 0; i < normalized.length; i += 1) {
    const c = normalized[i];
    if (c === "*") {
      if (normalized[i + 1] === "*") {
        // `**/` må også matche NUL mapper, så `src/**/*.js` dækker `src/a.js`.
        if (normalized[i + 2] === "/") { out += "(?:.*/)?"; i += 2; } else { out += ".*"; i += 1; }
      } else {
        out += "[^/]*";
      }
    } else if (c === "{") {
      const end = normalized.indexOf("}", i);
      assert.notEqual(end, -1, `content-glob mangler "}" : ${glob}`);
      out += `(?:${normalized.slice(i + 1, end).split(",").map((p) => p.trim()).join("|")})`;
      i = end;
    } else {
      out += c.replace(/[.+^${}()|[\]\\?]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

function collectAllFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectAllFiles(full));
    else out.push(full);
  }
  return out;
}

test("#5449: content-globben dækker hver filendelse under src der bærer klasser", () => {
  const globs = tailwindConfig.content;
  assert.ok(Array.isArray(globs) && globs.length > 0, "tailwind.config.js: `content` skal være en ikke-tom liste");
  const matchers = globs.map(globToRegExp);

  const uncovered = new Map(); // endelse → første fil der afslører hullet
  for (const file of collectAllFiles(SRC)) {
    const rel = relative(HERE, file).replace(/\\/g, "/");
    if (!MARKUP_HINT.test(readFileSync(file, "utf8"))) continue;
    if (matchers.some((re) => re.test(rel))) continue;
    const ext = rel.slice(rel.lastIndexOf(".")) || "(uden endelse)";
    if (!uncovered.has(ext)) uncovered.set(ext, rel);
  }

  assert.deepEqual(
    [...uncovered.entries()].map(([ext, file]) => `${ext} (fx ${file})`),
    [],
    "Filer under frontend/src bruger Tailwind-klasser, men ingen glob i " +
      "`content` matcher dem — klasserne genereres ALDRIG, og elementet falder " +
      "tilbage til browserens standard. Udvid `content` i tailwind.config.js.",
  );
});

test("#5449: den kendte kombination js/jsx/ts/tsx er dækket", () => {
  // Et eksplicit gulv oven på fil-scanningen ovenfor: hvis nogen sletter den
  // sidste `.tsx`-fil, må globben ikke stille og roligt kunne skrumpe igen og
  // genindføre fejlen for den NÆSTE nye fil.
  const matchers = tailwindConfig.content.map(globToRegExp);
  for (const ext of ["js", "jsx", "ts", "tsx"]) {
    assert.ok(
      matchers.some((re) => re.test(`src/components/Probe.${ext}`))
        && matchers.some((re) => re.test(`src/Probe.${ext}`)),
      `content-globben dækker ikke .${ext} under src/ (hard rule 31: nye filer skrives i TypeScript)`,
    );
  }
});
