// Akademi-graduerings-sweep (#932). Auto-resolverer pending graduates hvor
// override-vinduet (deadline) er udløbet, via default-kæden (promover→sælg).
// Spejler trainingSweep.js: kun efter kl. 22 dansk tid, gated på academy_enabled,
// idempotent (kun status='pending' med passeret deadline; resolveGraduation flytter
// status, så gentaget kørsel er en no-op). Per-rytter try/catch isolerer fejl.

import { shouldSweepNow } from "./trainingSweep.js";
import { isAcademyEnabled } from "./academyFlag.js";
import { fetchAllRows } from "./supabasePagination.js";
import { defaultResolveGraduate } from "./academyGraduation.js";

export async function runAcademyGraduationSweep({
  supabase, now = new Date(),
  resolveFn = defaultResolveGraduate, isEnabled = isAcademyEnabled,
} = {}) {
  if (!shouldSweepNow(now)) return { processed: 0, skipped: "before_window" };
  if (!(await isEnabled(supabase))) return { processed: 0, skipped: "flag_off" };

  const { data: season } = await supabase
    .from("seasons").select("id, number").eq("status", "active").maybeSingle();
  if (!season) return { processed: 0, skipped: "no_active_season" };

  const pending = await fetchAllRows(() =>
    supabase.from("academy_graduation")
      .select("team_id, rider_id, deadline").eq("status", "pending").order("created_at"));

  let resolved = 0, failed = 0;
  for (const g of pending) {
    if (new Date(g.deadline) > now) continue; // override-vinduet ikke udløbet endnu
    try {
      await resolveFn(supabase, { teamId: g.team_id, riderId: g.rider_id, seasonNumber: season.number, now });
      resolved++;
    } catch (err) {
      failed++;
      console.error(`graduation sweep failed (${g.rider_id}):`, err.message);
    }
  }
  return { processed: resolved + failed, resolved, failed };
}
