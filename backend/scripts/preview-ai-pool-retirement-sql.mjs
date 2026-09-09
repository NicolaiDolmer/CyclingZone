// Run the migration's exact read-only planner before installing it in prod.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function previewSql() {
  const migration = readFileSync(new URL('../../database/2026-09-09-4753-ai-pool-retirement.sql', import.meta.url), 'utf8');
  const body = name => {
    const declaration = migration.split(`CREATE OR REPLACE FUNCTION public.${name}(`)[1];
    if (!declaration || !declaration.includes('LANGUAGE sql STABLE SECURITY INVOKER')) throw new Error(`Not a read-only SQL function: ${name}`);
    return declaration.split('AS $$')[1].split('$$;')[0].trim().replace(/;$/, '');
  };
  const reason = body('ai_team_retirement_reason').replaceAll('p_team_id', 't.id');
  const plan = body('plan_ai_pool_retirements')
    .replaceAll('public.ai_team_retirement_reason(t.id)', `(${reason})`)
    .replaceAll('p_pool_id', 'pool.id').replaceAll('p_now','now()');
  const signature = migration.split('CREATE OR REPLACE FUNCTION public.plan_ai_pool_retirements(')[1];
  const columns = signature.match(/RETURNS TABLE\(([\s\S]*?)\)\s*LANGUAGE/)[1]
    .split(',').map(column => column.trim().split(/\s+/)[0]).join(',');
  return `SELECT preview.* FROM public.league_divisions pool CROSS JOIN LATERAL (${plan}) preview(${columns}) ORDER BY pool.id,preview.team_id;`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(previewSql());
