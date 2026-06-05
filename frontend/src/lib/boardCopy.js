// #917/#694 · Board i18n-resolvers.
//
// Backend genererer board-feedback, arketype-labels og medlems-reaktioner som
// strukturerede i18n-koder (+ params) med dansk råtekst som fallback. Disse
// helpers resolver koderne via board.json, så EN-mode ikke lækker dansk.
// Mønster matcher #678 (resolveApiError) + den eksisterende getDnaCopy i BoardPage.
//
// Kontrakt fra backend (alle felter valgfrie — falder tilbage til råtekst):
//   feedback: { headline, headline_key, summary, summary_base, summary_key,
//               summary_params, signal_hints: [{ key, params }] }
//   member/reaction: { label, label_key, short_description, short_description_key,
//                      long_description, long_description_key, quote, quote_key }
//   category: { label, label_key }

import { getCountryDisplay } from "./countryUtils.js";

// Backend sender lande-koder (fx "DK") i hint-params; oversæt til lokaliseret
// landenavn så signal-hints ikke viser rå koder.
function resolveHintParams(params = {}) {
  const out = { ...params };
  if (typeof out.country === "string" && /^[A-Z]{2}$/.test(out.country)) {
    out.country = getCountryDisplay(out.country).name || out.country;
  }
  return out;
}

// Generisk key+fallback-resolver. `keyField` er en board-relativ nøgle
// (fx "archetypes.sponsoraten.label"); præfikser med "board:" så den virker
// uanset om kalderens t() er board-scoped.
export function resolveBoardCopy(t, keyField, fallback = "") {
  if (keyField) return t(`board:${keyField}`, { defaultValue: fallback || "" });
  return fallback || "";
}

export function resolveBoardFeedbackHeadline(t, feedback) {
  if (!feedback) return "";
  return resolveBoardCopy(t, feedback.headline_key, feedback.headline);
}

export function resolveBoardFeedbackSummary(t, feedback) {
  if (!feedback) return "";

  let base;
  if (feedback.summary_key) {
    const params = feedback.summary_params || {};
    const strongLabel = params.strongCategory
      ? t(`board:category.${params.strongCategory}`, { defaultValue: "" })
      : "";
    const weakLabel = params.weakCategory
      ? t(`board:category.${params.weakCategory}`, { defaultValue: "" })
      : "";
    base = t(`board:${feedback.summary_key}`, {
      strong: strongLabel,
      weak: weakLabel,
      weakLower: weakLabel.toLowerCase(),
      personalitySummary: params.personalitySummary || "",
      profileHint: params.profileHint || "",
      defaultValue: feedback.summary_base || feedback.summary || "",
    });
  } else {
    base = feedback.summary || "";
  }

  const hints = (feedback.signal_hints || [])
    .map((hint) => (hint?.key
      ? t(`board:${hint.key}`, { ...resolveHintParams(hint.params), defaultValue: hint.text || "" })
      : (hint?.text || "")))
    .filter(Boolean);

  return [base, ...hints].filter(Boolean).join(" ").trim();
}

// Medlems-/reaktions-felter (label, kort/lang beskrivelse, citat).
export function resolveMemberLabel(t, member) {
  return resolveBoardCopy(t, member?.label_key, member?.label);
}

export function resolveMemberShortDescription(t, member) {
  return resolveBoardCopy(t, member?.short_description_key, member?.short_description);
}

export function resolveMemberLongDescription(t, member) {
  return resolveBoardCopy(t, member?.long_description_key, member?.long_description);
}

export function resolveReactionQuote(t, reaction) {
  return resolveBoardCopy(t, reaction?.quote_key, reaction?.quote);
}

export function resolveCategoryLabel(t, category) {
  return resolveBoardCopy(t, category?.label_key, category?.label);
}
