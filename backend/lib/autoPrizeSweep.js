// Auto-prize sweep (#WS1): udbetaler udestående præmier for completede løb i den
// aktive sæson. Genbruger den idempotente paySeasonPrizesToDate (prize_paid_at +
// idempotency_key gør gentagne ticks harmløse). Gated bag runtime-flag — fail-safe
// OFF: er flaget ikke eksplicit tændt, udbetales intet.
//
// Bevidst cron-sweep med interval (ikke inline-ved-completion): et løb afvikles,
// og admin har indtil næste sweep-tick til at re-derivere race-points hvis nødvendigt,
// før prize_paid_at sættes og løbet låses (Beslutning A, plan-Fase 0).
import { isAutoPrizeEnabled } from "./autoPrizeFlag.js";
import { paySeasonPrizesToDate } from "./prizePayoutEngine.js";
import { payRaceDaySponsorsToDate } from "./sponsorRaceDayIncome.js";
import { FINANCE_ACTOR_TYPE } from "./economyConstants.js";

export async function runAutoPrizeSweep({
  supabase,
  isEnabled = isAutoPrizeEnabled,
  payFn = paySeasonPrizesToDate,
  sponsorFn = payRaceDaySponsorsToDate,
} = {}) {
  if (!(await isEnabled(supabase))) return { paid: 0, skipped: "flag_off" };

  const { data: season, error } = await supabase
    .from("seasons").select("id").eq("status", "active").maybeSingle();
  if (error) throw new Error(`seasons: ${error.message}`);
  if (!season) return { paid: 0, skipped: "no_active_season" };

  const result = await payFn(season.id, null, supabase, { actorType: FINANCE_ACTOR_TYPE.SYSTEM });

  // #1663: per-løbsdag-sponsor-indkomst krediteres ved samme finaliserings-sweep
  // (idempotent per (race, team) — gentagne ticks er harmløse).
  const sponsor = await sponsorFn(season.id, supabase, { actorType: FINANCE_ACTOR_TYPE.SYSTEM });

  return {
    paid: result.races_paid ?? 0,
    total: result.total_paid ?? 0,
    sponsor_credited: sponsor?.credited ?? 0,
  };
}
