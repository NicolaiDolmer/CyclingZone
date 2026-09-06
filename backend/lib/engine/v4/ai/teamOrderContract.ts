// backend/lib/engine/v4/ai/teamOrderContract.ts
// Race Engine v4 F3, M14 (#4030) — DEN ENE TeamOrder-kontrakt. Spillere, AI og
// ordre-adapteren bruger PRAECIS samme form, ingen side-kanaler, ingen ekstra
// felter kun AI (eller kun spilleren) kan saette.
// SSOT: docs/superpowers/specs/2026-08-21-race-tactics-orders-v1-design.md
// ("Ordre-kontrakten") + docs/RACE_ENGINE_RULES.md §0/§1.
//
// #4246 (ejer-beslutninger 27/8 + 2/9, LAAST — auditten 5/9 fandt kontrakten i
// FIRE uenige kopier, hvor spiller-stien sendte et `race_role`-felt som netop
// denne fil afviste):
//
//  1. ROLLEN ER STANDARDORDREN. `race_role` bor i holdudtagelsen
//     (`race_entries.race_role`) og gaelder HELE loebet. Den er derfor IKKE et
//     felt i ordren — den er det den tomme ordre BETYDER. `defaultOrderForRole`
//     nedenfor er den oversaettelse, og `defaultTeamOrderForRoster` bygger et
//     helt holds standardordre ud af rollerne alene.
//  2. TAKTIK-KORTET ER ET ETAPE-OVERLAY. Det spilleren gemmer pr. etape laegges
//     OVEN PAA standardordren (`applyStageOverlayToOrder`) og kan aldrig
//     overskrive rollen — kun dagens udmoentning af den.
//  3. SPRINT-TOGET ER EN SPILLER-KANAL. `leadout` pr. rytter er den ene noegle
//     der manglede for at M6 (sprint-toget) kunne saettes af et menneske og
//     ikke kun af harnessen. Additivt og VALGFRIT: en ordre uden feltet er
//     stadig gyldig (fravaer = false), saa AI-taktikkens eksisterende output og
//     hver eneste raekke der allerede ligger i `race_team_orders` bestaar.
//
// TYPER FRA types.ts: `RiderRole`/`EffortLevel` importeres type-only fra den
// frosne kernekontrakt i stedet for at blive kopieret (den tidligere kopi var
// praecis den drift auditten fandt). Type-only-importen er 100% erasable —
// denne fil har stadig INGEN runtime-afhaengighed af types.ts.
//
// REN — ingen import fra oevrigt backend, ingen IO/Date/Math.random.

import type { EffortLevel, RiderRole } from "../types.ts";

export type { EffortLevel, RiderRole };

export type BreakawayStance = "chase" | "neutral" | "let_go";

export type TeamOrderRider = {
  rider_id: string;
  effort: EffortLevel; // M12, default "normal" (RACE_ENGINE_RULES §1b: "ikke valgt" = normal)
  try_break: boolean; // T3/M5, bounded bidrag (oeger sandsynlighed, garanterer aldrig)
  // M6, #4246 (additivt + valgfrit): rytteren koerer i holdets sprint-tog i dag.
  // Rollen `sprint_captain` er togets MAAL og saetter derfor aldrig selv feltet.
  leadout?: boolean;
};

export type TeamOrder = {
  team_id: string;
  breakaway_stance: BreakawayStance; // T3, default "neutral"
  riders: TeamOrderRider[];
};

/** Én plads i holdudtagelsen: rollen der ER standardordren. */
export type RosterEntry = { rider_id: string; role: RiderRole };

// ── Vokabularer (ÉT sted — API, adapter og AI importerer herfra) ─────────────
// Runtime-arrays, ikke kun typer: `backend/lib/raceTeamOrdersApi.js` (spiller-
// stien, ren JS) importerer dem, saa de to sider strukturelt ikke KAN diverge.

export const BREAKAWAY_STANCE_VALUES: readonly BreakawayStance[] = Object.freeze([
  "chase",
  "neutral",
  "let_go",
]);

// #4632: femtrins-intentionen (ejer 5-6/9). Samme fem strenge som types.ts's
// EffortLevel og v3's raceRoles.js VALID_EFFORTS_FIVE_STEP — ET vokabular paa
// tvaers af begge motorer (laast af en test i raceTeamOrdersApi.test.js).
export const EFFORT_LEVEL_VALUES: readonly EffortLevel[] = Object.freeze([
  "grupetto",
  "save",
  "normal",
  "protect",
  "all_out",
]);

export const RIDER_ROLE_VALUES: readonly RiderRole[] = Object.freeze([
  "captain",
  "sprint_captain",
  "helper",
  "hunter",
  "free_role",
]);

/** De ENESTE felter en TeamOrder maa baere. */
export const TEAM_ORDER_FIELDS: readonly string[] = Object.freeze(["team_id", "breakaway_stance", "riders"]);

/** De ENESTE felter en rytter-ordre maa baere. `race_role` staar bevidst IKKE her. */
export const TEAM_ORDER_RIDER_FIELDS: readonly string[] = Object.freeze([
  "rider_id",
  "effort",
  "try_break",
  "leadout",
]);

/**
 * Felter der aktivt AFVISES (ikke bare ignoreres) naar de sendes ind, med den
 * begrundelse fladen skal kunne give brugeren. Ejer-beslutning 27/8: rollen maa
 * ALDRIG kunne overskrives af taktik-kortet, saa en klient der stadig sender
 * den skal have en fejl — ikke en tavs, tabt skrivning.
 */
export const REJECTED_TEAM_ORDER_RIDER_FIELDS: readonly string[] = Object.freeze(["race_role"]);

const BREAKAWAY_STANCES: ReadonlySet<string> = new Set(BREAKAWAY_STANCE_VALUES);
const EFFORT_LEVELS: ReadonlySet<string> = new Set(EFFORT_LEVEL_VALUES);
const TEAM_ORDER_KEYS: ReadonlySet<string> = new Set(TEAM_ORDER_FIELDS);
const RIDER_ORDER_KEYS: ReadonlySet<string> = new Set(TEAM_ORDER_RIDER_FIELDS);

export type TeamOrderValidationResult = { ok: true } | { ok: false; errors: string[] };

/**
 * Streng runtime-validering mod kontrakten: rigtige noegler (og KUN dem — ingen
 * ekstra AI-only-felter, og ingen `race_role`), rigtige literal-unions, ingen
 * dubletter af rider_id. Bruges af AI-taktikken (aiTactics.ts) til at laase at
 * output aldrig afviger fra det spillerne selv kan indsende, og af
 * ordre-adapterens egen round-trip-test.
 */
export function validateTeamOrder(order: unknown): TeamOrderValidationResult {
  const errors: string[] = [];
  if (typeof order !== "object" || order === null || Array.isArray(order)) {
    return { ok: false, errors: ["order skal vaere et objekt"] };
  }
  const obj = order as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (!TEAM_ORDER_KEYS.has(key)) errors.push(`ukendt felt paa TeamOrder: "${key}"`);
  }
  if (typeof obj.team_id !== "string" || obj.team_id.length === 0) {
    errors.push("team_id skal vaere en ikke-tom streng");
  }
  if (typeof obj.breakaway_stance !== "string" || !BREAKAWAY_STANCES.has(obj.breakaway_stance as string)) {
    errors.push('breakaway_stance skal vaere "chase" | "neutral" | "let_go"');
  }
  if (!Array.isArray(obj.riders)) {
    errors.push("riders skal vaere et array");
    return { ok: errors.length === 0, errors } as TeamOrderValidationResult;
  }

  const seenRiderIds = new Set<string>();
  obj.riders.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      errors.push(`riders[${index}] skal vaere et objekt`);
      return;
    }
    const riderObj = entry as Record<string, unknown>;
    for (const key of Object.keys(riderObj)) {
      if (!RIDER_ORDER_KEYS.has(key)) errors.push(`ukendt felt paa riders[${index}]: "${key}"`);
    }
    if (typeof riderObj.rider_id !== "string" || riderObj.rider_id.length === 0) {
      errors.push(`riders[${index}].rider_id skal vaere en ikke-tom streng`);
    } else {
      if (seenRiderIds.has(riderObj.rider_id)) {
        errors.push(`riders[${index}].rider_id "${riderObj.rider_id}" er en dublet`);
      }
      seenRiderIds.add(riderObj.rider_id);
    }
    if (typeof riderObj.effort !== "string" || !EFFORT_LEVELS.has(riderObj.effort as string)) {
      errors.push(`riders[${index}].effort skal vaere "grupetto" | "save" | "normal" | "protect" | "all_out"`);
    }
    if (typeof riderObj.try_break !== "boolean") {
      errors.push(`riders[${index}].try_break skal vaere boolean`);
    }
    // VALGFRIT: fravaer = false. Kun en forkert TYPE er en fejl.
    if (riderObj.leadout !== undefined && typeof riderObj.leadout !== "boolean") {
      errors.push(`riders[${index}].leadout skal vaere boolean naar den er sat`);
    }
  });

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ── Rollen som standardordre (#4246, ejer 2/9) ───────────────────────────────

/**
 * Rollens standardordre for ÉN rytter. Ren opslagsfunktion.
 *
 * `teamHasSprintCaptain` er den ene kontekst rollen ikke selv baerer: en
 * hjaelper "arbejder for kaptajnen", og NAAR holdet har en spurt-kaptajn er
 * dagens udmoentning af det at koere i hans tog. Uden en spurt-kaptajn er der
 * intet tog at koere i, og hjaelperen har ingen tog-ordre (M6 giver pr. sin
 * egen kontrakt ingen bonus for et tog uden maal).
 *
 * `effort` er ALTID "normal": RACE_ENGINE_RULES §1b siger ordret at "ikke
 * valgt" = rollens standard = `normal`. Intentionen er dagens overlay, ikke
 * noget rollen saetter — og "aldrig gratis alt-ud" (§2 regel 1) betyder at
 * ingen automatik maa dele en dyrere indsats ud uden at spilleren valgte den.
 */
export function defaultOrderForRole(
  riderId: string,
  role: RiderRole,
  opts: { teamHasSprintCaptain?: boolean } = {},
): TeamOrderRider {
  const base = { rider_id: riderId, effort: "normal" as EffortLevel, try_break: false, leadout: false };
  switch (role) {
    case "hunter":
      // "Prioriterer udbrud" (RACE_ENGINE_RULES §1) — bounded bidrag i M5,
      // aldrig en garanti for medlemskab.
      return { ...base, try_break: true };
    case "helper":
      return { ...base, leadout: opts.teamHasSprintCaptain === true };
    case "captain":
    case "sprint_captain":
    case "free_role":
    default:
      // captain = holdets beskyttede rytter, sprint_captain = togets MAAL
      // (aldrig selv en del af toget), free_role = ingen bunden opgave.
      return base;
  }
}

/**
 * Hele holdets standardordre udelukkende ud fra rollerne i holdudtagelsen.
 * Deterministisk: rytter-raekkefoelgen er rosterets.
 */
export function defaultTeamOrderForRoster(teamId: string, roster: readonly RosterEntry[]): TeamOrder {
  const teamHasSprintCaptain = roster.some((r) => r.role === "sprint_captain");
  return {
    team_id: teamId,
    breakaway_stance: "neutral",
    riders: roster.map((r) => defaultOrderForRole(r.rider_id, r.role, { teamHasSprintCaptain })),
  };
}

/** Etape-overlayet: praecis de felter taktik-kortet kan saette pr. rytter. */
export type StageOverlayRider = {
  rider_id: string;
  effort?: EffortLevel;
  try_break?: boolean;
  leadout?: boolean;
};

export type StageOverlay = {
  breakaway_stance?: BreakawayStance;
  riders?: readonly StageOverlayRider[];
};

/**
 * Laeg etapens overlay oven paa standardordren (#4246, ejer 2/9).
 *
 * Regler:
 *  - Rytter-listen kommer ALTID fra standardordren (= holdudtagelsen). Et
 *    overlay for en rytter der ikke er udtaget droppes; en udtaget rytter uden
 *    overlay beholder rollens standard. Taktik-kortet kan altsaa ikke tilfoeje
 *    eller fjerne ryttere — kun aendre dagens udmoentning.
 *  - Kun felter der reelt er sat i overlayet overskriver. `undefined` = "ikke
 *    valgt i dag" = rollens standard.
 */
export function applyStageOverlayToOrder(base: TeamOrder, overlay: StageOverlay | null | undefined): TeamOrder {
  if (!overlay) return base;
  const byRider = new Map<string, StageOverlayRider>();
  for (const entry of overlay.riders ?? []) {
    if (entry && typeof entry.rider_id === "string") byRider.set(entry.rider_id, entry);
  }
  return {
    team_id: base.team_id,
    breakaway_stance: overlay.breakaway_stance ?? base.breakaway_stance,
    riders: base.riders.map((rider) => {
      const o = byRider.get(rider.rider_id);
      if (!o) return rider;
      return {
        rider_id: rider.rider_id,
        effort: o.effort ?? rider.effort,
        try_break: o.try_break ?? rider.try_break,
        leadout: o.leadout ?? rider.leadout ?? false,
      };
    }),
  };
}

/**
 * T4: neutrale defaults uden rolleviden — ingen ordre = effort normal, udbrud
 * neutral, intet break-flag, intet tog. Bruges dér hvor holdudtagelsen ikke er
 * i haanden (AI-taktikkens egen fallback); har du rollerne, brug
 * `defaultTeamOrderForRoster` i stedet — den ER standardordren.
 */
export function neutralTeamOrder(teamId: string, riderIds: readonly string[]): TeamOrder {
  return {
    team_id: teamId,
    breakaway_stance: "neutral",
    riders: riderIds.map((rider_id) => ({ rider_id, effort: "normal", try_break: false, leadout: false })),
  };
}
