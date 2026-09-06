// #4557 · Klub-DNA-copy-resolvere, udtrukket UÆNDRET fra BoardPage.jsx så både
// den gamle bestyrelsesside (fallback ved kill-switch off) og den nye Boardroom
// læser DNA-teksterne gennem præcis den samme funktion. Ingen ny copy her:
// nøglerne er dem der allerede står i `board.json` (`dna.<key>.*`).
//
// Kontrakt: `t` er board-namespace-scoped (fra useTranslation("board")).

/** Én af label/shortDescription/longDescription for et DNA, med DB-tekst som fallback. */
export function getDnaCopy(t, dna, field) {
  if (!dna?.key) return "";
  const keyByField = {
    label: dna.label_key || `dna.${dna.key}.label`,
    shortDescription: dna.short_description_key || `dna.${dna.key}.shortDescription`,
    longDescription: dna.long_description_key || `dna.${dna.key}.longDescription`,
  };
  const fallbackByField = {
    label: dna.label,
    shortDescription: dna.short_description,
    longDescription: dna.long_description,
  };
  return t(keyByField[field], { defaultValue: fallbackByField[field] || "" });
}

/** "Matches your DEN core from season 1" o.l. — hvorfor bestyrelsen foreslår netop dette DNA. */
export function getDnaRationale(t, suggestion) {
  const rationaleKey = suggestion?.rationale_key || suggestion?.rationaleKey;
  if (!rationaleKey) return suggestion?.rationale || "";
  const params = suggestion.rationale_params || suggestion.rationaleParams || {};
  return t(rationaleKey, {
    ...params,
    specLabel: params.primarySpec
      ? t(`dna.specLabel.${params.primarySpec}`, { defaultValue: params.primarySpec })
      : "",
    defaultValue: suggestion.rationale || "",
  });
}

/** Forslagets slot-label ("National match" / "Specialisation match" / "Wildcard"). */
export function getDnaSlotLabel(t, suggestion) {
  return t(`dna.slot.${suggestion?.suggestion_slot}`, { defaultValue: t("dna.slot.fallback") });
}
