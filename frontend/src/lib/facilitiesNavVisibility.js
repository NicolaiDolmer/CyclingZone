// Nav-synlighed for Klub-fladen (#1441 A3). Ren funktion → unit-testet.
// Spejler academyNavVisibility: tom liste når disabled, så spread'en i
// buildNavGroups blot udelader item'et.
export function facilitiesNavItem(facilitiesEnabled, t) {
  return facilitiesEnabled ? [{ to: "/klub", label: t("nav.item.klub") }] : [];
}
