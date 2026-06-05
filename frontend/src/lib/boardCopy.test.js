import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import i18next from "i18next";
import ICU from "i18next-icu";

import {
  resolveBoardFeedbackHeadline,
  resolveBoardFeedbackSummary,
  resolveReactionQuote,
  resolveMemberLabel,
  resolveCategoryLabel,
} from "./boardCopy.js";

// Loader den ÆGTE board.json gennem en ægte i18next-icu-instans, så testen
// fanger ICU-parse-fejl (fx apostroffer), manglende nøgler og param-mismatch
// præcis som production-renderen ville. #917/#694 forward-guard.
function loadJson(rel) {
  const path = fileURLToPath(new URL(rel, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8"));
}

const boardEn = loadJson("../../public/locales/en/board.json");
const boardDa = loadJson("../../public/locales/da/board.json");

let tEn;
let tDa;

before(async () => {
  const instance = i18next.createInstance();
  await instance.use(ICU).init({
    lng: "en",
    fallbackLng: "en",
    ns: ["board"],
    defaultNS: "board",
    resources: { en: { board: boardEn }, da: { board: boardDa } },
    interpolation: { escapeValue: false },
  });
  tEn = instance.getFixedT("en");
  tDa = instance.getFixedT("da");
});

test("feedback headline + summary resolve to EN (no Danish leak) with category params", () => {
  const feedback = {
    headline: "Bestyrelsen er meget tilfreds",
    headline_key: "feedback.veryHappy.headline",
    summary: "Resultater driver planen frem, og okonomi er stadig under kontrol.",
    summary_base: "Resultater driver planen frem, og okonomi er stadig under kontrol.",
    summary_key: "feedback.veryHappy.summary",
    summary_params: { strongCategory: "results", weakCategory: "economy" },
    signal_hints: [],
  };
  assert.equal(resolveBoardFeedbackHeadline(tEn, feedback), "The board is very satisfied");
  assert.equal(
    resolveBoardFeedbackSummary(tEn, feedback),
    "Results is driving the plan forward, and finances is still under control."
  );
});

test("feedback summary appends localized signal hints with country-name resolution", () => {
  const feedback = {
    headline_key: "feedback.steadyProgress.headline",
    summary_key: "feedback.steadyProgress.summary",
    summary_params: { strongCategory: "identity", weakCategory: "ranking" },
    signal_hints: [{ key: "feedback.signalHint.nationalCoreStrong", params: { country: "DK" } }],
  };
  const summary = resolveBoardFeedbackSummary(tEn, feedback);
  assert.match(summary, /^Identity is on track, but ranking needs more focus/);
  // Lande-koden "DK" skal blive til et lokaliseret landenavn (Denmark/Danmark
  // afhænger af Intl-locale i test-env), ikke rå kode. Apostroffen i "board's"
  // skal også overleve ICU-parsing.
  assert.match(summary, /(Denmark|Danmark) core gives the team a clear identity in the board's eyes\./);
  assert.doesNotMatch(summary, /\bDK\b/);
});

test("DA renders Danish (boardet lækker ikke engelsk den anden vej)", () => {
  const feedback = {
    headline_key: "feedback.veryHappy.headline",
    summary_key: "feedback.veryHappy.summary",
    summary_params: { strongCategory: "results", weakCategory: "economy" },
    signal_hints: [],
  };
  assert.equal(resolveBoardFeedbackHeadline(tDa, feedback), "Bestyrelsen er meget tilfreds");
  assert.equal(
    resolveBoardFeedbackSummary(tDa, feedback),
    "Resultater driver planen frem, og økonomi er stadig under kontrol."
  );
});

test("reaction quote resolves via array index key and renders apostrophes literally", () => {
  // traditionalisten feedback_positive[1] indeholder "90s"/"90'erne" — verificer
  // at ICU ikke spiser apostroffen.
  const reaction = {
    archetype_key: "traditionalisten",
    quote_key: "archetypes.traditionalisten.reactions.feedback_positive.1",
    quote: "Det her er hvad bestyrelsen drømte om i 90'erne.",
  };
  assert.equal(resolveReactionQuote(tEn, reaction), "This is what the board dreamed of back in the 90s.");
  assert.equal(resolveReactionQuote(tDa, reaction), "Det her er hvad bestyrelsen drømte om i 90'erne.");
});

test("member label + category label resolve via keys with fallback", () => {
  assert.equal(resolveMemberLabel(tEn, { label_key: "archetypes.sponsoraten.label", label: "Sponsoraten" }), "The Sponsor Director");
  assert.equal(resolveCategoryLabel(tEn, { label_key: "category.economy", label: "Okonomi" }), "Finances");
  // Ukendt nøgle → falder tilbage til den medsendte råtekst.
  assert.equal(resolveMemberLabel(tEn, { label_key: "archetypes.nope.label", label: "Fallback" }), "Fallback");
});

test("every archetype reaction string parses through ICU without throwing", () => {
  // Bredt ICU-parse-sweep: en lone apostrof før {/}/# ville kaste her.
  for (const [archKey, arch] of Object.entries(boardEn.archetypes)) {
    for (const [bucket, list] of Object.entries(arch.reactions)) {
      list.forEach((_, i) => {
        const key = `archetypes.${archKey}.reactions.${bucket}.${i}`;
        assert.doesNotThrow(() => tEn(key), `EN ${key} threw`);
        assert.doesNotThrow(() => tDa(key), `DA ${key} threw`);
        assert.notEqual(tEn(key), key, `EN ${key} did not resolve`);
        assert.notEqual(tDa(key), key, `DA ${key} did not resolve`);
      });
    }
  }
});
