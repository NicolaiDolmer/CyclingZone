// #8081 (ejervalg 16/11): rene regler for akademisiden udgave A (overblik + faner).
//
// Siden vises kun med kontakten academy_page_v2_8081 tændt (GET /api/feature-flags).
// Slukket står akademisiden præcis som før. Ren .ts uden React, så node --test kan loade den.
import { academyTargetSquad } from "../../lib/squadCaps.ts";
import { isYouthSquad, type YouthSquad } from "../../lib/youthSquadPages.ts";

export const ACADEMY_PAGE_V2_FLAG_KEY = "academy_page_v2_8081";

export type AcademyV2Tab = "intake" | "talents" | "profile";

/** Blandet + de fire aldre. Spejl af backend/lib/academyAgeFocus.js (AGE_FOCUS_VALUES). */
export const AGE_FOCUS_MIXED = "mixed";
export const AGE_FOCUS_OPTIONS: readonly string[] = Object.freeze([AGE_FOCUS_MIXED, "16", "17", "18", "19"]);

/** null/ukendt = Blandet; ellers alderen som streng. */
export function ageFocusChoice(value: string | null | undefined): string {
  return value && AGE_FOCUS_OPTIONS.includes(value) ? value : AGE_FOCUS_MIXED;
}

/** Valget som backend gemmer det: Blandet = null. */
export function ageFocusForSave(choice: string): string | null {
  return choice === AGE_FOCUS_MIXED || !AGE_FOCUS_OPTIONS.includes(choice) ? null : choice;
}

/**
 * Fund A1 fra design-gennemgangen: siden åbner på "Ugens optag", når der er noget at gøre
 * der (kandidater, bestyrelsens gave eller en åben hentning), ellers på "Dine talenter".
 * Har holdet heller ingen talenter, bliver den på optaget, hvor den tomme tilstand har en vej videre.
 */
export function initialAcademyTab({ regularCount, giftCount, pullOpen, talentCount }: {
  regularCount: number;
  giftCount: number;
  pullOpen: boolean;
  talentCount: number;
}): AcademyV2Tab {
  const intakeHasWork = regularCount > 0 || giftCount > 0 || pullOpen;
  return !intakeHasWork && talentCount > 0 ? "talents" : "intake";
}

/**
 * Truppen et talent står på. riders.squad er sandheden (sendt af /academy/me);
 * mangler den, afgør sæsonalderen det med samme regel som optaget.
 */
export function talentSquad(
  rider: { squad?: string | null; birthdate?: string | null },
  seasonYear: number | null | undefined,
): YouthSquad | null {
  if (isYouthSquad(rider.squad)) return rider.squad;
  return academyTargetSquad(rider.birthdate ?? null, seasonYear);
}
