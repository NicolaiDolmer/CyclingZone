// #6765 M1: bounded shadow maintenance. Legacy publication stays authoritative.
import { evaluateFlagStage, readFlagStage } from './featureStage.js';
import { copenhagenHour } from './copenhagenTime.js';
export const RANKING_SHADOW_ENABLED_FLAG_KEY='ranking_shadow_enabled';
type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
type Client = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
  from?: (table:string) => unknown };
type Options = {
  ownerToken?: string; targetVersion?: number | string; now: number;
  clock: () => number;
  logger?: {info?:(message:string,details:Record<string,unknown>)=>void};
  parityEveryPass?: boolean;
  renewLease?: () => Promise<boolean>;
  captureExceptionFn?: (error: Error, context: { tags: Record<string,string>; extra: Record<string,unknown> }) => void;
};
const lastParity = new WeakMap<object,number>();
const DAY_MS=24*60*60*1000;
// #6765 M1.5: one statement can enqueue more than one 200-item batch. Drain
// within a bounded budget per pass (below the 20 s operational alarm), so a
// burst does not wait one cron minute per batch. Remaining work stays queued.
export const SHADOW_DRAIN_MAX_BATCHES=20;
export const SHADOW_DRAIN_BUDGET_MS=8000;
// #6765 Codex P1: under a coordinator lease the work committed with the
// claimed version (queue ids up to the watermark read after the claim, plus a
// rebuild such a marker expands into) is drained before the version is
// acknowledged, past the soft budget above. These hard caps only stop a
// pathological backlog from pinning the coordinator; the rest stays queued for
// the next ticks and the pass logs status 'version-pending'.
export const SHADOW_VERSION_DRAIN_MAX_BATCHES=100;
export const SHADOW_VERSION_DRAIN_BUDGET_MS=45000;
// Queue ids are bigint and travel as decimal text. Absent before the
// 2026-10-31 migration, NULL on an empty queue.
function queueId(value:unknown,label:string):bigint|null{
  if(value===undefined||value===null) return null;
  if(typeof value!=='string'||!/^\d{1,19}$/.test(value)) throw new Error('Invalid ranking shadow '+label);
  return BigInt(value);
}
// A queue head older than this that a pass could not drain means batches keep
// failing/rolling back or the backlog outgrows the drain. Reported at most
// hourly per backend client so clean one-minute ticks do not flood Sentry.
export const SHADOW_QUEUE_STALL_ALARM_S=1800;
const STALL_ALARM_EVERY_MS=60*60*1000;
const lastStallAlarm = new WeakMap<object,number>();

export async function runRankingShadowPass(client: Client, {
  ownerToken, targetVersion, now,
  clock, logger=console,
  parityEveryPass=process.env.RANKING_SHADOW_PARITY_EVERY_PASS==='true',
  captureExceptionFn, renewLease,
}: Options): Promise<boolean> {
  const started=clock();
  let queueLength:number|null=null,oldestAgeS:number|null=null,batches=0,enabled=false,drained=false,status='disabled';
  // null: no lease or pre-migration SQL, so the M1.5 soft budget alone applies.
  let versionThrough:bigint|null=null,versionDrained:boolean|null=null;
  try {
    if(renewLease && !await renewLease()) throw new Error('Ranking refresh claim lost before shadow metrics');
    const metrics=await client.rpc('get_ranking_shadow_metrics',{});
    if(metrics.error?.code==='PGRST202'||metrics.error?.code==='42883') {
      status='schema-unavailable'; return false;
    }
    if(metrics.error) throw new Error(metrics.error.message);
    const count=(metrics.data as {queue_length?:unknown}|null)?.queue_length;
    if(typeof count!=='number'||!Number.isSafeInteger(count)||count<0) throw new Error('Invalid ranking shadow queue metric');
    queueLength=count;
    // Optional: absent before the 2026-10-23 migration, NULL on an empty queue.
    const age=(metrics.data as {oldest_age_s?:unknown}|null)?.oldest_age_s;
    if(age!==undefined&&age!==null){
      if(typeof age!=='number'||!Number.isSafeInteger(age)||age<0) throw new Error('Invalid ranking shadow queue age metric');
      oldestAgeS=age;
    }
    const watermark=queueId((metrics.data as {max_id?:unknown}|null)?.max_id,'queue watermark');
    if(targetVersion!==undefined&&targetVersion!==null&&watermark!==null){versionThrough=watermark;versionDrained=false;}
    if(renewLease && !await renewLease()) throw new Error('Ranking refresh claim lost before shadow flag');
    enabled=evaluateFlagStage(await readFlagStage(client,RANKING_SHADOW_ENABLED_FLAG_KEY),{engineWrite:true});
    if(renewLease && !await renewLease()) throw new Error('Ranking refresh claim lost after shadow flag');
    if(!enabled) return false;
    status='processing';
    for(;;){
      if(batches>0 && renewLease && !await renewLease()) throw new Error('Ranking refresh claim lost between shadow batches');
      const batchStarted=clock();
      const {data,error}=await client.rpc('apply_ranking_deltas',{
        p_max_items:200,p_owner_token:ownerToken??null,p_target_version:targetVersion??null,
      });
      // Additive migration and Node deployment can arrive in either order.
      if(error?.code==='PGRST202'||error?.code==='42883') return false;
      if(error) throw new Error(error.message);
      batches++;
      const result=data as {status?:string;pending?:boolean;next_id?:unknown;rebuild_from?:unknown;rebuild_through?:unknown}|null;
      if(result?.status==='disabled') {status='disabled';return false;}
      if(result?.pending===false) break;
      // A rebuild marker queued with this version expands into durable work
      // with higher ids. That work belongs to the version too.
      const rebuildFrom=queueId(result?.rebuild_from,'rebuild marker'),rebuildThrough=queueId(result?.rebuild_through,'rebuild watermark');
      if(versionThrough!==null&&rebuildFrom!==null&&rebuildThrough!==null
        &&rebuildFrom<=versionThrough&&rebuildThrough>versionThrough) versionThrough=rebuildThrough;
      const head=queueId(result?.next_id,'queue head');
      const versionWork=versionThrough!==null&&head!==null&&head<=versionThrough;
      if(versionThrough!==null&&!versionWork) versionDrained=true;
      // Only an explicit pending:true earns another batch; anything else keeps
      // the M1 meaning "not done" until the next pass. The budget check assumes
      // the next batch costs what this one did (a batch is never interrupted).
      const elapsed=clock()-started,lastBatch=Math.max(0,clock()-batchStarted);
      if(result?.pending!==true) {status='pending';return true;}
      if(versionWork){
        if(batches>=SHADOW_VERSION_DRAIN_MAX_BATCHES||elapsed+lastBatch>SHADOW_VERSION_DRAIN_BUDGET_MS) {status='version-pending';return true;}
        continue;
      }
      if(batches>=SHADOW_DRAIN_MAX_BATCHES
        || elapsed+lastBatch>SHADOW_DRAIN_BUDGET_MS) {status='pending';return true;}
    }
    drained=true;
    if(versionThrough!==null) versionDrained=true;
    status='processed';
    if(renewLease && !await renewLease()) throw new Error('Ranking refresh claim lost before shadow parity');
    const executionNow=now+Math.max(0,clock()-started);
    const last=lastParity.get(client);
    if(!parityEveryPass && last!==undefined && executionNow-last<DAY_MS) {status='parity-throttled';return true;}
    // The staging cadence override never bypasses the Danish evening peak.
    const hour=copenhagenHour(new Date(executionNow));
    if(hour>=19&&hour<22) {status='parity-deferred-peak';return true;}
    const parity=await client.rpc('check_ranking_shadow_parity',{
      p_target_version:targetVersion??null,p_now:new Date(executionNow).toISOString(),
    });
    if(parity.error) throw new Error(parity.error.message);
    if(renewLease && !await renewLease()) throw new Error('Ranking refresh claim lost after shadow parity');
    const result=parity.data as {status?:string;differences?:unknown}|null;
    if(result?.status==='pending'||result?.status==='deferred-peak'||result?.status==='disabled') {status=result.status;return true;}
    if(result?.status==='equal'||result?.status==='different') lastParity.set(client,now+Math.max(0,clock()-started));
    status=result?.status??'invalid-parity-result';
    if(result?.status!=='equal') {
      const failure=new Error('Ranking shadow parity differs from legacy matviews');
      captureExceptionFn?.(failure,{tags:{lib:'rankingShadowPass'},extra:{differences:result?.differences}});
      return false;
    }
    return true;
  } catch(error) {
    status='error';
    captureExceptionFn?.(error instanceof Error?error:new Error(String(error)),{
      tags:{lib:'rankingShadowPass'},extra:{phase:'shadow'},
    });
    return false;
  } finally {
    const passMs=Math.max(0,clock()-started);
    logger.info?.('[ranking-shadow] pass',{queue_length:queueLength,oldest_age_s:oldestAgeS,batches,pass_ms:passMs,enabled,status,
      ...(versionDrained===null?{}:{version_drained:versionDrained})});
    if((queueLength!==null&&queueLength>10000)||passMs>20000){
      captureExceptionFn?.(new Error('Ranking shadow queue or pass budget exceeded'),{
        tags:{lib:'rankingShadowPass',alarm:'operational-budget'},
        extra:{queue_length:queueLength,oldest_age_s:oldestAgeS,batches,pass_ms:passMs,enabled,status},
      });
    }
    // Only while enabled (off deliberately keeps one aged repair marker) and
    // only when this pass did not drain the queue the age was measured on.
    const alarmAt=now+passMs,lastAlarm=lastStallAlarm.get(client);
    if(enabled&&!drained&&oldestAgeS!==null&&oldestAgeS>SHADOW_QUEUE_STALL_ALARM_S
      &&(lastAlarm===undefined||alarmAt-lastAlarm>=STALL_ALARM_EVERY_MS)){
      lastStallAlarm.set(client,alarmAt);
      captureExceptionFn?.(new Error('Ranking shadow queue head is stalled'),{
        tags:{lib:'rankingShadowPass',alarm:'queue-stall'},
        extra:{queue_length:queueLength,oldest_age_s:oldestAgeS,batches,enabled,status},
      });
    }
  }
}
