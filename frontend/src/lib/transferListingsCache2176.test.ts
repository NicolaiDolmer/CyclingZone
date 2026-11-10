import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestCache, SHARED_KEYS, transferListingsCacheKey2176, transferListingsKeyForHeaders2176 } from './sharedRequestCache.js';

test('cache identity comes from the exact request credentials without retaining them in the key', async () => {
  const a = await transferListingsKeyForHeaders2176({ Authorization: 'Bearer beta-fixture' });
  const b = await transferListingsKeyForHeaders2176({ Authorization: 'Bearer ordinary-fixture' });
  assert.notEqual(a,b);
  assert.equal(a.includes('beta-fixture'),false);
  assert.equal(b.includes('ordinary-fixture'),false);
  assert.equal(await transferListingsKeyForHeaders2176(new Headers({ authorization: 'Bearer beta-fixture' })),a);
});

test('viewer-specific transfer rows cannot be reused by another viewer', async () => {
  const cache = createRequestCache({ now: () => 1000 });
  const betaKey = transferListingsCacheKey2176('beta-team');
  const normalKey = transferListingsCacheKey2176('ordinary-team');
  assert.notEqual(betaKey, normalKey);
  await cache.get(betaKey, () => [{ id: 'listing', auto_accept_price: 700 }]);
  assert.deepEqual(await cache.get(normalKey, () => [{ id: 'listing' }]), [{ id: 'listing' }]);
});

test('an old authorized response resolving after logout cannot warm the cache again', async () => {
  const cache = createRequestCache({ now: () => 1000 });
  const key = transferListingsCacheKey2176('team');
  let resolveOld!: (value: string[]) => void;
  const oldResponse = new Promise<string[]>(resolve => { resolveOld = resolve; });
  const old = cache.get(key, () => oldResponse);
  cache.clear();
  await cache.get(key, () => ['current viewer']);
  resolveOld(['old beta response']); await old;
  assert.deepEqual(await cache.get(key, () => ['unexpected reload']), ['current viewer']);
});

test('invalidating transfer family clears every viewer and prevents an in-flight old refill', async () => {
  const cache = createRequestCache({ now: () => 1000 });
  let release!: (value: string[]) => void;
  const old = cache.get(transferListingsCacheKey2176('A'), () => new Promise<string[]>(resolve => { release = resolve; }));
  await cache.get(transferListingsCacheKey2176('B'), () => ['B']);
  await cache.get('other endpoint', () => ['keep']);
  cache.invalidatePrefix(`${SHARED_KEYS.transferListings}:viewer:`);
  release(['stale A']); await old;
  assert.deepEqual(await cache.get(transferListingsCacheKey2176('A'), () => ['fresh A']), ['fresh A']);
  assert.deepEqual(await cache.get(transferListingsCacheKey2176('B'), () => ['fresh B']), ['fresh B']);
  assert.deepEqual(await cache.get('other endpoint', () => ['unexpected']), ['keep']);
});
