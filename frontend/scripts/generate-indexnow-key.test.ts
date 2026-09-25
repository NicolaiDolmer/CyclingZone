// #5493: INDEXNOW_KEY er build-time-only og må ALDRIG hardkodes eller
// committes — no-op uden env, skriv <key>.txt med env, kast ved ugyldigt
// format frem for at deploye en ubrugelig fil.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { main, resolveIndexNowKeyPath } from "./generate-indexnow-key.ts";

test("ingen INDEXNOW_KEY → no-op, public/ forbliver tom", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "indexnow-"));
  try {
    main({}, dir);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("INDEXNOW_KEY sat → skriver <key>.txt med nøglen som indhold", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "indexnow-"));
  const key = "abc123DEF456-key"; // gitleaks:allow - test-fixture, ikke en secret (#5493)
  try {
    main({ INDEXNOW_KEY: key }, dir);
    const target = resolveIndexNowKeyPath(dir, key);
    assert.equal(readFileSync(target, "utf-8"), key);
    assert.deepEqual(readdirSync(dir), [`${key}.txt`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("INDEXNOW_KEY trimmes for whitespace før validering/skrivning", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "indexnow-"));
  const key = "abc123DEF456-key"; // gitleaks:allow - test-fixture, ikke en secret (#5493)
  try {
    main({ INDEXNOW_KEY: `  ${key}  ` }, dir);
    assert.equal(readFileSync(resolveIndexNowKeyPath(dir, key), "utf-8"), key);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ugyldigt format kaster i stedet for at skrive en ubrugelig fil", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "indexnow-"));
  try {
    assert.throws(() => main({ INDEXNOW_KEY: "https://example.com/not-a-key" }, dir));
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveIndexNowKeyPath: filnavnet ER nøglen", () => {
  assert.equal(resolveIndexNowKeyPath("/public", "myKey123"), path.join("/public", "myKey123.txt"));
});
