// #4387 — dismiss-state for dashboardets kontrakt-udløbs-advarsel (#1150,
// DashboardPage.jsx). Ejer-go i Discord-tråden 29/8 (egomadsen/bobby2106):
// beskeden stod fremme hele sæsonen uden nogen måde at kvittere for den.
//
// Samme localStorage-mønster som lib/seasonStartGuide.js / lib/seasonWrapNudge.js
// (try/catch, fejler stille i privat browsing), men nøglet på BÅDE hold-id og
// sæson-NUMMER — ikke kun sæson-id som søskende-filerne — fordi beskeden er en
// pr.-HOLD advarsel og skal komme igen ved næste sæsonskifte uden manuel
// nulstilling (samme "pr. sæson"-garanti som seasonStartDismissed).
//
// Simpelt valg (bevidst, jf. opgavebrief #4387): vi gemmer SÆTTET af rytter-
// id'er der var udløbende DA beskeden blev lukket, ikke bare et antal. Et
// rent antal ville IKKE opdage at en ny rytter kom ind i udløbsvinduet hvis
// samtidig en anden rytter forlod det (fx forlænget kontrakt) — samme COUNT,
// forskelligt SET. Sættet er den mindste struktur der er korrekt i begge
// retninger (ny rytter tilføjet ELLER fjernet fra vinduet).
const DISMISS_KEY_PREFIX = "cz-dashboard-contract-expiry-dismissed-";

export function contractExpiryDismissKey(teamId, seasonNumber) {
  return `${DISMISS_KEY_PREFIX}${teamId}-${seasonNumber}`;
}

/**
 * @returns {string[]|null} rytter-id'erne der var udløbende ved sidste lukning,
 * eller null hvis beskeden aldrig er lukket for denne hold+sæson-kombination
 * (eller storage er utilgængelig/korrupt).
 */
export function readContractExpiryDismissed(teamId, seasonNumber) {
  if (!teamId || !seasonNumber) return null;
  try {
    const raw = globalThis.localStorage?.getItem(contractExpiryDismissKey(teamId, seasonNumber));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : null;
  } catch {
    return null; // private mode / storage afvist / korrupt JSON — vis hellere beskeden end at fejle
  }
}

export function writeContractExpiryDismissed(teamId, seasonNumber, riderIds) {
  if (!teamId || !seasonNumber) return;
  try {
    globalThis.localStorage?.setItem(
      contractExpiryDismissKey(teamId, seasonNumber),
      JSON.stringify((riderIds || []).map(String))
    );
  } catch {
    /* private mode / storage afvist — ignorer, lukningen er stadig anvendt i UI-state */
  }
}

/**
 * Skal beskeden vises? Ja hvis den aldrig er lukket for denne sæson, ELLER
 * hvis mindst én af de NUVÆRENDE udløbende rytter-id'er ikke indgik i sættet
 * fra sidste lukning (en ny rytter er kommet ind i udløbsvinduet siden da —
 * #4387 acceptance-krav 2).
 */
export function shouldShowContractExpiryNotice(currentRiderIds, dismissedRiderIds) {
  if (!dismissedRiderIds) return true;
  const dismissedSet = new Set(dismissedRiderIds.map(String));
  return (currentRiderIds || []).some((id) => !dismissedSet.has(String(id)));
}
