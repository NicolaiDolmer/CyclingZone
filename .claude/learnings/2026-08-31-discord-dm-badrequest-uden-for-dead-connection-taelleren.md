# Discord-DM: 400 faldt uden for dead-connection-tælleren (#3483)

**Dato:** 31/8 2026 (natbølge) · **Issue:** #3483 · **Opfølger på:** #3130

## Symptom

En spiller stod som "Discord tilsluttet" i indstillingerne, fik aldrig en DM, og
mistede undervejs en `board_critical`-besked i fuld tavshed. Auto-afkoblingen fra
#3130 rørte ham aldrig: 23 dage efter første observation stod
`discord_dm_failure_count` stadig på 0 og `discord_disconnected_at` på null.
Samme tick loggede digest-kørslen "0 fejl", fordi vagten tæller leverings-forsøg,
ikke droppede modtagere.

## Rod-årsag

`classifyDmFailure` i `backend/lib/discordDmDelivery.js` har to permanente
modtager-grene, ikke én:

- 403 → `recipient-blocked` (spilleren har forladt serveren / lukket DMs)
- 400/404 → `bad-request` (Discord-kode 50033 "Invalid Recipient(s)")

Men begge kaldesteder sammenlignede med den ene streng direkte:

- `discordNotifier.js:473` — `if (result.failure?.reason === "recipient-blocked")`
- `discordDmOutbox.js:142` — samme sammenligning før `onRecipientBlocked?.()`

Da 400/404-grenen blev tilføjet til klassifikationen, fulgte kaldestederne ikke
med. Fejlklassen er altså ikke "nogen glemte et tal", men **duplikeret viden om
en enum spredt over tre filer, hvor kun den ene af dem var kilden**.

400-grenen var den farligste af de to, ikke den mildeste: 403 selvhelbreder,
fordi `clearDmFailureCount` nulstiller tælleren ved næste vellykkede levering,
mens en 400-kobling hverken kunne tælle op eller nulstilles. Den var permanent.

## Fix

Listen over reasons der tæller som en død modtager-kobling bor nu ét sted:
`PERMANENT_RECIPIENT_FAILURE_REASONS` i `discordDmDelivery.js`, læst via
`isPermanentRecipientFailure(reason)`. Begge kaldesteder bruger prædikatet.

`token-invalid` (401) er bevidst holdt udenfor: det er vores egen bot-token, ikke
modtageren. Talte den med, ville ét roteret token afkoble alle spillere i flok
efter tre notifikationer.

Callbacken `onRecipientBlocked` er omdøbt til `onPermanentRecipientFailure`, så
navnet ikke fastholder 403-antagelsen for den næste der læser koden.

## Forward-guard

`backend/lib/discordDeadConnectionCallSites.test.js` scanner `backend/lib` og
`backend/routes` statisk og fejler hvis et kaldested igen sammenligner en
DM-reason med en enkelt hardkodet streng. Regexen er verificeret mod den præcise
gamle linje. Derudover fire regressionstests på drain-stien: 403 og 400 og 404
tæller op, 401 tæller ikke.

## Læring

Når en klassifikations-funktion får en ny gren, er de STEDER der forgrener på
resultatet en del af ændringen. En enum med to medlemmer og tre `=== "streng"`
sammenligninger spredt i koden er en fejl der venter på at ske. Eksportér
prædikatet sammen med klassifikationen, og lad en statisk guard håndhæve at ingen
går uden om det.
