// #6110 XP (Udvikling 2.0): Hjaelp beskriver dagens model indtil development_xp_model
// er taendt for viewer'en, og XP-modellen derefter. En tekst og dens XP-tvilling maa
// aldrig staa side om side, og kurve B-udgaverne forsvinder ogsaa med XP on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { HELP_BLOCK_FLAGS, HELP_FAQ_FLAGS, helpGateFlagKeys, isHelpBlockVisible, isHelpFaqVisible } from "./helpFlagGates.js";
import { PLAYER_VISIBLE_BINARY_FLAG_KEYS, PLAYER_VISIBLE_FLAG_KEYS } from "../../../backend/lib/stageFlagCatalog.js";

type Flags = Record<string, boolean> | null;
type Text = { title?: string; text?: string; q?: string; a?: string };
type Help = { sections: Record<string, Record<string, Text>>; faq: Record<string, Text> };

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "HelpPage.jsx"), "utf8");
const locale = (lang: string): Help =>
  JSON.parse(readFileSync(join(here, "..", "..", "public", "locales", lang, "help.json"), "utf8"));
const HELP = { en: locale("en"), da: locale("da") };

const XP = "development_xp_model";
const CURVE_B = "development_curve_b";
const TICK = "training_tick_per_race_day";
const BONUS = "training_train_now_bonus";

// [sektion, gammel blok, XP-tvilling]. Den gamle blok er den, der er synlig i dag.
const BLOCK_TWINS: Array<[string, string, string]> = [
  ["dailytraining", "dayTypes", "dayTypesXp"],
  ["dailytraining", "focusAbilities", "focusAbilitiesXp"],
  ["dailytraining", "trainNowBonus", "trainNowBonusXp"],
  ["dailytraining", "raceDaysPerRaceDay", "raceDaysPerRaceDayXp"],
  ["dailytraining", "progressBars", "progressBarsXp"],
  ["dailytraining", "maxOnePerDay", "maxOnePerDayXp"],
  ["dailytraining", "longTermGrowthCurveB", "longTermGrowthXp"],
  ["dailytraining", "typeGatingCurveB", "typeGatingXp"],
  ["dailytraining", "ceilingReachedCurveB", "ceilingReachedXp"],
  ["academy", "dailyTrainingBoostCurveB", "dailyTrainingBoostXp"],
  ["riders", "riderType", "riderTypeXp"],
];
const FAQ_TWINS: Array<[string, string]> = [
  ["raceDayAcademyPerRaceDayFaq", "raceDayAcademyPerRaceDayXpFaq"],
  ["trainingFocusFaq", "trainingFocusXpFaq"],
  ["restForDevelopedFaq", "restForDevelopedXpFaq"],
  ["teamworkLeadershipTrainingCurveBFaq", "teamworkLeadershipTrainingXpFaq"],
];
// Kurve B-tiden (off-blokkene under kurve B off) skal ogsaa vaek med XP on.
const CURVE_B_OFF_BLOCKS: Array<[string, string]> = [
  ["dailytraining", "longTermGrowth"],
  ["dailytraining", "typeGating"],
  ["dailytraining", "ceilingReached"],
  ["academy", "dailyTrainingBoost"],
];

// Prod i dag: kurve B on, loebsdags-modellen on, bonus on, XP off.
const TODAY = { [CURVE_B]: true, [TICK]: true, [BONUS]: true, [XP]: false };
const XP_ON = { ...TODAY, [XP]: true };
const STATES: Array<[string, Flags]> = [
  ["i dag", TODAY],
  ["XP on", XP_ON],
  ["XP on, kurve B off", { ...XP_ON, [CURVE_B]: false }],
  ["XP off, kurve B off", { ...TODAY, [CURVE_B]: false }],
  ["fejlsvar {}", {}],
  ["henter (null)", null],
  ["raat stadie 'beta'", { ...TODAY, [XP]: "beta" } as unknown as Flags],
];

const block = (section: string, id: string, flags: Flags) => isHelpBlockVisible(section, id, flags);

test("XP-kontakten er spillersynlig og binaer (beta = off, som motoren)", () => {
  assert.ok((PLAYER_VISIBLE_FLAG_KEYS as readonly string[]).includes(XP));
  assert.ok((PLAYER_VISIBLE_BINARY_FLAG_KEYS as readonly string[]).includes(XP));
  const gateKeys: string[] = helpGateFlagKeys();
  assert.ok(gateKeys.includes(XP));
});

test("i dag (XP off): de gamle blokke vises, ingen XP-tvilling og intet XP-afsnit", () => {
  for (const [section, old, xp] of BLOCK_TWINS) {
    assert.equal(block(section, old, TODAY), true, `${section}.${old}`);
    assert.equal(block(section, xp, TODAY), false, `${section}.${xp}`);
  }
  assert.equal(block("dailytraining", "developmentXp", TODAY), false);
  for (const [old, xp] of FAQ_TWINS) {
    assert.equal(isHelpFaqVisible(old, TODAY), true, old);
    assert.equal(isHelpFaqVisible(xp, TODAY), false, xp);
  }
});

test("XP on: XP-tvillingerne og XP-afsnittet vises, de gamle er vaek", () => {
  for (const [section, old, xp] of BLOCK_TWINS) {
    assert.equal(block(section, old, XP_ON), false, `${section}.${old}`);
    assert.equal(block(section, xp, XP_ON), true, `${section}.${xp}`);
  }
  assert.equal(block("dailytraining", "developmentXp", XP_ON), true);
  for (const [old, xp] of FAQ_TWINS) {
    assert.equal(isHelpFaqVisible(old, XP_ON), false, old);
    assert.equal(isHelpFaqVisible(xp, XP_ON), true, xp);
  }
  // Ogsaa kurve B off-teksterne er vaek med XP on.
  for (const [section, id] of CURVE_B_OFF_BLOCKS) {
    assert.equal(block(section, id, { ...XP_ON, [CURVE_B]: false }), false, `${section}.${id}`);
  }
  assert.equal(isHelpFaqVisible("teamworkLeadershipTrainingFaq", { ...XP_ON, [CURVE_B]: false }), false);
});

test("en tekst og dens XP-tvilling staar aldrig side om side, i nogen flag-tilstand", () => {
  for (const [label, flags] of STATES) {
    for (const [section, old, xp] of BLOCK_TWINS) {
      assert.ok(!(block(section, old, flags) && block(section, xp, flags)), `${label}: ${old} + ${xp}`);
    }
    for (const [old, xp] of FAQ_TWINS) {
      assert.ok(!(isHelpFaqVisible(old, flags) && isHelpFaqVisible(xp, flags)), `${label}: ${old} + ${xp}`);
    }
  }
  // Mens svaret hentes vises ingen af dem.
  for (const [section, old, xp] of BLOCK_TWINS) {
    assert.equal(block(section, old, null), false, old);
    assert.equal(block(section, xp, null), false, xp);
  }
});

test("XP-tvillingerne arver deres anden kontakt (Traen nu-bonus, loebsdags-modellen)", () => {
  assert.equal(block("dailytraining", "trainNowBonusXp", { ...XP_ON, [BONUS]: false }), false);
  assert.equal(block("dailytraining", "raceDaysPerRaceDayXp", { ...XP_ON, [TICK]: false }), false);
  assert.equal(isHelpFaqVisible("raceDayAcademyPerRaceDayXpFaq", { ...XP_ON, [TICK]: false }), false);
  // Den gamle blok bag loebsdags-kontakten er stadig synlig uden XP-noeglen (fejlsvar = off).
  assert.equal(block("dailytraining", "raceDaysPerRaceDay", { [TICK]: true }), true);
});

test("hver XP-tvilling er gatet, registreret i HelpPage.jsx og staar lige efter sin gamle blok", () => {
  const ids = [...source.matchAll(/\{ id: "(\w+)", kind: "\w+"/g)].map((m) => m[1]);
  const gates = HELP_BLOCK_FLAGS as Record<string, Record<string, unknown>>;
  for (const [section, old, xp] of BLOCK_TWINS) {
    assert.ok(Object.hasOwn(gates[section], xp), `${section}.${xp} mangler en gate`);
    // XP-afsnittet staar mellem kurve B-udgaven og longTermGrowthXp.
    const after = old === "longTermGrowthCurveB" ? "developmentXp" : old;
    assert.equal(ids.indexOf(xp), ids.indexOf(after) + 1, `${xp} skal staa lige efter ${after}`);
  }
  assert.equal(ids.indexOf("developmentXp"), ids.indexOf("longTermGrowthCurveB") + 1);
  const faqs = source.match(/const FAQ_KEYS = \[([\s\S]*?)\];/);
  assert.ok(faqs);
  const keys = [...faqs[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  for (const [old, xp] of FAQ_TWINS) {
    assert.ok(Object.hasOwn(HELP_FAQ_FLAGS, xp), `${xp} mangler en gate`);
    assert.equal(keys.indexOf(xp), keys.indexOf(old) + 1, `${xp} skal staa lige efter ${old}`);
  }
});

const OWNER_SENTENCE = {
  en: "There is no fixed ceiling any more, so a rider's weaker abilities keep improving, just more slowly than his best ones. Older riders earn less XP than before: it drops from his late twenties and then holds at a lower level. Veterans develop clearly more slowly than young riders, but they keep earning XP for their whole career.",
  da: "Der er ikke længere et fast loft, så rytterens svagere evner bliver ved med at stige, bare langsommere end hans bedste. Ældre ryttere optjener mindre XP end før: det falder fra sidst i tyverne og ligger derefter fast på et lavere niveau. Veteraner udvikler sig tydeligt langsommere end unge ryttere, men de optjener XP hele karrieren.",
};

test("XP-afsnittet bringer ejerens godkendte saetning ordret (17/11)", () => {
  for (const lng of ["en", "da"] as const) {
    const text = String(HELP[lng].sections.dailytraining.developmentXp?.text);
    assert.ok(text.includes(OWNER_SENTENCE[lng]), `${lng}: ejerens saetning mangler eller er aendret`);
  }
});

test("XP-teksterne findes paa en og da, uden em-dash, vi-stemme eller nye tal", () => {
  for (const lng of ["en", "da"] as const) {
    const h = HELP[lng];
    const pairs: Array<[string, Text | undefined, Text | undefined]> = [
      ["developmentXp", undefined, h.sections.dailytraining.developmentXp],
      ...BLOCK_TWINS.map(([s, old, xp]): [string, Text | undefined, Text | undefined] => [xp, h.sections[s][old], h.sections[s][xp]]),
      ...FAQ_TWINS.map(([old, xp]): [string, Text | undefined, Text | undefined] => [xp, h.faq[old], h.faq[xp]]),
    ];
    for (const [id, oldText, xpText] of pairs) {
      const body = String(xpText?.text ?? xpText?.a ?? "");
      assert.ok(body.length > 0 && (xpText?.title || xpText?.q), `${lng}: ${id} mangler`);
      assert.match(body, /XP|built for|bygget til|per date|pr. dato/, `${lng}: ${id} beskriver ikke XP-modellen`);
      assert.doesNotMatch(body, /—/, `${lng}: ${id} har em-dash`);
      assert.doesNotMatch(body, lng === "en" ? /\bwe\b/i : /\bvi\b/i, `${lng}: ${id} bruger vi-stemmen`);
      // Kun datogrænsens +1/+2 (spillerregel, ikke talfil) og tal fra den gamle tekst.
      const allowed = new Set(["1", "2", ...(String(oldText?.text ?? oldText?.a ?? "").match(/\d+/g) ?? [])]);
      const extra = (body.match(/\d+/g) ?? []).filter((n) => !allowed.has(n));
      assert.deepEqual(extra, [], `${lng}: ${id} har tal uden kilde: ${extra.join(", ")}`);
      // Loftet fra kurve B maa ikke vaere tilbage som noget man naar.
      assert.doesNotMatch(body, /lifetime ceiling|livstidsloft|his role allows|hans rolle tillader/, `${lng}: ${id}`);
    }
    for (const [old, xp] of FAQ_TWINS) assert.equal(h.faq[xp].q, h.faq[old].q, `${lng}: ${xp}.q`);
  }
});
