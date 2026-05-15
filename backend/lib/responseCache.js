/**
 * Zero-dep in-process read-through cache + endpoint timing for HTTP GET routes.
 *
 * Scope (per ADR docs/decisions/cache-adr.md, Phase 1):
 *   - Day-1 single-instance Railway backend. NOT safe for multi-instance.
 *   - Cache only stable read endpoints. Writes bypass and may invalidate.
 *   - Fail-open: any cache error logs and falls through to the handler.
 *
 * Each namespace ("riders", "races", "race-pool", "race-points") has its own
 * LRU+TTL bucket. Cache key includes the route path + sorted query string so
 * "/riders?team_id=1&page=1" and "/riders?page=1&team_id=1" hit the same entry.
 *
 * Mutation paths call invalidateNamespace("riders") on any state change that
 * could affect a cached read (ownership, retirement, salary, popularity).
 *
 * Timing: every wrapped handler emits a hit/miss + duration breadcrumb to
 * Sentry under category "endpoint-timing". Aggregated P50/P95 is derived from
 * Sentry breadcrumbs/transactions during baseline measurement (Phase 0).
 *
 * Break-glass: set RESPONSE_CACHE_DISABLED=1 to bypass all caches without
 * code change. Useful during incidents where stale reads are suspected.
 */

import * as Sentry from "@sentry/node";

const DISABLED = process.env.RESPONSE_CACHE_DISABLED === "1";

const namespaces = new Map();

const stats = {
  hits: 0,
  misses: 0,
  invalidations: 0,
};

function now() {
  return Date.now();
}

function sortedQueryString(query) {
  if (!query) return "";
  const entries = [];
  for (const [key, value] of Object.entries(query)) {
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (v !== undefined && v !== null && v !== "") {
        entries.push([String(key), String(v)]);
      }
    }
  }
  entries.sort(([aKey, aValue], [bKey, bValue]) => {
    const keyOrder = aKey.localeCompare(bKey);
    return keyOrder === 0 ? aValue.localeCompare(bValue) : keyOrder;
  });
  if (entries.length === 0) return "";
  return entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

function getBucket(namespace) {
  let bucket = namespaces.get(namespace);
  if (!bucket) {
    bucket = { store: new Map(), inFlight: new Map(), maxEntries: 200, version: 0 };
    namespaces.set(namespace, bucket);
  }
  return bucket;
}

function pruneExpired(bucket) {
  const t = now();
  for (const [key, entry] of bucket.store) {
    if (entry.expiresAt <= t) bucket.store.delete(key);
  }
}

function evictIfNeeded(bucket) {
  if (bucket.store.size <= bucket.maxEntries) return;
  // Map iteration order is insertion order; delete the oldest entries first.
  const overflow = bucket.store.size - bucket.maxEntries;
  let removed = 0;
  for (const key of bucket.store.keys()) {
    if (removed >= overflow) break;
    bucket.store.delete(key);
    removed += 1;
  }
}

export function getCacheStats() {
  const total = stats.hits + stats.misses;
  return {
    hits: stats.hits,
    misses: stats.misses,
    invalidations: stats.invalidations,
    hit_rate: total === 0 ? 0 : stats.hits / total,
    namespaces: Array.from(namespaces.entries()).map(([name, bucket]) => ({
      name,
      size: bucket.store.size,
    })),
  };
}

export function invalidateNamespace(namespace) {
  const bucket = namespaces.get(namespace);
  if (!bucket) return 0;
  const size = bucket.store.size;
  bucket.store.clear();
  bucket.version += 1;
  stats.invalidations += 1;
  return size;
}

function cacheableHeaders(res) {
  const headers = res.getHeaders();
  if (headers["set-cookie"]) {
    return { cacheable: false, headers: {} };
  }
  const copied = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (lower === "x-cache" || lower === "content-length" || lower === "set-cookie") continue;
    copied[name] = value;
  }
  return { cacheable: true, headers: copied };
}

function applyCachedHeaders(res, entry) {
  for (const [name, value] of Object.entries(entry.headers || {})) {
    res.set(name, value);
  }
}

function createInFlight() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Returns an Express middleware that:
 *   - measures request duration (always, even when DISABLED),
 *   - serves cached JSON if a fresh entry exists for {route + sorted query},
 *   - otherwise invokes handler and stores its res.json() payload.
 *
 * The handler MUST call res.json(payload). Streaming or res.send(string) is
 * not captured; those routes should not be wrapped.
 *
 * @param {object} opts
 * @param {string} opts.namespace        bucket identifier (e.g. "riders")
 * @param {number} opts.ttlMs            entry lifetime in ms
 * @param {function} [opts.keyExtras]    optional (req) => string extra key suffix
 *                                       (use when cache must be user-scoped; default is global)
 * @param {function} handler             the original (req, res) => Promise<void>
 */
export function cached({ namespace, ttlMs, keyExtras }, handler) {
  if (!namespace || typeof namespace !== "string") {
    throw new Error("cached: namespace required");
  }
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error("cached: ttlMs must be a positive number");
  }

  return async function cachedHandler(req, res, next) {
    const startedAt = process.hrtime.bigint();
    const routePath = req.route?.path ?? req.path ?? req.originalUrl?.split("?")[0] ?? "";
    const route = `${req.baseUrl || ""}${String(routePath)}`;
    const qs = sortedQueryString(req.query);
    const extras = typeof keyExtras === "function" ? String(keyExtras(req) || "") : "";
    const cacheKey = `${route}|${qs}|${extras}`;

    let hit = false;
    let inFlight = null;
    let bucket = null;
    let bucketVersion = 0;

    if (!DISABLED) {
      bucket = getBucket(namespace);
      bucketVersion = bucket.version;
      const entry = bucket.store.get(cacheKey);
      if (entry && entry.expiresAt > now()) {
        hit = true;
        stats.hits += 1;
        // Re-insert to mark as recently used (LRU touch).
        bucket.store.delete(cacheKey);
        bucket.store.set(cacheKey, entry);
        emitTiming({ route, namespace, hit, startedAt, status: 200 });
        applyCachedHeaders(res, entry);
        res.set("X-Cache", "HIT");
        return res.status(entry.statusCode || 200).json(entry.payload);
      }
      if (entry) bucket.store.delete(cacheKey);

      const pending = bucket.inFlight.get(cacheKey);
      if (pending) {
        const pendingEntry = await pending.promise.catch(() => null);
        if (pendingEntry && pendingEntry.expiresAt > now()) {
          hit = true;
          stats.hits += 1;
          bucket.store.delete(cacheKey);
          bucket.store.set(cacheKey, pendingEntry);
          emitTiming({ route, namespace, hit, startedAt, status: pendingEntry.statusCode || 200 });
          applyCachedHeaders(res, pendingEntry);
          res.set("X-Cache", "HIT");
          return res.status(pendingEntry.statusCode || 200).json(pendingEntry.payload);
        }
      }

      stats.misses += 1;
      inFlight = createInFlight();
      bucket.inFlight.set(cacheKey, inFlight);
    }

    // Wrap res.json to capture the payload for storage on success.
    const originalJson = res.json.bind(res);
    res.json = (payload) => {
      let storedEntry = null;
      try {
        if (!DISABLED && res.statusCode >= 200 && res.statusCode < 300) {
          const headerResult = cacheableHeaders(res);
          if (headerResult.cacheable && bucket.version === bucketVersion) {
            pruneExpired(bucket);
            storedEntry = {
              payload,
              headers: headerResult.headers,
              statusCode: res.statusCode,
              expiresAt: now() + ttlMs,
            };
            bucket.store.set(cacheKey, storedEntry);
            evictIfNeeded(bucket);
          }
        }
      } catch (err) {
        // Cache write failures must never break the response.
        captureCacheException(err, "store");
      } finally {
        if (inFlight && bucket?.inFlight.get(cacheKey) === inFlight) {
          bucket.inFlight.delete(cacheKey);
          inFlight.resolve(storedEntry);
        }
      }
      res.set("X-Cache", "MISS");
      emitTiming({ route, namespace, hit, startedAt, status: res.statusCode });
      return originalJson(payload);
    };

    try {
      await handler(req, res, next);
      if (inFlight && bucket?.inFlight.get(cacheKey) === inFlight) {
        bucket.inFlight.delete(cacheKey);
        inFlight.resolve(null);
      }
    } catch (err) {
      if (inFlight && bucket?.inFlight.get(cacheKey) === inFlight) {
        bucket.inFlight.delete(cacheKey);
        inFlight.reject(err);
      }
      emitTiming({ route, namespace, hit, startedAt, status: 500 });
      throw err;
    }
  };
}

function captureCacheException(err, phase) {
  try {
    Sentry.captureException(err, {
      tags: { component: "responseCache", phase },
    });
  } catch {
    // Sentry failures must never break the response path.
  }
}

let timingSink = null;

function emitTiming({ route, namespace, hit, startedAt, status }) {
  const durationNs = process.hrtime.bigint() - startedAt;
  const durationMs = Number(durationNs) / 1_000_000;
  const data = {
    route,
    namespace,
    hit,
    duration_ms: Math.round(durationMs),
    status,
  };
  try {
    Sentry.addBreadcrumb({
      category: "endpoint-timing",
      level: "info",
      message: `${route} ${hit ? "HIT" : "MISS"} ${durationMs.toFixed(1)}ms`,
      data,
    });
  } catch {
    // Sentry not initialised in tests — silent fallback.
  }
  if (timingSink) {
    try {
      timingSink(data);
    } catch {
      // Test sink only; keep production timing fail-open.
    }
  }
}

// Test helpers — never use in production paths.
export const __testing__ = {
  reset() {
    namespaces.clear();
    stats.hits = 0;
    stats.misses = 0;
    stats.invalidations = 0;
    timingSink = null;
  },
  setMaxEntries(namespace, n) {
    getBucket(namespace).maxEntries = n;
  },
  inspect(namespace) {
    return getBucket(namespace).store;
  },
  setTimingSink(fn) {
    timingSink = typeof fn === "function" ? fn : null;
  },
};
