# Alunta ops — webhook + reconcile (#2736)

Læs denne FØR den betalende kundes fornyelse (~24/8-2026). Dækker: hvad ejeren
skal konfigurere, hvilke Alunta-dashboard-events der skal slås til, og hvordan
kæden verificeres uden at vente på selve fornyelses-dagen.

## Baggrund (kort)

`invoice.paid` findes IKKE i Aluntas event-katalog — det var den oprindelige
bug (#2736, se `.claude/learnings/2026-08-03-alunta-invoice-paid-missing-current-period-end.md`).
To uafhængige lag retter det nu:

1. **Webhook** (`backend/lib/aluntaWebhook.js`) — reagerer på det RIGTIGE
   event-katalog i realtid (se tabellen i filens hoved-kommentar).
2. **Daglig reconcile** (`backend/lib/aluntaSubscriptionReconcile.js`) —
   sikkerhedsnet: synker Aluntas fulde `GET /subscriptions`-svar ind hver dag,
   uafhængigt af om et enkelt webhook-event skulle gå tabt eller have et
   uventet feltnavn.

De skal aldrig være uenige om semantik — webhookens status-mapping spejler
bevidst reconcilens `mapAluntaStatus`-aliaser.

## 1. Infisical — secrets der SKAL være sat

| Nøgle | Bruges af | Formål |
|---|---|---|
| `ALUNTA_WEBHOOK_SECRET` | `aluntaWebhook.js` | HMAC-SHA256-nøgle til at verificere `Signature`-headeren på hvert indkommende webhook-kald. Uden denne afvises ALT (401). |
| `ALUNTA_API_TOKEN` | `alunta.js` (bruges af reconcile + checkout + portal) | Bearer-token til Aluntas API (`GET /subscriptions` m.fl.). |

Verificér begge findes i det miljø backend rent faktisk kører i (Railway prod),
ikke kun lokalt/`.env`. Manglende `ALUNTA_WEBHOOK_SECRET` → webhooken afviser
alle events 401 → Alunta logger permanent fejlende leverancer.

## 2. Alunta-dashboard — hvilke webhook-events skal slås til

Aktivér PRÆCIS denne liste i Alunta-dashboardets webhook-konfiguration (peger
på `POST /api/billing/alunta-webhook`):

| Event | Effekt i CZ |
|---|---|
| `checkout.completed` | Ny Pro-abonnent → `status=active`, kan claime founder-sæde |
| `subscription.created` | Ny Pro-abonnent (alternativ sti til checkout) → samme som ovenfor |
| `subscription.started` | Fornyelse/reaktivering → `status=active`, opdaterer `current_period_end` |
| `subscription.resumed` | Genoptaget efter pause → `status=active` |
| `subscription.cancelled` | Opsagt (æret indtil periodeudløb) → `status=cancelled` |
| `subscription.payment_failed` | Betaling fejlede → `status=past_due` (stadig Pro til `current_period_end`) |
| `subscription.ended` | Abonnement definitivt slut → `status=inactive` |
| `subscription.tier_changed` | Plan skiftet (fx monthly→semiannual) → opdaterer KUN `plan_interval` |

**Slå IKKE `invoice.paid` til — det event findes ikke og vil aldrig fyre.**
`invoice.created` og `customer.*` kan roligt være slået til (webhooken
ignorerer dem stille, 200), men er ikke nødvendige for entitlement.

## 3. Ny migration — SKAL anvendes før fornyelsen

`database/2026-08-06-alunta-subscriptions-last-event-at.sql` tilføjer kolonnen
`subscriptions.last_event_at` (idempotent `ADD COLUMN IF NOT EXISTS`). Den
bruges til webhookens out-of-order-guard (en forsinket ældre event kan ikke
regressere en allerede anvendt nyere event). Uden migrationen fejler koden
IKKE (PostgREST returnerer roligt `{data:null,error}` for en ukendt kolonne,
webhooken falder tilbage til før-#2736-adfærd) — men beskyttelsen er inaktiv
indtil den er anvendt. Anvendes af Claude selv post-merge (hard rule 9,
idempotent + post-verify — se `AGENTS.md`).

## 4. Verifikation FØR fornyelsen (~24/8)

Kør i rækkefølge, fra `backend/`:

1. **Unit-/integrationstests (mock-only, ingen live Alunta):**
   ```
   node --test lib/aluntaWebhook.test.js lib/aluntaSubscriptionReconcile.test.js
   ```
   Alle events + idempotens + founder-semantik er dækket her — se
   `backend/lib/aluntaWebhook.test.js`.

2. **Reconcile dry-run mod ÆGTE Alunta (ingen writes):**
   ```
   infisical run --env=prod -- node scripts/reconcileAluntaSubscriptions.js
   ```
   Bekræft at RAW-feltudtrækket i outputtet matcher det du forventer for den
   betalende kundes abonnement (særligt `current_period_end` — den må IKKE
   være `null` for en aktiv kunde). Se `aluntaSubscriptionReconcile.js`'s
   "UVERIFICERET KONTRAKT"-kommentar — ret `extractSubscriptionFields`, hvis
   feltnavnene ikke matcher.

3. **Flip reconcile-flaget til on** (kun når dry-run-output er bekræftet
   korrekt):
   ```sql
   UPDATE public.app_config SET value='true'::jsonb WHERE key='alunta_reconcile_enabled';
   ```
   Cronen kører herefter dagligt (`backend/cron.js`, 24-timers interval) og
   er sikkerhedsnettet hvis et webhook-event alligevel skulle glippe.

4. **Webhook-test mod test_mode i Alunta-dashboardet** (send et test-event for
   hvert event i tabellen ovenfor, hvis Alunta-dashboardet understøtter
   test-afsendelse) — bekræft 200-svar i Aluntas leverings-log og at
   `public.subscriptions`-rækken for testkundens `team_id` opdaterer sig som
   forventet.

5. **Selve fornyelsen (~24/8):** hold øje med Sentry (reconcile-fejl
   captureException'es med `tags.cron=alunta-subscription-reconcile`) og
   Railway-logs for `aluntaWebhook.js` (500-svar logges der Alunta vil
   retry'e). Ingen handling nødvendig hvis begge er stille.

## 5. Hvis noget går galt alligevel

- Webhooken svarer 500 kun ved DB-fejl (Alunta retry'er automatisk).
- Ukendte/malformed events/payloads svares 200 (roligt ignoreret — undgår
  retry-storm på noget vi alligevel ikke kan handle på).
- Reconcilen er sikkerhedsnettet: selv hvis ALLE webhook-events for en given
  fornyelse går tabt, retter den daglige cron `current_period_end` inden for
  24 timer, forudsat flaget (pkt. 3) er sat til `true`.
- Manuel nødreparation: `node scripts/reconcileAluntaSubscriptions.js --apply`
  (skriver med det samme, uden at vente på cronen).
