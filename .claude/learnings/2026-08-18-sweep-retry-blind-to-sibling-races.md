# Postmortem · 2026-08-18 · Entry-sweepens uq-retry vidste intet om søsterløb

## Hvad skete der?
18/8 kl. 08:25 afviste #3420-constrainten (no_rider_double_booking) sweepens insert
for 3 (løb, hold)-enheder. Koben Racing var tilmeldt to overlappende løb i samme
pulje ("Famenne-Ardenne" + "Vuelta a Cantabria Menor"), og sweepen forsøgte at
dobbeltbooke ryttere mellem dem. Enhederne stod stuck på 5 entries; timelig retry
healede ikke sig selv. To menneskehold risikerede at stille med 5 ryttere i løb der
starter 19/8 kl. 12 og 20/8. Refs #3906, CYCLINGZONE-2D.

## Root cause
`raceEntryGenerator.js`'s hovedberegning (`assignTeamAcrossRaces`, kaldt fra step 9)
splitter allerede korrekt et holds trup over overlappende løb i SAMME batch, via den
delte busy-tracking. Men når skrivningen for én enhed rammer en
`uq_race_entries_captain/_sprint_captain/_hunter`-kollision (en konkurrerende manuel
gem, samme TOCTOU-klasse som #2436), kalder retry-funktionen
`regenerateUnitAfterConcurrentManualSave` `assignTeamAcrossRaces` med KUN dét ene
løb i `races`, uden hukommelse om holdets andre, tidsoverlappende løb i samme
pulje/batch, hverken allerede committede (denne kørsel eller en tidligere) eller kun
stagede (beregnet denne kørsel, endnu ikke skrevet). Retry'en kunne derfor uvidende
genvælge en rytter der allerede kørte søsterløbet, ramt af #3420's DB-backstop som et
senere insert-forsøg der selv fejlede: signalet blev captured (failed_units), men
enheden forblev underbemandet.

## Fix
`backend/lib/raceEntryGenerator.js`: ny `siblingLockedWindows()`-helper i
`regenerateUnitAfterConcurrentManualSave` bygger et komplet locked-windows-billede
for enhedens søsterløb, filtreret til dem hvis vindue rent faktisk overlapper: (a)
holdets allerede committede entries i andre løb (frisk DB-scan, mirror
`loadTeamBindingContext`/`raceBinding.js`), og (b) holdets andre stagede (beregnet
denne kørsel, endnu ikke skrevet) enheder for samme hold. Punkt (b) dækker den
rækkefølge hvor søsterløbet endnu ikke er skrevet på retry-tidspunktet. Ryttere i
disse vinduer ekskluderes fra kandidatlisten FØR autopick vælger, så truppen
splittes i stedet for at gense en allerede-bundet rytter. Er roster for lille til at
dække begge, giver autopick naturligt færre picks: partiel fyldning, ikke crash.
Outcome logges (`console.warn`) for både sibling-eksklusion og partiel fyldning.

## Forhindret-fremover
To nye regressionstests i `raceEntryGenerator.test.js` replikerer Koben-scenariet
(ét hold, to Class2-løb med overlappende game_day-vindue, uq-kollision på det senere
løb). Test-mocken (`makeSupabase`) fik en `enforceDayInvariant`-mulighed der
simulerer #3420's DB-backstop oven på den eksisterende PK/uq-håndhævelse, hvilket
beviser at sweepen nu ALDRIG *forsøger* dobbeltbookingen, ikke bare at den ikke
crasher. Verificeret ved at stashe fixet: begge nye tests fejlede da med PRÆCIS den
rapporterede fejlbesked ("rider-day invariant (#3420) rejected... the sweep's own
binding assignment missed a double-booking").

## Læring
En "sweep retryer hvert løb med fuld binding-kontekst" er ikke det samme som "alle
retry-stier har fuld binding-kontekst": uq_race_entries_*-retry'en var en separat,
smallere kodesti (single-race recompute) der ikke arvede hovedberegningens
binding-bevidsthed. Enhver retry/regenerate-funktion der genkører
`assignTeamAcrossRaces` for et delmængde af et holds løb skal eksplicit genopbygge
`lockedWindows` fra BÅDE DB'ens nuværende tilstand OG denne kørsels egne stagede
(endnu ikke skrevne) søsterenheder, ellers er den blind for præcis den invariant den
selv skal overholde.
