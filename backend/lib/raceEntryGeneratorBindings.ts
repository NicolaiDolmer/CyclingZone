/** Canonical rider-day locks; ownership and squad changes never release them. */
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
