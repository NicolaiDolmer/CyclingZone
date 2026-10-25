// #3564 kurve B: Hjaelp beskriver dagens udviklingsmodel indtil development_curve_b
// er taendt, og kurve B derefter. De to versioner maa aldrig staa side om side.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { HELP_BLOCK_FLAGS, HELP_FAQ_FLAGS, isHelpBlockVisible, isHelpFaqVisible } from "./helpFlagGates.js";
import { PLAYER_VISIBLE_FLAG_KEYS } from "../../../backend/lib/stageFlagCatalog.js";

type Gate = { flag: string; when: boolean };
type Text = { title?: string; text?: string; q?: string; a?: string };
type Help = { sections: Record<string, Record<string, Text>>; faq: Record<string, Text> };

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "HelpPage.jsx"), "utf8");
const locale = (lang: string): Help =>
  JSON.parse(readFileSync(join(here, "..", "..", "public", "locales", lang, "help.json"), "utf8"));
const BLOCK_GATES = HELP_BLOCK_FLAGS as Record<string, Record<string, Gate>>;
const FAQ_GATES = HELP_FAQ_FLAGS as Record<string, Gate>;

const FLAG = "development_curve_b";
const BLOCK_TWINS: Array<[string, string]> = [
  ["dailytraining", "longTermGrowth"],
  ["dailytraining", "typeGating"],
  ["dailytraining", "ceilingReached"],
  ["academy", "dailyTrainingBoost"],
];
const FAQ_TWINS: Array<[string, string]> = [["teamworkLeadershipTrainingFaq", "teamworkLeadershipTrainingCurveBFaq"]];

test("kurve B-flaget er spillersynligt (ellers forbliver tvillingerne skjult for evigt)", () => {
  assert.ok((PLAYER_VISIBLE_FLAG_KEYS as readonly string[]).includes(FLAG));
});

test("blok-tvillingerne: off viser dagens tekst, on viser kurve B, aldrig begge", () => {
  for (const [section, id] of BLOCK_TWINS) {
    const curveB = `${id}CurveB`;
    assert.deepEqual(BLOCK_GATES[section][id], { flag: FLAG, when: false }, `${section}.${id}`);
    assert.deepEqual(BLOCK_GATES[section][curveB], { flag: FLAG, when: true }, `${section}.${curveB}`);
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
    assert.deepEqual(FAQ_GATES[off], { flag: FLAG, when: false });
    assert.deepEqual(FAQ_GATES[on], { flag: FLAG, when: true });
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
      assert.doesNotMatch(String(block.text), /\d/, `${lang}: ${section}.${id}CurveB indeholder et tal`);
    }
    for (const [, on] of FAQ_TWINS) {
      assert.ok(h.faq[on]?.q && h.faq[on]?.a, `${lang}: faq.${on} mangler`);
      assert.doesNotMatch(String(h.faq[on].a), /\d/, `${lang}: faq.${on} indeholder et tal`);
    }
  }
});
