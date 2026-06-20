import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #1593 — nye spillere mødte uforklarede termer i selve shellen (CZ$ / Division /
// Deadline Day) før de nåede Help-siden. Fixen gav korte `title`-tooltips ved
// første kontakt. Forward-guard (kilde-tekst, samme mønster som RidersPage-tests):
// fanger hvis nogen fjerner tooltip-koblingerne på sidebar/nav.

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "Layout.jsx"), "utf8");

test("sidebar-saldoen har en CZ$-forklarende tooltip (#1593)", () => {
  assert.match(
    src,
    /title=\{t\("sidebar\.balanceTooltip"\)\}/,
    "saldo-linjen i sidebaren skal have title={t(\"sidebar.balanceTooltip\")}",
  );
});

test("sidebar-divisionen har en ligatrin-tooltip (#1593)", () => {
  assert.match(
    src,
    /title=\{t\("sidebar\.divisionTooltip"\)\}/,
    "division-linjen i sidebaren skal have title={t(\"sidebar.divisionTooltip\")}",
  );
});

test("Deadline Day-nav-punktet har en forklarende tooltip (#1593)", () => {
  assert.match(
    src,
    /to: "\/deadline-day",[^}]*title: t\("nav\.tooltip\.deadlineDay"\)/,
    "Deadline Day-nav-item'et skal sende title: t(\"nav.tooltip.deadlineDay\")",
  );
  assert.match(
    src,
    /function NavItem\(\{[^}]*\btitle\b/,
    "NavItem skal acceptere en title-prop så nav-tooltips kan rendres",
  );
});
