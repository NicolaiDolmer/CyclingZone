import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import i18next from "i18next";
import ICU from "i18next-icu";

import {
  resolveBoardCopy,
  resolveBoardFeedbackHeadline,
  resolveBoardFeedbackSummary,
  resolveBoardIdentitySummary,
  resolveBoardIdentitySummaryFromParams,
  resolveBoardPersonalitySummary,
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

// ── #1084 · Identity-/personality-summaries + request-koder ───────────────────

const IDENTITY_PARAMS = {
  primarySpecialization: "gc",
  secondarySpecialization: "sprint",
  youthLevel: "high",
  squadStatus: "healthy",
  nationalCoreEstablished: true,
  nationalCoreCode: "DK",
  nationalCoreSharePct: 45,
  starProfileLevel: "high",
};

test("identity summary composes EN fragments from codes (no Danish leak)", () => {
  const summary = resolveBoardIdentitySummaryFromParams(tEn, IDENTITY_PARAMS, "dansk fallback");
  assert.match(summary, /^GC team with a secondary sprint team direction/);
  assert.match(summary, /a strong youth imprint/);
  assert.match(summary, /a healthy squad/);
  // Lande-koden bliver til lokaliseret landenavn, ikke rå "DK".
  assert.match(summary, /(Denmark|Danmark) core at 45%/);
  assert.match(summary, /star profile: nationally known\.$/);
  assert.doesNotMatch(summary, /\bDK\b/);
});

test("identity summary composes DA fragments from codes", () => {
  const summary = resolveBoardIdentitySummaryFromParams(tDa, IDENTITY_PARAMS, "");
  assert.match(summary, /^GC-hold med sekundær sprinthold-retning/);
  assert.match(summary, /stjerneprofil: nationalt kendt\.$/);
});

test("identity summary falls back to raw Danish without params", () => {
  assert.equal(
    resolveBoardIdentitySummary(tEn, { summary: "Raa dansk summary.", summary_params: null }),
    "Raa dansk summary."
  );
  assert.equal(resolveBoardIdentitySummary(tEn, null), "");
});

test("personality summary resolves from codes in both languages", () => {
  const personality = { sports_ambition: "medium", financial_risk: "balanced", identity_strength: "high" };
  assert.equal(
    resolveBoardPersonalitySummary(tEn, personality),
    "Moderate sporting ambition, balanced financial risk appetite and strong identity strength."
  );
  assert.equal(
    resolveBoardPersonalitySummary(tDa, personality),
    "Moderat sportslig ambition, balanceret økonomisk risikovillighed og stærk identitetsstyrke."
  );
  // Manglende koder → fallback.
  assert.equal(resolveBoardPersonalitySummary(tEn, { summary: "dansk" }, "fallback"), "fallback");
});

test("awaitingFirstMarkers prefers personality/identity codes over raw Danish params", () => {
  const feedback = {
    headline_key: "feedback.awaitingFirstMarkers.headline",
    summary_key: "feedback.awaitingFirstMarkers.summary",
    summary_params: {
      personalitySummary: "moderat sportslig ambition (raa dansk)",
      profileHint: " Holdet laeser de som raa dansk.",
      personality: { sports_ambition: "medium", financial_risk: "cautious", identity_strength: "medium" },
      identitySummaryParams: IDENTITY_PARAMS,
    },
    signal_hints: [],
  };
  const summary = resolveBoardFeedbackSummary(tEn, feedback);
  assert.match(summary, /^Moderate sporting ambition, cautious financial risk appetite/);
  assert.match(summary, /The board reads the team as: GC team/);
  assert.doesNotMatch(summary, /raa dansk/);
  assert.doesNotMatch(summary, /laeser/);
});

test("awaitingFirstMarkers keeps raw Danish fallback for old payloads without codes", () => {
  const feedback = {
    summary_key: "feedback.awaitingFirstMarkers.summary",
    summary_params: {
      personalitySummary: "moderat sportslig ambition",
      profileHint: " Holdet laeser de som dansk.",
    },
  };
  const summary = resolveBoardFeedbackSummary(tEn, feedback);
  assert.match(summary, /^moderat sportslig ambition/);
  assert.match(summary, /Holdet laeser de som dansk\./);
});

test("request reasons/outcome codes resolve with params (windowBlocked) and fallback", () => {
  assert.equal(
    resolveBoardCopy(tEn, "requestReason.windowBlocked", "dansk", { raceDays: 5 }),
    "The season's final phase has begun. The board does not take requests in the last 5 race days."
  );
  assert.equal(
    resolveBoardCopy(tEn, "requestReason.midCycleLocked", "dansk", { years: 5, percent: 50 }),
    "The 5-year plan is too early in its cycle to be redirected. The board wants at least 50% of the plan completed or a major satisfaction swing before a re-orientation."
  );
  assert.equal(
    resolveBoardCopy(tEn, "requestOutcome.lowerResults.titlePartial", "Bestyrelsen giver lidt luft"),
    "The board gives a little slack"
  );
  assert.equal(
    resolveBoardCopy(tEn, "requestDefs.more_youth_focus.label", "Mere ungdomsfokus"),
    "More youth focus"
  );
  // Gamle log-rækker uden kode → rå dansk fallback.
  assert.equal(resolveBoardCopy(tEn, null, "Frossen dansk titel"), "Frossen dansk titel");
});

test("every new #1084 key parses through ICU in both languages", () => {
  const sections = ["specialization", "competitiveTier", "squadStatus", "starProfileLevel",
    "nationalCoreLabel", "identitySummary", "personalitySummary", "requestDefs",
    "requestReason", "requestOutcome"];
  const sampleParams = {
    country: "Denmark", percent: 45, label: "x", raceDays: 5, years: 5,
    primary: "a", secondaryLower: "b", youth: "c", squad: "d", national: "e", star: "f",
    ambition: "a", risk: "b", identity: "c", identitySummary: "x",
  };
  const walk = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = `${prefix}.${k}`;
      if (v && typeof v === "object") {
        walk(v, key);
      } else {
        assert.doesNotThrow(() => tEn(key, sampleParams), `EN ${key} threw`);
        assert.doesNotThrow(() => tDa(key, sampleParams), `DA ${key} threw`);
        assert.notEqual(tEn(key, sampleParams), key, `EN ${key} did not resolve`);
        assert.notEqual(tDa(key, sampleParams), key, `DA ${key} did not resolve`);
      }
    }
  };
  for (const section of sections) {
    assert.ok(boardEn[section], `EN board.json mangler sektionen ${section}`);
    assert.ok(boardDa[section], `DA board.json mangler sektionen ${section}`);
    walk(boardEn[section], section);
  }
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
