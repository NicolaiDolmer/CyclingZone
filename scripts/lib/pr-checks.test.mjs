import assert from 'node:assert/strict';
import test from 'node:test';
import { readLatestPrChecks } from './pr-checks.mjs';

const repo = 'o/r';
const head = 'a'.repeat(40);
const job = (runId, jobId, name, bucket) => ({
  name, bucket, link: 'https://github.com/o/r/actions/runs/' + runId + '/job/' + jobId,
});
const run = (id, extra = {}) => ({
  id, workflow_id: 10, status: 'completed', event: 'pull_request', head_sha: head,
  head_branch: 'branch', head_repository: { id: 3 }, created_at: '2026-11-24T11:10:00Z',
  run_attempt: 1, ...extra,
});
function read(required, all, runs) {
  return readLatestPrChecks({repo, number:42, headSha:head, json(args) {
    if (args[0] === 'pr') return args.includes('--required') ? required : all;
    assert.match(args.at(-1), /actions\/runs\?head_sha=/);
    return [{workflow_runs:runs}];
  }});
}

test('latest workflow run replaces the entire older run, including a differently named cancelled matrix', () => {
  const old = job(11, 1, 'backend-tests', 'cancel');
  const placeholder = job(11, 2, 'backend-test-shard ' + '$' + '{{ matrix.shard }}/3', 'fail');
  const fresh = job(12, 3, 'backend-tests', 'pass');
  const oldStartedLater = {...old, startedAt:'2026-11-24T11:53:00Z'};
  const other = {name:'gitleaks',bucket:'pass',link:'https://third-party.example/check'};
  const result = read([oldStartedLater,fresh,other], [oldStartedLater,placeholder,fresh,other], [
    run(12,{created_at:'2026-11-24T11:20:00Z'}),run(11,{run_attempt:2}),
    run(13,{event:'push'}),run(14,{head_sha:'b'.repeat(40)}),run(15,{head_branch:'other'}),
    run(16,{created_at:'2026-11-24T11:30:00Z',pull_requests:[{number:43}]}),
  ]);
  assert.deepEqual(result.required, [fresh,other]);
  assert.deepEqual(result.all, [fresh,other]);
});

test('a newer run lacking the required check leaves it pending rather than using stale green', () => {
  const stale = job(11,1,'backend-tests','pass');
  const result = read([stale], [stale], [run(11),run(12,{status:'queued',created_at:'2026-11-24T11:20:00Z'})]);
  assert.equal(result.required.length,1);
  assert.equal(result.required[0].bucket,'pending');
  assert.deepEqual(result.all,[]);
});

test('when the selected run was retried, only current job executions count', () => {
  const stale = job(11,1,'backend-tests','fail');
  const fresh = job(11,2,'backend-tests','pass');
  const result = readLatestPrChecks({repo, number:42, headSha:head, json(args) {
    if (args[0] === 'pr') return [stale,fresh];
    if (args.at(-1).includes('/jobs?filter=latest')) return [{jobs:[{id:2}]}];
    return [{workflow_runs:[run(11,{run_attempt:2})]}];
  }});
  assert.deepEqual(result.required,[fresh]);
  assert.deepEqual(result.all,[fresh]);
});

test('repairs a required context that only appeared on the cancelled run in the PR rollup', () => {
  const old = job(11,1,'backend-tests','cancel');
  const newerShard = job(12,2,'backend-test-shard 1/3','pass');
  const latestLink = 'https://github.com/o/r/actions/runs/12/job/3';
  const result = readLatestPrChecks({repo, number:42, headSha:head, json(args) {
    if (args[0] === 'pr') return args.includes('--required') ? [old] : [old,newerShard];
    if (args.at(-1).includes('/jobs?filter=latest')) {
      return [{jobs:[{id:3,name:'backend-tests',status:'completed',conclusion:'success',html_url:latestLink}]}];
    }
    return [{workflow_runs:[run(11),run(12,{created_at:'2026-11-24T11:20:00Z'})]}];
  }});
  assert.deepEqual(result.required.map(({bucket,link})=>[bucket,link]), [['pass',latestLink]]);
  assert.deepEqual(result.all.map(row=>row.link), [newerShard.link,latestLink]);
});

test('unbound Actions jobs cannot lend a green required context to a different head', () => {
  const stale = job(11,1,'backend-tests','pass');
  const result = read([stale], [stale], [run(11,{head_sha:'b'.repeat(40)})]);
  assert.deepEqual(result.required,[{name:'backend-tests',bucket:'pending'}]);
  assert.deepEqual(result.all,[]);
});

test('the latest PR-bound target review gate wins even when an older green rerun started later', () => {
  const old = {...job(11,1,'review-gate','pass'), event:'pull_request_target', startedAt:'2026-11-24T12:00:00Z'};
  const fresh = {...job(12,2,'review-gate','fail'), event:'pull_request_target', startedAt:'2026-11-24T11:30:00Z'};
  const check = (all) => readLatestPrChecks({repo, number:42, headSha:head, json(args) {
    if (args[0] === 'pr') return args.includes('--required') ? [] : all;
    assert.match(args[1], /review-gate\.yml\/runs\?event=pull_request_target/);
    return {workflow_runs:[
      {id:13,run_attempt:1,event:'pull_request_target',pull_requests:[{number:43}],created_at:'2026-11-24T11:50:00Z'},
      {id:12,run_attempt:1,event:'pull_request_target',pull_requests:[],display_title:'review-gate PR#42',created_at:'2026-11-24T11:30:00Z'},
      {id:11,run_attempt:2,event:'pull_request_target',pull_requests:[{number:42}],created_at:'2026-11-24T11:00:00Z'},
    ]};
  }});
  assert.deepEqual(check([old,fresh]).all,[fresh]);
  assert.deepEqual(check([old]).all,[{name:'review-gate',event:'pull_request_target',bucket:'pending'}]);
});
