import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeInventoryCell as escape } from './lib/guard-inventory-cell.mjs';

test('inventory cells escape backslashes before pipe delimiters', () => {
  assert.equal(escape('a\\|b|c'), 'a\\\\\\|b\\|c');
  assert.equal(escape('C:\\tools\\guard'), 'C:\\\\tools\\\\guard');
});

test('inventory cells keep repeated delimiters and line breaks inside one cell', () => {
  assert.equal(escape('a|b|c\r\nd'), 'a\\|b\\|c d');
  assert.equal(escape(42), '42');
});
