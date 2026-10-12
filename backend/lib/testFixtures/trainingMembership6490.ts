import { readFile } from 'node:fs/promises';
import { createTrainingSeenFixture } from './trainingSeen6490.ts';
import type { PGlite } from '@electric-sql/pglite';
export { insertReport,report,A,B,C,TEAM } from './trainingSeen6490.ts';
export const readMembership=(name:string)=>readFile(new URL(`../../../database/manual/6490/membership/${name}.sql`,import.meta.url),'utf8');
export async function membershipFixture(){const db=await createTrainingSeenFixture();await db.exec(await readMembership('foundation'));return db;}
export async function refs(db:PGlite){return (await db.query('SELECT report_id::text,rider_key FROM rider_training_report_refs ORDER BY report_id,rider_key COLLATE "C"')).rows;}
export async function refCounts(db:PGlite){return Object.fromEntries((await db.query<{rider_key:string,n:number}>(
  'SELECT rider_key,count(*)::int AS n FROM rider_training_report_refs GROUP BY rider_key ORDER BY rider_key COLLATE "C"')).rows.map(r=>[r.rider_key,r.n]));}
