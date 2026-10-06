// #6132: Race Hubs "Auto-udfyld igen" (POST /api/races/distribution/regenerate) skal
// kende rytterens kanonisk brugte loebsdage FOER tildelingen, ogsaa naar dagen blev
// brugt hos et tidligere hold og den gamle entry er slettet. Og afviser DB'en alligevel
// et insert, skal holdets HELE eksisterende maaludtagelse staa tilbage uaendret.
//
// Testene spejler rutens raekkefoelge: egne entries -> laase, kanoniske bindinger ->
// laase, assignTeamAcrossRaces, writer. Fake-DB'en haandhaever begge DB-vagter:
// rider-day-invarianten (#3420) og den brugte-dag-vagt (#5860), som afviser en entry
// naar rytteren har deltagelse paa en dag inden for maal-loebets foerste..sidste dag.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assignTeamAcrossRaces } from './raceEntryGenerator.js';
import { lockedWindowsFromEntries } from './raceDistribution.js';
import { raceBindingWindow } from './raceBinding.js';
import { writeRegeneratedLineups } from './raceHubAutofill.js';
import { loadRegenerateBindingLocks, writeRegeneratedLineupsPreservingTarget } from './raceEntryGeneratorBindings.ts';

type Row = Record<string, any>;
type Participation = { rider_id: string; race_id: string; game_day: number; season_id: string };

const SEASON = 'S-now';
const TEAM = 'T';

// Skema: race_id -> raekker med game_day + klokkeslaet. Klokkeslaet er bevidst forskellige
// inden for samme game_day: bindingen regnes i in-game-dag-rum, ikke kalendertid.
const SCHEDULE: Record<string, Row[]> = {
  L_DONE: [{ race_id: 'L_DONE', stage_number: 1, game_day: 29, scheduled_at: '2026-10-01T09:00:00Z' }],
  B: [{ race_id: 'B', stage_number: 1, game_day: 29, scheduled_at: '2026-10-01T16:30:00Z' }],
  B2: [{ race_id: 'B2', stage_number: 1, game_day: 29, scheduled_at: '2026-10-01T18:00:00Z' }],
  NEXT: [{ race_id: 'NEXT', stage_number: 1, game_day: 30, scheduled_at: '2026-10-02T09:00:00Z' }],
  STAGE: [27, 28, 29, 30, 31].map((game_day, i) => ({ race_id: 'STAGE', stage_number: i + 1, game_day, scheduled_at: `2026-09-${29 + i}T12:00:00Z` })),
  D27: [{ race_id: 'D27', stage_number: 1, game_day: 27, scheduled_at: '2026-09-29T20:00:00Z' }],
  EXT: [{ race_id: 'EXT', stage_number: 1, game_day: 29, scheduled_at: '2026-10-01T11:00:00Z' }],
};
const daysOf = (raceId: string) => (SCHEDULE[raceId] ?? []).map((row) => row.game_day);
const windowOf = (raceId: string) => raceBindingWindow(SCHEDULE[raceId]);

function makeDb({ entries = [] as Row[], participation = [] as Participation[], failInsert = null as null | ((rows: Row[]) => boolean) } = {}) {
  const state = { entries: entries.map((row) => ({ ...row })), rpcCalls: [] as Row[] };
  const sharesDay = (a: string, b: string) => daysOf(a).some((day) => daysOf(b).includes(day));
  const spent = (row: Row) => {
    const days = daysOf(row.race_id);
    if (!days.length) return false;
    const first = Math.min(...days); const last = Math.max(...days);
    return participation.some((p) => p.season_id === SEASON && p.rider_id === row.rider_id && p.race_id !== row.race_id
      && p.game_day >= first && p.game_day <= last);
  };
  function write(rows: Row[], { ignoreDuplicates = false } = {}) {
    if (failInsert && failInsert(rows)) return { error: { code: 'XX000', message: 'injected failure' } };
    const next = state.entries.map((row) => ({ ...row }));
    for (const row of rows) {
      if (next.some((r) => r.race_id === row.race_id && r.rider_id === row.rider_id)) {
        if (ignoreDuplicates) continue;
        return { error: { code: '23505', message: 'duplicate key value violates unique constraint "race_entries_pkey"' } };
      }
      if (spent(row)) return { error: { code: '23514', message: 'selection_rider_bound: no_rider_double_booking_day (spent participation)' } };
      if (next.some((r) => r.rider_id === row.rider_id && r.race_id !== row.race_id && sharesDay(r.race_id, row.race_id))) {
        return { error: { code: '23505', message: 'duplicate key value violates unique constraint "no_rider_double_booking_day"' } };
      }
      next.push({ ...row });
    }
    state.entries = next;
    return { error: null };
  }
  function selectBuilder() {
    const filters: Array<(row: Row) => boolean> = [];
    const value = (row: Row, col: string) => (col === 'races.season_id' ? row.season_id ?? SEASON : row[col]);
    const q: Row = {
      select: () => q,
      eq(col: string, v: unknown) { filters.push((row) => value(row, col) === v); return q; },
      neq(col: string, v: unknown) { filters.push((row) => value(row, col) !== v); return q; },
      in(col: string, vs: unknown[]) { filters.push((row) => vs.includes(value(row, col))); return q; },
      not(col: string, op: string, v: unknown) {
        assert.equal(op, 'is'); assert.equal(v, null);
        filters.push((row) => row[col] != null); return q;
      },
      order: () => q,
      range(from: number, to: number) {
        const data = state.entries.filter((row) => filters.every((f) => f(row))).slice(from, to + 1);
        return Promise.resolve({ data, error: null });
      },
    };
    return q;
  }
  function deleteBuilder() {
    const filters: Array<(row: Row) => boolean> = [];
    const b: Row = {
      eq(col: string, v: unknown) { filters.push((row) => row[col] === v); return b; },
      in(col: string, vs: unknown[]) { filters.push((row) => vs.includes(row[col])); return b; },
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        state.entries = state.entries.filter((row) => !filters.every((f) => f(row)));
        return Promise.resolve({ error: null }).then(resolve, reject);
      },
    };
    return b;
  }
  return {
    state,
    // Samme kontrakt som find_spent_race_days: maal-loebets saeson, foerste..sidste dag.
    async rpc(name: string, args: Row) {
      assert.equal(name, 'find_spent_race_days');
      state.rpcCalls.push(args);
      const days = daysOf(args.p_race_id);
      const first = Math.min(...days); const last = Math.max(...days);
      const data = participation
        .filter((p) => p.season_id === SEASON && args.p_rider_ids.includes(p.rider_id) && p.race_id !== args.p_race_id
          && p.game_day >= first && p.game_day <= last)
        .map(({ rider_id, race_id, game_day }) => ({ rider_id, race_id, game_day }));
      return { data, error: null };
    },
    from(table: string) {
      assert.equal(table, 'race_entries');
      return {
        select: () => selectBuilder(),
        delete: () => deleteBuilder(),
        insert: async (rows: Row[]) => write(rows),
        upsert: async (rows: Row[], opts: Row) => write(rows, opts),
      };
    },
  };
}

const ab = (v: number) => ({
  climbing: v, time_trial: v, sprint: v, punch: v, endurance: v,
  cobblestone: v, acceleration: v, recovery: v, tactics: v, positioning: v,
});
const flat = { profile_type: 'flat', demand_vector: { sprint: 0.8, endurance: 0.2, randomness: 0.5 } };
// r0 er holdets klart bedste rytter: uden laas vaelger assistenten ham altid.
const riders = Array.from({ length: 8 }, (_, i) => ({ rider_id: `r${i}`, abilities: ab(80 - i * 3), fatigue: 0 }));
const own = (race_id: string, rider_id: string, race_role = 'helper', is_auto_filled = true) =>
  ({ race_id, rider_id, team_id: TEAM, race_role, is_auto_filled });
const scheduled = (id: string, extra: Row = {}) => ({ id, status: 'scheduled', stages_completed: 0, ...extra });
// Afvis kun det FOERSTE insert der matcher: genskabelsen skal kunne lande bagefter.
const failOnce = (pred: (rows: Row[]) => boolean) => {
  let used = false;
  return (rows: Row[]) => { if (used || !pred(rows)) return false; used = true; return true; };
};
const spentAt = (rider_id: string, race_id: string, game_day: number, season_id = SEASON): Participation =>
  ({ rider_id, race_id, game_day, season_id });
const lineup = (db: ReturnType<typeof makeDb>, raceId: string) => db.state.entries
  .filter((row) => row.race_id === raceId && row.team_id === TEAM)
  .map((row) => `${row.rider_id}:${row.race_role}:${row.is_auto_filled}`).sort();

// Rutens tildeling (api.js POST /races/distribution/regenerate), med og uden #6132.
async function plan({ db, targetIds, ownEntries, withCanonical }: {
  db: ReturnType<typeof makeDb>; targetIds: string[]; ownEntries: Row[]; withCanonical: boolean;
}) {
  const windowByRace = new Map(Object.keys(SCHEDULE).map((id) => [id, windowOf(id)]));
  const lockedWindows: Array<{ window: any; riderIds: string[] }> = lockedWindowsFromEntries({
    entries: ownEntries, windowByRace, excludeRaceIds: new Set(targetIds),
  });
  if (withCanonical) {
    lockedWindows.push(...await loadRegenerateBindingLocks({
      supabase: db, seasonId: SEASON, teamId: TEAM, targetRaceIds: targetIds, riderIds: riders.map((r) => r.rider_id),
    }));
  }
  return assignTeamAcrossRaces({
    riders, lockedWindows,
    races: targetIds.map((id) => ({ race_id: id, window: windowOf(id), stages: [flat], sizeRule: { min: 6, max: 6 } })),
  });
}
const pickedIds = (picks: Record<string, Array<{ rider_id: string }>>, raceId: string) => picks[raceId].map((p) => p.rider_id);

// Hold A koerte L_DONE med r0 paa dag 29; r0 er siden solgt til os, L_DONE er completed
// og den gamle entry er slettet. Kun race_day_participation husker dagen.
const formerTeamDay = () => [spentAt('r0', 'L_DONE', 29)];
const existingB = () => ['r2', 'r3', 'r4', 'r5', 'r6', 'r7'].map((id, i) => own('B', id, i === 0 ? 'captain' : 'helper'));

test('#6132 repro: uden kanoniske bindinger udtages r0 igen paa sin brugte dag, DB afviser, og maaludtagelsen er vaek', async () => {
  const db = makeDb({ entries: existingB(), participation: formerTeamDay() });
  const picks = await plan({ db, targetIds: ['B'], ownEntries: existingB(), withCanonical: false });
  assert.ok(pickedIds(picks, 'B').includes('r0'), 'den gamle rute kender ikke dagen hos det tidligere hold');
  await assert.rejects(
    writeRegeneratedLineups({ supabase: db, teamId: TEAM, target: [scheduled('B')], picksByRace: picks, existingEntries: existingB() }),
    (err: any) => err.code === 'selection_rider_bound',
  );
  assert.deepEqual(lineup(db, 'B'), [], 'den gamle writer efterlader maal-loebet tomt efter afvisningen');
});

test('#6132: brugt dag hos tidligere hold (slettet entry, andet klokkeslaet samme game_day) laaser r0 foer tildeling', async () => {
  const db = makeDb({ entries: existingB(), participation: formerTeamDay() });
  const picks = await plan({ db, targetIds: ['B'], ownEntries: existingB(), withCanonical: true });
  assert.ok(!pickedIds(picks, 'B').includes('r0'));
  assert.equal(pickedIds(picks, 'B').length, 6);
  const res = await writeRegeneratedLineupsPreservingTarget({
    supabase: db, teamId: TEAM, target: [scheduled('B')], picksByRace: picks, existingEntries: existingB(), write: writeRegeneratedLineups,
  });
  assert.equal(res.regenerated, 1);
  assert.equal(lineup(db, 'B').length, 6);
});

test('#6132: dagen efter den brugte dag er lovlig, r0 kan udtages', async () => {
  const db = makeDb({ participation: formerTeamDay() });
  const picks = await plan({ db, targetIds: ['NEXT'], ownEntries: [], withCanonical: true });
  assert.ok(pickedIds(picks, 'NEXT').includes('r0'));
});

test('#6132: en enkelt brugt dag i et etapeloeb forklaedes ikke som hele loebets vindue', async () => {
  // r0 koerte kun foerste etape (dag 27) af STAGE hos Hold A. Dag 29 er derfor fri.
  const db = makeDb({ participation: [spentAt('r0', 'STAGE', 27)] });
  const locks = await loadRegenerateBindingLocks({ supabase: db, seasonId: SEASON, teamId: TEAM, targetRaceIds: ['B'], riderIds: ['r0'] });
  assert.deepEqual(locks, [], 'dag 27 ligger uden for B og binder ikke B');
  const picks = await plan({ db, targetIds: ['B'], ownEntries: [], withCanonical: true });
  assert.ok(pickedIds(picks, 'B').includes('r0'));
  // Og et maal-loeb paa selve dag 27 laases af praecis den dag, ikke af 27..31.
  const dayLocks = await loadRegenerateBindingLocks({ supabase: db, seasonId: SEASON, teamId: TEAM, targetRaceIds: ['D27'], riderIds: ['r0'] });
  assert.deepEqual(dayLocks, [{ window: { start: 27, end: 27 }, riderIds: ['r0'] }]);
});

test('#6132: brugte dage i U23-, junior- og andre puljers loeb laaser alle; en anden saeson laaser ikke', async () => {
  const db = makeDb({ participation: [
    spentAt('r0', 'U23_RACE', 29), spentAt('r1', 'JUNIOR_RACE', 29), spentAt('r2', 'OTHER_POOL_RACE', 29),
    spentAt('r3', 'OLD_SEASON_RACE', 29, 'S-old'),
  ] });
  const picks = await plan({ db, targetIds: ['B'], ownEntries: [], withCanonical: true });
  const ids = pickedIds(picks, 'B');
  for (const rid of ['r0', 'r1', 'r2']) assert.ok(!ids.includes(rid), `${rid} er bundet paa dag 29`);
  assert.ok(ids.includes('r3'), 'game_day er saeson-relativ; en anden saesons dag binder aldrig');
  assert.equal(ids.length, 5, 'kun fem frie ryttere tilbage, ingen dobbeltbooking for at fylde op');
});

test('#6132: et andet holds kanoniske entry samme loebsdag laaser rytteren', async () => {
  const db = makeDb({ entries: [{ race_id: 'EXT', rider_id: 'r0', team_id: 'HOLD_B', race_role: 'captain', is_auto_filled: false, binding_span: '[29,30)' }] });
  const picks = await plan({ db, targetIds: ['B'], ownEntries: [], withCanonical: true });
  assert.ok(!pickedIds(picks, 'B').includes('r0'));
});

test('#6132: afviser DB et insert, staar HELE den eksisterende maaludtagelse tilbage, ogsaa i allerede skrevne loeb', async () => {
  const existing = [...existingB(), own('B2', 'r0', 'captain', false), own('B2', 'r1')];
  const db = makeDb({ entries: existing, failInsert: failOnce((rows) => rows.some((row) => row.race_id === 'B2')) });
  const before = { B: lineup(db, 'B'), B2: lineup(db, 'B2') };
  // B skrives foerst (lykkes), B2 afvises. r1 flyttes fra B2 til B undervejs.
  const picksByRace = {
    B: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map((rider_id, i) => ({ rider_id, race_role: i ? 'helper' : 'captain' })),
    B2: [{ rider_id: 'r7', race_role: 'captain' }, { rider_id: 'r0', race_role: 'helper' }],
  };
  await assert.rejects(
    writeRegeneratedLineupsPreservingTarget({
      supabase: db, teamId: TEAM, target: [scheduled('B'), scheduled('B2')], picksByRace, existingEntries: existing, write: writeRegeneratedLineups,
    }),
    /race_entries insert \(B2\): injected failure/,
  );
  assert.deepEqual(lineup(db, 'B'), before.B);
  assert.deepEqual(lineup(db, 'B2'), before.B2, 'manuel kaptajn og r1 er tilbage i B2');
});

test('#6132: en afvisning fra DB-vagten beholder sin navngivne fejlkode efter genskabelsen', async () => {
  const db = makeDb({ entries: existingB(), participation: formerTeamDay() });
  const picks = { B: [{ rider_id: 'r0', race_role: 'captain' }, { rider_id: 'r1', race_role: 'helper' }] };
  await assert.rejects(
    writeRegeneratedLineupsPreservingTarget({
      supabase: db, teamId: TEAM, target: [scheduled('B')], picksByRace: picks, existingEntries: existingB(), write: writeRegeneratedLineups,
    }),
    (err: any) => err.code === 'selection_rider_bound',
  );
  assert.deepEqual(lineup(db, 'B'), existingB().map((row) => `${row.rider_id}:${row.race_role}:${row.is_auto_filled}`).sort());
});

test('#6132: genskabelsen roerer aldrig frosne loeb eller loeb uden picks', async () => {
  const existing = [own('B', 'r2', 'captain'), own('FROZEN', 'r5', 'captain'), own('NEXT', 'r6', 'captain')];
  const db = makeDb({ entries: existing, failInsert: failOnce(() => true) });
  await assert.rejects(writeRegeneratedLineupsPreservingTarget({
    supabase: db, teamId: TEAM,
    target: [scheduled('B'), scheduled('FROZEN', { stages_completed: 1 }), scheduled('NEXT')],
    picksByRace: { B: [{ rider_id: 'r3', race_role: 'captain' }], FROZEN: [{ rider_id: 'r4', race_role: 'captain' }], NEXT: [] },
    existingEntries: existing, write: writeRegeneratedLineups,
  }), /injected failure/);
  assert.deepEqual(db.state.entries.map((row) => `${row.race_id}:${row.rider_id}`).sort(), ['B:r2', 'FROZEN:r5', 'NEXT:r6']);
});

test('#6132: fejler ogsaa genskabelsen, faar kalderen stadig den oprindelige fejl', async () => {
  const db = makeDb({ entries: existingB(), failInsert: () => true });
  await assert.rejects(writeRegeneratedLineupsPreservingTarget({
    supabase: db, teamId: TEAM, target: [scheduled('B')],
    picksByRace: { B: [{ rider_id: 'r0', race_role: 'captain' }] }, existingEntries: existingB(), write: writeRegeneratedLineups,
  }), /race_entries insert \(B\): injected failure/);
});
