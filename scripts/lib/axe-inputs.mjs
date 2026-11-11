import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// Bind a scan to the exact compiled app and gate inputs, even before a commit.
export function axeInputHash(root) {
  const files = ['frontend/package-lock.json', 'frontend/playwright.config.js', 'frontend/tests/e2e/axe-quality.spec.ts', 'scripts/lib/axe-ratchet.mjs', 'scripts/lib/axe-inputs.mjs'];
  function visit(relative) {
    for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile()) files.push(name);
      else throw Error(`Unexpected non-file build input: ${name}`);
    }
  }
  visit('frontend/dist');
  const hash = createHash('sha256');
  for (const name of files.sort()) hash.update(name).update('\0').update(readFileSync(path.join(root, name))).update('\0');
  return hash.digest('hex');
}
