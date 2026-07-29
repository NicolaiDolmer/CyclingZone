# PostgREST .in()-lister har en usynlig URL-klippe ved ~430 UUID'er

**Dato:** 2026-07-26 · **Issue:** #3030 · **Sentry:** CYCLINGZONE-3H, CYCLINGZONE-3G

## Symptom
Auto-prize-sweepen fejlede på hvert 5-min-tick med `TypeError: fetch failed` (ingen statuskode, ingen PostgREST-fejl) — 6 løb / 688.200 CZ$ stod ubetalt. Ownership-invariant-watch var knækket ~15 timer tidligere med samme fejl.

## Rod-årsag
supabase-js sender `.in("col", ids)` som GET med hele id-listen URL-encodet i query-strengen. Request-linjen har en gateway-grænse på ~16 KB ≈ ~430 UUID'er; over den dropper gatewayen forbindelsen, og undici kaster netværksfejlen "fetch failed" — der ligner en transient netværksfejl, ikke en query-fejl. Fejlen opstår derfor SNIGENDE: koden virker i månedsvis, indtil datamængden (completed løb pr. sæson, offered intake-rækker) vokser forbi klippen. Retry-laget hjælper ikke — hver retry rammer samme grænse.

## Hvorfor den var svær at se
- "fetch failed" pattern-matcher til Cloudflare-hikke (#2023-retryen findes netop derfor) — man leder efter netværksproblemer, ikke query-form.
- Al anden DB-trafik kørte fint samtidig (race engine, writes) — kun de store `.in()`-kald døde.
- `academyIntakeReconcile` chunkede allerede — men ved 1000 ids pr. chunk (~37 KB), dvs. chunking-uden-at-forstå-grænsen.

## Fix
Fælles helper `fetchAllRowsChunkedIn` i `backend/lib/supabasePagination.js`: chunker ved 100 ids (~3,7 KB URL) og paginerer pr. chunk. Anvendt på de 3 ramte call-sites (PR #3031).

## Læring / forward-guard
1. **Enhver `.in(ids)` med ubundet liste er en tikkende bombe.** Brug `fetchAllRowsChunkedIn` medmindre listen er hårdt bundet lavt (< ~50).
2. "fetch failed" uden statuskode på en query der plejer at virke + voksende datamængde → mistænk URL-længden FØR netværket.
3. Follow-up i #3030: audit af øvrige ubundne `.in()`-call-sites i backend.
