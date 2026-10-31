// #3564 kurve B (D-058): flaget `development_curve_b` og kurvens private params.
//
// Fail-safe OFF. Kun "on" (eller boolean true) tænder: "beta" læses som off, fordi
// kurven er en live balance-ændring for hele ligaen uden skyggedata at bygge.
// Ejer-only flip, og først efter en ny 10-sæsoners-kørsel med den rigtige kurve.
//
// Kurvens tal er private (hard rule 17). app_config kan læses af alle indloggede,
// så de ligger IKKE dér. #7390: de ligger KUN i den lukkede tabel private_config
// under nøglen `development_curve_b_params` (privateConfig.ts, samme validering
// som før). Den midlertidige Railway-reserve er fjernet, efter rækken blev
// bekræftet i prod; miljøet læses ikke længere.
// Flag on + manglende, ugyldige eller ulæselige params = dagens model (fail-safe),
// med en advarsel i loggen, så en halv opsætning aldrig giver en halv kurve.
// Flag off = intet opslag i private_config.
//
// Kalderen (dailyTrainingEngine.js) sender resultatet som `curveB` ind i
// applyDailyTick.

import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { readConditionWriterFlag } from "./trainingDateConditionFlag.js";
import { type DevelopmentCurveBParams } from "./developmentCurveB.ts";
import { readPrivateConfigEntry, PRIVATE_CONFIG_KEYS } from "./privateConfig.ts";

export const DEVELOPMENT_CURVE_B_FLAG_KEY = "development_curve_b";
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

/**
 * Kurvens params uden flag-tjek, kun fra private_config. Manglende, ugyldig eller
 * (uden strict) ulæselig række = null; privateConfig.ts advarer selv om ugyldig
 * og ulæselig, og strict kaster i begge tilfælde. Logger aldrig tallene.
 */
export async function readDevelopmentCurveBParams({
  supabase, log = console, strict = false, now = Date.now,
}: {
  supabase: ReadFlagStageClient;
  log?: Log;
  strict?: boolean;
  /** Ur til cachen; tests injicerer et fast ur (AGENTS.md). */
  now?: () => number;
}): Promise<DevelopmentCurveBParams | null> {
  const entry = await readPrivateConfigEntry<DevelopmentCurveBParams>(
    supabase as { from(table: string): any },
    DEVELOPMENT_CURVE_B_PARAMS_KEY,
    { strict, log, now, schema: PRIVATE_CONFIG_KEYS.development_curve_b_params.parse },
  );
  return entry.status === "ok" ? entry.value : null;
}

/**
 * Kurven motoren skal bruge i dag: params når flaget er on OG params er gyldige,
 * ellers null (dagens model). Logger aldrig selve tallene.
 */
export async function loadDevelopmentCurveB({
  supabase, log = console, strict = false, now = Date.now,
}: {
  supabase: ReadFlagStageClient;
  log?: Log;
  strict?: boolean;
  /** Ur til cachen; tests injicerer et fast ur (AGENTS.md). */
  now?: () => number;
}): Promise<DevelopmentCurveBParams | null> {
  if (!(await isDevelopmentCurveBEnabled(supabase, { strict }))) return null;
  const params = await readDevelopmentCurveBParams({ supabase, log, strict, now });
  if (!params) {
    log?.warn?.(`[curve-b] ${DEVELOPMENT_CURVE_B_FLAG_KEY} er on, men ${DEVELOPMENT_CURVE_B_PARAMS_KEY} (private_config) mangler eller er ugyldig - koerer dagens model`);
  }
  return params;
}
