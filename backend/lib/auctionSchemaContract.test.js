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
      return content.slice(start, start + marker.length + 400);
    }
  }

  assert.fail(`Expected auctions CREATE TABLE block in ${filePath}`);
}

test("auction schema allows null seller_team_id for non-owned history cleanup", () => {
  const files = [
    resolve(__dirname, "../../database/schema.sql"),
    resolve(__dirname, "../../database/supabase_setup.sql"),
    resolve(__dirname, "../../setup.py"),
  ];

  for (const filePath of files) {
    const block = getAuctionCreateBlock(filePath);
    assert.match(block, /seller_team_id UUID REFERENCES/);
    assert.doesNotMatch(block, /seller_team_id UUID NOT NULL REFERENCES/);
  }
});
