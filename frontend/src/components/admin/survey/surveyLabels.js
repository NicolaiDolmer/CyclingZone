// #4943 · Etiketter der deles af fanerne på admin-fladen.
//
// Spørgsmåls- og valg-tekster ligger i DATABASEN (label_en/label_da), ikke i
// i18n-filerne: et skema er redaktionelt indhold med en levetid
// (docs/SURVEY_SYSTEM.md §1). Kun fladens egen chrome er i18n.

/** Segmenter der aldrig må rendes som en rå nøgle ("unknown", "da", "3"). */
export function segmentLabel(t, value) {
  if (value == null) return t("surveyResults.segment.values.unknown");
  if (/^\d+$/.test(String(value))) {
    return t("surveyResults.segment.values.division", { value });
  }
  const known = ["da", "en", "active", "lapsed", "unknown"];
  return known.includes(value)
    ? t(`surveyResults.segment.values.${value}`)
    : String(value);
}

/** Slår et aggregeret spørgsmål op på nøgle; undefined når skemaet ikke har det. */
export function questionByKey(data, key) {
  return (data?.questions ?? []).find((question) => question.key === key);
}

/** Alle fritekst-spørgsmål i skemaets egen rækkefølge. */
export function textQuestions(data) {
  return (data?.questions ?? []).filter((question) => question.kind === "text");
}
