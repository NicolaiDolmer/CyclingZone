// #4849 · Traening pr. loebsdag i Hjaelp, skive 1.
//
// Loebsdags-modellen ligger bag `training_tick_per_race_day` (off indtil
// flippet). Hjaelpen har derfor to udgaver af de tekster der beskriver
// traeningsdagen: den nuvaerende (kalenderdag, restitution efter kl. 22) og
// tvillingen for loebsdags-modellen (loeb ELLER traening, etapeloebet binder
// inkl. hviledage, restitution pr. loebsdag, samlet koersel tidligst kl. 20).
//
// To kontrakter vogtes her:
//   1. Flag off giver PRAECIS den hjaelp spillerne ser i dag: ingen eksisterende
//      blok eller FAQ forsvinder, og ingen af de nye dukker op.
//   2. En off-tekst og dens on-tvilling staar ALDRIG side om side, i nogen
//      flag-tilstand, ogsaa mens flag-svaret hentes.
//
// Kilde-regex paa HelpPage.jsx, samme moenster som HelpPage.flagGates.test.js:
// frontend-tests koerer paa `node --test` uden DOM/JSX-transform.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HELP_BLOCK_FLAGS,
  HELP_FAQ_FLAGS,
  helpGateFlagKeys,
  isHelpBlockVisible,
  isHelpFaqVisible,
} from "./helpFlagGates.js";

type Flags = Record<string, boolean> | null;
type HelpText = Record<string, unknown>;

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "HelpPage.jsx"), "utf8");
const localesDir = join(here, "..", "..", "public", "locales");

function loadHelp(lng: string): { sections: Record<string, Record<string, HelpText>>; faq: Record<string, HelpText> } {
  return JSON.parse(readFileSync(join(localesDir, lng, "help.json"), "utf8"));
}
const HELP = { en: loadHelp("en"), da: loadHelp("da") };

function dailyTrainingBlocks(): string[] {
  const defs = source.match(/const SECTION_DEFS = \[([\s\S]*?)\n\];/);
  assert.ok(defs, "HelpPage.jsx mangler 'const SECTION_DEFS = [...]'");
  const section = defs[1].match(/key: "dailytraining",[\s\S]*?blocks: \[([\s\S]*?)\]/);
  assert.ok(section, "SECTION_DEFS mangler dailytraining-sektionen");
  return [...section[1].matchAll(/id: "(\w+)"/g)].map((m) => m[1]);
}

function faqKeys(): string[] {
  const match = source.match(/const FAQ_KEYS = \[([\s\S]*?)\];/);
  assert.ok(match, "HelpPage.jsx mangler 'const FAQ_KEYS = [...]'");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

const FLAG = "training_tick_per_race_day";
const OFF: Flags = { race_engine_v4: false, board_mandate_model_enabled: false, [FLAG]: false };
const ON: Flags = { ...OFF, [FLAG]: true };
// Alle tilstande siden kan staa i: kendt off/on, fejlsvar ({} = off), mens
// svaret hentes (null), og et raat stadie der ikke er et strengt true.
const STATES: Array<[string, Flags]> = [
  ["off", OFF],
  ["on", ON],
  ["fejlsvar {}", {}],
  ["henter (null)", null],
  ["raat stadie 'on'", { [FLAG]: "on" } as unknown as Flags],
];

// De dele der KUN findes i loebsdags-modellen. runDayNow er fra #4847; resten er
// denne PR. Listen er bevidst skrevet ud, saa en ny on-del er et aktivt valg.
const ON_ONLY_BLOCKS = ["runDayNow", "raceDaysPerRaceDay", "formFatiguePerRaceDay"];
const ON_ONLY_FAQS = [
  "raceDayIntensityPerRaceDayFaq",
  "raceDayAcademyPerRaceDayFaq",
  "lowerDivisionTrainingFaq",
  "multipleStagesTrainingFaq",
  "stageRaceRestDayFaq",
];

// Off-tekst -> on-tvilling. Maa aldrig vises samtidig.
const BLOCK_PAIRS: Array<[string, string]> = [
  ["trainToday", "runDayNow"],
  ["raceDays", "raceDaysPerRaceDay"],
  ["formFatigue", "formFatiguePerRaceDay"],
];
const FAQ_PAIRS: Array<[string, string]> = [
  ["raceDayIntensityFaq", "raceDayIntensityPerRaceDayFaq"],
  ["raceDayAcademyFaq", "raceDayAcademyPerRaceDayFaq"],
];

const blockVisible = (id: string, flags: Flags) => isHelpBlockVisible("dailytraining", id, flags);
const faqVisible = (id: string, flags: Flags) => isHelpFaqVisible(id, flags);

test("flag off: dailytraining viser praecis de blokke den viser i dag", () => {
  const blocks = dailyTrainingBlocks();
  const expected = blocks.filter((id) => !ON_ONLY_BLOCKS.includes(id));
  assert.deepEqual(blocks.filter((id) => blockVisible(id, OFF)), expected);
  // Fejlsvaret er off (fail-safe) og skal give samme hjaelp.
  assert.deepEqual(blocks.filter((id) => blockVisible(id, {})), expected);
  for (const id of ["trainToday", "raceDays", "formFatigue"]) {
    assert.ok(expected.includes(id), `${id} skal staa i dagens hjaelp`);
  }
});

test("flag off: FAQ'en er praecis dagens liste, i dagens raekkefoelge", () => {
  const keys = faqKeys();
  const expected = keys.filter((id) => !ON_ONLY_FAQS.includes(id));
  assert.deepEqual(keys.filter((id) => faqVisible(id, OFF)), expected);
  assert.deepEqual(keys.filter((id) => faqVisible(id, {})), expected);
  for (const id of ["raceDayIntensityFaq", "raceDayAcademyFaq"]) {
    assert.ok(expected.includes(id), `${id} skal staa i dagens FAQ`);
  }
});

test("de gatede dele er praecis de forventede (ingen eksisterende del er skjult ved en fejl)", () => {
  const gatedBlocks = Object.keys(HELP_BLOCK_FLAGS.dailytraining).sort();
  assert.deepEqual(gatedBlocks, [...ON_ONLY_BLOCKS, ...BLOCK_PAIRS.map(([off]) => off)].sort());
  const gatedFaqs = Object.keys(HELP_FAQ_FLAGS).sort();
  assert.deepEqual(gatedFaqs, [...ON_ONLY_FAQS, ...FAQ_PAIRS.map(([off]) => off)].sort());
  // Flaget skal med i krydstjekket mod backendens allowlist (HelpPage.flagGates.test.js).
  const gateKeys: string[] = helpGateFlagKeys();
  assert.ok(gateKeys.includes(FLAG), `${FLAG} mangler i helpGateFlagKeys()`);
});

test("flag on: loebsdags-teksterne vises, og de gamle er vaek", () => {
  for (const id of ON_ONLY_BLOCKS) assert.equal(blockVisible(id, ON), true, id);
  for (const id of ON_ONLY_FAQS) assert.equal(faqVisible(id, ON), true, id);
  for (const [off] of BLOCK_PAIRS) assert.equal(blockVisible(off, ON), false, off);
  for (const [off] of FAQ_PAIRS) assert.equal(faqVisible(off, ON), false, off);
});

test("et off/on-par staar aldrig side om side, i nogen flag-tilstand", () => {
  for (const [label, flags] of STATES) {
    for (const [off, on] of BLOCK_PAIRS) {
      assert.ok(!(blockVisible(off, flags) && blockVisible(on, flags)), `${label}: ${off} + ${on}`);
    }
    for (const [off, on] of FAQ_PAIRS) {
      assert.ok(!(faqVisible(off, flags) && faqVisible(on, flags)), `${label}: ${off} + ${on}`);
    }
  }
  // Staerkere: de synlige gatede dele beskriver altid EEN model, aldrig en blanding.
  for (const [label, flags] of STATES) {
    const models = new Set<boolean>();
    for (const [id, gate] of Object.entries(HELP_BLOCK_FLAGS.dailytraining)) {
      if (blockVisible(id, flags)) models.add(gate.when);
    }
    for (const [id, gate] of Object.entries(HELP_FAQ_FLAGS)) {
      if (faqVisible(id, flags)) models.add(gate.when);
    }
    assert.ok(models.size <= 1, `${label}: hjaelpen blander kalenderdags- og loebsdags-modellen`);
  }
});

test("mens flag-svaret hentes vises ingen af de gatede dele", () => {
  for (const [off, on] of [...BLOCK_PAIRS]) {
    assert.equal(blockVisible(off, null), false, off);
    assert.equal(blockVisible(on, null), false, on);
  }
  for (const id of Object.keys(HELP_FAQ_FLAGS)) assert.equal(faqVisible(id, null), false, id);
  // Ugatede FAQ'er er altid synlige.
  assert.equal(faqVisible("seasonPlanner", null), true);
  assert.equal(faqVisible("constructor", {}), true);
});

test("hver tvilling staar lige efter sin off-tekst, saa laeseraekkefoelgen er den samme", () => {
  const blocks = dailyTrainingBlocks();
  for (const [off, on] of BLOCK_PAIRS.slice(1)) {
    assert.equal(blocks.indexOf(on), blocks.indexOf(off) + 1, `${on} skal staa lige efter ${off}`);
  }
  const keys = faqKeys();
  assert.equal(keys.indexOf("raceDayIntensityPerRaceDayFaq"), keys.indexOf("raceDayIntensityFaq") + 1);
  assert.equal(keys.indexOf("raceDayAcademyPerRaceDayFaq"), keys.indexOf("raceDayAcademyFaq") + 1);
  for (const id of ON_ONLY_FAQS) assert.ok(keys.includes(id), `${id} mangler i FAQ_KEYS`);
});

test("FAQ-tvillinger stiller samme spoergsmaal; kun svaret foelger modellen", () => {
  for (const lng of ["en", "da"] as const) {
    for (const [off, on] of FAQ_PAIRS) {
      assert.equal(HELP[lng].faq[on].q, HELP[lng].faq[off].q, `${lng}: ${on}.q`);
      assert.notEqual(HELP[lng].faq[on].a, HELP[lng].faq[off].a, `${lng}: ${on}.a er en kopi`);
    }
  }
});

// Tekster for loebsdags-modellen. Et par med en off-tekst arver dens tal; nye
// tal maa kun vaere dem TRAINING_RULES.md §13.3/§13.4 fastlaegger (140 loebsdage,
// tidligst kl. 20).
const NEW_NUMBERS = ["140", "20"];
function onTexts(lng: "en" | "da"): Array<{ id: string; text: string; offText: string }> {
  const s = HELP[lng].sections.dailytraining;
  const f = HELP[lng].faq;
  const out = [];
  for (const [off, on] of BLOCK_PAIRS.slice(1)) {
    out.push({ id: on, text: String(s[on].text), offText: String(s[off].text) });
  }
  for (const [off, on] of FAQ_PAIRS) out.push({ id: on, text: String(f[on].a), offText: String(f[off].a) });
  for (const id of ON_ONLY_FAQS.filter((k) => !FAQ_PAIRS.some(([, on]) => on === k))) {
    out.push({ id, text: `${f[id].q} ${f[id].a}`, offText: "" });
  }
  return out;
}

test("loebsdags-teksterne naevner ikke den gamle model (kl. 22, knap-bonus)", () => {
  const retired = {
    en: [/22:00/, /Train today/i, /\+25/],
    da: [/kl\. 22/, /Træn i dag/i, /\+25/],
  };
  for (const lng of ["en", "da"] as const) {
    for (const { id, text } of onTexts(lng)) {
      for (const re of retired[lng]) assert.doesNotMatch(text, re, `${lng}: ${id} naevner ${re}`);
    }
  }
});

test("loebsdags-teksterne bruger kun tal fra off-teksten eller §13.3/§13.4", () => {
  for (const lng of ["en", "da"] as const) {
    for (const { id, text, offText } of onTexts(lng)) {
      const allowed = new Set([...NEW_NUMBERS, ...(offText.match(/\d+/g) ?? [])]);
      const extra = (text.match(/\d+/g) ?? []).filter((n) => !allowed.has(n));
      assert.deepEqual(extra, [], `${lng}: ${id} har tal uden kilde: ${extra.join(", ")}`);
    }
  }
});

test("ingen em-dash og ingen vi-stemme i de nye tekster (TONE_OF_VOICE.md)", () => {
  for (const lng of ["en", "da"] as const) {
    for (const { id, text } of onTexts(lng)) {
      assert.doesNotMatch(text, /—/, `${lng}: ${id} har em-dash`);
      assert.doesNotMatch(text, lng === "en" ? /\bwe\b/i : /\bvi\b/i, `${lng}: ${id} bruger vi-stemmen`);
    }
  }
});

test("HelpPage filtrerer FAQ'en gennem gaten og husker den aabne FAQ paa id", () => {
  assert.match(source, /isHelpFaqVisible\(/, "FAQ'en filtreres ikke gennem helpFlagGates");
  assert.match(source, /buildFaq\(t, helpNumbers, playerFlags\)/, "buildFaq faar ikke flag-svaret");
  // Listen filtreres nu, saa en plads i listen er ikke laengere et stabilt id.
  assert.doesNotMatch(source, /FAQ_KEYS\.indexOf\(faqParam\)/, "dyb-linket bruger stadig listens plads");
  assert.match(source, /faqOpen === f\.id/, "den aabne FAQ huskes ikke paa id");
});
