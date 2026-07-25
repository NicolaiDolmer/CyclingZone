import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #2880 forward-guard. Root cause was TWO competing z-index scales: the
// design-token scale (z-dropdown/z-sticky/z-overlay/z-modal/z-toast, defined
// below + in tailwind.config.js) vs. raw Tailwind z-{10,20,30,40,50} used
// ad-hoc on `fixed` navigation/modal elements. Sticky page content (token
// scale, 1100+) beat the mobile drawer and several modals (raw scale,
// 30-50) — 3 independent Discord bug reports in 2 days, 23 occurrences
// across 17 files. Fixed by migrating every `fixed` overlay/nav/modal/toast
// element onto the token scale + adding a `nav` tier for the mobile bottom
// quick-nav (sits above sticky content, below the drawer/modal tier).
//
// Scope is deliberately the same as the issue's own reproduction grep
// (`fixed.*z-{30,40,50}` per #2880) generalized to any raw z-{n}/z-[n] on a
// `fixed` element: sticky/absolute/relative raw z-index is page-local
// stacking (e.g. a popover already nested inside its own token'd stacking
// context) and is a separate, lower-risk drift class — documented as a
// follow-up in PR #2880 rather than folded into this guard.

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { walk(full, out); continue; }
    if (/\.jsx?$/.test(entry.name) && !entry.name.endsWith(".test.js")) out.push(full);
  }
  return out;
}

// className value, either a plain string or a template literal (covers the
// vast majority of callsites in this codebase — see className={`...`} usage
// throughout components/ui).
const CLASSNAME_VALUE = /className\s*=\s*(?:"([^"]*)"|\{`([^`]*)`\})/g;
const RAW_Z = /\bz-\d+\b|\bz-\[/;
const FIXED = /\bfixed\b/;

test("#2880: ingen raw z-index på fixed-elementer uden om token-skalaen", () => {
  const offenders = [];
  for (const file of walk(srcRoot)) {
    const src = readFileSync(file, "utf8");
    CLASSNAME_VALUE.lastIndex = 0;
    let m;
    while ((m = CLASSNAME_VALUE.exec(src))) {
      const value = m[1] ?? m[2] ?? "";
      if (FIXED.test(value) && RAW_Z.test(value)) {
        offenders.push(`${file.slice(srcRoot.length).replace(/\\/g, "/")}: ${value.trim().replace(/\s+/g, " ").slice(0, 90)}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Brug z-dropdown/z-sticky/z-nav/z-overlay/z-modal/z-toast (token-skalaen) i stedet for raw z-{n} på fixed-elementer (#2880):\n${offenders.join("\n")}`,
  );
});

test("tailwind.config.js zIndex-skalaen er de 6 kanoniske lag i stigende rækkefølge", () => {
  const tw = readFileSync(join(srcRoot, "..", "tailwind.config.js"), "utf8");
  const m = tw.match(/zIndex:\s*\{([^}]*)\}/);
  assert.ok(m, "tailwind.config.js mangler zIndex-blokken");
  const scale = {};
  for (const [, name, value] of m[1].matchAll(/(\w+):\s*"(\d+)"/g)) scale[name] = Number(value);

  const order = ["dropdown", "sticky", "nav", "overlay", "modal", "toast"];
  assert.deepEqual(Object.keys(scale), order, "zIndex-skalaen skal indeholde præcis disse 6 lag i denne rækkefølge");
  for (let i = 1; i < order.length; i++) {
    assert.ok(scale[order[i]] > scale[order[i - 1]], `${order[i]} (${scale[order[i]]}) skal være > ${order[i - 1]} (${scale[order[i - 1]]})`);
  }
});

test("index.css --z-* CSS-vars matcher tailwind zIndex 1:1", () => {
  const css = readFileSync(join(srcRoot, "index.css"), "utf8");
  const tw = readFileSync(join(srcRoot, "..", "tailwind.config.js"), "utf8");
  const twMatch = tw.match(/zIndex:\s*\{([^}]*)\}/)[1];
  for (const [, name, value] of twMatch.matchAll(/(\w+):\s*"(\d+)"/g)) {
    assert.match(css, new RegExp(`--z-${name}:\\s*${value}\\b`), `index.css mangler --z-${name}: ${value}`);
  }
});
