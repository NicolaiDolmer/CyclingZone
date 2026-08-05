// #2752/#2361 — dismiss-state for SeasonWrapNudgeCard (dashboardets "sæson N er
// slut"-kort). Samme localStorage-mønster og PR-SÆSON-nøgle som
// seasonStartGuide.js's dismiss-par (readSeasonStartDismissed/write...), men
// keyet på den AFSLUTTEDE sæsons id, ikke den aktive — kortet handler om DEN
// sæson, og skal derfor huske dismiss pr. afsluttet sæson, ikke pr. aktiv.

const DISMISS_KEY_PREFIX = "cz-dashboard-season-wrap-dismissed-";

export function seasonWrapDismissKey(completedSeasonId) {
  return `${DISMISS_KEY_PREFIX}${completedSeasonId}`;
}

export function readSeasonWrapDismissed(completedSeasonId) {
  if (!completedSeasonId) return false;
  try {
    return globalThis.localStorage?.getItem(seasonWrapDismissKey(completedSeasonId)) === "1";
  } catch {
    return false; // private mode / storage afvist
  }
}

export function writeSeasonWrapDismissed(completedSeasonId) {
  if (!completedSeasonId) return;
  try {
    globalThis.localStorage?.setItem(seasonWrapDismissKey(completedSeasonId), "1");
  } catch {
    /* private mode / storage afvist — ignorer */
  }
}
