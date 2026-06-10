// #1240 · Tilbage-navigation i bestyrelses-forhandlings-wizarden.
//
// Ren state-logik udtrukket fra BoardPage.jsx så den kan unit-testes
// (node --test). Wizard-flowet er trin 1 (strategi) → 2 (forhandling, ét mål
// ad gangen) → 3 (underskrift). Tilbage må ALDRIG smide brugerens valg væk:
// `finalGoals`/`negotiated` rører vi ikke — kun trin/mål-index/pending-view.

/**
 * Beregn forrige wizard-state ved klik på "Tilbage".
 *
 * Rækkefølge (mest lokale view først):
 *   trin 3            → trin 2 på sidste mål (goalIdx er bevaret af accept-handleren)
 *   trin 2 + pending  → luk kompromis-viewet, bliv på samme mål
 *   trin 2 + mål >0   → forrige mål
 *   trin 2 + mål 0    → trin 1 (strategi)
 *   trin 1            → null (ingen intern tilbage — "Tilbage til oversigt" ejes af parent)
 *
 * @returns {{ step: number, goalIdx: number, pendingNegotiate: boolean } | null}
 */
export function getWizardBackState({ step, goalIdx = 0, pendingNegotiate = false } = {}) {
  if (step === 3) return { step: 2, goalIdx, pendingNegotiate: false };
  if (step === 2) {
    if (pendingNegotiate) return { step: 2, goalIdx, pendingNegotiate: false };
    if (goalIdx > 0) return { step: 2, goalIdx: goalIdx - 1, pendingNegotiate: false };
    return { step: 1, goalIdx: 0, pendingNegotiate: false };
  }
  return null;
}

/**
 * Afgør om "Start forhandling →" på trin 1 skal GENOPTAGE en igangværende
 * forhandling (bevarede valg) frem for at starte forfra.
 *
 * Genoptag når forslaget er uændret siden forhandlingen startede: trin-1-
 * useEffect'en refetcher proposal (ny array-reference) ved fokus-/planskifte
 * og ved wizard-genåbning, så reference-lighed mellem `previewGoals` og
 * `proposedGoals` betyder "samme forslag, brugeren gik bare tilbage".
 */
export function canResumeNegotiation({ proposedGoals, previewGoals, finalGoals } = {}) {
  return Boolean(
    Array.isArray(proposedGoals)
    && proposedGoals.length > 0
    && proposedGoals === previewGoals
    && Array.isArray(finalGoals)
    && finalGoals.length === proposedGoals.length
  );
}
