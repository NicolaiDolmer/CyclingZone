import test from "node:test";
import assert from "node:assert/strict";

import { getRelease, getSentryRelease, readReleaseMeta } from "./release.js";

// Minimal document-stub: kun det release.js faktisk bruger.
function withMeta(content, fn) {
  const previous = globalThis.document;
  globalThis.document = {
    querySelector(selector) {
      if (selector !== 'meta[name="cz-release"]') return null;
      if (content === null) return null;
      return { getAttribute: (name) => (name === "content" ? content : null) };
    },
  };
  try {
    return fn();
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
}

test("readReleaseMeta laeser sha'en fra meta-tagget", () => {
  withMeta("4093ab59e0", () => {
    assert.equal(readReleaseMeta(), "4093ab59e0");
    assert.equal(getRelease(), "4093ab59e0");
    assert.equal(getSentryRelease(), "4093ab59e0");
  });
});

test("whitespace trimmes", () => {
  withMeta("  4093ab59e0\n", () => {
    assert.equal(readReleaseMeta(), "4093ab59e0");
  });
});

test("manglende meta-tag giver tom raa-vaerdi", () => {
  withMeta(null, () => {
    assert.equal(readReleaseMeta(), "");
  });
});

test("tomt content (build uden sha) behandles som ukendt", () => {
  withMeta("", () => {
    assert.equal(readReleaseMeta(), "");
    // getRelease skal ALTID give en streng — den bruges som sessionStorage-noegle
    // i chunk-reload-loopguarden (chunkErrors.js).
    assert.equal(typeof getRelease(), "string");
    assert.ok(getRelease().length > 0);
    // Sentry skal derimod IKKE faa en syntetisk release der ingen source maps har.
    assert.equal(getSentryRelease(), undefined);
  });
});

test("uden document (SSR/prerender) kastes der ikke", () => {
  const previous = globalThis.document;
  delete globalThis.document;
  try {
    assert.equal(readReleaseMeta(), "");
    assert.equal(getSentryRelease(), undefined);
    assert.equal(typeof getRelease(), "string");
  } finally {
    if (previous !== undefined) globalThis.document = previous;
  }
});
