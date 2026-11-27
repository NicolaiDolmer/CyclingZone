// #8725 · Kontakten sentence_case_8725 (off | beta | on) for sentence case i
// kittets små labels (TASTE v2 M1). Layout har allerede viewerens stadier
// (loadFeatureFlagStages); her afgøres kun, om <html> skal bære
// data-sentence-case, som index.css' `sentence:`-variant læser.
//
// Fail-safe: ukendt stadie, fejlet kald eller manglende svar = off, så siden
// ser ud som i dag.

export const SENTENCE_CASE_FLAG_KEY = "sentence_case_8725";
export const SENTENCE_CASE_ATTR = "data-sentence-case";

/** Er sentence case tændt for denne viewer? Beta-testere og "on" for alle. */
export function isSentenceCaseOn(stage: string | null | undefined): boolean {
  return stage === "beta" || stage === "on";
}

/** Sætter eller fjerner attributten på roden. Ren bortset fra DOM-skrivningen. */
export function applySentenceCase(on: boolean, root: Element | null | undefined = globalThis.document?.documentElement): void {
  if (!root) return;
  if (on) root.setAttribute(SENTENCE_CASE_ATTR, "");
  else root.removeAttribute(SENTENCE_CASE_ATTR);
}
