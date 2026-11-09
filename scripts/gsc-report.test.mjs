import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { periodRange, parseOptions, collectReport, renderReport, writeReport } from './gsc-report.mjs';

const now = new Date('2026-11-09T00:30:00Z');
const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const sa = {client_email:'fixture@example.invalid', private_key:pair.privateKey.export({type:'pkcs8',format:'pem'})};
const metric = {clicks:19, impressions:100, ctr:.19, position:3.5};
function fixtureFetch(calls, overrides = {}) {
  return async (url, options) => {
    calls.push({url, ...options});
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({access_token:'fixture-token'});
    const body = JSON.parse(options.body);
    const key = body.dimensions?.[0] || 'total';
    return Response.json(overrides[key] || {rows:[key === 'total' ? metric : {...metric,clicks:1,keys:[key]}]});
  };
}
test('periods follow Pacific date across UTC midnight and require an explicit clock', () => {
  assert.deepEqual(periodRange(7,now), {current:{start:'2026-10-30',end:'2026-11-05'},previous:{start:'2026-10-23',end:'2026-10-29'}});
  assert.throws(()=>periodRange(7));
  assert.throws(()=>periodRange(0,now));
});
test('DST and leap day preserve inclusive date counts', () => {
  assert.equal(periodRange(7,new Date('2026-03-09T00:30:00Z')).current.end,'2026-03-05');
  assert.deepEqual(periodRange(2,new Date('2024-03-04T12:00:00Z')).current,{start:'2024-02-29',end:'2024-03-01'});
});
test('weekly defaults and strict argument validation', () => {
  assert.equal(parseOptions(['--weekly']).days,7);
  assert.equal(parseOptions([]).days,28);
  for (const arg of ['--days=7oops','--days=1.5','--days','--days=0','--wat','--json=no','--out']) assert.throws(()=>parseOptions([arg]));
  assert.throws(()=>parseOptions(['--weekly','--days=28']));
});
test('property totals are independent of top query rows and use final web data', async () => {
  const calls=[];
  const report=await collectReport({site:'sc-domain:cyclingzone.org',days:7,now,serviceAccount:sa,fetchImpl:fixtureFetch(calls)});
  assert.equal(report.totals.current.clicks,19);
  assert.equal(report.queries[0].clicks,1);
  assert.equal(report.timezone,'America/Los_Angeles');
  assert.ok(report.countries.length && report.devices.length);
  const requests=calls.slice(1).map(c=>JSON.parse(c.body));
  assert.equal(requests.filter(b=>!b.dimensions?.length).length,2);
  assert.ok(requests.every(b=>b.dataState==='final' && b.type==='web'));
  assert.ok(calls.every(c=>c.signal));
  const claim=JSON.parse(Buffer.from(new URLSearchParams(calls[0].body).get('assertion').split('.')[1],'base64url'));
  assert.equal(claim.iat,Math.floor(now.getTime()/1000));
});
test('empty data remains unknown instead of zero traffic', async () => {
  const report=await collectReport({site:'sc-domain:cyclingzone.org',days:7,now,serviceAccount:sa,fetchImpl:fixtureFetch([],{total:{rows:[]}})});
  assert.equal(report.totals.current,null);
  assert.match(renderReport(report),/Ingen data/);
  assert.doesNotMatch(renderReport(report),/fixture-token|PRIVATE KEY/);
});
test('historical report dates do not backdate Google authentication', async () => {
  const calls=[];
  const authNow=new Date('2026-11-10T12:00:00Z');
  const report=await collectReport({site:'sc-domain:cyclingzone.org',days:7,now,authNow,serviceAccount:sa,fetchImpl:fixtureFetch(calls)});
  const claim=JSON.parse(Buffer.from(new URLSearchParams(calls[0].body).get('assertion').split('.')[1],'base64url'));
  assert.equal(claim.iat,Math.floor(authNow.getTime()/1000));
  assert.equal(report.period.current.end,'2026-11-05');
  assert.equal(report.generatedAt,authNow.toISOString());
});
test('failures never echo Google response bodies or fetch exceptions', async () => {
  for (const response of [async()=>Response.json({error_description:'PRIVATE-EXAMPLE'},{status:403}),async()=>{throw new Error('PRIVATE-EXAMPLE');}]) {
    await assert.rejects(collectReport({site:'sc-domain:cyclingzone.org',days:7,now,serviceAccount:sa,fetchImpl:response}),err=>!err.message.includes('PRIVATE-EXAMPLE') && err.exitCode===3);
  }
});
test('untrusted token endpoint is rejected before any network traffic', async () => {
  let called=false;
  await assert.rejects(collectReport({site:'sc-domain:cyclingzone.org',days:7,now,serviceAccount:{...sa,token_uri:'https://example.invalid'},fetchImpl:async()=>{called=true;}}));
  assert.equal(called,false);
});
test('private output refuses Git and refuses to overwrite a report', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gsc-report-test-'));
  const file=path.join(dir,'private-report.md');
  await writeReport(file,'private fixture');
  assert.equal(await fs.readFile(file,'utf8'),'private fixture');
  await assert.rejects(writeReport(file,'replacement'));
  const gitDir=path.join(dir,'public');
  await fs.mkdir(path.join(gitDir,'.git'),{recursive:true});
  await assert.rejects(writeReport(path.join(gitDir,'report.md'),'private fixture'));
  await fs.unlink(file);
  await fs.rmdir(path.join(gitDir,'.git'));
  await fs.rmdir(gitDir);
  await fs.rmdir(dir);
});
