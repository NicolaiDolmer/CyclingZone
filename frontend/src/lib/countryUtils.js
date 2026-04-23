function normalizeCountryCode(code) {
  return typeof code === "string" ? code.trim().toUpperCase() : "";
}

export function getFlagEmoji(code) {
  const normalizedCode = normalizeCountryCode(code);
  if (!/^[A-Z]{2}$/.test(normalizedCode)) return "";

  return [...normalizedCode]
    .map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0)))
    .join("");
}

export function getCountryName(code, locale = "da-DK") {
  const normalizedCode = normalizeCountryCode(code);
  if (!normalizedCode) return "";

  try {
    return new Intl.DisplayNames([locale, "en"], { type: "region" }).of(normalizedCode) || normalizedCode;
  } catch (_error) {
    return normalizedCode;
  }
}

export function getCountryDisplay(code, locale = "da-DK") {
  const normalizedCode = normalizeCountryCode(code);
  const flag = getFlagEmoji(normalizedCode);
  const name = getCountryName(normalizedCode, locale);

  return {
    code: normalizedCode || null,
    flag,
    name,
    label: [flag, name].filter(Boolean).join(" ").trim() || normalizedCode || "Ukendt land",
  };
}
