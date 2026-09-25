// #5493: nøglen kommer KUN fra VITE_AHREFS_ANALYTICS_KEY — aldrig hardkodet —
// og pluginet skal være en total no-op når nøglen mangler (lokalt/preview),
// præcis som GA4's .env.example-mønster.
import { test } from "node:test";
import assert from "node:assert/strict";

import { ahrefsAnalyticsPlugin } from "./ahrefs-analytics.ts";

function callTransform(): unknown {
  const plugin = ahrefsAnalyticsPlugin();
  const handler = plugin.transformIndexHtml as (() => unknown) | undefined;
  if (typeof handler !== "function") throw new Error("transformIndexHtml er ikke en funktion");
  return handler.call(plugin);
}

test("ingen VITE_AHREFS_ANALYTICS_KEY → ingen tags injiceret", () => {
  const prev = process.env.VITE_AHREFS_ANALYTICS_KEY;
  delete process.env.VITE_AHREFS_ANALYTICS_KEY;
  try {
    const result = callTransform();
    assert.deepEqual(result, []);
  } finally {
    if (prev !== undefined) process.env.VITE_AHREFS_ANALYTICS_KEY = prev;
  }
});

test("VITE_AHREFS_ANALYTICS_KEY sat → injicerer async script med data-key i head", () => {
  const prev = process.env.VITE_AHREFS_ANALYTICS_KEY;
  process.env.VITE_AHREFS_ANALYTICS_KEY = "test-key-123";
  try {
    const result = callTransform() as Array<{
      tag: string;
      attrs: Record<string, unknown>;
      injectTo: string;
    }>;
    assert.equal(result.length, 1);
    const [tag] = result;
    assert.equal(tag.tag, "script");
    assert.equal(tag.injectTo, "head");
    assert.equal(tag.attrs.src, "https://analytics.ahrefs.com/analytics.js");
    assert.equal(tag.attrs["data-key"], "test-key-123");
    assert.equal(tag.attrs.async, true);
  } finally {
    if (prev === undefined) delete process.env.VITE_AHREFS_ANALYTICS_KEY;
    else process.env.VITE_AHREFS_ANALYTICS_KEY = prev;
  }
});
