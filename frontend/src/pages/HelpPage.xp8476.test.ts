// #8476: med XP taendt maa Hjaelp ikke sige, at traenede evner vokser "mod deres loft",
// at traeningsscoren driver udviklingen mod et loft, eller at der findes skarpe og
// flade traeningsdage. Med kontakten slukket er alt som i dag.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { HELP_BLOCK_FLAGS, isHelpBlockFlagVisible, isHelpBlockVisible, isHelpFaqVisible } from "./helpFlagGates.js";

type Flags = Record<string, boolean> | null;
type Text = { title?: string; text?: string; q?: string; a?: string };
type Help = { sections: Record<string, Record<string, Text>>; faq: Record<string, Text> };

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "HelpPage.jsx"), "utf8");
const LANGS = ["en", "da", "es", "fr", "nl"] as const;
const locale = (lang: string): Help =>
  JSON.parse(readFileSync(join(here, "..", "..", "public", "locales", lang, "help.json"), "utf8"));

const XP = "development_xp_model";
const SCORE = "training_score_visible";
const TODAY = { [XP]: false, [SCORE]: true, training_effort_levels: true };
const XP_ON = { ...TODAY, [XP]: true };
const STATES: Array<[string, Flags]> = [["i dag", TODAY], ["XP on", XP_ON], ["fejlsvar {}", {}], ["henter (null)", null]];

test("trainingFocus: dagens tekst uden XP, XP-tvillingen med XP, aldrig begge", () => {
  assert.equal(isHelpBlockVisible("riders", "trainingFocus", TODAY), true);
  assert.equal(isHelpBlockVisible("riders", "trainingFocusXp", TODAY), false);
  assert.equal(isHelpBlockVisible("riders", "trainingFocus", XP_ON), false);
  assert.equal(isHelpBlockVisible("riders", "trainingFocusXp", XP_ON), true);
  // Fejlsvar = off: dagens tekst, som foer.
  assert.equal(isHelpBlockVisible("riders", "trainingFocus", {}), true);
  for (const [label, flags] of STATES) {
    assert.ok(!(isHelpBlockVisible("riders", "trainingFocus", flags) && isHelpBlockVisible("riders", "trainingFocusXp", flags)), label);
  }
});

test("trainingScore og sharpFlatTrainingDaysFaq: skjult under XP, uaendret uden", () => {
  assert.equal(isHelpBlockVisible("dailytraining", "trainingScore", TODAY), true);
  assert.equal(isHelpBlockVisible("dailytraining", "trainingScore", XP_ON), false);
  // Blokkens egen kontakt gaelder stadig (begge filtre i HelpPage).
  assert.equal(isHelpBlockFlagVisible(SCORE, { ...TODAY, [SCORE]: false }), false);
  assert.equal(isHelpFaqVisible("sharpFlatTrainingDaysFaq", TODAY), true);
  assert.equal(isHelpFaqVisible("sharpFlatTrainingDaysFaq", {}), true);
  assert.equal(isHelpFaqVisible("sharpFlatTrainingDaysFaq", XP_ON), false);
});

test("trainingFocusXp er registreret lige efter trainingFocus og gatet", () => {
  const ids = [...source.matchAll(/\{ id: "(\w+)", kind: "\w+"/g)].map((m) => m[1]);
  assert.equal(ids.indexOf("trainingFocusXp"), ids.indexOf("trainingFocus") + 1);
  assert.ok(Object.hasOwn(HELP_BLOCK_FLAGS.riders, "trainingFocusXp"));
  assert.ok(Object.hasOwn(HELP_BLOCK_FLAGS.dailytraining, "trainingScore"));
});

test("trainingFocusXp findes paa alle fem sprog, uden loft, uden em-dash og ellers som dagens tekst", () => {
  const ceiling: Record<(typeof LANGS)[number], RegExp> = {
    en: /ceiling/i, da: /loft/i, es: /techo/i, fr: /plafond/i, nl: /plafond/i,
  };
  for (const lng of LANGS) {
    const h = locale(lng).sections.riders;
    const old = h.trainingFocus;
    const xp = h.trainingFocusXp;
    assert.ok(xp?.text && xp.title, `${lng}: trainingFocusXp mangler`);
    assert.equal(xp.title, old.title, `${lng}: titel`);
    assert.match(String(xp.text), /XP/, `${lng}: naevner ikke XP`);
    assert.doesNotMatch(String(xp.text), ceiling[lng], `${lng}: naevner stadig loftet`);
    assert.doesNotMatch(String(xp.text), /—/, `${lng}: em-dash`);
    assert.match(String(old.text), ceiling[lng], `${lng}: dagens tekst er uaendret`);
    // Kun den ene vending er skiftet: teksten er ellers ord for ord den samme. Ejervalg 21/11
    // (#6110/#7947): under XP kan indsatsen vaelges (Let/Mellem/Haard), saa indsats-saetningen
    // er ogsaa ny; den fjernes fra begge, foer resten sammenlignes.
    const EFFORT = /[^.!?]*(not a separate choice|selvstændigt valg|elección aparte|choix séparé|aparte keuze|standard effort|standardniveau|esfuerzo estándar|effort standard|standaardinspanning)[^.!?]*[.!?](\s+[^.!?]*(Easy, Medium or Hard|Let, Mellem eller Hård|Suave, Medio o Duro|Facile, Moyen ou Dur|Licht, Gemiddeld of Zwaar)[^.!?]*[.!?])?/g;
    const a = String(old.text).replace(EFFORT, ""), b = String(xp.text).replace(EFFORT, "");
    let pre = 0;
    while (pre < a.length && a[pre] === b[pre]) pre++;
    let suf = 0;
    while (suf < a.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
    assert.ok(a.length - pre - suf < 80, `${lng}: mere end vendingen er aendret`);
  }
});

// #8570: Let/Mellem/Haard-teksterne under XP findes kun, naar indsats ogsaa er on.
for (const [section, id] of [["riders", "trainingFocusXp"], ["dailytraining", "focusAbilitiesXp"]] as const) {
  test(`${id}: kun synlig naar BAADE XP og training_effort_levels er on`, () => {
    const effort = "training_effort_levels";
    assert.equal(isHelpBlockVisible(section, id, { [XP]: true, [effort]: true }), true, "begge on");
    assert.equal(isHelpBlockVisible(section, id, { [XP]: true, [effort]: false }), false, "XP on, indsats off");
    assert.equal(isHelpBlockVisible(section, id, { [XP]: true }), false, "XP on, indsats mangler");
    assert.equal(isHelpBlockVisible(section, id, { [XP]: false, [effort]: true }), false, "XP off");
    assert.equal(isHelpBlockVisible(section, id, { [XP]: false, [effort]: false }), false, "begge off");
    assert.equal(isHelpBlockVisible(section, id, null), false, "henter");
  });
}
