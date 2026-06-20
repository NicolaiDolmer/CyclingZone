#!/usr/bin/env node
// Compute the CSP sha256-hash for inline <script> blocks in the BUILT HTML (#1462).
//
// Why built, not source: Vite can alter inline-script whitespace, and the CSP
// `'sha256-...'` source-expression must hash the EXACT bytes the browser sees in
// the served HTML. So run `npm run build` first, then point this at dist/index.html.
//
// We intentionally do NOT commit the literal hash anywhere (it is a high-entropy
// string that trips secret-scanners, even though a CSP hash is public by design).
// Instead the owner runs this at enforce-time and pastes the value into the
// `script-src` of frontend/vercel.json when flipping Report-Only -> enforcing.
//
// Usage:
//   cd frontend && npm run build && cd ..
//   node scripts/compute-csp-hash.mjs                 # defaults to frontend/dist/index.html
//   node scripts/compute-csp-hash.mjs path/to/index.html
//
// Output: one `'sha256-...'` token per inline (non-module, non-JSON) <script>.

import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const target = process.argv[2] || "frontend/dist/index.html";
if (!fs.existsSync(target)) {
  console.error(`[csp-hash] not found: ${target}\n  Build first: (cd frontend && npm run build)`);
  process.exit(1);
}

const html = fs.readFileSync(target, "utf8");
// Inline executable scripts only: a <script> with NO src and NO type (or type=module
// excluded — module scripts are external by URL). JSON-LD (type="application/ld+json")
// is data, not executed, so CSP script-src does not gate it; we skip it.
const re = /<script(?![^>]*\bsrc=)(?![^>]*type=)[^>]*>([\s\S]*?)<\/script>/gi;
let m;
const tokens = [];
while ((m = re.exec(html))) {
  const body = m[1];
  const b64 = crypto.createHash("sha256").update(body, "utf8").digest("base64");
  tokens.push(`'sha256-${b64}'`);
}

if (tokens.length === 0) {
  console.log(`[csp-hash] no inline executable <script> blocks in ${path.basename(target)} (nothing to hash).`);
  process.exit(0);
}

console.log(`[csp-hash] ${tokens.length} inline script hash token(s) for ${path.basename(target)}:`);
console.log(`[csp-hash] add these to script-src in frontend/vercel.json at enforce-time:\n`);
for (const t of tokens) console.log(`  ${t}`);
