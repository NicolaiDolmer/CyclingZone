/** Canonical rider-day locks; ownership and squad changes never release them. */
import { loadSpentRaceDays } from './raceSpentDays.js';
import { fetchAllRowsChunkedIn } from './supabasePagination.js';
import { isRaceLineupFrozen } from './raceActiveGuard.js';
import { captureException } from './sentry.js';

type Day = { race_id: string; rider_id: string; game_day: number };
export type EntrySpan = { race_id: string; rider_id: string; team_id: string; binding_span: string };
type Window = { start: number; end: number };
type Binding = { race_id: string; rider_id: string; window: Window } &
  ({ kind: 'entry'; team_id: string } | { kind: 'participation' });
export type GeneratorBindings = ReadonlyMap<string, readonly Binding[]>;

export function indexGeneratorBindings(entrySpans: readonly EntrySpan[], participation: readonly Day[]): GeneratorBindings {
  const bindings = new Map<string, Binding[]>();
  const rows: Binding[] = entrySpans.map(row => {
    // Postgres canonical int4range stores an inclusive lower/exclusive upper.
    const match = /^\[(-?\d+),(-?\d+)\)$/.exec(row.binding_span);
    if (!match || Number(match[2]) <= Number(match[1])) throw new Error('Invalid canonical generator binding span');
    return { ...row, kind: 'entry', window: { start: Number(match[1]), end: Number(match[2]) - 1 } };
  });
  for (const row of participation) {
    if (!Number.isInteger(row.game_day)) throw new Error('Canonical generator binding requires an integer race day');
    rows.push({ ...row, kind: 'participation', window: { start: row.game_day, end: row.game_day } });
  }
  for (const row of rows) {
    const days = bindings.get(row.rider_id) ?? [];
    days.push(row);
    bindings.set(row.rider_id, days);
  }
  return bindings;
}

export function generatorBindingLocks({ bindings, riderIds, teamId, regeneratingRaceIds }: {
  bindings: GeneratorBindings; riderIds: readonly string[]; teamId: string; regeneratingRaceIds: ReadonlySet<string>;
}) {
  const locks: Array<{ window: Window; riderIds: string[] }> = [];
  for (const riderId of riderIds) {
    for (const row of bindings.get(riderId) ?? []) {
      // Existing manual/frozen locks remain in the generator. Only this owner's
      // mutable target units are replanned; another owner's row is still binding.
      if (row.kind === 'entry' && row.team_id === teamId && regeneratingRaceIds.has(row.race_id)) continue;
      locks.push({ window: row.window, riderIds: [riderId] });
    }
  }
  return locks;
}

/**
 * #6132: Race Hub's bulk regenerate must know every canonical binding before it
 * assigns: actual participation (also at a former team, after the old entry was
 * deleted) and another owner's entries. The caller already locks this team's own
 * entries. Participation stays one exact game day, never the whole race window.
 */
export async function loadRegenerateBindingLocks({ supabase, seasonId, teamId, targetRaceIds, riderIds }: {
  supabase: any; seasonId: string; teamId: string; targetRaceIds: readonly string[]; riderIds: readonly string[];
}) {
  if (!targetRaceIds.length || !riderIds.length) return [];
  const spent = new Map<string, Day>();
  // The same RPC the DB guard uses: season-scoped, each target's first..last day.
  for (const raceId of targetRaceIds) {
    for (const row of await loadSpentRaceDays({ supabase, raceId, riderIds: [...riderIds] })) {
      spent.set(`${row.rider_id}:${row.race_id}:${row.game_day}`, row);
    }
  }
  const external: EntrySpan[] = (await fetchAllRowsChunkedIn([...riderIds], (chunk: string[]) => supabase.from('race_entries')
    .select('race_id, rider_id, team_id, binding_span, races!inner(season_id)')
    .eq('races.season_id', seasonId).neq('team_id', teamId).not('binding_span', 'is', null)
    .in('rider_id', chunk).order('race_id').order('rider_id')))
    .map(({ race_id, rider_id, team_id, binding_span }: EntrySpan) => ({ race_id, rider_id, team_id, binding_span }));
  return generatorBindingLocks({
    bindings: indexGeneratorBindings(external, [...spent.values()]),
    riderIds, teamId, regeneratingRaceIds: new Set(targetRaceIds),
  });
}

type Lineup = { race_id: string; rider_id: string; race_role?: string | null; is_auto_filled?: boolean | null };
type TargetRace = { id: string; status?: string; stages_completed?: number | null };
type WriteArgs = {
  supabase: any; teamId: string; target: readonly TargetRace[];
  picksByRace: Record<string, ReadonlyArray<{ rider_id: string; race_role: string }>>; existingEntries: readonly Lineup[];
};

/**
 * #6132: the writer deletes then inserts per race. A rejected insert must leave the
 * team's WHOLE existing target selection, not an empty or half-written day. Only
 * races the writer may touch (not frozen, with picks) are restored: first every
 * such row is removed, then the old selection goes back in one statement, so no
 * rider-day collision can occur between restored races.
 */
export async function writeRegeneratedLineupsPreservingTarget<T>(
  { write, ...args }: WriteArgs & { write: (args: WriteArgs) => Promise<T> },
): Promise<T> {
  try {
    return await write(args);
  } catch (err) {
    const raceIds = args.target
      .filter((race) => !isRaceLineupFrozen(race) && (args.picksByRace[race.id] ?? []).length)
      .map((race) => race.id);
    const restore = args.existingEntries.filter((row) => raceIds.includes(row.race_id)).map((row) => ({
      race_id: row.race_id, rider_id: row.rider_id, team_id: args.teamId,
      race_role: row.race_role ?? 'helper', is_auto_filled: row.is_auto_filled !== false,
    }));
    try {
      if (raceIds.length) {
        const { error: delErr } = await args.supabase.from('race_entries').delete().eq('team_id', args.teamId).in('race_id', raceIds);
        if (delErr) throw new Error(`race_entries restore delete (#6132): ${delErr.message}`);
      }
      if (restore.length) {
        const { error: insErr } = await args.supabase.from('race_entries').insert(restore);
        if (insErr) throw new Error(`race_entries restore (#6132, ${restore.length} rows): ${insErr.message}`);
      }
    } catch (restoreErr) {
      // Double failure: report it, but the caller still gets the original error.
      captureException(restoreErr instanceof Error ? restoreErr : new Error(String(restoreErr)));
    }
    throw err;
  }
}
