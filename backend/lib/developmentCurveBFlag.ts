// #3564 kurve B (D-058): flaget `development_curve_b` og kurvens private params.
//
// Fail-safe OFF. Kun "on" (eller boolean true) tænder: "beta" læses som off, fordi
// kurven er en live balance-ændring for hele ligaen uden skyggedata at bygge.
// Ejer-only flip, og først efter en ny 10-sæsoners-kørsel med den rigtige kurve.
//
// Kurvens tal er private (hard rule 17). app_config kan læses af alle indloggede,
// så de ligger IKKE dér, men i serverens miljø (DEVELOPMENT_CURVE_B_PARAMS, JSON).
// Flag on + manglende eller ugyldige params = dagens model (fail-safe), med en
// advarsel i loggen, så en halv opsætning aldrig giver en halv kurve.
//
// Kalderen (dailyTrainingEngine.js) sender resultatet som `curveB` ind i
// applyDailyTick. Den kobling er ikke lavet endnu; indtil da ændrer intet sig.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { readConditionWriterFlag } from "./trainingDateConditionFlag.js";
import { validateDevelopmentCurveBParams, type DevelopmentCurveBParams } from "./developmentCurveB.ts";

export const DEVELOPMENT_CURVE_B_FLAG_KEY = "development_curve_b";
export const DEVELOPMENT_CURVE_B_PARAMS_ENV = "DEVELOPMENT_CURVE_B_PARAMS";

type ReadFlagStageClient = Parameters<typeof readFlagStage>[0];

// strict = loebsdags-datoens atomare sti: en fejlet laesning kaster (som de
// oevrige flag der laeses dér), i stedet for at blive tolket som "off" og
// committe dagens model paa en tick der ikke kan koeres igen.
export async function isDevelopmentCurveBEnabled(
  supabase: ReadFlagStageClient,
  { strict = false }: { strict?: boolean } = {},
): Promise<boolean> {
  if (strict) return readConditionWriterFlag(supabase, DEVELOPMENT_CURVE_B_FLAG_KEY);
  return evaluateFlagStage(await readFlagStage(supabase, DEVELOPMENT_CURVE_B_FLAG_KEY));
}

/** Parser params fra miljøet. Ugyldig eller manglende = null. */
export function curveBParamsFromEnv(env: Record<string, string | undefined> = process.env): DevelopmentCurveBParams | null {
  const raw = env?.[DEVELOPMENT_CURVE_B_PARAMS_ENV];
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    return validateDevelopmentCurveBParams(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Kurven motoren skal bruge i dag: params når flaget er on OG params er gyldige,
 * ellers null (dagens model). Logger aldrig selve tallene.
 */
export async function loadDevelopmentCurveB({
  supabase, env = process.env, log = console, strict = false,
}: {
  supabase: ReadFlagStageClient;
  env?: Record<string, string | undefined>;
  log?: Pick<Console, "warn">;
  strict?: boolean;
}): Promise<DevelopmentCurveBParams | null> {
  if (!(await isDevelopmentCurveBEnabled(supabase, { strict }))) return null;
  const params = curveBParamsFromEnv(env);
  if (!params) {
    log?.warn?.(`[curve-b] ${DEVELOPMENT_CURVE_B_FLAG_KEY} er on, men ${DEVELOPMENT_CURVE_B_PARAMS_ENV} mangler eller er ugyldig - koerer dagens model`);
  }
  return params;
}
