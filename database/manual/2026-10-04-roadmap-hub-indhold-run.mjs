// Dry-run: kører indholds-SQL'en i én transaktion og ROLLBACK'er altid.
// Brug: infisical run --env=prod --silent -- node roadmap-dryrun.mjs [--commit]
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = 'C:/Dev/CyclingZone';
const { requireEnv, pgEnvFromDsn, resolvePgBin, run } = await import(pathToFileURL(path.join(root, 'scripts/db-lib.mjs')).href);
const commit = process.argv.includes('--commit');
const src = readFileSync(path.join(root, 'database/manual/2026-10-04-roadmap-hub-indhold.sql'), 'utf8');
const idx = src.lastIndexOf('\nCOMMIT;');
if (idx < 0) throw new Error('COMMIT ikke fundet');
const body = src.slice(0, idx);

const verify = `
SELECT 'items_by_status' AS k, status, approved, count(*) FROM roadmap_items GROUP BY 2,3 ORDER BY 2,3;
SELECT 'planned_by_horizon' AS k, horizon, approved, count(*) FROM roadmap_items WHERE status='planned' GROUP BY 2,3 ORDER BY 2,3;
SELECT 'beta_now' AS k, title_en, flag_key, beta_since::date, beta_soon, live_soon FROM roadmap_items WHERE status='in_progress' ORDER BY beta_since NULLS FIRST;
SELECT 'votes_total' AS k, count(*) FROM roadmap_votes;
SELECT 'votes_on_split' AS k, i.title_en, count(v.id) FROM roadmap_items i LEFT JOIN roadmap_votes v ON v.item_id=i.id WHERE i.title_en ILIKE '%valley%' OR i.title_en ILIKE 'Cobbles that count%' GROUP BY 2;
SELECT 'issues_by_status' AS k, status, published, count(*) FROM known_issues GROUP BY 2,3 ORDER BY 2;
SELECT 'issue_updates' AS k, count(*) FROM known_issue_updates;
SELECT 'null_titles' AS k, count(*) FROM roadmap_items WHERE coalesce(btrim(title_en),'')='' OR coalesce(btrim(title_da),'')='';
SELECT 'emdash' AS k, count(*) FROM roadmap_items WHERE title_en LIKE '%—%' OR title_da LIKE '%—%';
SELECT 'shipped_no_date' AS k, count(*) FROM roadmap_items WHERE status='shipped' AND shipped_at IS NULL;
`;
const dump = process.argv.includes('--dump');
const dumpSql = `
\\pset tuples_only on
\\pset format unaligned
\\o ${path.join(root, 'pr-screens/6150/indhold-dump.json').replace(/\\/g, '/')}
SELECT json_build_object(
  'roadmap_items', (SELECT json_agg(row_to_json(i) ORDER BY i.sort_order, i.title_en) FROM (SELECT id, engine, sort_order, title_en, title_da, approved, status, horizon, issue_ref, flag_key, beta_since, beta_soon, live_soon, created_at, shipped_at FROM roadmap_items WHERE approved AND status IN ('active','planned','in_progress','shipped')) i),
  'known_issues', (SELECT json_agg(row_to_json(k) ORDER BY k.sort_order, k.title_en) FROM (SELECT id, area, status, title_en, title_da, sort_order, created_at, updated_at, closed_at FROM known_issues WHERE published) k),
  'known_issue_updates', (SELECT json_agg(row_to_json(u) ORDER BY u.created_at DESC) FROM (SELECT id, issue_id, body_en, body_da, created_at FROM known_issue_updates) u)
);
\\o
\\pset tuples_only off
\\pset format aligned
`;
const tmp = path.join(process.env.TEMP, 'roadmap-dryrun.sql');
writeFileSync(tmp, body + '\n' + (dump ? dumpSql : verify) + '\n' + (commit ? 'COMMIT;' : 'ROLLBACK;') + '\n', 'utf8');
const pgEnv = pgEnvFromDsn(requireEnv('SUPABASE_DB_URL'));
const res = run(resolvePgBin('psql'), ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-P', 'pager=off', '-f', tmp], { env: { ...pgEnv, PGCLIENTENCODING: 'UTF8' }, allowFail: true });
console.log((res.stdout || '').toString());
const err = (res.stderr || '').toString().replace(/postgres(ql)?:\/\/\S+/g, '[dburl]');
if (err.trim()) console.log('STDERR:\n' + err);
console.log(commit ? 'MODE: COMMIT' : 'MODE: ROLLBACK (dry-run)', 'exit', res.status);
