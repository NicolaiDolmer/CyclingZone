# 2026-08-03 — Alunta 'invoice.paid' findes ikke + current_period_end allerede NULL i prod

## Hvad skete
Issue #2736 (bidt via #1903-opfølgning 20/7): aluntaWebhook.js's ACTIVATING-set lytter på
`invoice.paid`, men det event findes IKKE i Aluntas event-katalog (kun invoice.created,
subscription.created/started/cancelled/resumed/ended/payment_failed/tier_changed,
checkout.completed, customer.*). Konsekvens: `current_period_end` bliver muligvis ALDRIG
opdateret ved fornyelse.

Read-only SELECT mod prod (Supabase MCP, 2026-08-03) bekræftede det er VÆRRE end "vil knække
ved fornyelse ~24/8": den eneste subscriptions-række i produktion har allerede
`current_period_end = NULL` og `alunta_customer_id`/`alunta_subscription_id` begge NULL, kun
`status='active'`, `is_founder=true`. `last_event_id = 'checkout.completed:<timestamp>'`
(fallback-formatet i aluntaWebhook.js — betyder `data.uuid` manglede i webhook-payloaden, og
sandsynligvis gjorde `data.current_period_end`/`data.subscription_uuid`/`data.customer_uuid`
det også). `computeIsPro()` (backend/lib/entitlement.js + frontend/src/lib/proEntitlement.js)
kræver `current_period_end != null` OG i fremtiden — kunden har derfor sandsynligvis ALDRIG
haft synlig Pro-status i entitlement-laget, siden checkout 2026-07-25. Impact var kosmetisk
(ingen backend-feature er pt. hård-gatet bag `isPro`, kun UI: ProBadge/ProfilePage/
ProUpgradePage, og Layout.jsx viser badgen alligevel via `isPro || isFounder`), men
datamodellen var reelt i stykker fra dag ét, ikke kun ved den kommende fornyelse.

## Rod-årsag
Samme klasse som 20/7-hændelsen (se `2026-07-20-alunta-contract-assumptions-and-icu-syntax.md`):
webhook-koden blev bygget mod en ANTAGET event-kontrakt uden efterfølgende verifikation af det
FAKTISKE payload-indhold for hvert event. `checkout.completed` blev antaget at bære fulde
billing-felter (customer_uuid, subscription_uuid, current_period_end) — det gør den
sandsynligvis ikke; de felter leveres formentlig kun via `subscription.created`/faktura-
events, som enten aldrig fyrede for denne kunde, eller fyrede før koden lyttede korrekt.

## Fix (#2736)
Daglig reconcile-cron (`backend/lib/aluntaSubscriptionReconcile.js`) henter Aluntas fulde
`GET /subscriptions`-liste og synker status+current_period_end+plan_interval+alunta-id'er ind,
matchet på `external_customer_id === team_id` (uafhængigt af om en lokal række allerede har
alunta_customer_id/alunta_subscription_id — netop denne kundes række havde ingen af delene).
Gated bag `app_config.alunta_reconcile_enabled` (fail-safe OFF): GET /subscriptions'
svarform er UVERIFICERET i denne session (ingen live test_mode-adgang, docs.alunta.com er en
JS-SPA WebFetch ikke kan læse statisk indhold fra). `node scripts/reconcileAluntaSubscriptions.js`
(dry-run som default) er den påkrævede første-verifikations-gate før flaget flippes.

## Læredomme / guards
- **En webhook-kontrakt der virkede ved AKTIVERING er ikke bevis for at den virker ved
  FORNYELSE** — forskellige events kan bære forskellige felt-delmængder. Test hele
  livscyklussen (aktivering OG fornyelse OG udløb), ikke kun første succesfulde køb.
- **"Betalingen gik igennem" ≠ "entitlement-data er korrekt."** En kunde kan opleve at
  checkoutten lykkedes, mens den afledte adgangs-tilstand (current_period_end) aldrig bliver
  sat — usynligt indtil nogen læser rækken direkte (som her).
- **Prod-SELECT FØR design af et reconcile-flow** afslørede at det virkelige problem var
  bredere end issuets oprindelige framing (kun "ved fornyelse") — verificér altid live-
  tilstanden for den konkrete kunde/entitet reconcilen skal rette, ikke kun symptomets
  beskrivelse i issuet.
- Forward-guard: reconcilen matcher på `external_customer_id` (ikke på allerede-gemte
  alunta_customer_id/alunta_subscription_id) netop fordi en række kan mangle dem helt —
  et per-ID-opslag ville have været blindt for denne kundes faktiske tilstand.
