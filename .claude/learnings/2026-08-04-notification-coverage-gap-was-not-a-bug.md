# Postmortem · 2026-08-04 · "13% af aktive brugere har 0 notifikationer" var ikke en dæknings-/RLS-bug

## Hvad skete der?
Produkt-gap-reviewet 2026-08-03 (Gab 2) hypotesede at en 23/7-måling ("13% af
aktive brugere modtog aldrig en eneste notifikation") skyldtes en
dæknings-/trigger-/opt-in-/RLS-bug for nye konti. Opgaven var at rod-årsage
den mod prod og fixe fremadrettet.

## Root cause
Der var INGEN dæknings-/RLS-/trigger-bug. Direkte prod-queries (read-only,
ghwvkxzhsbbltzfnuhhz) af de 14 aktuelle nul-notifikations-konti viste to helt
andre, ikke-bug-relaterede forklaringer:

1. **9/14 havde aldrig oprettet et hold** (nogle en måned gamle signups,
   `users`-række uden matchende `teams`-række). Kan strukturelt ikke have
   fået nogen notifikation uanset trigger-dækning — næsten alle 47
   notifikationstyper kræver et team-baseret event.
2. **Resten havde reel, tung aktivitet** (op til 120 bud, måneders
   `last_seen`-historik) men stod alligevel med 0 rækker i `notifications`.
   Krydstjek mod `notifications.related_id` for netop de auktioner de bød på
   viste at ANDRE bydere på SAMME auktioner korrekt fik
   `auction_outbid`/`auction_won` — pipelinen virker. Forklaringen er
   `NotificationsPage.jsx`'s "slet læste"/enkelt-sletning
   (`deleteAllRead`/`deleteNotif`), som RLS-policyen "Users can delete own
   notifications" tillader, og som INGEN backend-oprydningsjob nogensinde
   rører. Et bevidst brugervalg, ikke en fejl.

Den REELLE, provable gap var noget helt tredje: en helt ny konto har ingen
notifikation FØR det første tilfældige event (bud/overbudt/løb/board) rammer
den — hvilket for konti oprettet mellem to events kan være dage, og for de
9 team-løse konti er for evigt. Ingen "welcome"/onboarding-notifikation
eksisterede ved holdoprettelse.

## Fix
Ny notifikationstype `welcome`, afsendt fra `PUT /api/teams/my` når
`result.created === true` (backend/routes/api.js). Bygget via
`buildWelcomeNotification()` i backend/lib/notificationService.js, leveret
via den allerede prod-bevist virkende `notifyTeamOwnerBuilt`. Idempotent
constraint-migration: database/2026-08-04-welcome-notification-type.sql.

## Forhindret-fremover
- `backend/lib/notificationTypes.test.js`'s paritetstest (NOTIFICATION_TYPES
  ↔ migrationsfil) fanger automatisk hvis "welcome" nogensinde kommer ud af
  sync mellem kode og constraint.
- Unit-tests i notificationService.test.js dækker payload-formen + hele
  leveringsstien (teamId → user_id-opslag → insert).
- Hvis nogen senere måler "X% har 0 notifikationer" igen: tjek FØRST om det
  er team-løse konti + selv-slettede rækker, før man antager en trigger-/RLS-
  bug. RLS "Users can delete own notifications" gør et snapshot af
  `notifications`-tabellen strukturelt UEGNET som direkte mål for "modtog
  aldrig en notifikation" — man skal enten måle ved leverings-tidspunktet
  (fx et event-log) eller eksplicit udelukke brugere med delete-events.

## Læring
En metrisk der ser ud som "X% har aldrig fået Y" kan lige så godt betyde
"X% har SLETTET Y" som "X% har aldrig MODTAGET Y" — når UI'et tillader
brugeren at rydde sin egen historik, er et nul-snapshot ikke bevis for
nul-levering. Rod-årsag KRÆVER at man krydstjekker mod andre brugeres samme
event (fandt correcte notifikationer til andre bydere på samme auktioner)
før man konkluderer at leveringen er i stykker for netop den bruger.
