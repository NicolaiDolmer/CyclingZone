# Frontend server data
SSOT for the incremental #6494 migration. Draft implementation; Claude reviews the issue spec before merge.

## Ownership and scope
- Migrated market pages import typed data hooks from `frontend/src/data/`; their UI owns filters, dialog state and pending interaction feedback.
- One lazy browser QueryClient is shared by migrated routes and remains mounted for browser focus/reconnect events. The public landing/prerender import graph does not load Query. Server runtimes are created separately and never share private data.
- Private query keys contain auth generation, viewer, team, resource and relevant parameters. Tokens and e-mail addresses never enter keys. Real viewer/team changes cancel and clear old queries. Same-viewer token refresh preserves generation.
- Unknown auth blocks private reads. The viewer-scoped team bootstrap precedes team-scoped reads. Cached team data remains available after a background failure; initial bootstrap failure terminates loading and exposes retry.
- Reads use AbortSignal where supported and reject late results after scope/write revision changes. Writes bind to the captured viewer, never retry automatically, cancel older reads and hold new reads until writes settle. Money and successful bids remain server-confirmed.
- Query freshness is 30 seconds and inactive retention five minutes. No polling, persistence, broadcast cache, service-worker data cache or offline write queue is added.

## Market resources
- `marketData.ts` owns listings, sent/received/archived offers and swaps, shape validation and ability normalization.
- `auctionData.ts` owns auction rows, current bids/proxies, watchlist and squad availability. Realtime is an invalidation signal, not a replacement for joined rows. Events coalesce in bounded 400ms windows, so continuous events cannot starve freshness.
- After first migrated route use, existing profile listing readers delegate through `sharedRequestCache` into the same Query listing key. Exact credential snapshots are checked before reuse. Existing listing mutations invalidate this owner through the existing service; unrelated legacy GET caches keep their owners.
- Watchlist optimism updates the canonical cache and rolls back only the affected rider; reads are cancelled before it changes and reconciled after the write.
- API transport preserves existing 401 handling, Retry-After, cancellation and network errors. Errors and malformed bodies never become successful empty arrays. Known data remains visible on failed refresh.

## Incremental boundary
Dashboard is still legacy at the first checkpoint and must not be called migrated. Cross-cutting profile, active-season, scouting, player flags and existing self-fetching widgets retain their named legacy owners until separately migrated; do not wrap their existing memo caches in a second Query cache.
New data modules/tests are TypeScript. Bundle ceilings remain unchanged. No new recurring service cost.
