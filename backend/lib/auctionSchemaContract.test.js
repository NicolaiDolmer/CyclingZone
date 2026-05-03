import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getAuctionCreateBlock(filePath) {
  const content = readFileSync(filePath, "utf8");
  const markers = [
    "CREATE TABLE auctions (",
    "CREATE TABLE IF NOT EXISTS public.auctions (",
    "'''CREATE TABLE IF NOT EXISTS auctions (",
  ];

  for (const marker of markers) {
    const start = content.indexOf(marker);
    if (start >= 0) {
      // Walk parens from after the opening "(" to the matching closing ")",
      // so inline calls like uuid_generate_v4() don't terminate the slice early.
      let depth = 1;
      let i = start + marker.length;
      while (i < content.length && depth > 0) {
        const ch = content[i];
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        i++;
      }
      if (depth !== 0) break;
      return content.slice(start, i);
    }
  }

  assert.fail(`Expected auctions CREATE TABLE block in ${filePath}`);
}

const SCHEMA_FILES = [
  resolve(__dirname, "../../database/schema.sql"),
  resolve(__dirname, "../../database/supabase_setup.sql"),
  resolve(__dirname, "../../setup.py"),
];

test("auction schema allows null seller_team_id for non-owned history cleanup", () => {
  for (const filePath of SCHEMA_FILES) {
    const block = getAuctionCreateBlock(filePath);
    assert.match(block, /seller_team_id UUID REFERENCES/);
    assert.doesNotMatch(block, /seller_team_id UUID NOT NULL REFERENCES/);
  }
});

// Why: api.js POST /api/auctions inserts is_flash for Deadline Day flash auctions
// (backend/routes/api.js ~725) and AuctionsPage.jsx selects it. Live Supabase
// has the column; source-of-truth must match so fresh setups + schema-driven
// tooling don't fail the first time a flash auction is started.
test("auction schema includes is_flash column for Deadline Day flash auctions", () => {
  for (const filePath of SCHEMA_FILES) {
    const block = getAuctionCreateBlock(filePath);
    assert.match(block, /is_flash BOOLEAN NOT NULL DEFAULT FALSE/, `is_flash missing in ${filePath}`);
  }
});
