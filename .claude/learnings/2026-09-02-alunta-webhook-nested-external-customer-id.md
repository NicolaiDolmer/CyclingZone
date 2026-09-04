# 2026-09-02: Webhooken laeste kun flade Alunta-felter, mens den aegte payload nester dem

## Hvad skete

`backend/lib/aluntaWebhook.js` laeste identitets-felterne rent flad:
`data.external_customer_id`, `data.customer_uuid`, `data.subscription_uuid`. Det
virker for et syntetisk testeksempel (og for de eksisterende node-tests, som
alle skrev flade payloads). Men Aluntas AEGTE REST-kontrakt (verificeret mod
`GET /subscriptions` i prod 2026-09-02, dokumenteret i `docs/BILLING_STACK.md`
§5) nester identiteten under `data.customer` for subscription.*-events:

```json
{
  "uuid": "b9d010fc-...",
  "customer": { "uuid": "dd7665b4-...", "external_customer_id": "<team_id>" },
  "external_customer_id": "<team_id>",
  "interval": 6,
  "current_period_end": "..."
}
```

Ramte webhooken et event i denne form uden en flad `external_customer_id`,
faldt `teamId` til `null`, og webhooken loggede roligt "ignoreret: mangler
event eller team_id" og returnerede 200 — en fornyelse/aktivering fra den
AEGTE Alunta ville altsaa kunne ramme null-team-id og blive tavst droppet,
med kun den time-vise reconcile (`aluntaSubscriptionReconcile.js`) som net.

## Rod-aarsag

Koden blev oprindeligt skrevet/testet mod et FLADT eksempel-payload uden at
maale den aegte REST-kontrakt foerst — samme fejlklasse som de to tidligere
Alunta-postmortems i denne fil-serie (`invoice.paid` findes ikke,
checkout-session-envelope er udokumenteret). BILLING_STACK.md §5's nestede
kontrakt blev dokumenteret 2/9 for `aluntaSubscriptionReconcile.js`
(`extractSubscriptionFields`), men webhooken blev aldrig opdateret til at
spejle den samme flad-foer-nested-fallback.

## Rettelse (#4648)

`extractWebhookIdentity(event, data)` i `aluntaWebhook.js` traekker nu:
- `teamId = data.external_customer_id ?? data.customer?.external_customer_id`
- `customerUuid = data.customer_uuid ?? data.customer?.uuid`
- `subscriptionUuid = data.subscription_uuid ?? data.uuid` — **KUN** paa
  `subscription.*`-events. Paa `checkout.completed` er `data.uuid`
  checkout-SESSIONENS id, ikke abonnementets, og maa ALDRIG skrives som
  `alunta_subscription_id`.
- `plan_interval` laeser nu ogsaa `data.interval` (Aluntas REST-feltnavn),
  ikke kun `data.plan_interval`.

Testet med BAADE den flade og den nestede payload-form (`aluntaWebhook.test.js`,
#4648-sektionen), inkl. en eksplicit guard-test for at `checkout.completed`
aldrig laeser `data.uuid` som abonnements-id.

Samtidig tilfoejet: efter `checkout.completed` kaldes en ny scopet
`runAluntaSubscriptionReconcileForTeam()` (fire-and-forget, efter 200-svaret)
saa DETTE ene holds fulde billing-felter (isaer `current_period_end`, som
`checkout.completed` ikke altid baerer) synkes straks i stedet for at vente op
til en time paa den fulde reconcile. `computeIsPro()` (backend + frontend)
faar desuden et 24-timers respit for active/past_due UDEN `current_period_end`
(`PRO_GRACE_NO_PERIOD_END_MS`), saa vinduet mellem checkout og reconcile aldrig
viser en frisk betalende kunde som ikke-Pro.

## Laering

1. **Maal svaret foer du laeser felter af det — for HVER forbruger af
   samme payload, ikke kun den foerste.** `aluntaSubscriptionReconcile.js`
   fik den nestede kontrakt rettet 2/9; webhooken, som laeser den SAMME
   slags Alunta-payload, blev overset. Et felt-kontrakt-fund paa ét sted i
   kodebasen er en grund til at grep'e efter alle andre steder samme kontrakt
   antages.
2. **Et payload-testeksempel skrevet ud fra hukommelse/antagelse er ikke det
   samme som en verificeret kontrakt.** De oprindelige webhook-tests var alle
   flade og gav derfor falsk tillid — de beviste at koden virkede mod sin
   egen antagelse, ikke mod Aluntas virkelighed.
3. **Et checkout-session-id og et abonnements-id kan dele feltnavn
   (`data.uuid`) paa tvaers af event-typer.** Fallback-logik der er korrekt
   for én event-familie kan vaere direkte forkert for en anden — scop
   fallbacks til den event-type de faktisk gaelder for.
