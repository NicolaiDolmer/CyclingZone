// backend/lib/academyIntakeSource.ts
// #5844 — academy_intake.source: hvor et akademi-tilbud kom fra. Bevidst
// dependency-fri, så academyIntake.js, udløbs-sweep'en og api.js kan importere
// den uden at trække academyBoardGift.js (og dermed en import-cyklus) med.

export const INTAKE_SOURCE_DEFAULT = "intake";
export const BOARD_GIFT_SOURCE = "board_gift";
export const NORMAL_INTAKE_EXPIRY_DAYS = 7;
export const BOARD_GIFT_EXPIRY_DAYS = 14;

export function isBoardGiftSource(source: string | null | undefined): boolean {
  return source === BOARD_GIFT_SOURCE;
}

/** Tilbuddets frist i dage ud fra kilden. */
export function intakeOfferExpiryDaysFor(source: string | null | undefined): number {
  return isBoardGiftSource(source) ? BOARD_GIFT_EXPIRY_DAYS : NORMAL_INTAKE_EXPIRY_DAYS;
}

/** Signing-fee for et tilbud: bestyrelsens gave er gratis, alt andet uændret. */
export function signingFeeForSource(source: string | null | undefined, normalFee: number): number {
  return isBoardGiftSource(source) ? 0 : normalFee;
}

/**
 * Er fejlen "kolonnen/tabellen findes ikke endnu"? Backend deployes få minutter
 * FØR auto-migrate.yml kører migrationen; i det vindue skal læse-stierne falde
 * tilbage til den gamle adfærd i stedet for at fejle (ingen gave-rækker kan
 * eksistere før migrationen).
 */
export function isMissingSchemaError(err: { code?: unknown; message?: unknown } | null | undefined): boolean {
  if (!err) return false;
  const code = String(err.code ?? "");
  if (code === "42703" || code === "42P01" || code === "PGRST204" || code === "PGRST205") return true;
  return /column .*source.* does not exist|academy_gift_claims/i.test(String(err.message ?? ""));
}
