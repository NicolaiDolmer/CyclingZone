import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { readMembership } from './trainingMembership6490.ts';
export const READER_SIGNATURES = [
  'public.register_training_date_work(uuid,uuid,date,integer[],uuid[],timestamp with time zone,timestamp with time zone)',
  'public.initialize_first_use_rider_condition()',
  'public.apply_training_compensation_6061(text,text,timestamp with time zone)',
];
export async function readManual(name: string) {
  return readFile(new URL(`../../../database/manual/6490/training-seen-${name}.sql`,import.meta.url),'utf8');
}
export async function sourceFunction(file: string,name: string) {
  const source=(await readFile(new URL(`../../../database/${file}`,import.meta.url),'utf8')).replaceAll('\r','');
  const start=source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end=source.indexOf('\n$$;',start);
  if(start<0||end<start)throw new Error(`Missing SQL fixture function: ${name}`);
  return source.slice(start,end+4);
}
export async function createTrainingSeenReadersFixture(projection='counter') {
  if(!['counter','membership'].includes(projection))throw new Error('Unknown fixture projection');
  const db=new PGlite();
  await db.exec(await readFile(new URL('./trainingSeenReaders6490.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../../../database/2026-10-05-6061-compensation-ledger.sql',import.meta.url),'utf8'));
  for(const [file,name] of [
    ['2026-10-10-6439-training-follows-rider.sql','register_training_date_work'],
    ['2026-10-11-academy-sign-latency.sql','initialize_first_use_rider_condition'],
    ['2026-10-05-6129-compensation-slim-source.sql','training_compensation_6061_source_hashes'],
    ['2026-10-05-6129-compensation-slim-source.sql','apply_training_compensation_6061'],
  ])await db.exec(await sourceFunction(file,name));
  for(const sig of [...READER_SIGNATURES,'public.training_compensation_6061_source_hashes(uuid[],uuid[],uuid[],date)']) {
    await db.exec(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION ${sig} TO service_role;`);
  }
  await db.exec(`CREATE TRIGGER trg_initialize_first_use_rider_condition AFTER INSERT OR UPDATE OF team_id ON riders
    FOR EACH ROW EXECUTE FUNCTION initialize_first_use_rider_condition();`);
  for(const name of ['foundation','parity','backfill'])await db.exec(await (projection==='membership'?readMembership:readManual)(name));
  return db;
}
