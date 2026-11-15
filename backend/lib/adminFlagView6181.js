// #6181 · Hvordan admin-tavlen viser et stadie-flag. Ren funktion, ingen I/O.
//
// Tavlen maa aldrig vise noget andet end det spilleren faar. For de binaere
// noegler (PLAYER_VISIBLE_BINARY_FLAG_KEYS) laeses kun "on" (eller true) som
// taendt; "beta" er slukket for alle, baade i modulet bag noeglen, i SQL-vejen
// og i GET /api/feature-flags. Tavlen skal derfor:
//   - markere noeglen som binaer (boolean_only), ogsaa naar raekkens vaerdi er en streng,
//   - vise en skrevet "beta" som slukket, med en advarsel i stedet for et pænt "Beta",
//   - aldrig tilbyde "beta" som valg.
// Alle andre noegler vises som foer (normalizeStageValue).
import {
  PLAYER_VISIBLE_BINARY_FLAG_KEYS,
  isUnknownStageValue,
  normalizeStageValue,
} from "./stageFlagCatalog.js";

/** Advarselskode tavlen kan vise (frontend ejer teksten). */
export const BETA_READS_AS_OFF_WARNING = "beta_reads_as_off";

const BINARY_STAGES = Object.freeze(["off", "on"]);
const ALL_STAGES = Object.freeze(["off", "beta", "on"]);

/**
 * @param {{ key: string, area: string, label: string }} flag  post fra STAGE_FLAGS
 * @param {{ value?: unknown, updated_at?: string|null } | null | undefined} row  app_config-raekken, hvis den findes
 * @param {{ binaryKeys?: readonly string[] }} [opts]
 */
export function adminFlagView(flag, row, { binaryKeys = PLAYER_VISIBLE_BINARY_FLAG_KEYS } = {}) {
  // Raekken findes ikke = "off", praecis som evaluateFlagStage laeser den.
  const raw = row ? (row.value ?? null) : null;
  const binary = binaryKeys.includes(flag.key);
  const normalized = normalizeStageValue(raw);
  // Binaer noegle: "beta" er slukket, ikke et stadie. Resten som normalizeStageValue.
  const stage = binary && normalized === "beta" ? "off" : normalized;
  const booleanOnly = binary || typeof raw === "boolean";
  return {
    ...flag,
    stage,
    raw_value: raw,
    boolean_only: booleanOnly,
    binary,
    offered_stages: booleanOnly ? BINARY_STAGES : ALL_STAGES,
    warning: binary && raw === "beta" ? BETA_READS_AS_OFF_WARNING : null,
    configured: Boolean(row),
    unknown_value: isUnknownStageValue(raw),
    updated_at: row?.updated_at ?? null,
  };
}
