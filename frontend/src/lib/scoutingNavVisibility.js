// Nav-synlighed for Scouting-central (#2244 Fase 3 Slice C). Ren funktion →
// unit-testet. Spejler facilitiesNavVisibility: tom liste når systemet er
// slukket (scout_system_enabled kill-switch), så spread'en i buildNavGroups
// blot udelader item'et.
export function scoutingNavItem(scoutSystemEnabled, t) {
  return scoutSystemEnabled ? [{ to: "/scouting", label: t("nav.item.scouting") }] : [];
}
