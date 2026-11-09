import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ownershipSnapshot } from './wave-ownership.mjs';
import { recoverWave, processSnapshot } from './wave-recovery.mjs';
import { updateWave, readWave, finalizeObservedWave, recoverObservedWave, acquireWave, withWaveStateLock } from './wave-policy.mjs';
import { allChildrenObservedStopped, registeredChildProcesses, persistChildStop } from './wave-child-lifecycle.mjs';

const now = 1790000000000;

function observedJob(waveId,key,pid) {
  const job={type:'windows-job-v1',token:'00000000-0000-4000-8000-000000000001',waveId,childKey:key};
  return {job,treeProof:{version:1,containment:job.type,activeProcesses:0,token:job.token,waveId,childKey:key,supervisorPid:pid}};
}
const stoppedChild={key:'worker',pid:200,state:'stopped',closeObserved:true,closedAt:now,exitCode:0,...observedJob('fixture-wave','worker',200)};

function fixture(t, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-wave-recovery-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const wave = { waveId: 'fixture-wave', owner: 'fixture-owner', runtime: 'codex', pid: 100,
    bootId: 'fixture-boot', dispatchStarted: true,
    processTracking: 'registered', children: [{ key: 'worker', pid: 200, state: 'running' }], ...extra };
  fs.writeFileSync(path.join(dir, 'wave-active.json'), JSON.stringify(wave));
  return { dir, wave };
}
const expected = { waveId: 'fixture-wave', owner: 'fixture-owner', now };
const sameBoot = processes => () => ({ bootId: 'fixture-boot', processes });
const nextBoot = processes => () => ({ bootId: 'next-boot', processes });

test('observed reboot proves the old tree stopped; evidence retained', t => {
  const { dir } = fixture(t);
  const result = recoverWave(dir, expected, nextBoot([{ pid: 999, ppid: 998 }]));
  assert.equal(result.released, true);
  assert.equal(fs.existsSync(path.join(dir, 'wave-active.json')), false);
  assert.ok(fs.existsSync(result.evidence));
});

test('living owner, worker or orphaned descendant keeps the marker', t => {
  const { dir } = fixture(t);
  for (const processes of [[{ pid: 100, ppid: 1 }], [{ pid: 200, ppid: 100 }], [{ pid: 300, ppid: 200 }]]) {
    assert.throws(() => recoverWave(dir, expected, sameBoot(processes)), /Same-boot/);
    assert.equal(fs.existsSync(path.join(dir, 'wave-active.json')), true);
  }
  updateWave(dir, expected.waveId, wave => ({ ...wave, children: [{ key: 'worker', pid: 200, state: 'stopped' }] }));
  assert.throws(() => recoverWave(dir, expected, sameBoot([{ pid: 300, ppid: 200 }])), /Same-boot/);
  // Both intermediate ancestors have disappeared from the current snapshot.
  assert.throws(() => recoverWave(dir, expected, sameBoot([{ pid: 400, ppid: 300 }])), /Same-boot/);
});

test('unknown process snapshot, missing owner PID, or incomplete spawn never releases', t => {
  const { dir } = fixture(t);
  assert.throws(() => recoverWave(dir, expected, () => { throw Error('unavailable'); }), /unavailable/);
  updateWave(dir, expected.waveId, wave => ({ ...wave, children: [{ key: 'worker', state: 'starting' }] }));
  assert.throws(() => recoverWave(dir, expected, sameBoot([])), /incomplete/);
  const missingOwner = fixture(t, { children: [], pid: null });
  assert.throws(() => recoverWave(missingOwner.dir, expected, sameBoot([])), /owner PID/);
  assert.equal(fs.existsSync(path.join(dir, 'wave-active.json')), true);
});

test('foreign ownership and legacy markers are rejected explicitly', t => {
  const { dir } = fixture(t);
  assert.throws(() => recoverWave(dir, { ...expected, owner: 'other' }, sameBoot([])), /owner/);
  fs.writeFileSync(path.join(dir, 'wave-active.json'), JSON.stringify({ tracks: [], expiresAt: '2000-01-01' }));
  assert.throws(() => recoverWave(dir, expected, sameBoot([])), /legacy/i);
  assert.equal(fs.existsSync(path.join(dir, 'wave-active.json')), true);
});

test('marker updates replace atomically and refuse a different wave', t => {
  const { dir } = fixture(t);
  updateWave(dir, expected.waveId, wave => ({ ...wave, watchPid: 456 }));
  assert.equal(readWave(dir).watchPid, 456);
  assert.throws(() => updateWave(dir, 'foreign', wave => wave), /owner/);
  assert.deepEqual(fs.readdirSync(dir), ['wave-active.json']);
});

test('Windows recovery measures a real stopped owner and refuses the live test process', { skip: process.platform !== 'win32' }, t => {
  const child = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  assert.equal(child.status, 0);
  const { dir } = fixture(t, { pid: process.pid, bootId: processSnapshot().bootId, dispatchStarted: false, children: [] });
  assert.throws(() => recoverWave(dir, expected), /alive/);
  const stopped = fixture(t, { pid: child.pid, bootId: processSnapshot().bootId, dispatchStarted: false, children: [] });
  assert.equal(recoverWave(stopped.dir, expected).released, true);
});

// #5533: Windows LastBootUpTime drifts sub-ms within one boot (23/9: +0.772 ms).
const markerTicks = '639256957975000000';
const driftedTicks = '639256957975007720';
const minutesLater = (BigInt(markerTicks) + 5n * 60n * 10_000_000n).toString();
const bootAt = bootId => processes => () => ({ bootId, processes });

test('sub-second boot drift is the same boot: a dispatched wave is never released as host-restarted', t => {
  const { dir } = fixture(t, { bootId: markerTicks });
  assert.throws(() => recoverWave(dir, expected, bootAt(driftedTicks)([{ pid: 999, ppid: 998 }])), /Same-boot/);
  assert.equal(fs.existsSync(path.join(dir, 'wave-active.json')), true);
});

test('sub-second boot drift before dispatch still recovers a dead owner as the same boot', t => {
  const { dir } = fixture(t, { bootId: markerTicks, dispatchStarted: false, children: [] });
  const result = recoverWave(dir, expected, bootAt(driftedTicks)([{ pid: 999, ppid: 998 }]));
  assert.equal(result.released, true);
  const evidence = JSON.parse(fs.readFileSync(result.evidence, 'utf8'));
  assert.equal(evidence.proof, 'dead-owner-before-dispatch');
  assert.equal(evidence.observedBootId, '639256957970000000');
});

// Owner admitted shortly after the 17:43:17 UTC boot; the new boot starts 5 minutes after it.
const ownerProcess = { pid: 100, createdAt: '2026-09-22T17:44:00.0000000Z', bootId: markerTicks };
const newBootProcesses = [{ pid: 4, ppid: 0, createdAt: '2026-09-22T17:48:22.9512800Z' }, { pid: 100, ppid: 4, createdAt: '2026-09-22T17:49:10.0000000Z' }];
const sameBootProcesses = [{ pid: 4, ppid: 0, createdAt: '2026-09-22T17:43:22.9512800Z' }, { pid: 999, ppid: 4, createdAt: '2026-09-22T18:10:00.0000000Z' }];

test('a real restart minutes later is still recovered as host-restarted', t => {
  const { dir } = fixture(t, { bootId: markerTicks, ownerProcess });
  const result = recoverWave(dir, expected, bootAt(minutesLater)(newBootProcesses));
  assert.equal(result.released, true);
  assert.equal(JSON.parse(fs.readFileSync(result.evidence, 'utf8')).proof, 'host-restarted');
});

test('a large clock correction without restart is never taken as host-restarted', t => {
  // Boot time moved an hour by a clock step, but the kernel still predates the owner.
  const stepped = (BigInt(markerTicks) + 3600n * 10_000_000n).toString();
  const { dir } = fixture(t, { bootId: markerTicks, ownerProcess });
  assert.throws(() => recoverWave(dir, expected, bootAt(stepped)(sameBootProcesses)), /Same-boot/);
  assert.equal(fs.existsSync(path.join(dir, 'wave-active.json')), true);
});

test('a changed Windows boot time without process-start proof keeps the marker', t => {
  const { dir } = fixture(t, { bootId: markerTicks });
  // No admitted owner start time to compare with: restart unproven.
  assert.throws(() => recoverWave(dir, expected, bootAt(minutesLater)(newBootProcesses)), /Same-boot/);
  const unparseable = fixture(t, { bootId: markerTicks, ownerProcess });
  assert.throws(() => recoverWave(unparseable.dir, expected, bootAt(minutesLater)([{ pid: 4, ppid: 0 }])), /Same-boot/);
  assert.equal(fs.existsSync(path.join(dir, 'wave-active.json')), true);
});

test('recovery after reboot does not kill an old watch PID reused by another process', t => {
  const { dir } = fixture(t, { watchPid: process.pid, watchStarted: 'old-identity' });
  assert.equal(recoverWave(dir, expected, nextBoot([{ pid: process.pid, ppid: 1 }])).released, true);
});

test('a recovery crash lock from an earlier boot cannot block the next boot', t => {
  const { dir } = fixture(t);
  fs.writeFileSync(path.join(dir, 'wave-recovery-fixture-wave-old-boot.lock'), '');
  assert.equal(recoverWave(dir, expected, nextBoot([])).released, true);
});

test('Claude hook timeout covers the GitHub deadline with headroom', () => {
  const settings = JSON.parse(fs.readFileSync(new URL('../.claude/settings.json', import.meta.url)));
  const hook = settings.hooks.PreToolUse.flatMap(group => group.hooks).find(h => h.command.includes('guard-agent-spawn.sh'));
  assert.ok(hook.timeout >= 45);
});

test('#7554: same-boot recovery uses closed registration and persisted child-close observations',t=>{
  const {dir}=fixture(t,{state:'draining',registrationClosed:true,children:[stoppedChild]});
  const result=recoverWave(dir,expected,sameBoot([]));
  assert.equal(result.released,true);
  assert.equal(fs.existsSync(path.join(dir,'wave-active.json')),false);
  assert.equal(JSON.parse(fs.readFileSync(result.evidence,'utf8')).proof,'registered-children-closed');
});

test('#7554: a new descendant during final recovery validation retains the marker',t=>{
  const {dir}=fixture(t,{state:'draining',registrationClosed:true,children:[stoppedChild]});
  let snapshots=0;
  assert.throws(()=>recoverWave(dir,expected,()=>({bootId:'fixture-boot',processes:++snapshots===1?[]:[{pid:300,ppid:200}]})),/alive/);
  assert.equal(fs.existsSync(path.join(dir,'wave-active.json')),true);
});

test('#7554: incomplete, legacy or open registrations cannot use same-boot stop recovery',t=>{
  for(const extra of [
    {registrationClosed:false},{state:'running'},{runtime:'claude',processTracking:'owner-tree'},
    {terminationUnaccounted:true},{children:[{...stoppedChild,state:'running'}]},
    {children:[{...stoppedChild,closeObserved:false}]},{children:[{...stoppedChild,closedAt:undefined}]},
    {children:[{...stoppedChild,pid:null}]},{children:[stoppedChild,stoppedChild]},
  ]){
    const {dir}=fixture(t,{state:'draining',registrationClosed:true,children:[stoppedChild],...extra});
    assert.equal(allChildrenObservedStopped(readWave(dir)),false);
    assert.throws(()=>recoverWave(dir,expected,sameBoot([])),/Same-boot|incomplete/);
    assert.equal(fs.existsSync(path.join(dir,'wave-active.json')),true);
  }
});
test('#7554: live owner, child, descendant or invalid snapshot retains a completed registration',t=>{
  for(const processes of [[{pid:100,ppid:1}],[{pid:200,ppid:100}],[{pid:300,ppid:200}],[{pid:300}],[{pid:-1,ppid:0}]]){
    const {dir}=fixture(t,{state:'draining',registrationClosed:true,children:[stoppedChild]});
    assert.throws(()=>recoverWave(dir,expected,sameBoot(processes)),/alive|invalid/);
    assert.equal(fs.existsSync(path.join(dir,'wave-active.json')),true);
  }
});
test('#7554: spawn failure with observed close is not an incomplete unknown PID',t=>{
  const {dir}=fixture(t,{state:'draining',registrationClosed:true,children:[{...stoppedChild,pid:null,spawnFailed:true,exitCode:-2}]});
  assert.equal(recoverWave(dir,expected,sameBoot([{pid:0,ppid:0}])).released,true);
});
test('#7554: sealed child registration cannot be reopened or gain another child',t=>{
  const {dir}=fixture(t,{state:'draining',registrationClosed:true,children:[stoppedChild]});
  assert.throws(()=>updateWave(dir,expected.waveId,w=>({...w,registrationClosed:false})),/reopen/);
  assert.throws(()=>updateWave(dir,expected.waveId,w=>({...w,children:[...w.children,{...stoppedChild,key:'extra'}]})),/add or remove/);
  assert.throws(()=>updateWave(dir,expected.waveId,w=>({...w,children:[]})),/add or remove/);
  assert.equal(readWave(dir).children.length,1);
});
test('#7554: final snapshot boot change or marker mutation never releases',t=>{
  for(const mutation of ['boot','marker']){
    const {dir}=fixture(t,{state:'draining',registrationClosed:true,children:[stoppedChild]});let calls=0;
    const snapshot=()=>{
      if(++calls===2&&mutation==='marker')fs.writeFileSync(path.join(dir,'wave-active.json'),JSON.stringify({...readWave(dir),owner:'foreign'}));
      return {bootId:calls===2&&mutation==='boot'?'different-boot':'fixture-boot',processes:[]};
    };
    assert.throws(()=>recoverWave(dir,expected,snapshot),/changed/);
    assert.equal(fs.existsSync(path.join(dir,'wave-active.json')),true);
  }
});
test('#7554: automatic recovery never removes legacy or live-owner markers',async t=>{
  const legacy=fixture(t);
  assert.equal((await recoverObservedWave(legacy.dir,now,()=>{assert.fail('legacy marker must not measure or recover');})).released,false);
  const active=fixture(t,{state:'draining',registrationClosed:true,children:[stoppedChild]});
  assert.equal((await recoverObservedWave(active.dir,now,sameBoot([{pid:100,ppid:1}]))).released,false);
  assert.equal(fs.existsSync(path.join(active.dir,'wave-active.json')),true);
  const stopped=fixture(t,{state:'draining',registrationClosed:true,children:[stoppedChild]});
  assert.equal((await recoverObservedWave(stopped.dir,now,sameBoot([]))).released,true);
  assert.equal((await recoverObservedWave(stopped.dir,now,sameBoot([]))).released,false);
});
test('#7554: owned finalization checks caller identity and fresh registered descendants',t=>{
  const owner={pid:process.pid,createdAt:'10',bootId:'fixture-boot'};
  const ownerRow={pid:process.pid,ppid:0,createdAt:'10'};
  for(const scenario of ['safe','foreign','descendant','unavailable']){
    const {dir}=fixture(t,{pid:process.pid,ownerProcess:owner,state:'draining',registrationClosed:true,children:[stoppedChild]});let calls=0;
    const snapshot=()=>{
      calls++;
      if(scenario==='unavailable')throw Error('snapshot unavailable');
      return {bootId:'fixture-boot',processes:scenario==='foreign'?[]:[ownerRow,...(scenario==='descendant'&&calls===2?[{pid:300,ppid:200}]:[])]};
    };
    if(scenario==='safe'){
      const result=finalizeObservedWave(dir,expected.waveId,now,snapshot);
      assert.equal(result.released,true);
      assert.equal(JSON.parse(fs.readFileSync(result.evidence)).proof,'registered-children-closed');
    }else{
      assert.throws(()=>finalizeObservedWave(dir,expected.waveId,now,snapshot),/own|alive|unavailable/);
      assert.equal(fs.existsSync(path.join(dir,'wave-active.json')),true);
    }
  }
});
test('#7554: registered intermediate process roots expose surviving deeper descendants',()=>{
  const wave={children:[{pid:200},{pid:300}]};
  assert.deepEqual(registeredChildProcesses(wave,{processes:[{pid:400,ppid:300},{pid:500,ppid:400},{pid:0,ppid:0}]}).map(p=>p.pid),[400,500]);
});
test('#7554: Windows assert-idle automatically recovers a stopped registered fixture without TTY', {skip:process.platform!=='win32'},t=>{
  const owner=spawnSync(process.execPath,['-e','process.exit(0)']);assert.equal(owner.status,0);
  const child=spawnSync(process.execPath,['-e','process.exit(0)']);assert.equal(child.status,0);
  const {dir}=fixture(t,{pid:owner.pid,bootId:processSnapshot().bootId,state:'draining',registrationClosed:true,children:[{...stoppedChild,pid:child.pid,...observedJob('fixture-wave','worker',child.pid)}]});
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./wave-policy.mjs',import.meta.url)),'assert-idle','--run-dir',dir],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).idle,true);
  assert.equal(fs.existsSync(path.join(dir,'wave-active.json')),false);
});

test('#7554: owned finalization rejects a marker changed during its final snapshot',t=>{
  const owner={pid:process.pid,createdAt:'10',bootId:'fixture-boot'};
  const {dir}=fixture(t,{pid:process.pid,ownerProcess:owner,state:'draining',registrationClosed:true,children:[stoppedChild]});let calls=0;
  const snapshot=()=>{
    if(++calls===2)fs.writeFileSync(path.join(dir,'wave-active.json'),JSON.stringify({...readWave(dir),owner:'foreign'}));
    return {bootId:'fixture-boot',processes:[{pid:process.pid,ppid:0,createdAt:'10'}]};
  };
  assert.throws(()=>finalizeObservedWave(dir,expected.waveId,now,snapshot),/changed/);
  assert.equal(fs.existsSync(path.join(dir,'wave-active.json')),true);
});

test('#7554: concurrent Windows admission checks recover once and leave no recovery locks',{skip:process.platform!=='win32'},async t=>{
  const owner=spawnSync(process.execPath,['-e','process.exit(0)']);assert.equal(owner.status,0);
  const child=spawnSync(process.execPath,['-e','process.exit(0)']);assert.equal(child.status,0);
  const {dir}=fixture(t,{pid:owner.pid,bootId:processSnapshot().bootId,state:'draining',registrationClosed:true,children:[{...stoppedChild,pid:child.pid,...observedJob('fixture-wave','worker',child.pid)}]});
  const check=()=>new Promise((resolve,reject)=>{
    const process=spawn(globalThis.process.execPath,[fileURLToPath(new URL('./wave-policy.mjs',import.meta.url)),'assert-idle','--run-dir',dir],{windowsHide:true,stdio:'ignore'});
    process.once('error',reject);process.once('close',resolve);
  });
  const codes=await Promise.all([check(),check()]);
  assert.ok(codes.includes(0));
  assert.ok(codes.every(code=>code===0||code===2));
  assert.equal(fs.existsSync(path.join(dir,'wave-active.json')),false);
  assert.deepEqual(fs.readdirSync(dir).filter(name=>name.endsWith('.lock')),[]);
});
test('#7554: an uncontained watch cannot authorize automatic release',{skip:process.platform!=='win32'},async t=>{
  const child=spawn(process.execPath,['-e','process.stdin.resume()'],{windowsHide:true,stdio:['pipe','ignore','ignore']});
  const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill();});
  const identity=spawnSync('pwsh',['-NoProfile','-Command',`(Get-Process -Id ${child.pid}).StartTime.ToUniversalTime().Ticks.ToString()`],{encoding:'utf8'});
  assert.equal(identity.status,0,identity.stderr);
  const observed=ownershipSnapshot(),owner=observed.processes.find(p=>p.pid===process.pid);
  const {dir}=fixture(t,{pid:process.pid,bootId:observed.bootId,ownerProcess:{pid:process.pid,createdAt:owner.createdAt,bootId:observed.bootId},state:'draining',registrationClosed:true,children:[],watchPid:child.pid,watchStarted:identity.stdout.trim()});
  assert.equal(finalizeObservedWave(dir,expected.waveId,now).released,false);
  assert.equal(fs.existsSync(path.join(dir,'wave-active.json')),true);
  child.kill(); await closed;
});

test('#7554: Windows admission automatically releases completed prior registration',{skip:process.platform!=='win32'},async t=>{
  const owner=spawnSync(process.execPath,['-e','process.exit(0)']);assert.equal(owner.status,0);
  const child=spawnSync(process.execPath,['-e','process.exit(0)']);assert.equal(child.status,0);
  const bootId=processSnapshot().bootId;
  const {dir}=fixture(t,{pid:owner.pid,bootId,state:'draining',registrationClosed:true,children:[{...stoppedChild,pid:child.pid,...observedJob('fixture-wave','worker',child.pid)}]});
  const stopFile=path.join(dir,'build-stop-fixture.json');
  fs.writeFileSync(stopFile,JSON.stringify({active:false,since:'2026-10-29',finishList:[],cleanupList:[],brandList:[]}));
  const prior=process.env.CZ_BUILD_STOP_FILE;process.env.CZ_BUILD_STOP_FILE=stopFile;
  t.after(()=>{if(prior===undefined)delete process.env.CZ_BUILD_STOP_FILE;else process.env.CZ_BUILD_STOP_FILE=prior;});
  const next=await acquireWave(dir,{runtime:'codex',owner:'next-owner',pid:process.pid,bootId,dispatchStarted:false,processTracking:'registered',children:[],now,
    tracks:[{issue:1,branch:'codex/7554-next-fixture',title:'Fixture',ownership:['fixtures/next.mjs'],tier:'TARGETED'}]},async()=>[]);
  assert.notEqual(next.waveId,expected.waveId);
  assert.equal(readWave(dir).owner,'next-owner');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'waves',expected.waveId,'recovery.json'))).proof,'registered-children-closed');
});

test('#7554: wrapper close cannot prove a detached orphan subtree stopped',t=>{
  const {dir}=fixture(t,{state:'draining',registrationClosed:true,children:[{key:'wrapper',pid:200,state:'stopped',closeObserved:true,closedAt:now,exitCode:0}]});
  assert.throws(()=>recoverWave(dir,expected,sameBoot([{pid:400,ppid:300}])),/Same-boot/);
  assert.equal(fs.existsSync(path.join(dir,'wave-active.json')),true);
});
test('#7554: sealed registration rejects in-place transforms',t=>{
  for(const change of [w=>{w.registrationClosed=false;return w;},w=>{w.children.push({...stoppedChild,key:'extra'});return w;}]){
    const {dir}=fixture(t,{state:'draining',registrationClosed:true,children:[stoppedChild]});
    assert.throws(()=>updateWave(dir,expected.waveId,change),/reopen|add or remove/);
    assert.equal(readWave(dir).registrationClosed,true);
    assert.equal(readWave(dir).children.length,1);
  }
});

test('#7554: real state-lock contention cannot erase the durable stop receipt',async t=>{
  const {dir}=fixture(t,{state:'draining',registrationClosed:true,children:[{...stoppedChild,state:'running',closeObserved:false,treeProof:null}]});
  const receipt=path.join(dir,'receipt.json');let pending;
  withWaveStateLock(dir,()=>{
    pending=persistChildStop(receipt,stoppedChild,()=>updateWave(dir,expected.waveId,w=>({...w,children:[stoppedChild]}),1),{attempts:2,delayMs:0});
    assert.equal(JSON.parse(fs.readFileSync(receipt)).closeObserved,true);
    assert.equal(readWave(dir).children[0].state,'running');
  });
  await pending;
  assert.equal(readWave(dir).children[0].closeObserved,true);
  assert.equal(recoverWave(dir,expected,sameBoot([])).released,true);
});
test('#7554: automatic recovery restores a lost marker mirror from a bound kernel proof',async t=>{
  for(const wrongToken of [false,true]){
    const {dir}=fixture(t,{state:'draining',registrationClosed:false,children:[]});
    const job={...stoppedChild.job,proofFile:path.join(dir,'kernel.json'),receiptFile:path.join(dir,'receipt.json')};
    const child={...stoppedChild,job,state:'running',closeObserved:false,treeProof:null};
    updateWave(dir,expected.waveId,w=>({...w,children:[child],registrationClosed:true}));
    fs.writeFileSync(job.proofFile,JSON.stringify({...stoppedChild.treeProof,...(wrongToken?{token:'foreign'}:{})}));
    fs.writeFileSync(job.receiptFile,JSON.stringify({...stoppedChild,job,waveId:expected.waveId}));
    const result=await recoverObservedWave(dir,now,sameBoot([]));
    assert.equal(result.released,!wrongToken);
    assert.equal(fs.existsSync(path.join(dir,'wave-active.json')),wrongToken);
  }
});

test('#7554: a reused PID born after the observed close does not hold the lock', () => {
  const closedAt = Date.parse('2026-11-06T10:00:00Z');
  const wave = { waveId: 'w', pid: 0, children: [{ key: 'a', pid: 400, closedAt }] };
  const later = '2026-11-06T10:05:00Z';
  const earlier = '2026-11-06T09:55:00Z';
  assert.deepEqual(registeredChildProcesses(wave, { processes: [{ pid: 400, ppid: 1, createdAt: later }, { pid: 500, ppid: 400, createdAt: later }] }), []);
  assert.deepEqual(registeredChildProcesses(wave, { processes: [{ pid: 400, ppid: 1, createdAt: earlier }] }).map(p => p.pid), [400]);
  assert.deepEqual(registeredChildProcesses(wave, { processes: [{ pid: 500, ppid: 400, createdAt: earlier }] }).map(p => p.pid), [500]);
});
