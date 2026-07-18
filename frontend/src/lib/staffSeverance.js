// #2649 (opsigelses-gebyr, ejer-beslutning 18/7): severance = 4 × ugentlig løn.
// 1:1-spejling af backend/lib/facilityConstants.js (staffWeeklyWage/staffReleaseSeverance
// + STAFF_RELEASE_SEASON_WEEKS/STAFF_RELEASE_SEVERANCE_WEEKS) — samme co-SSOT-disciplin
// som frontend/src/preview/clubMock.js (parity-testet mod backend, se
// staffSeverance.parity.test.js). Frontend regner selv beløbet ud til bekræftelses-
// dialogen (ingen ekstra "quote"-roundtrip) — backend er stadig eneste autoritative
// kilde ved selve debiteringen (facilityService.releaseStaff).
export const STAFF_RELEASE_SEASON_WEEKS = 11;
export const STAFF_RELEASE_SEVERANCE_WEEKS = 4;

export function staffWeeklyWage(salary) {
  return Math.round((salary || 0) / STAFF_RELEASE_SEASON_WEEKS);
}

export function staffReleaseSeverance(salary) {
  return STAFF_RELEASE_SEVERANCE_WEEKS * staffWeeklyWage(salary);
}
