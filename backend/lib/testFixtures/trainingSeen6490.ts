import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

export const foundationUrl = new URL('../../../database/manual/6490/training-seen-foundation.sql', import.meta.url);
export const TEAM = '00000000-0000-0000-0000-000000000001';
export const A = 'aaaaaaaa-0000-0000-0000-000000000001';
export const B = 'bbbbbbbb-0000-0000-0000-000000000002';
export const C = 'cccccccc-0000-0000-0000-000000000003';

export async function createTrainingSeenFixture(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    CREATE TABLE public.teams(id uuid PRIMARY KEY);
    CREATE TABLE public.training_day_runs(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      tick_date date NOT NULL DEFAULT DATE '2026-10-11',
      executed_by text NOT NULL DEFAULT 'assistant' CHECK(executed_by IN ('manager','assistant')),
      bonus_applied boolean NOT NULL DEFAULT false,
      report jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT TIMESTAMPTZ '2026-10-11T18:00:00Z',
      season_id uuid, game_day integer, squad text DEFAULT 'senior'
    );
    ALTER TABLE training_day_runs ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON training_day_runs TO service_role;
    GRANT SELECT, INSERT, DELETE ON teams TO service_role;
    CREATE INDEX idx_training_day_runs_report_riders
      ON training_day_runs USING gin ((report->'riders') jsonb_path_ops);
    CREATE FUNCTION public.training_seen_legacy_reader(p_key text) RETURNS boolean
      LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM public.training_day_runs
        WHERE report->'riders' @> jsonb_build_array(jsonb_build_object('rider_id',p_key))) $$;
    INSERT INTO teams VALUES ('${TEAM}');
  `);
  return db;
}

export async function installFoundation(db: PGlite) {
  await db.exec(await readFile(foundationUrl, 'utf8'));
}

export async function insertReport(db: PGlite, report: unknown, id?: string) {
  return db.query<{ id: string }>(`INSERT INTO training_day_runs(id,team_id,report)
    VALUES(COALESCE($1::uuid,gen_random_uuid()),$2,$3) RETURNING id`, [id ?? null, TEAM, JSON.stringify(report)]);
}

export async function counts(db: PGlite): Promise<Record<string, number>> {
  const { rows } = await db.query<{ rider_key: string; n: number }>(
    'SELECT rider_key, report_count::integer AS n FROM rider_training_seen ORDER BY rider_key COLLATE "C"');
  return Object.fromEntries(rows.map(row => [row.rider_key, row.n]));
}

export const report = (...ids: string[]) => ({ riders: ids.map(rider_id => ({ rider_id })) });
