# Supabase HTML-fejlsider forurener Sentry (én outage → 7 issues)

**Dato:** 2026-06-30
**Issue/PR:** #2023 / PR #2024
**Symptom-cluster:** CYCLINGZONE-1E/1F/1G/1H/1J/1K/1M ("Error: <!DOCTYPE html> ...")

## Hvad skete der

Supabase-gatewayen (Cloudflare foran `*.supabase.co`) var nede 29/6 kl. 20:33–20:35 CEST
og svarede med Cloudflare-fejlsider (522 Connection timed out / 525 SSL handshake failed)
i stedet for JSON. `supabase-js` kan ikke JSON-parse body'en og lægger **hele
HTML-dokumentet** i `error.message`.

Vores call-sites kastede `throw new Error(error.message)`. Resultat: **ét Sentry-issue
PER call-site**, hver med en titel der er et helt HTML-dokument. Én infrastruktur-hændelse
blev til 7 separate, ulæselige issues (achievementEngine, supabasePagination/cron,
marketUtils, discordDmOutbox).

## Rod-årsag

Rå videregivelse af en **ekstern fejl-besked** (som vi ikke kontrollerer formen på) direkte
ind i en `Error` der fingerprintes af Sentry. HTML-payloads varierer (Ray ID, timestamp) →
de grupperer dårligt og er umulige at læse i issue-listen.

## Fix

`backend/lib/supabaseErrorNormalize.js`:
- `normalizeSupabaseErrorMessage()` — detekterer HTML/Cloudflare-fejlside og koger den ned
  til én stabil linje (`Supabase unavailable (522 Connection timed out)`). Ægte PostgREST-fejl
  passerer uændret.
- `isTransientSupabaseError()` + `withSupabaseRetry()` — idempotente reads (fetchAllRows)
  retry'er et kort, selv-helende gateway-hikke; ikke-transiente fejl kastes uden retry.

## Forward-guard

- **Normalisér altid eksterne fejl-beskeder før de bliver til en `Error` der når Sentry.**
  Gælder enhver `throw new Error(externalThing.message)` hvor `externalThing` kommer fra et
  tredjeparts-SDK/gateway. Samme mønster bør bruges hvis vi tilføjer nye Supabase-call-sites.
- Backwards-check udført: alle fire kendte call-sites (`ensureNoError`, `readMany`/
  `readMaybeSingle`, `fetchAllRows`, `discordDmOutbox`) er wiret ind i denne PR.
- Bonus: retry betyder at en cron eller bruger-request nu overlever et par sekunders
  Supabase-hikke i stedet for at fejle hårdt.

## Relateret (samme triage, andet udfald)

- **CYCLINGZONE-17** (WatchlistPage `null.id`): ægte bug, men allerede fikset i koden
  (`.filter(e => e.rider)`, WatchlistPage.jsx:74, #1918). Resolved i Sentry.
- **CYCLINGZONE-1D/1N/1P** (React DOM `insertBefore/removeChild`): Google Translate/
  browser-extension der manipulerer DOM under React-commit. Ekstern, lav-prioritet,
  ikke fixet — lod dem ligge.
