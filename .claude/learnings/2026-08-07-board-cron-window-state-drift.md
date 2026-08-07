# Postmortem · 2026-08-07 · Bestyrelses-crons reelt døde: window-felt skrevet ét sted, læst som global gate to steder

## Hvad skete der?
`boardAutoAccept.js` (T-3/T-1-reminders + auto-accept) og `boardMidSeason.js`
(mid-season "Skal handles"-banner) gatede begge HELE deres kørsel på
`transfer_windows.board_negotiation_state` — en global "fase-lås" der ifølge
design skulle gennemløbe `locked → pending_5yr → pending_3yr → pending_1yr →
complete`. I praksis skriver koden kun ÉT trin: `boardSequentialNegotiation.js`
sætter `pending_5yr`, kun når sæson 1 slutter. Ingen kodesti sætter nogensinde
`pending_3yr`, `pending_1yr` eller `complete`. Værre: `insertTransferWindowIfMissing`
(`seasonTransition.js`) opretter ved HVERT sæsonskifte en ny `transfer_windows`-
række uden feltet, som falder tilbage til DB-default `locked`. Prod-evidens
7/8: S2-vinduet (nyeste) `locked`, S1-vinduet `pending_5yr`.

Konsekvens: `boardAutoAccept.js` returnerede tidligt for ALLE hold fra 26/7
(ingen T-3/T-1-reminders, ingen auto-accept). `boardMidSeason.js` krævede
`state === 'complete'`, en værdi ingen kodesti nogensinde sætter — cronen
havde ALDRIG kørt i prod, nogensinde.

## Root cause
Delt state, én skriver (kun ét trin af fem), flere læsere der antog fuld
gennemløb. Samme fejlklasse som `.claude/learnings/2026-07-16-board-auto-accept-unit-mismatch.md`
og fan-in-drift-serien (#2469/#2592/#2596): et globalt felt der IKKE
vedligeholdes af de kodesti'er der senere afhænger af det.

## Fix
Droppede window-feltet som sandhedskilde i begge crons (#3502, anbefalet
retning i issuet). Feltet står stadig i DB og skrives stadig af
`boardSequentialNegotiation.js` (ingen migration, ingen writer-ændring) — men
er pensioneret i LÆSERNE:

- `boardMidSeason.js`: den globale gate var allerede redundant — det
  eksisterende per-hold-tjek (`board_profiles.plan_type='1yr' AND
  negotiation_status='completed'`) er i sig selv et præcist signal. Fjernede
  bare den globale gate.
- `boardAutoAccept.js`: den globale gate beskyttede reelt mod at et
  sæson-1-baseline-hold blev fejlagtigt behandlet som "pending" (siden
  `findPendingPlanType` behandler en manglende board-række som implicit
  pending). Erstattet med et per-hold-signal (`hasStartedNegotiation`):
  `team.season_1_identity_basis` sat (skrives synkront som trin 1 i
  `startSequentialNegotiation` for S1-kohorten, og af `ensureSeasonIdentityBasis`
  ved holddannelse for S2+-nykommere) ELLER en eksisterende ikke-baseline
  board-række.

## Forhindret-fremover
`backend/lib/boardCronSeasonTransitionGuard.test.js` (ny fil — grep i
`seasonTransition.test.js` gav 0 hits før dette) kæder de FAKTISKE
sæson-slut/sæsonskifte-funktioner (`startSequentialNegotiation`,
`insertTransferWindowIfMissing`) sammen med begge crons og beviser at de
stadig virker selvom `transfer_windows` drifter til `locked` — nøjagtig
#3502-mekanismen. `boardMidSeason.test.js` har en tilsvarende dedikeret
forward-guard-test. Begge fejler hvis en fremtidig ændring genindfører en
global window-state-gate.

## Læring
Et globalt fase-felt der kun skrives af ÉT trin i en flertrins-sekvens er ikke
en pålidelig fase-lås for resten af sekvensen — særligt når en helt anden
kodesti (her: sæsonskifte) rutinemæssigt opretter FRISKE rækker i samme tabel
uden feltet. Enhver læser der antager fuld gennemløb bør i stedet aflæse
behovet direkte fra den tabel der reelt bærer sandheden (her: `board_profiles`)
frem for et separat "status"-felt et andet sted.
