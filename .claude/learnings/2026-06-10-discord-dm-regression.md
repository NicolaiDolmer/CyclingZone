# Discord DM-regression #2 — samme symptom, NY rod-årsag (429, ikke token)

**Dato:** 2026-06-10 · **Issue:** #1115 · **Forrige runde:** #1002 (3/6)

## Hvad skete

Overbuds-/auktions-DMs holdt op med at virke IGEN under transfervinduet.
Alle antog token-rotation (som i #1002) — men evidensen viste noget andet:

- **Token var gyldigt.** Probe fra lokal IP: `users/@me` = 200 (bot "Cycling
  Zone", 2 guilds). Kun 1 alert-event i Sentry på 14 dage trods daglige boots
  (token-check kører ved hver boot) → Railway-tokenet var også gyldigt.
- **Sentry CYCLINGZONE-Z:** boot-time token-check fik HTTP **429** ét sekund
  efter app-start (app_start_time 22:47:46.704Z, event 22:47:47.666Z, 9/6).
  Processens FØRSTE request kan ikke have opbrugt sit eget request-budget →
  rate-limit på **Railways delte egress-IP** (kendt Discord+PaaS-problem).
- Den gamle `sendDM` lavede præcis ét forsøg, sluged fejlen i `console.error`
  og droppede DM'en permanent. Railway-logs roterer på minutter → intet spor.

## Hvorfor skete det "igen"

Det var IKKE samme fejl. #1002 fiksede token-navne-mismatch (401). Denne gang
var det intermitterende 429 på IP-niveau. Det LIGNEDE en gentagelse fordi:

1. **Symptomet er identisk** (ingen DMs) og fejl-laget er usynligt (console.error
   i roterende logs) — så enhver DM-død mappes mentalt til "token igen".
2. **#1002-guarden fyrede faktisk** (Sentry + webhook 9/6) — men dens tekst sagde
   *"sandsynligvis roteret/ugyldigt"* for en 429. Alarm med forkert diagnose
   sendte fejlsøgningen i den forkerte retning og underminerede tilliden til den.
3. **Leveringen var ikke-resilient by design:** ét forsøg, intet retry, ingen
   persistens. Enhver transient infra-fejl (429/5xx/netværk) = permanent tabt DM.

## Fix (rod-årsag, ikke plaster)

- `discordDmDelivery.js` (pure): fejl-klassifikation (401=permanent/alarm,
  403=data/ingen alarm, 429/5xx/netværk=retryable) + inline-retry der
  respekterer Discords `retry_after`, cappet til 5s.
- `discordDmOutbox.js` + `discord_dm_outbox`-tabel: retryable fejl persisteres
  og drain-cron (5 min) retryer med backoff op til ~27h — DMs overlever
  IP-ban-vinduer og deploy-restarts. Opgivne rækker → 'dead' + ÉN aggregeret
  alarm (webhook + Sentry) pr. drain-run.
- `discordBotTokenCheck.js`: 429 og 401 skelnes nu i både embed og Sentry-besked
  — alarmen diagnosticerer korrekt næste gang.

## Hvad forhindrer tredje gang

1. **Transiente fejl kan ikke længere dræbe DMs permanent** — de venter i
   outbox'en og leveres når IP'en er fri igen.
2. **Vedvarende fejl er højlydte:** dead-letter-alarm med status + årsag i både
   Discord-webhook og Sentry (webhook-kanalen virker uafhængigt af bot-token).
3. **Alarmer diagnosticerer korrekt:** 429 ≠ "token roteret". Ingen vildledning
   af næste fejlsøgning.

## Læring (generaliserbar)

- **Samme symptom ≠ samme rod-årsag.** Verificér fejl-klassen (statuskode!)
  før du genbruger sidste runde-diagnose.
- **En alarm med forkert diagnose er værre end ingen alarm** — den styrer
  fejlsøgningen aktivt i den forkerte retning. Skeln fejl-klasser i alarmtekst.
- **Fire-and-forget + console.error + roterende logs = designet tavshed.**
  Best-effort-sideeffekter med brugerværdi skal have persistens + dead-letter-
  alarm, ellers er "best effort" reelt "no effort" under infra-støj.
