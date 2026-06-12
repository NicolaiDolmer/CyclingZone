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
// uanset om kalderens t() er board-scoped. `params` er valgfrie ICU-params
// (fx { raceDays: 5 } for requestReason.windowBlocked — #1084).
export function resolveBoardCopy(t, keyField, fallback = "", params = {}) {
  if (keyField) return t(`board:${keyField}`, { ...params, defaultValue: fallback || "" });
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
    // #1084 · personality/identity-koder foretrækkes over de rå danske
    // fallback-strenge (personalitySummary/profileHint) når backend sender dem.
    const personalitySummary = params.personality
      ? resolveBoardPersonalitySummary(t, params.personality, params.personalitySummary || "")
      : (params.personalitySummary || "");
    let profileHint = params.profileHint || "";
    if (params.identitySummaryParams) {
      const identitySummary = resolveBoardIdentitySummaryFromParams(t, params.identitySummaryParams, "");
      const hint = identitySummary
        ? t("board:feedback.awaitingFirstMarkers.profileHint", { identitySummary, defaultValue: "" })
        : "";
      if (hint) profileHint = ` ${hint}`;
    }
    base = t(`board:${feedback.summary_key}`, {
      strong: strongLabel,
      weak: weakLabel,
      weakLower: weakLabel.toLowerCase(),
      personalitySummary,
      profileHint,
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

// ── #1084 · Identity-profil + personality-summaries ───────────────────────────
//
// Backend (boardIdentity.js) emitterer summary_key + summary_params med rå koder;
// fragmenterne (identitySummary.* / personalitySummary.*) komponeres her så hele
// sætningen følger sproget. Dansk råtekst forbliver fallback.

export function resolveBoardIdentitySummaryFromParams(t, params, fallback = "") {
  if (!params) return fallback || "";

  const primary = params.primarySpecialization
    ? t(`board:specialization.${params.primarySpecialization}`, { defaultValue: "" })
    : "";
  const secondary = params.secondarySpecialization
    ? t(`board:specialization.${params.secondarySpecialization}`, { defaultValue: "" })
    : "";
  if (!primary || !secondary) return fallback || "";

  const youth = t(`board:identitySummary.youth.${params.youthLevel || "medium"}`, { defaultValue: "" });
  const squad = t(`board:identitySummary.squad.${params.squadStatus || "healthy"}`, { defaultValue: "" });
  const national = params.nationalCoreEstablished && params.nationalCoreCode
    ? t("board:identitySummary.national.core", {
      country: getCountryDisplay(params.nationalCoreCode).name || params.nationalCoreCode,
      percent: params.nationalCoreSharePct ?? 0,
      defaultValue: "",
    })
    : t("board:identitySummary.national.mixed", { defaultValue: "" });
  const starLevelLabel = params.starProfileLevel
    ? t(`board:starProfileLevel.${params.starProfileLevel}`, { defaultValue: "" })
    : "";
  const star = starLevelLabel
    ? t("board:identitySummary.star.profile", { label: starLevelLabel.toLowerCase(), defaultValue: "" })
    : t("board:identitySummary.star.none", { defaultValue: "" });

  return t("board:identitySummary.template", {
    primary,
    secondaryLower: secondary.toLowerCase(),
    youth,
    squad,
    national,
    star,
    defaultValue: fallback || "",
  });
}

export function resolveBoardIdentitySummary(t, identityProfile) {
  if (!identityProfile) return "";
  return resolveBoardIdentitySummaryFromParams(
    t,
    identityProfile.summary_params,
    identityProfile.summary || ""
  );
}

// Accepterer både outlook.personality ({ sports_ambition, ... }) og
// feedback.summary_params.personality (samme koder).
export function resolveBoardPersonalitySummary(t, personality, fallback = "") {
  if (!personality) return fallback || "";
  const { sports_ambition: ambitionCode, financial_risk: riskCode, identity_strength: identityCode } = personality;
  if (!ambitionCode || !riskCode || !identityCode) {
    return fallback || personality.summary || "";
  }

  const ambition = t(`board:personalitySummary.ambition.${ambitionCode}`, { defaultValue: "" });
  const risk = t(`board:personalitySummary.risk.${riskCode}`, { defaultValue: "" });
  const identity = t(`board:personalitySummary.identity.${identityCode}`, { defaultValue: "" });
  if (!ambition || !risk || !identity) {
    return fallback || personality.summary || "";
  }

  return t("board:personalitySummary.template", {
    ambition,
    risk,
    identity,
    defaultValue: fallback || personality.summary || "",
  });
}
