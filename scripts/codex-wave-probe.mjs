#!/usr/bin/env node
// Harmless live capability probe. Synthetic repos only, no project locks or APIs.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { runWave, runAgent } from './codex-wave.mjs';

const interrupt = process.argv[2] === '--interrupt';
if (process.argv[2] !== '--live' && !interrupt) {
  console.log('Use --live for two read-only arithmetic workers and independent reviewers; --interrupt tests owned process-tree interruption. Temporary fixture repositories only.');
} else {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-codex-live-probe-'));
  const tracks = [1, 2].map(issue => ({ issue, branch: `codex/${issue}-fixture`, ownership: [`fixture${issue}.json`], kind: 'investigate', tier: 'TARGETED' }));
  const result = await runWave({ root, runDir: path.join(root, 'coordination'), tracks, owner: 'live-fixture', lanes: 2 }, {
    now: () => Date.now(), readPrs: async () => [], prefilter: async () => {},
    prepare: async (track) => {
      const worktree = path.join(root, `fixture-${track.issue}`), scratch = path.join(root, `scratch-${track.issue}`);
      fs.mkdirSync(worktree); fs.mkdirSync(scratch);
      execFileSync('git', ['init', '--quiet', worktree]);
      fs.writeFileSync(path.join(worktree, 'fixture.json'), JSON.stringify({ left: 19, right: 23 }));
      return { ...track, worktree, scratch, brief: 'Harmless fixture, no repository work.' };
    },
    runAgent: async (role, track, context) => {
      const fixturePrompt = role === 'reviewer'
        ? `Harmless independent fixture review. No changes or agents. Read fixture.json in your cwd and ${path.join(track.scratch, 'worker-0-result.json')}. Independently calculate left + right. Approve with findings=[] only if worker summary equals the correct numeric sum. No startup tasks or connectors.`
        : 'Harmless capability fixture. No changes, other agents, connectors or startup tasks. Run one shell command to read fixture.json and show cwd. Compute left + right. Return status=ready, summary containing ONLY the numeric sum, tests=["fixture arithmetic checked"].';
      const timer = interrupt ? setTimeout(() => process.emit('SIGINT'), 2000) : null;
      try { return await runAgent(role, track, { ...context, fixturePrompt }); }
      finally { clearTimeout(timer); }
    },
    validateResult: async track => {
      const output = JSON.parse(fs.readFileSync(path.join(track.scratch, 'worker-0-result.json'), 'utf8'));
      if (output.summary !== '42') throw Error('Fixture answer incorrect');
    },
  });
  console.log(JSON.stringify({ fixtureRoot: root, ...result }, null, 2));
  if (result.results.length !== 2 || result.results.some(r => r.state !== (interrupt ? 'blocked' : 'ready'))) process.exitCode = 1;
  if (fs.existsSync(path.join(root, 'coordination/wave-active.json'))) process.exitCode = 1;
}
