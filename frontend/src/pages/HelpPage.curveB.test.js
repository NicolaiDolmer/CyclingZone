// #3564 kurve B: Hjaelp beskriver dagens udviklingsmodel indtil development_curve_b
// er taendt, og kurve B derefter. De to versioner maa aldrig staa side om side.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { HELP_BLOCK_FLAGS, HELP_FAQ_FLAGS, isHelpBlockVisible, isHelpFaqVisible } from "./helpFlagGates.js";
import { PLAYER_VISIBLE_FLAG_KEYS } from "../../../backend/lib/stageFlagCatalog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "HelpPage.jsx"), "utf8");
const locale = (lang) =>
  JSON.parse(readFileSync(join(__dirname, "../../public/locales", lang, "help.json"), "utf8"));

const FLAG = "development_curve_b";
const BLOCK_TWINS = [
  ["dailytraining", "longTermGrowth"],
  ["dailytraining", "typeGating"],
  ["dailytraining", "ceilingReached"],
  ["academy", "dailyTrainingBoost"],
];
const FAQ_TWINS = [["teamworkLeadershipTrainingFaq", "teamworkLeadershipTrainingCurveBFaq"]];

test("kurve B-flaget er spillersynligt (ellers forbliver tvillingerne skjult for evigt)", () => {
  assert.ok(PLAYER_VISIBLE_FLAG_KEYS.includes(FLAG));
});

test("blok-tvillingerne: off viser dagens tekst, on viser kurve B, aldrig begge", () => {
  for (const [section, id] of BLOCK_TWINS) {
    const curveB = `${id}CurveB`;
    assert.deepEqual(HELP_BLOCK_FLAGS[section][id], { flag: FLAG, when: false }, `${section}.${id}`);
    assert.deepEqual(HELP_BLOCK_FLAGS[section][curveB], { flag: FLAG, when: true }, `${section}.${curveB}`);
    assert.equal(isHelpBlockVisible(section, id, { [FLAG]: false }), true);
    assert.equal(isHelpBlockVisible(section, curveB, { [FLAG]: false }), false);
    assert.equal(isHelpBlockVisible(section, id, { [FLAG]: true }), false);
    assert.equal(isHelpBlockVisible(section, curveB, { [FLAG]: true }), true);
    // Manglende noegle = off (fail-safe): dagens tekst.
    assert.equal(isHelpBlockVisible(section, id, {}), true);
    assert.equal(isHelpBlockVisible(section, curveB, {}), false);
    // Mens svaret hentes er begge skjult.
    assert.equal(isHelpBlockVisible(section, id, null), false);
    assert.equal(isHelpBlockVisible(section, curveB, null), false);
  }
});

test("FAQ-tvillingen foelger samme kontakt", () => {
  for (const [off, on] of FAQ_TWINS) {
    assert.deepEqual(HELP_FAQ_FLAGS[off], { flag: FLAG, when: false });
    assert.deepEqual(HELP_FAQ_FLAGS[on], { flag: FLAG, when: true });
    assert.equal(isHelpFaqVisible(off, { [FLAG]: false }), true);
    assert.equal(isHelpFaqVisible(on, { [FLAG]: false }), false);
    assert.equal(isHelpFaqVisible(off, { [FLAG]: true }), false);
    assert.equal(isHelpFaqVisible(on, { [FLAG]: true }), true);
    assert.ok(source.includes(`"${on}",`), `${on} mangler i FAQ_KEYS i HelpPage.jsx`);
  }
});

test("hver kurve B-tvilling staar lige efter sin off-blok i SECTION_DEFS", () => {
  for (const [, id] of BLOCK_TWINS) {
    const re = new RegExp(`id: "${id}", kind: "text" \\},\\s*\\{ id: "${id}CurveB", kind: "text" \\}`);
    assert.match(source, re, `${id}CurveB skal staa direkte efter ${id}`);
  }
});

test("teksterne findes paa alle sprog og naevner ingen tal (hard rule 17)", () => {
  for (const lang of ["en", "da", "fr", "es", "nl"]) {
    const h = locale(lang);
    for (const [section, id] of BLOCK_TWINS) {
      const block = h.sections[section][`${id}CurveB`];
      assert.ok(block?.title && block?.text, `${lang}: ${section}.${id}CurveB mangler`);
      assert.doesNotMatch(block.text, /\d/, `${lang}: ${section}.${id}CurveB indeholder et tal`);
    }
    for (const [, on] of FAQ_TWINS) {
      assert.ok(h.faq[on]?.q && h.faq[on]?.a, `${lang}: faq.${on} mangler`);
      assert.doesNotMatch(h.faq[on].a, /\d/, `${lang}: faq.${on} indeholder et tal`);
    }
  }
});
