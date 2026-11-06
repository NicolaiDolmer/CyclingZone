// #7686: Hjaelp beskriver intervallet indtil potential_estimate_display er taendt, og tal
// + ord derefter. De to versioner maa aldrig staa side om side, og den nye tekst maa
// ikke tale om interval eller loft.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { HELP_BLOCK_FLAGS, HELP_FAQ_FLAGS, isHelpBlockVisible, isHelpFaqVisible } from "./helpFlagGates.js";
import { PLAYER_VISIBLE_FLAG_KEYS } from "../../../backend/lib/stageFlagCatalog.js";

type Text = { title?: string; text?: string; q?: string; a?: string };
type Help = { sections: Record<string, Record<string, Text>>; faq: Record<string, Text> };

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "HelpPage.jsx"), "utf8");
const locale = (lang: string): Help =>
  JSON.parse(readFileSync(join(here, "..", "..", "public", "locales", lang, "help.json"), "utf8"));

const FLAG = "potential_estimate_display";
const BLOCK_TWINS: Array<[string, string, string]> = [
  ["riders", "potentialBestRole", "potentialBestRoleEstimate"],
  ["riders", "scouting", "scoutingEstimate"],
  ["academy", "prognosisTraining", "prognosisTrainingEstimate"],
  ["facilities", "hireChiefScout", "hireChiefScoutEstimate"],
];
const FAQ_TWINS: Array<[string, string]> = [
  ["developmentProjectionFaq", "developmentProjectionEstimateFaq"],
  ["scoutedBandGuaranteeFaq", "scoutedEstimateGuaranteeFaq"],
  ["scoutChangeRecalcFaq", "scoutChangeEstimateFaq"],
  ["scoutNetworkOwnRidersFaq", "scoutNetworkOwnRidersEstimateFaq"],
];

test("flaget er spillersynligt, og Hjaelp bruger ikke det pensionerede flag", () => {
  assert.ok((PLAYER_VISIBLE_FLAG_KEYS as readonly string[]).includes(FLAG));
  const gates = JSON.stringify([HELP_BLOCK_FLAGS, HELP_FAQ_FLAGS]);
  assert.ok(!gates.includes("potential_single_number"), "potential_single_number er on i prod og ville skifte teksten nu");
});

test("blok-tvillingerne: off viser intervallet, on viser tal + ord, aldrig begge", () => {
  for (const [section, oldId, newId] of BLOCK_TWINS) {
    assert.equal(isHelpBlockVisible(section, oldId, { [FLAG]: false }), true, oldId);
    assert.equal(isHelpBlockVisible(section, newId, { [FLAG]: false }), false, newId);
    assert.equal(isHelpBlockVisible(section, oldId, { [FLAG]: true }), false, oldId);
    assert.equal(isHelpBlockVisible(section, newId, { [FLAG]: true }), true, newId);
    assert.equal(isHelpBlockVisible(section, oldId, {}), true, `${oldId}: manglende noegle er off`);
    assert.equal(isHelpBlockVisible(section, newId, {}), false, `${newId}: manglende noegle er off`);
    assert.ok(source.includes(`id: "${newId}"`), `${newId} mangler i SECTION_DEFS`);
  }
});

test("FAQ-tvillingerne foelger samme kontakt", () => {
  for (const [oldId, newId] of FAQ_TWINS) {
    assert.equal(isHelpFaqVisible(oldId, { [FLAG]: false }), true, oldId);
    assert.equal(isHelpFaqVisible(newId, { [FLAG]: false }), false, newId);
    assert.equal(isHelpFaqVisible(oldId, { [FLAG]: true }), false, oldId);
    assert.equal(isHelpFaqVisible(newId, { [FLAG]: true }), true, newId);
  }
  assert.equal(isHelpFaqVisible("typeRatingScaleFaq", { potential_estimate_display: true }), false);
});

for (const [lang, forbidden] of [
  ["en", /\b(range|band|ceiling|interval)\b/i],
  ["da", /\b(interval|bånd|loft)/i],
] as const) {
  test(`[${lang}] den nye tekst taler ikke om interval eller loft`, () => {
    const help = locale(lang);
    for (const [section, , newId] of BLOCK_TWINS) {
      const { title, text } = help.sections[section][newId];
      assert.ok(title && text, `${section}.${newId}`);
      assert.doesNotMatch(text, forbidden, `${section}.${newId}`);
    }
    for (const [, newId] of FAQ_TWINS) {
      const { q, a } = help.faq[newId];
      assert.ok(q && a, newId);
      assert.doesNotMatch(`${q} ${a}`, forbidden, newId);
    }
  });
}
