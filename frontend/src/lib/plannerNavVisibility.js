// Season Planner nav-synlighed (spec §3) — ren funktion, unit-testbar. Spejler
// scoutingNavVisibility: returnér en tom liste når peak_planner_enabled er OFF, så
// array-spread'et i buildNavGroups udelader menupunktet (samme kill-switch-mønster).
export function plannerNavItem(enabled, t) {
  return enabled ? [{ to: "/planner", label: t("nav.item.planner") }] : [];
}
