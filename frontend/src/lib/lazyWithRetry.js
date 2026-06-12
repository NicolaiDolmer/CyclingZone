import { lazy } from "react";
import { isChunkLoadError } from "./chunkErrors.js";

// Wraps React.lazy så stale-chunk-fejl efter et deploy bliver recoverable.
//
// Problemet (#881): når en bruger har en gammel index.html i cachen og lazy-loader
// et route-chunk hvis hash er roteret væk af et nyt deploy, fejler import(). React.lazy
// efterlades i en tilstand hvor dens interne `_result` er undefined, og under render
// kaster den en opak "Cannot read properties of undefined (reading 'default')" /
// "e._result is undefined". Den streng matcher IKKE isChunkLoadError() → error-boundary
// klassificerer den som render_error → ingen auto-reload, dårlig UX, og Sentry-støj.
//
// Fix: fang import-fejlen i factory'en. Ét stille retry (dækker transiente netværks-blips
// / mid-deploy races); ved vedvarende fejl kast en *genkendelig* ChunkLoadError, så
// SentryBoundary + vite:preloadError-reload-stien engagerer korrekt.
function validateModule(module) {
  if (module?.default != null) return module;

  const error = new Error(
    "Failed to fetch dynamically imported module: resolved to an invalid module without a default export",
  );
  error.name = "ChunkLoadError";
  return Promise.reject(error);
}

export async function loadWithRetry(importFn) {
  try {
    return await validateModule(await importFn());
  } catch (err) {
    if (!isChunkLoadError(err)) throw err;
    try {
      // Transient? Ét retry. Hjælper ikke hvis chunk-hash'en permanent er væk —
      // men så kaster vi nedenfor en genkendelig fejl der trigger reload (frisk index.html).
      return await validateModule(await importFn());
    } catch (retryErr) {
      const wrapped = new Error(
        `Failed to fetch dynamically imported module (chunk reload needed): ${retryErr?.message || retryErr}`,
      );
      wrapped.name = "ChunkLoadError";
      wrapped.cause = retryErr;
      throw wrapped;
    }
  }
}

export function lazyWithRetry(importFn) {
  return lazy(() => loadWithRetry(importFn));
}
