// #6110 trin 2: kontakten for XP-modellen, dens private params og startdatoen.
//
// Spec: docs/superpowers/specs/2026-11-06-6110-xp-udvikling-design.md §7 og §11 trin 2.
//
// ═══ KONTAKTEN ═══════════════════════════════════════════════════════════════
// `development_xp_model` i app_config. Fail-safe OFF. Kun "on" (eller boolean true)
// tænder; "beta" læses som off, som kurve B, fordi det er en balanceændring for
// hele ligaen. Ejer-only flip, og kun efter kravene i spec §7.2.
//
// ═══ STARTDATOEN ═════════════════════════════════════════════════════════════
// `development_xp_from_date` i app_config: dansk dato (YYYY-MM-DD). Motoren vælger
// model ud fra TICK-DATOEN, ikke ud fra hvornår kontakten blev slået om, så en dato
// aldrig afregnes med to modeller (Træn nu tidligt, aftenkørslen resten). Datoer før
// startdatoen kører dagens model, også ved efterslæb (samme erfaring som #7382).
// Kontakt on uden gyldig startdato = dagens model plus en advarsel.
//
// ═══ TALLENE ═════════════════════════════════════════════════════════════════
// `development_xp_params` ligger KUN i den lukkede tabel private_config (#7390),
// aldrig i app_config (hard rule 17). Kontakt on med manglende eller ugyldige params
// = dagens model plus en advarsel. På dato-stien (strict) læses alt strengt: en
// fejlet læsning kaster, så datoen prøves igen i stedet for at blive afregnet halvt.
//
// ═══ SAMSPIL (spec §7.1) ═════════════════════════════════════════════════════
//  - Kurve B: XP vinder, når begge er on (applyDailyTick bruger kun XP-grenen).
//    Slukkes XP, lander motoren på kurve B igen.
//  - Udviklingsscore B (development_score_v2) og XP samtidig er en ugyldig opsætning:
//    der kastes, så datoen prøves igen.
//  - Catch-up via løb (race_day_catchup_enabled) er ikke udtrykt i XP endnu (#6950).
//    Samme regel: der kastes, så de to aldrig kører sammen.
//  - Dato-loftet (ability_cap_per_date_enabled, #6210): gælder kun kurve B og dagens
//    model. Under XP er der intet +1-loft pr. evne pr. dato; kun prisen bremser (#7739).
//  - Gemt bjælke-fremgang udbetales helt på tændingsnatten (ejer 12/11, #6110 R10).
//    Der findes ingen dryp-regel: overgangsvinduet (development_xp_transition_cap_dates)
//    er fjernet, og en sådan nøgle i app_config læses ikke.
//
// Kalderen (dailyTrainingEngine.js) sender resultatet som `developmentXp` ind i
// applyDailyTick. null = dagens model, bit-identisk (frossen golden i
// developmentXpWiring.test.js).

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { readConditionWriterFlag } from "./trainingDateConditionFlag.js";
import { readPrivateConfigEntry, PRIVATE_CONFIG_KEYS } from "./privateConfig.ts";
import { TRAINING_CONFIG } from "./training.js";
import { raceDayRoleBaseProgram, raceDayRoleYieldMultipliers, withRaceDayRoleYield } from "./raceDayRoleYield5950.js";
import { type DevelopmentXpParams } from "./developmentXp.ts";
import { type XpRaceDayFit } from "./developmentXpRaceFit.ts";

export const DEVELOPMENT_XP_FLAG_KEY = "development_xp_model";
export const DEVELOPMENT_XP_FROM_DATE_KEY = "development_xp_from_date";
export const DEVELOPMENT_XP_PARAMS_KEY = "development_xp_params";

const LOG_TAG = "[development-xp]";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type DbClient = { from(table: string): any };
type Log = Pick<Console, "warn">;

// strict = dato-stiens atomare sti: en fejlet læsning kaster i stedet for at blive
// tolket som "off" og committe dagens model på en tick, der ikke kan køres igen.
export async function isDevelopmentXpEnabled(
  supabase: DbClient,
  { strict = false }: { strict?: boolean } = {},
): Promise<boolean> {
  if (strict) return readConditionWriterFlag(supabase, DEVELOPMENT_XP_FLAG_KEY);
  return evaluateFlagStage(await readFlagStage(supabase, DEVELOPMENT_XP_FLAG_KEY));
}

/** Startdatoen som dansk dato, ellers null (også en dato, der ikke findes). */
export function developmentXpFromDateValue(value: unknown): string | null {
  if (typeof value !== "string" || !DATE_RE.test(value)) return null;
  const t = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value ? value : null;
}

/** Læser startdatoen uden cache. Uden strict giver en databasefejl null (= dagens model). */
export async function readDevelopmentXpFromDate(
  supabase: DbClient,
  { strict = false, log = console }: { strict?: boolean; log?: Log } = {},
): Promise<string | null> {
  try {
    const { data, error } = await supabase.from("app_config").select("value")
      .eq("key", DEVELOPMENT_XP_FROM_DATE_KEY).maybeSingle();
    if (error) throw new Error(error.message ?? String(error));
    return developmentXpFromDateValue(data?.value ?? null);
  } catch (error) {
    const message = `${LOG_TAG} ${DEVELOPMENT_XP_FROM_DATE_KEY} read failed: ${(error as Error)?.message ?? error}`;
    if (strict) throw new Error(message);
    log?.warn?.(message);
    return null;
  }
}

/** Params fra private_config uden kontakt-tjek. Manglende eller ugyldige = null. Logger aldrig tallene. */
export async function readDevelopmentXpParams({
  supabase, log = console, strict = false, now = Date.now,
}: {
  supabase: DbClient;
  log?: Log;
  strict?: boolean;
  /** Ur til cachen; tests injicerer et fast ur (AGENTS.md). */
  now?: () => number;
}): Promise<DevelopmentXpParams | null> {
  const entry = await readPrivateConfigEntry<DevelopmentXpParams>(supabase, DEVELOPMENT_XP_PARAMS_KEY, {
    strict, log, now, schema: PRIVATE_CONFIG_KEYS.development_xp_params.parse,
  });
  return entry.status === "ok" ? entry.value : null;
}

/**
 * XP-params, motoren skal bruge for `tickDate`: params når kontakten er on, tick-datoen
 * er på eller efter startdatoen og params er gyldige. Ellers null (dagens model).
 * Kaster, hvis XP ville køre sammen med Udviklingsscore B eller catch-up via løb.
 */
export async function loadDevelopmentXp({
  supabase, tickDate, log = console, strict = false, now = Date.now,
  developmentScoreB = null, raceCatchUp = null,
}: {
  supabase: DbClient;
  tickDate: string | null | undefined;
  log?: Log;
  strict?: boolean;
  now?: () => number;
  developmentScoreB?: unknown;
  raceCatchUp?: unknown;
}): Promise<DevelopmentXpParams | null> {
  // #7739 (ejer 7/11): XP kender intet +1-loft pr. dato, så ability_cap_per_date_enabled
  // er ikke længere en betingelse. Kontakten bliver on for kurve B.
  if (!(await isDevelopmentXpEnabled(supabase, { strict }))) return null;
  const fromDate = await readDevelopmentXpFromDate(supabase, { strict, log });
  if (!fromDate) {
    log?.warn?.(`${LOG_TAG} ${DEVELOPMENT_XP_FLAG_KEY} is on, but ${DEVELOPMENT_XP_FROM_DATE_KEY} is missing or invalid - running today's model`);
    return null;
  }
  // Modellen vælges på tick-datoen: før startdatoen (også efterslæb) er det dagens model.
  if (typeof tickDate !== "string" || !DATE_RE.test(tickDate) || tickDate < fromDate) return null;
  const params = await readDevelopmentXpParams({ supabase, log, strict, now });
  if (!params) {
    log?.warn?.(`${LOG_TAG} ${DEVELOPMENT_XP_FLAG_KEY} is on, but ${DEVELOPMENT_XP_PARAMS_KEY} (private_config) is missing or invalid - running today's model`);
    return null;
  }
  if (developmentScoreB) {
    throw new Error(`${LOG_TAG} ${DEVELOPMENT_XP_FLAG_KEY} and development_score_v2 are both on - invalid setup, refusing to tick, retry on next sweep`);
  }
  if (raceCatchUp) {
    throw new Error(`${LOG_TAG} ${DEVELOPMENT_XP_FLAG_KEY} and race_day_catchup_enabled are both on - catch-up is not expressed in XP yet, refusing to tick`);
  }
  return params;
}

/**
 * Løbsdagens rolletillæg (#5950) i XP-modellens forhold mellem fokus og resten.
 * XP slukket (null) = withRaceDayRoleYield med præcis de samme argumenter, så kaldet
 * er bit-identisk med i dag. Tændt = som 10-sæsoners-kørslen: hård basisdag og
 * tillægget regnet med løbsdagens off-fokus-andel fra XP-params, så tillægget
 * lægger det samme oven i, uanset hvor stor off-fokus-andelen er.
 *
 * #6110 R15b (ejer 13/11): tændt bærer kaldet også etapen og holdets katalog
 * (`catalogV3`) med til tick'et som `xpRaceDayFit`, så applyDailyTick kan løfte en
 * løbsdag, der passer rytteren, op til hans bedste hårde pas (developmentXpRaceFit.ts).
 * Slukket læses `catalogV3` ikke, og intet nyt felt siver ind i den gamle model.
 */
export function withRaceDayRoleYieldXp(
  developmentXp: DevelopmentXpParams | null | undefined,
  extraTickArgs: Record<string, unknown>,
  { params = null, profileType = null, role = null, catalogV3 = false }: {
    params?: any; profileType?: string | null; role?: string | null; catalogV3?: boolean;
  } = {},
): Record<string, unknown> {
  // JS-hjaelperne udleder typer af deres null-standardvaerdier; cast holder kaldet
  // uaendret i runtime (typecheck-fejl paa main efter #7843).
  if (!developmentXp) return withRaceDayRoleYield(extraTickArgs, { params, profileType, role } as any);
  const xpRaceDayFit: XpRaceDayFit = { profileType: profileType ?? null, catalogV3: catalogV3 === true };
  // Uden rolletillaeg er programmet og tillaegget som i dag; R15b gaelder stadig (alle roller).
  if (!params) return { ...extraTickArgs, xpRaceDayFit };
  const trainingCfg = {
    ...TRAINING_CONFIG,
    offFocusMult: developmentXp.raceOffFocusShare * TRAINING_CONFIG.focusGrowthMult.hard,
  };
  const program = raceDayRoleBaseProgram(profileType as any, { role, roleDrivesBaseDay: params.roleDrivesBaseDay === true, trainingCfg } as any);
  const abilityYieldMult = raceDayRoleYieldMultipliers({ params, profileType, role, program, trainingCfg } as any);
  return { ...extraTickArgs, program, abilityYieldMult, xpRaceDayFit };
}
