// Owner scope 12 October: existing baseline plus one trial per alternative.
// Offline aggregation only. Refuse partial experiments.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const root='docs/snapshots/6490';
const stats=values=>{
 const sorted=[...values].sort((a,b)=>a-b);
 return {count:sorted.length,p50:sorted[Math.ceil(sorted.length*.5)-1],p95:sorted[Math.ceil(sorted.length*.95)-1],max:sorted.at(-1)};
};
const sum=(rows,key)=>rows.reduce((n,row)=>n+Number(row[key]??0),0);
const arms=[];let workloadSha256;
for(const arm of ['baseline','fastupdate-off','no-gin']){
 const runs=[1].map(repeat=>{
  const name=`${arm}-${repeat}.json`,privateFile=`.codex.local/6490-evidence-full/${name}`;
  return JSON.parse(readFileSync(existsSync(privateFile)?privateFile:`${root}/${name}`));
 });
 for(const run of runs){
  workloadSha256??=run.workloadSha256;
  if(run.status!=='COMPLETED'||run.workloadSha256!==workloadSha256||run.calls.length!==2620||run.teamDates.length!==262)throw new Error('Incomplete or mismatched experiment');
  const writers=run.calls.filter(c=>c.kind==='writer');
  if(writers.length!==1310||sum(writers,'applied')!==41450||writers.some(c=>c.applied<=0||c.alreadyRan))throw new Error('Writer coverage mismatch');
  if(arm!=='no-gin'&&(run.endIndexAfterDrain.pending_pages!==0||run.endIndexAfterDrain.pending_tuples!==0))throw new Error('Pending index work remains');
 }
 const writers=runs.flatMap(r=>r.calls.filter(c=>c.kind==='writer'));
 const sources={};
 for(const row of runs.flatMap(r=>r.attribution.filter(a=>a.kind==='writer'))){
  sources[row.category]=(sources[row.category]??0)+Number(row.wal_bytes);
 }
 arms.push({arm,writerCalls:writers.length,sqlMsPerCall:stats(writers.map(c=>c.sqlMs)),
  clientThroughCommitMsPerCall:stats(writers.map(c=>c.clientThroughCommitMs)),
  sqlMsPerTeamDate:stats(runs.flatMap(r=>r.teamDates.map(t=>t.sqlMs))),
  walBytesPerCall:sum(writers,'walBytes')/writers.length,
  walBytesPerTeamDate:sum(writers,'walBytes')/(runs.length*262),
  sourceTransactionWalBytesPerCall:Object.fromEntries(Object.entries(sources).map(([k,v])=>[k,v/writers.length])),
  repeats:runs.map(r=>({repeat:r.repeat,sqlMsPerCall:r.duration.allWriterSqlMs,
   writerWalBytes:sum(r.calls.filter(c=>c.kind==='writer'),'walBytes'),
   writerSqlSeconds:sum(r.calls.filter(c=>c.kind==='writer'),'sqlMs')/1000,
   deferredCleanup:r.deferredCleanup??null})),
  wholeEveningDurationEstimate:null});
}
const result={workloadSha256,teamDatesPerTrial:262,writerCallsPerTrial:1310,appliedRiderSlotsPerTrial:41450,
 durationMeaning:'SQL execution time. Sum is database work, not elapsed evening duration. Client timing includes transport and commit.',
 walMeaning:'Statement WAL; source attribution includes transaction records separately. Deferred cleanup excluded and reported separately.',arms};
writeFileSync(`${root}/summary.json`,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
