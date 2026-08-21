// backend/lib/engine/v4/adapters/entrantAdapter.ts
// Race Engine v4 F2 (#4030), Fase B4: oversaettelseslag rider_derived_abilities-
// raekke + rolle -> Entrant (kerne-kontrakten, types.ts).
// SSOT: docs/superpowers/specs/2026-08-21-race-engine-v4-f2-core-design.md
//   §3 modul-layout ("adapters/entrantAdapter.ts rider_derived_abilities-række
//   + rolle → Entrant. abilityRegistry er kanonisk evne-liste").
//
// UDENFOR renheds-graensen (designdoc §1 renheds-raekke): denne fil MAA
// importere backend-moduler (abilityRegistry.js/raceRoles.js). Selve
// funktionerne er stadig RENE (raekke-objekt ind, type ud — INGEN DB-kald
// her, det er kaldstedets ansvar at hente raekken).

import { ABILITY_REGISTRY } from "../../../abilityRegistry.js";
import { VALID_RACE_ROLES } from "../../../raceRoles.js";
import type { AbilityKey, EffortLevel, Entrant, RiderRole } from "../types.ts";

// abilityRegistry.js's REGISTRY_ABILITY_KEYS er allerede de 15 noegler i
// lagringsorden — her afledt lokalt af ABILITY_REGISTRY (samme kilde) saa
// AbilityKey-typen (types.ts's litteral-kopi) er den eneste antagelse om
// noegle-SAETTET; selve raekkefoelgen laeses altid fra registry-runtimen.
const ABILITY_KEYS_IN_STORAGE_ORDER: readonly AbilityKey[] = ABILITY_REGISTRY
  .slice()
  .sort((a, b) => a.storageOrder - b.storageOrder)
  .map((a) => a.key as AbilityKey);

const VALID_ROLE_SET = new Set<string>(VALID_RACE_ROLES);

/**
 * Formen paa en rider_derived_abilities-DB-raekke (evt. med ekstra kolonner
 * som formula_version/generated_at/hidden_potential/ability_caps/
 * ability_progress — de ignoreres her, kun de 15 evne-noegler + rider_id laeses).
 */
export type AbilitiesRow = {
  rider_id?: string | null;
} & Partial<Record<AbilityKey, number | string | null | undefined>>
  & Record<string, unknown>;

function clampAbility(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(99, n));
}

/**
 * Udtraekker de 15 registry-evner fra en DB-raekke, clampet til [0, 99].
 * Manglende/null/ikke-numerisk evne -> 0 (defensivt, samme konvention som
 * raceSimulator.js's terrainScore: "Manglende ability → 0 (defensivt)").
 */
export function abilitiesFromRow(row: AbilitiesRow): Record<AbilityKey, number> {
  const out = {} as Record<AbilityKey, number>;
  for (const key of ABILITY_KEYS_IN_STORAGE_ORDER) {
    out[key] = clampAbility(row[key]);
  }
  return out;
}

/** Ukendt/manglende rolle -> "free_role" (VALID_RACE_ROLES's laveste-antagelse-rolle). */
export function normalizeRole(role: unknown): RiderRole {
  return typeof role === "string" && VALID_ROLE_SET.has(role) ? (role as RiderRole) : "free_role";
}

export type EntrantAdapterOptions = {
  /** Overstyrer row.rider_id — kraevet hvis raekken ikke selv baerer rider_id. */
  riderId?: string;
  role?: unknown;
  /** F2 behandler alle som 'normal' (segmentLoop.ts laeser feltet, effekten er M12/F3-scope). */
  effort?: EffortLevel;
  /** 0-1, dag-til-dag-slid (M7/F3-scope). Default 1 (frisk) naar intet andet er kendt. */
  condition?: number;
};

/**
 * REN oversaettelse: rider_derived_abilities-raekke + rolle/effort/condition
 * -> Entrant (kerne-kontrakten). INGEN DB-kald — kaldstedet henter raekken.
 */
export function entrantFromAbilitiesRow(row: AbilitiesRow, opts: EntrantAdapterOptions = {}): Entrant {
  const riderId = opts.riderId ?? row.rider_id;
  if (!riderId) {
    throw new Error("entrantFromAbilitiesRow: rider_id mangler (hverken row.rider_id eller opts.riderId er sat)");
  }
  const condition = Number.isFinite(opts.condition) ? Math.max(0, Math.min(1, opts.condition as number)) : 1;
  return {
    rider_id: String(riderId),
    abilities: abilitiesFromRow(row),
    role: normalizeRole(opts.role),
    effort: opts.effort ?? "normal",
    condition,
  };
}

/** Batch-variant: praktisk for harness/tests der oversaetter et helt startfelt ad gangen. */
export function entrantsFromAbilitiesRows(
  rows: readonly AbilitiesRow[],
  roleAndOptsByRiderId: (riderId: string) => EntrantAdapterOptions = () => ({}),
): Entrant[] {
  return rows.map((row) => {
    const riderId = String(row.rider_id ?? "");
    return entrantFromAbilitiesRow(row, { riderId, ...roleAndOptsByRiderId(riderId) });
  });
}
