// Frontend-SSOT for staff-evne-visning (#2220 A4b). Staff-shapen er
// { overall, dimensions, levels, roleSkills }. Kolonner pr. rolle (spec §1.2).
// #2529 (ejer-beslutning Discord 16/7): "youth" + "junior" kollapset til ÉT
// "u23"-bånd (spillere kunne ikke finde forklaringen på båndene). Kaldes
// "coaching group" i UI — IKKE "tier" — for ikke at kollidere med #2492's
// tre-tier KLUBSTRUKTUR (Senior/U23/Junior), som er noget andet.
export const STAFF_LEVEL_KEYS = ["u23", "senior"];
export const STAFF_DIMENSION_KEYS = ["physical", "mental", "technical"];
export const STAFF_ROLE_SKILL_KEYS = {
  training: [],
  scouting: ["evaluation", "reach"],
  medical: ["recovery", "injuryPrevention"],
  academy: ["intake", "growth"],
  commercial: ["negotiation", "marketing"],
};
export function staffColumnsFor(role) {
  const cols = [];
  if (role === "training") {
    cols.push({ key: "dimensions", axisKeys: STAFF_DIMENSION_KEYS, source: "dimensions" });
  } else if ((STAFF_ROLE_SKILL_KEYS[role] || []).length) {
    cols.push({ key: "roleSkills", axisKeys: STAFF_ROLE_SKILL_KEYS[role], source: "roleSkills" });
  }
  cols.push({ key: "levels", axisKeys: STAFF_LEVEL_KEYS, source: "levels" });
  return cols;
}
export function topStaffAxis(profile) {
  const ab = profile?.abilities;
  if (!ab) return null;
  const entries = [
    ...Object.entries(ab.dimensions || {}),
    ...Object.entries(ab.levels || {}),
    ...Object.entries(ab.roleSkills || {}),
  ].filter(([, v]) => Number.isFinite(v));
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return { axisKey: entries[0][0], value: entries[0][1] };
}
export function staffSpecializationHeadline(profile, t) {
  const top = topStaffAxis(profile);
  if (!top) return null;
  return t("hero.specHeadline", { axis: t(`axes.${top.axisKey}`) });
}
