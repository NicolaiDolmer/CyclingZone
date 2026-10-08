import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { themeNamespace } from "../../lib/themeTokens.ts";

// #2880 forward-guard. Root cause was TWO competing z-index scales: the
// design-token scale (z-dropdown/z-sticky/z-overlay/z-modal/z-toast, defined
// below + in index.css @theme) vs. raw Tailwind z-{10,20,30,40,50} used
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
const STICKY = /\bsticky\b/;

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

// #2880 follow-up (CI-caught regression, same PR): the first guard above only
// scans `className` text for the word `fixed` — it MISSED LanguageSwitcher.jsx,
// which sets `position: "fixed"` via an inline `style={{...}}` prop (portaled
// dropdown, needed for viewport-flip positioning) while its raw z-index lived
// in a separate `className`. That dropdown lost to the desktop sidebar once
// the sidebar was migrated to a token, because raw z-50 < any 1000+ token.
// This guard closes that gap: find `position: "fixed"` inside an OPEN
// `style={{` block, then look forward (same tag, stopping at the next `<`) for
// a `className` carrying a raw z-index.
test("#2880: ingen raw z-index på position:fixed sat via inline style (LanguageSwitcher-klassen)", () => {
  const offenders = [];
  for (const file of walk(srcRoot)) {
    const src = readFileSync(file, "utf8");
    const styleFixedRe = /position:\s*["']fixed["']/g;
    let m;
    while ((m = styleFixedRe.exec(src))) {
      const before = src.slice(Math.max(0, m.index - 200), m.index);
      const styleOpenIdx = before.lastIndexOf("style={{");
      if (styleOpenIdx === -1) continue; // not actually inside a style prop
      if (before.slice(styleOpenIdx).includes("}}")) continue; // that style block already closed — unrelated match

      const styleCloseIdx = src.indexOf("}}", m.index);
      if (styleCloseIdx === -1) continue;
      const forward = src.slice(styleCloseIdx, styleCloseIdx + 1000);
      const nextTagIdx = forward.indexOf("<");
      const scope = nextTagIdx === -1 ? forward : forward.slice(0, nextTagIdx);
      const classMatch = scope.match(/className\s*=\s*(?:"([^"]*)"|\{`([^`]*)`\})/);
      const value = classMatch ? (classMatch[1] ?? classMatch[2] ?? "") : "";
      if (RAW_Z.test(value)) {
        offenders.push(`${file.slice(srcRoot.length).replace(/\\/g, "/")}: style position:fixed + className "${value.trim().replace(/\s+/g, " ").slice(0, 90)}"`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `position:"fixed" sat via inline style skal STADIG bruge token-skalaen (z-dropdown/z-sticky/z-nav/z-overlay/z-modal/z-toast) i className — ikke kun Tailwind-klassen \`fixed\` (#2880):\n${offenders.join("\n")}`,
  );
});

// #2952 forward-guard, follow-up to #2880. That migration deliberately left
// raw z-{10,20,30} on `sticky` (not `fixed`) table headers/columns out of
// scope — they sit far below the nav/modal scale and don't cause the #2880
// bug, but were the last drift class without tokens. This guard mirrors the
// `fixed`-className guard above, swapped to `sticky`: most sticky elements
// (page sub-headers, floating action bars, drawer headers) migrate straight
// to `z-sticky`. A few tables combine a sticky TOP header row with sticky
// LEFT/RIGHT columns (AuctionsPage, TransfersPage market view) — those use
// the table-local `z-table-col`/`z-table-head` sub-scale (index.css @theme)
// instead, since flattening both onto the same `z-sticky` value would make
// the body's sticky columns cover the header row on vertical scroll (DOM
// order, not the token, would then decide stacking). Either way the guard
// only cares that no BARE z-{n}/z-[n] remains — it doesn't prescribe which
// named token.
test("#2952: ingen raw z-index på sticky-elementer uden om token-skalaen", () => {
  const offenders = [];
  for (const file of walk(srcRoot)) {
    const src = readFileSync(file, "utf8");
    CLASSNAME_VALUE.lastIndex = 0;
    let m;
    while ((m = CLASSNAME_VALUE.exec(src))) {
      const value = m[1] ?? m[2] ?? "";
      if (STICKY.test(value) && RAW_Z.test(value)) {
        offenders.push(`${file.slice(srcRoot.length).replace(/\\/g, "/")}: ${value.trim().replace(/\s+/g, " ").slice(0, 90)}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Brug z-sticky (eller den table-lokale z-table-col/z-table-head-skala for tabeller med BÅDE sticky top-header og sticky venstre/højre-kolonner, #2952) i stedet for raw z-{n} på sticky-elementer:\n${offenders.join("\n")}`,
  );
});

// #6271: Tailwind 4 — the z-index scale lives in index.css `@theme` as
// `--z-index-<name>` (parsed by lib/themeTokens.ts), not in tailwind.config.js.
const zScale = () => themeNamespace(readFileSync(join(srcRoot, "index.css"), "utf8"), "--z-index-");

test("#2952: @theme table-lokal z-skala (table-col/table-head) er under page-chrome-skalaen og korrekt ordnet", () => {
  const scale = zScale();
  assert.ok(scale.size > 0, "index.css @theme mangler --z-index-*-skalaen");
  const local = { "table-col": Number(scale.get("table-col")), "table-head": Number(scale.get("table-head")) };

  assert.equal(local["table-col"], 1, "--z-index-table-col skal være 1");
  assert.equal(local["table-head"], 2, "--z-index-table-head skal være 2");
  assert.ok(
    local["table-head"] > local["table-col"],
    "table-head skal være > table-col — ellers vinder sticky-kolonnerne over header-rækken ved lodret scroll",
  );
  assert.ok(
    local["table-col"] < 1000 && local["table-head"] < 1000,
    "table-lokal skala skal forblive under dropdown (1000) — ellers konkurrerer den med side-chrome",
  );
});

test("@theme z-index-skalaen er de 6 kanoniske lag i stigende rækkefølge", () => {
  const scale = {};
  for (const [name, value] of zScale()) if (!name.startsWith("table-")) scale[name] = Number(value);

  const order = ["dropdown", "sticky", "nav", "overlay", "modal", "toast"];
  assert.deepEqual(Object.keys(scale), order, "z-index-skalaen skal indeholde præcis disse 6 lag i denne rækkefølge");
  for (let i = 1; i < order.length; i++) {
    assert.ok(scale[order[i]] > scale[order[i - 1]], `${order[i]} (${scale[order[i]]}) skal være > ${order[i - 1]} (${scale[order[i - 1]]})`);
  }
});

test("index.css --z-* CSS-vars matcher @theme --z-index-* 1:1", () => {
  const css = readFileSync(join(srcRoot, "index.css"), "utf8");
  for (const [name, value] of zScale()) {
    assert.match(css, new RegExp(`--z-${name}:\\s*${value}\\b`), `index.css mangler --z-${name}: ${value}`);
  }
});
