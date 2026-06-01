import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getChunkReloadKey,
  isChunkLoadError,
  shouldAttemptChunkReload,
} from "./chunkErrors.js";

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
  };
}

test("isChunkLoadError — detects Vite dynamic import failures", () => {
  assert.equal(
    isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://cycling-zone.vercel.app/assets/TeamPage-old.js")),
    true
  );
});

test("isChunkLoadError — detects module MIME-type chunk failures", () => {
  assert.equal(
    isChunkLoadError(new Error("Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of text/html.")),
    true
  );
});

test("isChunkLoadError — ignores ordinary render errors", () => {
  assert.equal(isChunkLoadError(new Error("Cannot read properties of null")), false);
});

test("isChunkLoadError — detects React.lazy internal-state failures (#881)", () => {
  assert.equal(
    isChunkLoadError(new TypeError('can\'t access property "default", e._result is undefined')),
    true
  );
  assert.equal(
    isChunkLoadError(new TypeError("undefined is not an object (evaluating 'e._result.default')")),
    true
  );
});

test("shouldAttemptChunkReload — allows exactly one reload per release", () => {
  const storage = memoryStorage();
  const error = new Error("Failed to fetch dynamically imported module");

  assert.equal(shouldAttemptChunkReload({ error, release: "abc123", storage }), true);
  assert.equal(shouldAttemptChunkReload({ error, release: "abc123", storage }), false);
  assert.equal(storage.getItem(getChunkReloadKey("abc123")), "1");
});

test("shouldAttemptChunkReload — does not reload for non-chunk errors", () => {
  assert.equal(
    shouldAttemptChunkReload({ error: new Error("ordinary crash"), release: "abc123", storage: memoryStorage() }),
    false
  );
});
