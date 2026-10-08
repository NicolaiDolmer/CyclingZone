// Operator-only prepared writer. Calculation approval is not production approval.
// Accepts only the slim apply payload (balance-internals/6061/compensation-apply-payload.json):
// plans + scope + per-table source hashes. Raw source rows never reach the RPC (#6129).
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {copenhagenDateString} from '../../lib/copenhagenTime.js';
import {MAX_APPLY_PAYLOAD_BYTES,assertSourceHashes} from './compensation6061Source.mjs';
const isIdList=v=>Array.isArray(v)&&v.length>0&&v.every(x=>typeof x==='string'&&x);
export function validateApprovedFile(raw,hash,now){
 if(!/^[a-f0-9]{64}$/.test(hash??'')||createHash('sha256').update(raw).digest('hex')!==hash)throw new Error('Approved file hash mismatch');
 if(Buffer.byteLength(raw,'utf8')>MAX_APPLY_PAYLOAD_BYTES)throw new Error('Slim apply payload required');
 const plan=JSON.parse(raw);const clock=new Date(now);
 if(!Number.isFinite(clock.getTime())||!/^\d{4}-\d{2}-\d{2}$/.test(plan.through??'')||plan.through>=copenhagenDateString(clock))throw new Error('Valid clock and closed cutoff required');
 if(plan.issue!==6061||plan.policy!=='current_plans_current_engine'||!Array.isArray(plan.plans)||plan.summary?.riders!==plan.plans.length||plan.summary?.rider_days!==plan.plans.reduce((n,p)=>n+(p.days?.length??0),0)||!plan.plans.length)throw new Error('Verified compensation plan required');
 if('source_checks' in plan)throw new Error('Slim apply payload required');
 const scope=plan.source_scope;
 if(!isIdList(scope?.rider_ids)||!isIdList(scope?.team_ids)||!isIdList(scope?.season_ids))throw new Error('Complete source scope required');
 assertSourceHashes(plan.source_hashes);
 if(plan.plans.some(p=>!scope.rider_ids.includes(p.rider_id)||!scope.team_ids.includes(p.team_id)||!scope.season_ids.includes(p.season_id)))throw new Error('Compensation plan outside source scope');
 return plan;
}
export function parseApplyArgs(argv){
 const opts={apply:false,ownerGo:false};
 for(const arg of argv){
  if(arg.startsWith('--plan='))opts.path=arg.slice(7);
  else if(arg.startsWith('--approved-hash='))opts.hash=arg.slice(16);
  else if(arg==='--apply')opts.apply=true;
  else if(arg==='--owner-go=6061-production')opts.ownerGo=true;
  else throw new Error('Unknown compensation option');
 }
 if(!opts.path||!/^[a-f0-9]{64}$/.test(opts.hash??''))throw new Error('--plan and exact --approved-hash required');
 if(opts.apply&&!opts.ownerGo)throw new Error('Separate --owner-go=6061-production required after human production approval');
 return opts;
}
export async function runCompensation({supabase,raw,hash,now,apply=false,ownerGo=false}){
 const plan=validateApprovedFile(raw,hash,now);
 if(!apply)return {dry_run:true,riders:plan.summary.riders,rider_days:plan.summary.rider_days,payload_bytes:Buffer.byteLength(raw,'utf8'),approved_hash:hash};
 if(!ownerGo)throw new Error('Separate production owner-go required');
 const {data,error}=await supabase.rpc('apply_training_compensation_6061',{p_plan_text:raw,p_approved_hash:hash,p_now:now});
 // Only the writer's own guard text (e.g. which source table changed) is surfaced;
 // anything carrying digits/ids stays hidden so no payload value is echoed.
 if(error){const text=String(error.message??'');const guard=/^[A-Za-z ;,()_.-]{1,200}$/.test(text)?text:'see database diagnostics';throw new Error(`Atomic compensation failed (${guard}); nothing was written, repeat dry-run`);}
 if(data?.rider_days!==plan.summary.rider_days)throw new Error('Unexpected compensation result; verify receipts before retry');
 return data;
}
async function main(){
 const opts=parseApplyArgs(process.argv.slice(2));const raw=readFileSync(resolve(opts.path),'utf8');
 let supabase;
 if(opts.apply){const {createClient}=await import('@supabase/supabase-js');supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY,{auth:{persistSession:false}});}
 console.log(JSON.stringify(await runCompensation({supabase,raw,hash:opts.hash,now:new Date().toISOString(),apply:opts.apply,ownerGo:opts.ownerGo})));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
