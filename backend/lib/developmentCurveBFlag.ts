// #3564 kurve B (D-058): flaget `development_curve_b` og kurvens private params.
//
// Fail-safe OFF. Kun "on" (eller boolean true) tænder: "beta" læses som off, fordi
// kurven er en live balance-ændring for hele ligaen uden skyggedata at bygge.
// Ejer-only flip, og først efter en ny 10-sæsoners-kørsel med den rigtige kurve.
//
// Kurvens tal er private (hard rule 17). app_config kan læses af alle indloggede,
// så de ligger IKKE dér. #7390: de ligger i den lukkede tabel private_config under
// nøglen `development_curve_b_params` (privateConfig.ts, samme validering som før).
// Railway-variablen DEVELOPMENT_CURVE_B_PARAMS (JSON) er en MIDLERTIDIG reserve,
// der kun bruges når rækken mangler (eller ikke kunne læses uden strict), og det
// logges. Reserven fjernes, når tabellen er bekræftet i prod.
// Flag on + manglende eller ugyldige params = dagens model (fail-safe), med en
// advarsel i loggen, så en halv opsætning aldrig giver en halv kurve.
// Flag off = intet opslag i private_config.
//
// Kalderen (dailyTrainingEngine.js) sender resultatet som `curveB` ind i
// applyDailyTick.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { readConditionWriterFlag } from "./trainingDateConditionFlag.js";
import { validateDevelopmentCurveBParams, type DevelopmentCurveBParams } from "./developmentCurveB.ts";
import { readPrivateConfigEntry, PRIVATE_CONFIG_KEYS } from "./privateConfig.ts";

export const DEVELOPMENT_CURVE_B_FLAG_KEY = "development_curve_b";
export const DEVELOPMENT_CURVE_B_PARAMS_ENV = "DEVELOPMENT_CURVE_B_PARAMS";
export const DEVELOPMENT_CURVE_B_PARAMS_KEY = "development_curve_b_params";

type ReadFlagStageClient = Parameters<typeof readFlagStage>[0];
type Log = Pick<Console, "warn">;

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

// Reserve-advarslen kommer hoejst hvert 10. minut pr. logger: /feature-flags
// kalder ved hver sidevisning, og loggen skal kunne laeses.
const RESERVE_LOG_INTERVAL_MS = 10 * 60_000;
const reserveLoggedAt = new WeakMap<object, number>();
function shouldLogReserve(log: unknown): boolean {
  if (!log || typeof log !== "object") return true;
  const last = reserveLoggedAt.get(log);
  const now = Date.now();
  if (last !== undefined && now - last < RESERVE_LOG_INTERVAL_MS) return false;
  reserveLoggedAt.set(log, now);
  return true;
}

/**
 * Kurvens params uden flag-tjek: private_config først, Railway-reserven kun når
 * rækken mangler (eller laesningen fejlede uden strict). En række der findes men
 * er ugyldig bruger ALDRIG reserven (null + advarsel; strict kaster), saa en
 * forkert vaerdi i tabellen ikke stille erstattes af en gammel. Logger aldrig tallene.
 */
export async function readDevelopmentCurveBParams({
  supabase, env = process.env, log = console, strict = false,
}: {
  supabase: ReadFlagStageClient;
  env?: Record<string, string | undefined>;
  log?: Log;
  strict?: boolean;
}): Promise<DevelopmentCurveBParams | null> {
  const entry = await readPrivateConfigEntry<DevelopmentCurveBParams>(
    supabase as { from(table: string): any },
    DEVELOPMENT_CURVE_B_PARAMS_KEY,
    { strict, log, schema: PRIVATE_CONFIG_KEYS.development_curve_b_params.parse },
  );
  if (entry.status === "ok") return entry.value;
  if (entry.status === "invalid") return null;
  const reserve = curveBParamsFromEnv(env);
  if (reserve && shouldLogReserve(log)) {
    log?.warn?.(`[curve-b] ${DEVELOPMENT_CURVE_B_PARAMS_KEY} mangler i private_config - bruger den midlertidige reserve ${DEVELOPMENT_CURVE_B_PARAMS_ENV}`);
  }
  return reserve;
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
  log?: Log;
  strict?: boolean;
}): Promise<DevelopmentCurveBParams | null> {
  if (!(await isDevelopmentCurveBEnabled(supabase, { strict }))) return null;
  const params = await readDevelopmentCurveBParams({ supabase, env, log, strict });
  if (!params) {
    log?.warn?.(`[curve-b] ${DEVELOPMENT_CURVE_B_FLAG_KEY} er on, men ${DEVELOPMENT_CURVE_B_PARAMS_KEY} (private_config) og reserven ${DEVELOPMENT_CURVE_B_PARAMS_ENV} mangler eller er ugyldige - koerer dagens model`);
  }
  return params;
}
