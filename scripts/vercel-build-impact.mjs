#!/usr/bin/env node
// Replay build decisions against a fixed, sanitized deployment/commit manifest.
// No Vercel request, deployment or external write is performed.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { needsFrontendBuild } from '../frontend/scripts/vercel-ignore-build.ts';

const manifest = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const git = args => execFileSync('git', args, { encoding: 'utf8', timeout: 15000 });
let base = manifest.previousSha;
if (!/^[a-f0-9]{40}$/i.test(base || '')) throw Error('Manifest must pin the previous successful deployment SHA.');
const rows = [...manifest.rows].sort((a,b) => a.created - b.created);
const decisions = rows.map(row => {
  if (!/^[a-f0-9]{40}$/i.test(row.sha || '')) throw Error('Invalid commit SHA in manifest');
  const files = git(['diff', '--name-only', '--no-renames', '-z', base, row.sha, '--']).split('\0').filter(Boolean);
  const build = row.sha === base || needsFrontendBuild(files);
  const result = { sha: row.sha, build, changedPaths: files.length };
  if (build) base = row.sha;
  return result;
});
console.log(JSON.stringify({ kind: 'historical decision replay, not observed savings', periodUTC: manifest.periodUTC,
  beforeBuildDecisions: rows.length, afterBuildDecisions: decisions.filter(d=>d.build).length,
  skippedDecisions: decisions.filter(d=>!d.build).length, decisions }, null, 2));
