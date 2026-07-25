import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const css = readFileSync(join(root, "index.css"), "utf8");
const tw = readFileSync(join(root, "..", "tailwind.config.js"), "utf8");

test("index.css definerer fundament-tokens", () => {
  for (const v of ["--radius-sm", "--radius-pill", "--shadow-overlay", "--dur", "--ease", "--z-modal"]) {
    assert.ok(css.includes(v), `index.css mangler ${v}`);
  }
  assert.match(css, /--radius-sm:\s*5px/, "radius-sm skal vaere 5px (laast)");
});

test("tailwind eksponerer fundament-tokens", () => {
  for (const k of ["borderRadius", "cz-pill", "overlay:", "var(--radius-sm)", "zIndex"]) {
    assert.ok(tw.includes(k), `tailwind.config mangler ${k}`);
  }
});

// #2849 bølge 6 forward-guard: `cz-{status}-bg0` var et typo-alias for basisfarven
// og skabte to token-familier til den samme statusflade (69 callsites, 10 forskellige
// ad hoc-alfaer). Aliaset er fjernet fra tailwind.config.js; en genindførelse ville
// genåbne driften. `-bg` er den ENESTE statusflade; `cz-{status}/N` er til hover og
// badges, hvor en eksplicit alfa er intentionel.
test("cz-{status}-bg0-aliaset er væk fra både config og source", async () => {
  const cfgPath = new URL("../../../tailwind.config.js", import.meta.url);
  const cfg = (await import(cfgPath.href)).default;
  const colors = cfg.theme.extend.colors;
  for (const status of ["success", "danger", "warning", "info"]) {
    assert.ok(!(`cz-${status}-bg0` in colors), `cz-${status}-bg0 må ikke genindføres i tailwind.config.js`);
    assert.ok(`cz-${status}-bg` in colors, `cz-${status}-bg skal findes som den kanoniske statusflade`);
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
