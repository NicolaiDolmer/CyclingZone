// #6765 M1: bounded shadow maintenance. Legacy publication stays authoritative.
type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
type Client = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult> };
type Options = {
  ownerToken?: string; targetVersion?: number | string; now?: number;
  parityEveryPass?: boolean;
  renewLease?: () => Promise<boolean>;
  captureExceptionFn?: (error: Error, context: { tags: Record<string,string>; extra: Record<string,unknown> }) => void;
};
const lastParity = new WeakMap<object,number>();
const DAY_MS=24*60*60*1000;

export async function runRankingShadowPass(client: Client, {
  ownerToken, targetVersion, now=Date.now(),
  parityEveryPass=process.env.RANKING_SHADOW_PARITY_EVERY_PASS==='true',
  captureExceptionFn, renewLease,
}: Options = {}): Promise<boolean> {
  try {
    if(renewLease && !await renewLease()) throw new Error('Ranking refresh claim lost before shadow apply');
    const {data,error}=await client.rpc('apply_ranking_deltas',{
      p_max_items:200,p_owner_token:ownerToken??null,p_target_version:targetVersion??null,
    });
    // Additive migration and Node deployment can arrive in either order.
    if(error?.code==='PGRST202'||error?.code==='42883') return false;
    if(error) throw new Error(error.message);
    if(!data || (data as {pending?:boolean}).pending!==false) return true;
    const last=lastParity.get(client);
    if(!parityEveryPass && last!==undefined && now-last<DAY_MS) return true;
    if(renewLease && !await renewLease()) throw new Error('Ranking refresh claim lost before shadow parity');
    const parity=await client.rpc('check_ranking_shadow_parity',{p_target_version:targetVersion??null});
    if(parity.error) throw new Error(parity.error.message);
    if(renewLease && !await renewLease()) throw new Error('Ranking refresh claim lost after shadow parity');
    const result=parity.data as {status?:string;differences?:unknown}|null;
    if(result?.status==='pending') return true;
    if(result?.status==='equal'||result?.status==='different') lastParity.set(client,now);
    if(result?.status!=='equal') {
      const failure=new Error('Ranking shadow parity differs from legacy matviews');
      captureExceptionFn?.(failure,{tags:{lib:'rankingShadowPass'},extra:{differences:result?.differences}});
      return false;
    }
    return true;
  } catch(error) {
    captureExceptionFn?.(error instanceof Error?error:new Error(String(error)),{
      tags:{lib:'rankingShadowPass'},extra:{phase:'shadow'},
    });
    return false;
  }
}
