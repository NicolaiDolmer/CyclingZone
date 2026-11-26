import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #8816 (TASTE v2, ejer 26/11): menuen. Kilde-tekst-vagt, samme mønster som
// Layout.forumNavOrder.test.js: fanger hvis nogen flytter Spejder tilbage, slipper
// et menupunkt uden ikon, eller lader menuens nye stil slippe ud uden kontakten.

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "Layout.jsx"), "utf8");
const read = (rel) => JSON.parse(readFileSync(join(__dirname, rel), "utf8"));

function groupBlock(key, nextKey) {
  const start = src.indexOf(`key: "${key}"`);
  const end = nextKey ? src.indexOf(`key: "${nextKey}"`, start) : src.indexOf("];", start);
  assert.ok(start !== -1 && end > start, `gruppen ${key} skal findes`);
  return src.slice(start, end);
}

test("Spejder bor under Marked, ikke i Klubhus (ruten er uændret)", () => {
  assert.doesNotMatch(groupBlock("klubhus", "planlaegning"), /scoutingNavItem\(/);
  assert.match(groupBlock("marked", "resultater"), /scoutingNavItem\(scoutSystemEnabled, t\)/);
  assert.match(readFileSync(join(__dirname, "../lib/scoutingNavVisibility.js"), "utf8"), /to: "\/scouting"/);
});

test("hvert fast menupunkt har et stroke-ikon fra spillets sæt", () => {
  // Punkterne i Layout selv + dem fra lib/*NavVisibility (Spejder, Klub).
  const routes = [...[...src.matchAll(/\{ to: "([^"`]+)"/g)].map((m) => m[1]), "/scouting", "/klub"];
  assert.ok(routes.length >= 20, `forventede mange menupunkter, fandt ${routes.length}`);
  const iconBlock = src.slice(src.indexOf("const NAV_ICONS = {"), src.indexOf("};", src.indexOf("const NAV_ICONS = {")));
  for (const to of routes) {
    assert.ok(iconBlock.includes(`"${to}":`), `mangler ikon for ${to}`);
  }
  assert.match(src, /startsWith\("\/managers\/"\)\) return UserIcon/);
  assert.match(src, /YOUTH_SQUAD_PATHS\.includes\(to\)\) return JerseyIcon/);
});

test("menuens nye stil (15 px, ikoner, luft) står kun bag sentence:-varianten", () => {
  assert.equal(
    src.match(/const NAV_ITEM_TYPE_8816 = "([^"]+)"/)?.[1].split(" ").every((c) => c.startsWith("sentence:")),
    true,
  );
  for (const name of ["NAV_GROUP_HEADER_8816", "NAV_GROUP_LABEL_8816"]) {
    const classes = src.match(new RegExp(`const ${name} = "([^"]+)"`))?.[1];
    assert.ok(classes, `${name} skal findes`);
    assert.ok(classes.split(" ").every((c) => c.startsWith("sentence:")), `${name} må kun bruge sentence:-klasser`);
  }
  // Ikonet er skjult indtil kontakten; prikken skjules kun bag kontakten.
  assert.match(src, /className="hidden sentence:block shrink-0"/);
  assert.match(src, /sentence:hidden/);
});

test("'Konto og hjælp' / 'Account and help' på alle sprog, intet '&'", () => {
  for (const lng of ["en", "da", "es", "fr", "nl"]) {
    const label = read(`../../public/locales/${lng}/common.json`).nav.group.accountHelp;
    assert.doesNotMatch(label, /&/, `${lng}: ${label}`);
  }
  assert.equal(read("../../public/locales/en/common.json").nav.group.accountHelp, "Account and help");
  assert.equal(read("../../public/locales/da/common.json").nav.group.accountHelp, "Konto og hjælp");
});
