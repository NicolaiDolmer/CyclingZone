import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #1593 — nye spillere mødte uforklarede termer i selve shellen (CZ$ / Division)
// før de nåede Help-siden. Fixen gav korte `title`-tooltips ved første kontakt.
// Forward-guard (kilde-tekst, samme mønster som RidersPage-tests): fanger hvis
// nogen fjerner tooltip-koblingerne på sidebaren.

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

test("sidebar-footeren viser login-link til anonyme i stedet for Log ud (#7500)", () => {
  assert.match(src, /isAnonymous \? \(/, "footeren skal forgrene på isAnonymous");
  assert.match(src, /to="\/login"[\s\S]{0,400}\{loginLabel\}/, "anonym: Link til /login med loginLabel");
  assert.match(src, /isAnonymous: !session/, "isAnonymous kommer fra manglende session");
  assert.match(src, /loginLabel: t\("landing:nav\.login"\)/, "eksisterende login-nøgle genbruges");
});
