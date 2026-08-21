// backend/lib/engine/v4/ai/teamOrderContract.ts
// Race Engine v4 F3, M14 (#4030): den FROSNE TeamOrder-kontrakt fra
// taktik-ordre-designet — spillere og AI bruger PRAECIS samme form, ingen
// side-kanaler, ingen ekstra felter kun AI kan saette.
// SSOT: docs/superpowers/specs/2026-08-21-race-tactics-orders-v1-design.md
// ("Ordre-kontrakten (fryses ind i engine v4 types.ts — F3 bygger imod
// denne)"). Mor-spec addendum 22 (2026-08-20-race-engine-v4-intra-stage-
// design.md §8b): "AI bruger PRAECIS samme ordre-API som spillere".
//
// HVORFOR DUPLIKERET HER I STEDET FOR IMPORTERET FRA types.ts:
// types.ts's nuvaerende `TeamOrder`-eksport ("F2 leverer... et bevidst LOEST
// placeholder-kontrakt-udkast... F3-workeren der bygger M5/M14 praeciserer
// kind/params") er endnu IKKE opdateret til den frosne form fra taktik-
// designsessionen 21/8. Denne worker (M14/AI-taktik) maa ALDRIG roere
// types.ts (hard rule, delt fil paa tvaers af F3-workers — M5-workeren ejer
// den formelle sync). Denne fil er en PRAECIS 1:1-kopi af det frosne
// kontrakt-skema fra taktik-specen, saa M14 bygger imod den rigtige form nu
// i stedet for at vente. Duplikering er etableret moenster i pakken
// (rng.ts's stableSeed/mulberry32, jf. f2-core-design.md §1 "Renhed"-raekken)
// — holdes i sync manuelt naar M5-workeren opdaterer types.ts.
//
// REN — ingen import fra oevrigt backend, ingen IO/Date/Math.random.

export type BreakawayStance = "chase" | "neutral" | "let_go";
export type EffortLevel = "protect" | "normal" | "save";

export type TeamOrderRider = {
  rider_id: string;
  effort: EffortLevel; // M12, default "normal"
  try_break: boolean; // T3, default false, bounded bidrag (oeger sandsynlighed, garanterer aldrig)
};

export type TeamOrder = {
  team_id: string;
  breakaway_stance: BreakawayStance; // T3, default "neutral"
  riders: TeamOrderRider[];
};

const BREAKAWAY_STANCES: ReadonlySet<BreakawayStance> = new Set(["chase", "neutral", "let_go"]);
const EFFORT_LEVELS: ReadonlySet<EffortLevel> = new Set(["protect", "normal", "save"]);

// Praecise noegle-sæt (spec §"Ordre-kontrakten") — bruges til at afvise
// side-kanal-felter (ingen ekstra felter kun AI kan saette).
const TEAM_ORDER_KEYS: ReadonlySet<string> = new Set(["team_id", "breakaway_stance", "riders"]);
const RIDER_ORDER_KEYS: ReadonlySet<string> = new Set(["rider_id", "effort", "try_break"]);

export type TeamOrderValidationResult = { ok: true } | { ok: false; errors: string[] };

/**
 * Streng runtime-validering mod den frosne kontrakt: rigtige noegler (og
 * KUN dem — ingen ekstra AI-only-felter), rigtige literal-unions, ingen
 * dubletter af rider_id. Bruges af AI-taktikken (aiTactics.ts) til at laase
 * at output aldrig afviger fra det spillerne selv kan indsende.
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
  if (typeof obj.breakaway_stance !== "string" || !BREAKAWAY_STANCES.has(obj.breakaway_stance as BreakawayStance)) {
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
    if (typeof riderObj.effort !== "string" || !EFFORT_LEVELS.has(riderObj.effort as EffortLevel)) {
      errors.push(`riders[${index}].effort skal vaere "protect" | "normal" | "save"`);
    }
    if (typeof riderObj.try_break !== "boolean") {
      errors.push(`riders[${index}].try_break skal vaere boolean`);
    }
  });

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/** T4: neutrale defaults — ingen ordre = roller fra lineup, effort normal, udbrud neutral, intet break-flag. */
export function neutralTeamOrder(teamId: string, riderIds: readonly string[]): TeamOrder {
  return {
    team_id: teamId,
    breakaway_stance: "neutral",
    riders: riderIds.map((rider_id) => ({ rider_id, effort: "normal", try_break: false })),
  };
}
