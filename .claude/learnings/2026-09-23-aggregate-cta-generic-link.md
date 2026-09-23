# Samlet indbakkelinje arvede det generiske link, ikke deep-linket (#5417)

## Symptom
En spiller (telefon, 19/9) kunne ikke komme fra indbakken til et afviklet løbs resultat efter #5384. "Vis detaljer" på den samlede løbslinje viste ikke løbet; han måtte gå via Race Centre.

## Rod-årsag
Knappen i bunden af en udfoldet aggregat-linje tog destinationen direkte fra `TYPE_CONFIG[entry.type].link`. For `race_result`/`stage_result` er det den generiske fallback `/resultater` (resultat-hubben). Den enkelte besked har altid gået til `/races/:raceId` via `resolveNotificationLink` (#1952/#3243), men aggregat-grenen kaldte aldrig den logik. Før #5384 var løbsbeskeder aldrig i en bøtte, så hullet var usynligt: auktions-bøtterne har ikke noget mere specifikt link end fallbacken.

Ikke mobil-specifikt: desktop landede samme sted. Spilleren havde kun tjekket telefonen.

## Rettelse
`resolveAggregateLink` (`frontend/src/components/notifications/aggregateLink.ts`): bøtten `race_completed` går til `/races/<related_id>` (bøttens nøgle er løbets id); alle andre bøtter beholder fallbacken. NotificationsPage bruger den til både destination og knap-tekst.

## Læring
Når en ny type lægges i en eksisterende aggregat-bøtte, skal aggregatets klik-destination tjekkes mod den enkelte besked-types destination. En bøtte der kun bruger `TYPE_CONFIG.link` taber hvert deep-link som `resolveNotificationLink` giver den enkelte besked.

## Forward-guard
- `aggregateLink.test.ts`: race_completed-bøtter (resultat-, etape- og kun-milepæl-ansigt) går til løbssiden; auktions-bøtter er uændrede; kildetekst-vagt på at NotificationsPage ikke navigerer til `config.link` direkte.
- `frontend/tests/e2e/inbox-race-view-details.spec.ts`: indbakke til Vis detaljer til løbssiden med eget hold synligt, i alle tre Playwright-projekter.
