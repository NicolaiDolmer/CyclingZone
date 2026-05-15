# Postmortem · 2026-05-15 · Response-cache key collision and in-flight invalidation

## Hvad skete der?
Phase 1 response-cache review found two edge cases before production close-out: query values containing `&` or `=` could collide with ordinary query params, and a slow cache miss could finish after an invalidating write and re-store stale payload.

## Root cause
Cache keys were assembled as raw `key=value` strings without URL encoding. Invalidation cleared the namespace, but in-flight misses had no namespace version check before storing their response.

## Fix
Query keys are now URL-encoded and sorted by key/value. Each namespace has a version counter, invalidation bumps it, and misses only store if their captured version still matches. Concurrent first misses are coalesced so a cold burst for one key produces one upstream read.

## Forhindret-fremover
Regression tests cover crafted query collisions, `req.route` fallback, concurrent first miss coalescing, in-flight invalidation, Set-Cookie bypass, header preservation, `res.send()` non-capture, and the 10,000-query maxEntries bound.

## Læring
In-process caches still need distributed-systems thinking at async boundaries. Single-threaded Node prevents memory races, not stale async write-back after an awaited read.
