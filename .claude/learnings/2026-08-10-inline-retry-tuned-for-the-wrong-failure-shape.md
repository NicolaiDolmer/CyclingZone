# Inline-retry var tunet til den forkerte fejl-form (#3545)

**Dato:** 2026-08-10 · **Fundet af:** daglig Sentry/Railway-triage (Sentry-kort CYCLINGZONE-4C)
**Berørt:** Discord kanal-poster — auktions-annonceringer og løbsresultater

## Hvad skete der

7/8 kl. 22:21-22:23 svarede Discord 503 på 8 webhook-POSTs i træk. Systemet prøvede
igen 4 gange over ~3 sekunder, gav op og **droppede beskeden**. 8 auktioner blev
oprettet korrekt (HTTP 201), men aldrig annonceret i Discord. Spillerne fik ikke
besked om at der var noget at byde på.

## Rod-årsag

`discordWebhookDelivery.js` (#2882) blev bygget som svar på en **429-hændelse** 24/7,
hvor en tier-3-resultatpost forsvandt i Discords per-webhook rate limit. Den fejl-form
varer *millisekunder*, så 4 inline-forsøg med 500/1000/1500ms backoff — loftet af
`MAX_INLINE_RETRY_WAIT_MS = 15s` for ikke at blokere en cron-tick — var rigeligt.

Men `classifyWebhookFailure` klassificerer **både** 429 og 5xx som `retryable`, og de
to har vidt forskellig varighed:

| Fejl-form | Typisk varighed | Dækket af 3 sek inline-retry? |
|---|---|---|
| 429 rate-limit | millisekunder | ja |
| Discord 5xx-udfald | minutter | **nej — pr. konstruktion umuligt** |

Retry-budgettet blev dimensioneret efter den fejl der udløste arbejdet, ikke efter
den bredeste fejl-klasse koden faktisk fanger. Da 5xx'en kom, havde `retryable` en
sti der lovede genforsøg og en implementering der ikke kunne holde løftet.

Sentry-capturen fra #2882 virkede perfekt — vi *vidste* beskederne røg. Det der
manglede, var at de blev leveret.

## Fix

Durabel outbox frem for længere inline-venten (inline-loftet er der af en god grund —
det beskytter cron-ticks og HTTP-requests):

- `discord_webhook_outbox` + `discordWebhookOutbox.js` — spejler DM-outbox'en (#1115),
  som løste præcis samme problem for person-rettede beskeder i juni.
- Retryable fejl der overlever inline-forsøgene → outbox i stedet for drop.
- Drain-cron hvert 5. minut, eksponentiel backoff, ~27 timers horisont.
- Sentry-capturen **flyttet** til det tidspunkt hvor beskeden reelt er tabt (outbox →
  dead) i stedet for 3 sekunder efter første hik. Permanent 4xx (#2395) går aldrig i
  outbox'en — der er intet at vente på.

## Læring

**Dimensionér et retry-budget efter den langsomste fejl-form klassifikatoren fanger,
ikke efter den hændelse der udløste arbejdet.** `classifyWebhookFailure` samler 429 og
5xx under ét `retryable`-flag, men de kræver to størrelsesordener forskellig
tålmodighed. Når én etiket dækker fejl-former med vidt forskellig varighed, skal
implementeringen enten spalte etiketten eller dimensioneres efter den værste.

**Sekund-skala-retry hører til inline; time-skala-retry kræver persistens.** En proces
kan ikke vente minutter uden at blokere noget andet. Så snart et retry-vindue skal
overleve længere end en request/tick, skal beskeden på disk — der findes ingen mellemvej.

## Backwards-check

- `discordDmDelivery.js` har allerede outbox (#1115) — dækket.
- `discordWebhookDelivery.js` var det eneste tilbageværende Discord-leveringslag uden
  persistens. Nu dækket.
- Ingen andre eksterne fire-and-forget-kald i backend'en har inline-only retry
  (Resend-mails går via provider-kø; Supabase-kald er synkrone med kalderens fejlsti).

## Forward-guard

- `discordWebhookOutbox.test.js` asserter eksplicit at den samlede backoff-horisont er
  **≥24 timer** — en fremtidig indsnævring til sekund-skala fejler testen.
- `discordNotifier.test.js` asserter at et 5xx-udfald ender i outbox'en (ikke i en
  capture), at permanent 4xx aldrig gør, og at drainens egen dead-alarm ikke kan
  lægge sig selv i outbox'en (loop-vagt).
- `cron.monitorCoverage.test.js` dækker automatisk det nye monitor-slug.
