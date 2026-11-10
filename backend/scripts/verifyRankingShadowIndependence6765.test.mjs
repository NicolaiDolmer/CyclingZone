import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { loadFrozenEntry } from './verifyRankingShadowIndependence6765.mjs';

test('golden loader executes both frozen entry and frozen shadow dependency, never the new default', async () => {
  const dir=mkdtempSync(join(process.env.RANKING_VERIFY_SCRATCH??tmpdir(),'cz-6765-golden-test-'));
  const source='import { marker } from "./rankingShadowPass.ts"; export const value=marker;';
  const shadow='export const marker="before";';
  const entryPath=join(dir,'entry.js');
  writeFileSync(entryPath,source);
  writeFileSync(join(dir,'rankingShadowPass-frozen.ts'),shadow);
  const frozen=await loadFrozenEntry(entryPath,dir);
  assert.equal(frozen.entry.value,'before');
  assert.equal(frozen.sha256,createHash('sha256').update(source).digest('hex'));
  assert.equal(frozen.shadowSha256,createHash('sha256').update(shadow).digest('hex'));
  writeFileSync(entryPath,'export const value="after";');
  assert.equal(frozen.entry.value,'before');
  // Preserve all fixture files for the lane's normal archival cleanup.
});

test('golden comparison refuses to silently use current source without a frozen input', async () => {
  await assert.rejects(loadFrozenEntry(undefined,''),/before-source/);
});
