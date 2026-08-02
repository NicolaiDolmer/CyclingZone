# 2026-08-02 — Supabase gateway-500 blev klassificeret som permanent fejl

**Issue:** [#3180](https://github.com/NicolaiDolmer/CyclingZone/issues/3180) · **Sentry:** CYCLINGZONE-47 · **Fundet af:** daglig Sentry/Railway-triage

## Symptom

2/8 kl. 15:58 CEST døde hele auto-prize-sweep-cron'en med `Error: Internal server error.`
Ét event, 0 brugere ramt. Railway-loggen viste samme linje: `Cron error (auto-prize sweep): Internal server error.`

Kæden: `runAutoPrizeSweepCron` → `runAutoPrizeSweep` → `paySeasonPrizesToDate` →
`getSeasonPrizePreview` → `fetchAllRowsChunkedIn` → `fetchAllRows` → `withSupabaseRetry` → kastede.

## Rod-årsag

`isTransientSupabaseError()` kendte tre klasser af transiente fejl:

1. Cloudflare-HTML-fejlsider (#2023),
2. netværks-/socket-tokens (`ECONNRESET`, `fetch failed`, …),
3. Postgres statement/lock-timeout (57014 / 55P03, CYCLINGZONE-3D/3E).

Supabase-gatewayen har en **fjerde** fejlform: når den fejler uden at Cloudflare når at rendere
en HTML-side, er hele body'en `{"message":"Internal server error."}` — ingen Postgres-kode,
ingen HTML, intet netværks-token. Ingen af de tre klasser matchede, så `withSupabaseRetry`
kaldte `asError()` med det samme: **0 retries** på et rent infrastruktur-hikke.

## Konsekvens (målt)

Lav og selv-helende denne gang: sweepet er idempotent, og næste tick tog restancen.
Verificeret i prod samme dag — sæson 2, `races` med `status='completed'`: **0 uudbetalte**,
89 udbetalte, sidste udbetaling 13:08 UTC. Ingen penge hængende.

Men de to andre `withSupabaseRetry`-call-sites ligger i `economyEngine` (rytterværdi-batch +
standings-recompute). Samme fejl dér ville koste en etapes berigelse permanent — præcis det
scenarie retry-laget blev bygget for at forhindre. Held, ikke design, at det ramte det billige sted.

## Fix

Fjerde klasse i `backend/lib/supabaseErrorNormalize.js`:

```js
const TRANSIENT_GATEWAY_MESSAGE_RE =
  /^(internal server error|bad gateway|service (temporarily )?unavailable|gateway time-?out)\.?$/i;
```

Matchet er **ankret på hele beskeden**. Det er det, der gør det sikkert: PostgREST's egne fejl er
altid mere specifikke (`permission denied for table "riders"`, `column ... does not exist`), så en
fuld-streng-match kan ikke maskere en ægte DB-fejl som et transient hikke. Fire regressionstests
dækker begge retninger — de bare gateway-beskeder retry'es, de PostgREST-lignende gør ikke.

Retry er sikkert her fordi alle tre call-sites bag `withSupabaseRetry` er idempotente
(paginerede reads + samme-payload PATCHes).

## Læring

**En fejlklassifikator er kun så god som antallet af fejlformer du har set.** Klassifikatoren blev
udvidet to gange (HTML-sider 29/6, statement-timeout 24/7) — hver gang efter en produktions-hændelse,
hver gang med præcis den form vi lige havde set. Formerne er ikke tilfældige: de svarer til lag i
stakken (Cloudflare → gateway → PostgREST → Postgres), og gateway-laget var det eneste, der manglede.

Praktisk konsekvens: når en klassifikator udvides, så spørg hvilket **lag** den nye form kom fra
og om nabolagene er dækket — i stedet for kun at tilføje den observerede streng.

Bemærk også hvad der virkede: fejlen blev opdaget af triagen inden for 15 minutter, fordi
`sentryCapture` er wiret ind i cron-fejl-stien (#2389 A2). Uden den ville dette have været en
tavs linje i Railway-loggen.
