// Rene display-helpers for Scouting-central (#2244 Fase 3 Slice C). Ingen I/O —
// unit-testet uafhængigt af hooks/komponenter.

// Antal hele dage til en ready_on-dato (YYYY-MM-DD, Copenhagen-kalenderdato fra
// backend). Aldrig negativ — en dato i fortiden (sweep endnu ikke kørt) vises som 0.
export function daysUntil(readyOn, now = new Date()) {
  if (!readyOn) return 0;
  const ready = new Date(`${readyOn}T00:00:00Z`);
  if (Number.isNaN(ready.getTime())) return 0;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const diffMs = ready.getTime() - today.getTime();
  return Math.max(0, Math.ceil(diffMs / 86400000));
}

// Menneskelæsbart kriterie-label for en mission (scope + value). `translateScope`
// og `translateCountry` injiceres af kalderen (i18n/nationality-navn-opslag) så
// denne fil forbliver ren.
export function missionCriteriaLabel(criteria, { translateScope, translateCountry } = {}) {
  if (!criteria?.scope) return "";
  const scope = criteria.scope;
  if (scope === "u23") return translateScope ? translateScope("u23") : "U23";
  if (scope === "country" || scope === "nm") {
    const countryLabel = criteria.value && translateCountry ? translateCountry(criteria.value) : criteria.value;
    const scopeLabel = translateScope ? translateScope(scope) : scope;
    return countryLabel ? `${scopeLabel} · ${countryLabel}` : scopeLabel;
  }
  if (scope === "division") {
    return translateScope ? translateScope("division") : `Division ${criteria.value ?? ""}`;
  }
  return translateScope ? translateScope(scope) : scope;
}
