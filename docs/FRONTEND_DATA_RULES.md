# Frontend server data

SSOT for the incremental #6494 migration onto one data layer (TanStack Query). Pages move one at a time.

## Ownership and scope
- Migrated pages read through typed hooks in `frontend/src/data/`; the page owns filters, dialogs and pending feedback, never a direct `supabase.from(` or `fetch` call.
- One lazily created browser runtime (`useDataScope.ts` `appRuntime()`) owns the QueryClient. A migrated page renders inside `DataProvider` (`DataProvider.tsx`). While migration is page by page the provider wraps the page, not the app, so unmigrated routes and the public landing/prerender graph never load Query. Server renders get a separate runtime and never share private data.
- Private keys come from `queryRuntime.ts`: `privateKey(scope, resource, ...)` holds auth generation, viewer, team, resource and parameters; `viewerKey` keeps the team slot empty for data that does not depend on the team, so the key stays stable while the team bootstrap resolves. Tokens and e-mail addresses never enter keys. A real viewer or team change cancels and clears every private key; a same-viewer token refresh keeps the generation.
- Reads call `runtime.beforeRead` and `runtime.assertReadCurrent`, so an answer that arrives after a viewer/team change or a write is discarded. A read whose transport cannot abort does not consume Query's signal, so a remount joins the in-flight read instead of starting a second one.
- Writes bind to the captured viewer (`beginWrite`), never retry automatically, and hold new reads until they settle. Money and successful bids stay server-confirmed.
- Freshness is 30 seconds, inactive retention five minutes, no automatic retry. No polling, persistence, broadcast cache, service-worker data cache or offline write queue.
- Failures never become successful empty lists (`apiQuery.ts`). Known data stays visible on a failed background refresh; the page's existing error state shows only when there is nothing to show.

## Migrated pages
- Global Rank (`/standings?tab=global`, `globalRankData.ts` + `useGlobalRankData.ts`): read-only, no realtime. The rankings hub loads the tab lazily so the league tab does not load Query.

## Incremental boundary
Pages not listed above are legacy and keep their own loading, including `sharedRequestCache` and `useRealtimeRefetch`. Do not wrap their existing memo caches in a second Query cache. New data modules and tests are TypeScript. Bundle ceilings stay unchanged. No new recurring service cost.
