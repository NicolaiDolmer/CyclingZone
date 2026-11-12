import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./MyLatestResultCard.jsx', import.meta.url), 'utf8');
const hook = source.slice(source.indexOf('function useSeenBadge('), source.indexOf('// #3398'));
// Execute the production hook before effects, as React does during the first paint.
const render = new Function('useState', 'useRef', 'useEffect', `${hook}; return useSeenBadge;`)(
  (initial: unknown) => [typeof initial === 'function' ? initial() : initial, () => {}],
  () => ({ current: null }),
  () => {},
);

test('#8019 badge occupies its space on the first render of an unseen result', () => {
  assert.equal(render({ id: 'race-a', seen: false }), true);
  assert.equal(render({ id: 'race-b' }), true);
});

test('#8019 seen and absent results never flash a new badge', () => {
  assert.equal(render({ id: 'race-a', seen: true }), false);
  assert.equal(render(null), false);
});
