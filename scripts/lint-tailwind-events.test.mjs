import test from 'node:test';
import assert from 'node:assert/strict';
import { lintEvents } from './lint-tailwind-events.mjs';

test('renamed Tailwind utilities cannot become DOM event names', () => {
  for (const source of ['window.removeEventListener("blur-sm", handler)', 'window["addEventListener"]("ring-3", handler)', 'window.dispatchEvent(new Event("shadow-sm"))', 'new CustomEvent(`rounded-sm`)', 'const event = "blur-" + "sm"; window.addEventListener(event, h)']) {
    assert.ok(lintEvents(source).length, source);
  }
});
test('real DOM events, custom events, class strings, comments and prose remain valid', () => {
  assert.deepEqual(lintEvents('window.addEventListener("blur", h); new Event("resize"); new CustomEvent("app:ready"); const className = "blur-sm ring-3"; const prose = "blur-sm"; // new Event("ring-3")'), []);
});
