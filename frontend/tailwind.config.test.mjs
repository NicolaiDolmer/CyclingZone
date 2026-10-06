// Tailwind theme guards. #6271: Tailwind 4 has no tailwind.config.js — the
// theme is the `@theme` blocks in src/index.css and the scanned files are its
// `@source` lines. The file keeps its name so the guards stay where people
// look for them; everything below reads index.css instead of the JS config.
//
// #5150 — forward-guard for alpha-capable farvetokens.
//
// En klasse som `bg-cz-card/40` genereres kun hvis tokenet findes i temaet.
// Fejlen er tavs — ingen build-warning, ingen lint-fejl, kun en flade der
// mangler sin baggrund/kant.
//
// Guarden har tre lag:
//   1. Hver `xxx-cz-token/NN`-klasse i frontend/src skal ramme et token der
//      findes OG faktisk give CSS (kompileret med Tailwind selv, ikke gættet).
//   2. Den BARE klasse (uden modifier) skal give præcis samme CSS-værdi som
//      før, så tusinder af kaldsteder der ikke bruger `/NN` er uændrede.
//   3. `/NN` på tokens giver v3's værdi efter vite-plugins/tailwind-v3-alpha.ts
//      (#6271), også i browsere uden color-mix.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// @tailwindcss/node kommer med @tailwindcss/vite (samme version, låst i
// package-lock) — det er Tailwinds egen compile med @import-opløsning.
import { compile } from "@tailwindcss/node";

import { readThemeTokens, themeNamespace } from "./src/lib/themeTokens.ts";
import { restoreV3Alpha } from "./vite-plugins/tailwind-v3-alpha.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SRC = join(HERE, "src");
const CSS_PATH = join(SRC, "index.css");
const CSS = readFileSync(CSS_PATH, "utf8");

const colors = themeNamespace(CSS, "--color-");

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

let compiled;
/** index.css kompileret med Tailwind for en given kandidatliste. */
async function buildCss(candidates) {
  compiled ??= await compile(CSS, { base: dirname(CSS_PATH), onDependency() {} });
  return compiled.build(candidates);
}

/** Tailwinds escaping af en klasse i en selector (`/` og `.` og `[`). */
function selectorFor(cls) {
  return "." + cls.replace(/[/.[\]():%!#,]/g, (c) => `\\${c}`);
}

test("#5150: hver cz-token/NN i frontend/src rammer et token der findes og genererer CSS", async () => {
  const problems = [];
  const uses = new Map(); // klasse → første fil

  for (const file of collectFiles(SRC)) {
    const rel = relative(HERE, file).replace(/\\/g, "/");
    if (SKIP_FILES.has(rel)) continue;
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(OPACITY_USE)) {
      if (KNOWN_DEAD_CLASSES.has(match[0])) continue;
      const token = match[1];
      if (!colors.has(token)) {
        problems.push(`${rel}: ${match[0]} — token "${token}" findes ikke i index.css @theme (--color-${token})`);
      } else if (!uses.has(match[0])) {
        uses.set(match[0], rel);
      }
    }
  }

  const css = await buildCss([...uses.keys()]);
  for (const [cls, rel] of uses) {
    if (!css.includes(`${selectorFor(cls)} {`)) problems.push(`${rel}: ${cls} — Tailwind genererede ingen regel`);
  }

  assert.ok(uses.size > 50, `forventede mange /NN-kaldsteder, fandt ${uses.size} — er scanningen gået i stykker?`);
  assert.deepEqual(problems, [], `Opacity-klasser der ikke genererer CSS:\n${problems.join("\n")}`);
});

test("#5150: den bare klasse er uændret — color-mix rammer kun /NN-brug", async () => {
  // Den bare `bg-cz-card` skal give præcis den rå var(--x) som før #5150:
  // ellers skifter computed value fra `rgb(252, 251, 247)` til `color(srgb …)`
  // på tværs af hele appen, og kode der læser backgroundColor som rgb bryder.
  for (const [name, cssVar] of [
    ["cz-card", "--bg-card"],
    ["cz-1", "--text-1"],
    ["cz-border", "--border"],
    ["cz-subtle", "--bg-subtle"],
    ["cz-warning-bg", "--warning-bg"],
  ]) {
    assert.equal(colors.get(name), `var(${cssVar})`, `${name}: tokenet skal være den rå var(${cssVar})`);
  }
  const css = restoreV3Alpha(await buildCss(["bg-cz-card", "bg-cz-accent"]));
  assert.match(css, /\.bg-cz-card \{\s*background-color: var\(--bg-card\);\s*\}/);
  assert.match(css, /\.bg-cz-accent \{\s*background-color: rgb\(var\(--accent\)\);\s*\}/);
});

test("#6271: /NN giver v3-værdien i alle browsere (vite-plugins/tailwind-v3-alpha.ts)", async () => {
  const css = restoreV3Alpha(await buildCss(["bg-cz-card/40", "bg-cz-accent/10", "ring-cz-accent/40", "bg-black/60"]));
  // Kanal-tokens: præcis v3's `rgb(var(--x) / a)` — ingen color-mix, intet @supports.
  assert.match(css, /\.bg-cz-accent\\\/10 \{\s*background-color: rgb\(var\(--accent\) \/ 10%\);\s*\}/);
  assert.match(css, /--tw-ring-color: rgb\(var\(--accent\) \/ 40%\);/);
  // var()-tokens: #5150's color-mix i srgb, uden en fuldt-dækkende fallback.
  assert.match(css, /\.bg-cz-card\\\/40 \{\s*background-color: color-mix\(in srgb, var\(--bg-card\) 40%, transparent\);\s*\}/);
  // Statiske farver beholder Tailwinds egen (korrekte) fallback.
  assert.match(css, /\.bg-black\\\/60 \{\s*background-color: color-mix\(in srgb, #000 60%, transparent\);\s*@supports/);
});

// ---------------------------------------------------------------------------
// #5449 — forward-guard for de scannede filer (v3: `content`, v4: `@source`).
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
// matches af mindst én `@source`-glob i index.css. Så snart en ny endelse
// dukker op (`.mts`, `.svelte`, `.astro`, …) fejler testen, uanset om nogen
// huskede at opdatere en liste her.
// ---------------------------------------------------------------------------

/** Filer der bærer Tailwind-klasser (JSX-attribut eller rå HTML/SVG-attribut). */
const MARKUP_HINT = /\bclassName\b|\bclass=/;

// node_modules kan ikke ligge under src, men en lokal build-artefakt kan; de
// hører aldrig til i scanningen og ville kun larme.
const IGNORED_DIRS = new Set(["node_modules", "dist", ".vite"]);

/**
 * `@source`-globs fra index.css, omregnet fra index.css' mappe (src/) til
 * frontend-roden, så de kan matches mod `src/...`-stier.
 */
function sourceGlobs() {
  const globs = [];
  for (const [, glob] of CSS.matchAll(/@source\s+(?!not\b)['"]([^'"]+)['"]\s*;/g)) {
    globs.push(relative(HERE, join(SRC, glob)).replace(/\\/g, "/"));
  }
  return globs;
}

/**
 * Minimal glob → RegExp, kun de former `@source` faktisk bruger:
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
      assert.notEqual(end, -1, `@source-glob mangler "}" : ${glob}`);
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

test("#6271: Tailwinds automatiske scanning er slået fra — kun @source-linjerne tæller", () => {
  // Uden source(none) scanner v4 hele projektet (tests, scripts, patch-note-
  // prosa) og genererer CSS for hvert ord der tilfældigvis er et klassenavn.
  assert.match(CSS, /@import\s+['"]tailwindcss\/utilities\.css['"][^;]*\bsource\(none\)/);
  assert.ok(sourceGlobs().length > 0, "index.css mangler @source-linjer");
});

test("#5449: @source-globben dækker hver filendelse under src der bærer klasser", () => {
  const matchers = sourceGlobs().map(globToRegExp);

  const uncovered = new Map(); // endelse → første fil der afslører hullet
  for (const file of collectAllFiles(SRC)) {
    if (file === CSS_PATH) continue; // stylesheetet selv (dets kommentarer nævner className)
    const rel = relative(HERE, file).replace(/\\/g, "/");
    if (!MARKUP_HINT.test(readFileSync(file, "utf8"))) continue;
    if (matchers.some((re) => re.test(rel))) continue;
    const ext = rel.slice(rel.lastIndexOf(".")) || "(uden endelse)";
    if (!uncovered.has(ext)) uncovered.set(ext, rel);
  }

  assert.deepEqual(
    [...uncovered.entries()].map(([ext, file]) => `${ext} (fx ${file})`),
    [],
    "Filer under frontend/src bruger Tailwind-klasser, men ingen @source-glob " +
      "i src/index.css matcher dem — klasserne genereres ALDRIG, og elementet " +
      "falder tilbage til browserens standard. Udvid @source i index.css.",
  );
});

test("#5449: den kendte kombination js/jsx/ts/tsx er dækket", () => {
  // Et eksplicit gulv oven på fil-scanningen ovenfor: hvis nogen sletter den
  // sidste `.tsx`-fil, må globben ikke stille og roligt kunne skrumpe igen og
  // genindføre fejlen for den NÆSTE nye fil.
  const matchers = sourceGlobs().map(globToRegExp);
  for (const ext of ["js", "jsx", "ts", "tsx"]) {
    assert.ok(
      matchers.some((re) => re.test(`src/components/Probe.${ext}`))
        && matchers.some((re) => re.test(`src/Probe.${ext}`)),
      `@source dækker ikke .${ext} under src/ (hard rule 31: nye filer skrives i TypeScript)`,
    );
  }
  assert.ok(matchers.some((re) => re.test("index.html")), "@source skal også dække index.html");
});

test("#6271: temaet er komplet — alle cz-farver og fonte findes i @theme", () => {
  const theme = readThemeTokens(CSS);
  for (const token of [
    "cz-body", "cz-card", "cz-elevated", "cz-subtle", "cz-border", "cz-1", "cz-2", "cz-3",
    "cz-accent", "cz-accent-t", "cz-on-accent", "cz-sidebar", "cz-sidebar-hover", "cz-sidebar-border",
    "cz-sidebar-1", "cz-sidebar-2", "cz-sidebar-3", "cz-success", "cz-success-bg", "cz-danger",
    "cz-danger-bg", "cz-warning", "cz-warning-bg", "cz-info", "cz-info-bg", "cz-discord", "cz-discord-hover",
  ]) {
    assert.ok(colors.has(token), `--color-${token} mangler i index.css @theme`);
  }
  for (const font of ["sans", "mono", "data", "display"]) {
    assert.ok(theme.has(`--font-${font}`), `--font-${font} mangler i index.css @theme`);
  }
  assert.equal(theme.get("--text-2xs"), "11px");
  assert.equal(theme.get("--text-3xs"), "10px");
});
