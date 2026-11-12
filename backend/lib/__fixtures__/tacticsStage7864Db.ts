import {readFile} from 'node:fs/promises';
export const tacticsId7864=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
export async function prepareTacticsDatabase7864({exec,riderEntries}:{exec:(source:string)=>Promise<unknown>;riderEntries?:Array<{rider_id:string;race_role:string}>}){
 const team=tacticsId7864(1),race=tacticsId7864(2),rider=tacticsId7864(3),other=tacticsId7864(4);
 await exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE teams(id uuid PRIMARY KEY); CREATE TABLE riders(id uuid PRIMARY KEY);
 CREATE TABLE races(id uuid PRIMARY KEY,status text,stages integer,stages_completed integer);
 CREATE TABLE race_entries(race_id uuid,team_id uuid,rider_id uuid,race_role text,PRIMARY KEY(race_id,rider_id));
 CREATE TABLE race_incidents(race_id uuid,rider_id uuid,outcome text);
 CREATE TABLE race_stage_schedule(race_id uuid,stage_number integer,scheduled_at timestamptz,PRIMARY KEY(race_id,stage_number));
 CREATE TABLE race_stage_profiles(race_id uuid,stage_number integer,distance_km numeric,profile_type text,climbs jsonb,sprints jsonb,PRIMARY KEY(race_id,stage_number));`);
 for(const file of ['2026-07-12-race-v3-s1-work-cost.sql','2026-08-21-4030-race-team-orders.sql']){
  const source=await readFile(new URL(`../../../database/${file}`,import.meta.url),'utf8');
  const ddl=source.match(/CREATE TABLE IF NOT EXISTS public\.race_(?:stage_roles|team_orders)\s*\([\s\S]*?\n\);/);
  if(!ddl)throw new Error(`Missing real table DDL: ${file}`);await exec(ddl[0]);
 }
 const entries=riderEntries??[{rider_id:rider,race_role:'captain'}];
 await exec(`INSERT INTO teams VALUES('${team}'),('${other}'); INSERT INTO riders VALUES ${entries.map(row=>`('${row.rider_id}')`).join(',')};
 INSERT INTO races VALUES('${race}','scheduled',3,0); INSERT INTO race_entries VALUES ${entries.map(row=>`('${race}','${team}','${row.rider_id}','${row.race_role}')`).join(',')};
 INSERT INTO race_stage_schedule SELECT '${race}',n,'2026-11-12T10:00:00Z' FROM generate_series(1,3)n;
 INSERT INTO race_stage_profiles SELECT '${race}',n,160,'flat','[]','[]' FROM generate_series(1,3)n;
 GRANT SELECT,UPDATE ON races,race_entries,race_incidents,race_stage_schedule,race_stage_profiles TO service_role;
 GRANT SELECT,INSERT,UPDATE,DELETE ON race_stage_roles,race_team_orders TO service_role;`);
 const migration=await readFile(new URL('../../../database/2026-11-11-7864-atomic-stage-tactics.sql',import.meta.url),'utf8');
 await exec(migration);await exec(migration);
}
