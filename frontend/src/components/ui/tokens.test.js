import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readThemeTokens, themeNamespace } from "../../lib/themeTokens.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const css = readFileSync(join(root, "index.css"), "utf8");
// #6271: Tailwind 4 has no tailwind.config.js — the theme is the @theme
// blocks in index.css (parsed by lib/themeTokens.ts).
const theme = readThemeTokens(css);

test("index.css definerer fundament-tokens", () => {
  for (const v of ["--radius-sm", "--radius-pill", "--shadow-overlay", "--dur", "--ease", "--z-modal"]) {
    assert.ok(css.includes(v), `index.css mangler ${v}`);
  }
  assert.match(css, /--radius-sm:\s*5px/, "radius-sm skal vaere 5px (laast)");
});

test("tailwind eksponerer fundament-tokens", () => {
  assert.equal(theme.get("--radius-*"), "initial", "radius-skalaen skal ERSTATTES (token-lock), ikke udvides");
  assert.equal(theme.get("--radius-cz"), "var(--radius-sm)", "rounded-cz skal pege på --radius-sm (5px)");
  assert.equal(theme.get("--radius-cz-pill"), "var(--radius-pill)");
  assert.equal(theme.get("--shadow-overlay"), "var(--shadow-overlay)", "shadow-overlay skal pege på fundament-skyggen");
  assert.ok(themeNamespace(css, "--z-index-").size > 0, "@theme mangler z-index-skalaen");
});

// #1578 WP0 token-locks: ingen rounded-xl/2xl/3xl og ingen backdrop-blur.
test("radius- og blur-skalaerne er låst i @theme", () => {
  const radii = [...themeNamespace(css, "--radius-").keys()].sort();
  assert.deepEqual(radii, ["cz", "cz-pill", "full", "lg", "md", "none", "sm"].sort());
  for (const slop of ["--radius-xl", "--radius-2xl", "--radius-3xl"]) {
    assert.ok(!theme.has(slop), `${slop} må ikke findes (slop-radius)`);
  }
  assert.equal(theme.get("--blur-*"), "initial", "blur-skalaen skal være tom, så backdrop-blur-* er no-ops");
});

// #2849 bølge 6 forward-guard: `cz-{status}-bg0` var et typo-alias for basisfarven
// og skabte to token-familier til den samme statusflade (69 callsites, 10 forskellige
// ad hoc-alfaer). Aliaset er fjernet fra temaet; en genindførelse ville
// genåbne driften. `-bg` er den ENESTE statusflade; `cz-{status}/N` er til hover og
// badges, hvor en eksplicit alfa er intentionel.
test("cz-{status}-bg0-aliaset er væk fra både tema og source", async () => {
  const colors = themeNamespace(css, "--color-");
  for (const status of ["success", "danger", "warning", "info"]) {
    assert.ok(!colors.has(`cz-${status}-bg0`), `cz-${status}-bg0 må ikke genindføres i @theme`);
    assert.ok(colors.has(`cz-${status}-bg`), `cz-${status}-bg skal findes som den kanoniske statusflade`);
  }

  const srcRoot = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const offenders = [];
  const walk = async (dir) => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { await walk(full); continue; }
      if (!/\.jsx?$/.test(e.name)) continue;
      if (e.name === "patchNotes.js" || e.name.endsWith(".test.js")) continue; // historik / denne fil
      if (/cz-(?:success|danger|warning|info)-bg0/.test(readFileSync(full, "utf8"))) {
        offenders.push(full.slice(srcRoot.length));
      }
    }
  };
  await walk(srcRoot);
  assert.deepEqual(offenders, [], `brug bg-cz-{status}-bg (flade) eller bg-cz-{status}/N (hover/badge): ${offenders.join(", ")}`);
});
