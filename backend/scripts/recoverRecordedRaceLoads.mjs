// Owner-approved recovery only. Default is read-only; --apply must be explicit.
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { recoverRecordedRaceLoads,completeRecordedRace } from '../lib/trainingRaceRecovery.js';

const args=process.argv.slice(2);
if(args.includes('--help')) {
  console.log('node backend/scripts/recoverRecordedRaceLoads.mjs --race=<uuid> [--stages=1,2 | --complete] [--apply]');
  console.log('Dry-run by default. Apply only after owner approval and pausing/draining race finalizers. Restores recorded loads; unfinished races remain held for review.');
  console.log('--complete can finish the stored-result tail when original board/notification completion proofs exist; missing proofs are reported as blockers.');
  process.exit(0);
}
config();
const raceId=args.find(arg=>arg.startsWith('--race='))?.slice(7);
const selected=args.find(arg=>arg.startsWith('--stages='))?.slice(9);
const stageNumbers=selected?selected.split(',').map(Number):null;
const apply=args.includes('--apply');
const complete=args.includes('--complete');
if(!raceId||(complete&&stageNumbers)||args.some(arg=>arg!=='--apply'&&arg!=='--complete'&&!arg.startsWith('--race=')&&!arg.startsWith('--stages='))) throw new Error('Use --race=<uuid> [--stages=1,2 | --complete] [--apply]; --help describes the safe workflow');
if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY required');
const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
try {
  const result=complete?await completeRecordedRace({supabase,raceId,apply}):await recoverRecordedRaceLoads({supabase,raceId,stageNumbers,apply});
  console.log(JSON.stringify(result,null,2));
  if(!result.canApply) process.exitCode=2;
} catch(error) {
  console.error(error.message);
  process.exitCode=1;
}
