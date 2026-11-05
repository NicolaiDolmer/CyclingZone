// #3550 — ungdomspakken (løn-design-session 19/8): pull-baseret akademi-intake-flag.
// Bor i app_config (key/value) → flippes runtime UDEN re-deploy. Fail-safe: fejl/
// fravær → false (uændret nuværende adfærd: søndags-drippet fortsætter automatisk
// indtil flaget eksplicit flippes til "on" i cutover-drejebogen 23/8). Spejrer
// academyIntakeExpiryFlag.ts/dailyTrainingFlag.js-mønsteret.
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const ACADEMY_INTAKE_PULL_FLAG_KEY = "academy_intake_pull_enabled";

type FlagOptions = NonNullable<Parameters<typeof evaluateFlagStage>[1]> & Record<string, unknown>;

export async function isAcademyIntakePullEnabled(supabase: unknown, opts: FlagOptions = {}): Promise<boolean> {
  return evaluateFlagStage(await readFlagStage(supabase, ACADEMY_INTAKE_PULL_FLAG_KEY), opts);
}
