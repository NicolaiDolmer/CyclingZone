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

export async function runRankingShadowPass(client: Client, {
  ownerToken, targetVersion, now,
  clock, logger=console,
  parityEveryPass=process.env.RANKING_SHADOW_PARITY_EVERY_PASS==='true',
  captureExceptionFn, renewLease,
}: Options): Promise<boolean> {
  const started=clock();
  let queueLength:number|null=null,enabled=false,status='disabled';
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
    if(renewLease && !await renewLease()) throw new Error('Ranking refresh claim lost before shadow flag');
    enabled=evaluateFlagStage(await readFlagStage(client,RANKING_SHADOW_ENABLED_FLAG_KEY),{engineWrite:true});
    if(renewLease && !await renewLease()) throw new Error('Ranking refresh claim lost after shadow flag');
    if(!enabled) return false;
    status='processing';
    const {data,error}=await client.rpc('apply_ranking_deltas',{
      p_max_items:200,p_owner_token:ownerToken??null,p_target_version:targetVersion??null,
    });
    // Additive migration and Node deployment can arrive in either order.
    if(error?.code==='PGRST202'||error?.code==='42883') return false;
    if(error) throw new Error(error.message);
    if(!data || (data as {pending?:boolean}).pending!==false) {status='pending';return true;}
    status='processed';
    if(renewLease && !await renewLease()) throw new Error('Ranking refresh claim lost before shadow parity');
    const executionNow=now+Math.max(0,clock()-started);
    const last=lastParity.get(client);
    if(!parityEveryPass && last!==undefined && executionNow-last<DAY_MS) {status='parity-throttled';return true;}
    // The staging cadence override never bypasses the Danish evening peak.
    const hour=copenhagenHour(new Date(executionNow));
    if(hour>=19&&hour<22) {status='parity-deferred-peak';return true;}
    const parity=await client.rpc('check_ranking_shadow_parity',{p_target_version:targetVersion??null});
    if(parity.error) throw new Error(parity.error.message);
    if(renewLease && !await renewLease()) throw new Error('Ranking refresh claim lost after shadow parity');
    const result=parity.data as {status?:string;differences?:unknown}|null;
    if(result?.status==='pending'||result?.status==='deferred-peak') {status=result.status;return true;}
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
    logger.info?.('[ranking-shadow] pass',{queue_length:queueLength,pass_ms:passMs,enabled,status});
    if((queueLength!==null&&queueLength>10000)||passMs>20000){
      captureExceptionFn?.(new Error('Ranking shadow queue or pass budget exceeded'),{
        tags:{lib:'rankingShadowPass',alarm:'operational-budget'},
        extra:{queue_length:queueLength,pass_ms:passMs,enabled,status},
      });
    }
  }
}
