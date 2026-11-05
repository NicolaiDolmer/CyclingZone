// #4147: styrer om løbs-afslutningen skriver en trin-markering (races.finalize_state)
// og dermed kan GENOPTAGES efter en afbrydelse midt i finaliseringen. Bor i app_config
// (samme mønster som riderValuesBulkWriteFlag.js/autoPrizeFlag.js) → flippes runtime
// uden re-deploy.
//
// Fail-safe: fejl/fravær → false. Med flaget OFF skriver afslutningen INGEN markering
// og læser ingen — adfærden er bit-identisk med før #4147 (den grovkornede
// finalizationPending-recovery fra P0 2/7 er uændret aktiv). Vagten
// (raceFinalizeWatch.ts) er UAFHÆNGIG af flaget: den kan finde halve løb uden
// markering også, netop fordi et løb kan være crashet mens flaget var slukket.
//
// Default OFF ved merge — orkestratoren tænder den eksplicit efter at have set
// `[finalize-state]`-linjerne i Railway-loggen for et rigtigt løb.
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";

export const RACE_FINALIZE_RESUMABLE_FLAG_KEY = "race_finalize_resumable_enabled";

type FlagOptions = NonNullable<Parameters<typeof evaluateFlagStage>[1]> & Record<string, unknown>;

export async function isRaceFinalizeResumableEnabled(supabase: unknown, opts: FlagOptions = {}): Promise<boolean> {
  return evaluateFlagStage(await readFlagStage(supabase, RACE_FINALIZE_RESUMABLE_FLAG_KEY), opts);
}
