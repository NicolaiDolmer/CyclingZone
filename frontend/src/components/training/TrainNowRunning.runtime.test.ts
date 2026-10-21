import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';

const source = stripTypeScriptTypes(readFileSync(new URL('./TrainNowClient.ts', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*?from\s+"[^"]+";\s*/gm, '').replaceAll('export ', '');
const flush = async () => { for (let n=0;n<12;n++) await Promise.resolve(); };
function harness() {
  const effects: Array<() => (() => void) | undefined> = [];
  const timeouts = new Map<number, () => void>();
  let tick: () => Promise<void> = async () => {};
  let stateIndex=0, refreshes=0, active=0, maxActive=0;
  const requests: Array<{signal?: AbortSignal; finish: (settled?: boolean) => void}> = [];
  const states: unknown[] = [];
  const hook = runInNewContext(`${source}\nuseTrainNow`, {
    AbortController, TRAIN_NOW_OFF: {}, parseTrainNowStatus: (x: unknown) => x,
    useCallback: (fn: unknown) => fn, useRef: (v: unknown) => ({current:v}),
    useState: (v: unknown) => { const i=stateIndex++; states[i]=i===4?true:v; return [states[i],(next: unknown)=>{states[i]=next;}]; },
    useEffect: (fn: () => (() => void) | undefined) => effects.push(fn),
    authHeaders: async()=>({}),
    apiFetch: (_path: string, options: {signal?: AbortSignal}) => new Promise((resolve,reject)=>{
      active++; maxActive=Math.max(active,maxActive);
      const finish=(settled=false)=>{active--;resolve({ok:true,data:{settled}});};
      requests.push({signal:options.signal,finish});
      options.signal?.addEventListener('abort',()=>{active--;reject(new DOMException('Aborted','AbortError'));},{once:true});
    }),
    setInterval: (fn: typeof tick) => {tick=fn;return 1;}, clearInterval:()=>{},
    setTimeout: (fn: () => void, ms: number) => {timeouts.set(ms,fn);return ms;},
    clearTimeout: (id: number) => timeouts.delete(id),
  });
  hook({onSettled:()=>{refreshes++;}});
  const cleanup=effects[1]();
  return {tick:()=>tick(),timeout:()=>timeouts.get(8000)?.(),ceiling:()=>timeouts.get(900000)?.(),cleanup,
    requests,states,get active(){return active;},get maxActive(){return maxActive;},get refreshes(){return refreshes;}};
}

test('#6839 status timeout aborts actual fetch before a new poll starts',async()=>{
  const h=harness(); const first=h.tick();await flush();
  assert.equal(h.active,1);
  h.timeout();await flush();
  assert.equal(h.requests[0].signal?.aborted,true);
  await first;
  assert.equal(h.active,0);
  const second=h.tick();await flush();
  assert.equal(h.maxActive,1);
  h.requests[1].finish(true);await second;
  assert.equal(h.refreshes,1);assert.equal(h.states[4],false);
  h.cleanup?.();
});
for(const stop of ['cleanup','ceiling'] as const) test(`#6839 ${stop} aborts pending status without refresh`,async()=>{
  const h=harness();const pending=h.tick();await flush();h[stop]?.();await flush();
  assert.equal(h.requests[0].signal?.aborted,true);await pending;
  assert.equal(h.active,0);assert.equal(h.refreshes,0);
});
