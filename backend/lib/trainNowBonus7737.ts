import type { SupabaseClient } from '@supabase/supabase-js';

export const TRAIN_NOW_BONUS_FLAG_KEY = 'training_train_now_bonus';
export const TRAIN_NOW_BONUS_FACTOR = 1.15;

/** The first press decides; automatic continuations never consult today's flags. */
export async function loadTrainNowBonusRiderIds({ supabase, teamId, seasonId, tickDate, riderIds }: {
  supabase: SupabaseClient; teamId: string; seasonId: string; tickDate: string; riderIds: string[];
}): Promise<Set<string>> {
  if (!riderIds.length) return new Set();
  // pagination-safe: bounded by the registered team/date roster.
  // schema-columns-ok: train_now_bonus is added by database/2026-11-10-7737-train-now-bonus.sql.
  const { data, error } = await supabase.from('training_train_now_locks')
    .select('rider_id,train_now_bonus').eq('team_id', teamId).eq('season_id', seasonId)
    .eq('tick_date', tickDate).in('rider_id', riderIds);
  if (error) {
    const missingColumn = ['42703', 'PGRST204'].includes(error.code)
      && String(error.message).includes('train_now_bonus');
    if (missingColumn || ['42P01', 'PGRST205'].includes(error.code)) return new Set();
    throw new Error(`train-now bonus decision: ${error.message}`);
  }
  return new Set((data ?? []).filter(row => row.train_now_bonus === true).map(row => row.rider_id));
}
