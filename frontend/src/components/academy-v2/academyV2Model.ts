// #8081 (ejervalg 16/11): rene regler for akademisiden udgave A (overblik + faner).
//
// Siden vises kun med kontakten academy_page_v2_8081 tændt (GET /api/feature-flags).
// Slukket står akademisiden præcis som før. Ren .ts uden React, så node --test kan loade den.
import { academyTargetSquad } from "../../lib/squadCaps.ts";
import { isYouthSquad, type YouthSquad } from "../../lib/youthSquadPages.ts";

export const ACADEMY_PAGE_V2_FLAG_KEY = "academy_page_v2_8081";

export type AcademyV2Tab = "intake" | "talents" | "ledger" | "profile";

/** Blandet + de fire aldre. Spejl af backend/lib/academyAgeFocus.js (AGE_FOCUS_VALUES). */
export const AGE_FOCUS_MIXED = "mixed";
export const AGE_FOCUS_OPTIONS: readonly string[] = Object.freeze([AGE_FOCUS_MIXED, "16", "17", "18", "19"]);

/** null/ukendt = Blandet; ellers alderen som streng. */
export function ageFocusChoice(value: string | null | undefined): string {
  return value && AGE_FOCUS_OPTIONS.includes(value) ? value : AGE_FOCUS_MIXED;
}

/** Hvordan et talent kom til holdet: et signeret akademi-tilbud eller en vundet ungdomsauktion. */
export type TalentOrigin = "offer" | "youthAuction";
export interface SignedIntakeRow { rider_id?: string | null }
export interface YouthAuctionWinRow {
  rider_id?: string | null;
  current_bidder_id?: string | null;
  is_guaranteed_sale?: boolean | null;
  is_youth?: boolean | null;
}

/**
 * "Kom via" pr. rytter. Samme regel som akademi-regnskabets rytterkreds (buildAcademyRiderPool,
 * backend/lib/academyPnl.ts i PR #8288): et signeret academy_intake for holdet er et
 * akademi-tilbud og vinder; ellers tæller en gennemført ungdomsauktion holdet vandt. Ingen
 * af delene: ingen oprindelse (tabellen viser "–").
 */
export function buildTalentOrigins({ signedIntake = [], youthAuctionWins = [] }: {
  signedIntake?: readonly SignedIntakeRow[];
  youthAuctionWins?: readonly YouthAuctionWinRow[];
} = {}): Map<string, TalentOrigin> {
  const origins = new Map<string, TalentOrigin>();
  for (const row of signedIntake) {
    if (row?.rider_id) origins.set(row.rider_id, "offer");
  }
  for (const a of youthAuctionWins) {
    if (!a?.rider_id || a.is_youth !== true || origins.has(a.rider_id)) continue;
    if (!a.current_bidder_id && !a.is_guaranteed_sale) continue;
    origins.set(a.rider_id, "youthAuction");
  }
  return origins;
}

/**
 * Ejer 16/11 (#8081): "Dine talenter" viser kun egen avl, dvs. ryttere med et signeret akademi-tilbud
 * fra holdets eget akademi. Ungdomsauktion, transfer og ukendt oprindelse (fx gamle ryttere uden
 * academy_intake-række) er IKKE egen avl: den sikre side er at udelade frem for at gætte.
 * null = oprindelsen er ikke kendt endnu (indlæser eller fejlede): listen kan da ikke afgøres.
 * Trupgrænserne (U23/junior) tæller fortsat hele truppen; kun listen filtreres.
 */
export function ownAcademyTalents<T extends { id: string }>(
  roster: readonly T[],
  origins: ReadonlyMap<string, TalentOrigin> | null,
): T[] | null {
  if (origins === null) return null;
  return roster.filter((r) => origins.get(r.id) === "offer");
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
