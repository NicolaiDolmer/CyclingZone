# NOW.md læst som sandhedskilde gav tre forkerte konklusioner på én aften

**Dato:** 2026-08-28 · **Session:** github-audit + masterplan-planlægning
**Relateret:** #4254 (SSOT-gæld), #4176 (kalender-SSOT), #4364 (NOW/MASTERPLAN på token-lofterne), #4221 (hard rule 30)

## Hvad skete der

Tre gange i samme session drog jeg en forkert konklusion, fordi jeg læste `docs/NOW.md`
som en beskrivelse af tilstanden nu. Ejeren fangede alle tre.

| Påstand | Virkelighed | Hvad NOW.md sagde |
|---|---|---|
| #4103's brudte stage-mix er et overset problem der akkumulerer skade | Parkeret ejer-valg, blokeret af regenererings-forbuddet | Linje 21 sagde det ordret — jeg læste den og konkluderede alligevel modsat |
| #4288 truer sæsonen (tre GT'er umålte) | Båndet er forældet, ikke kalenderen — lille guard-rettelse | Nævnt som "åben", uden årsagen. Årsagen stod i handoff-planen |
| #4000 skal flippes 30/8 og er i konflikt med dagens ejer-beslutning | **Flippet 23/8** med ejer-go i PR #4135, patch note 7.180, spillerbesked samme dag | *"Type-dæmpningen (#4000) flippes med #3449 tidligst 30/8"* — en plan virkeligheden overhalede fem dage før |

Den tredje er den værste: jeg skrev en "åben konflikt" ind i `MASTERPLAN.md` og
præsenterede ejeren for et valg der ikke fandtes. Koden var entydig hele tiden:

```js
export const TYPE_DAMPENING_ENABLED = true; // FLIPPET 23/8: ejer-go sammen med #3449-c
```

## Rodårsag

`NOW.md` har et hårdt loft på ~1.200 tokens og trimmes ved **hver** close-out. Den
indeholder derfor planer som de så ud da linjen blev skrevet — ikke tilstanden nu.
Den er en arbejdsseddel, men bliver læst som en sandhedskilde.

To forstærkende forhold:

1. **Filen er for lille til det den bærer.** Under denne session ramte jeg loftet fem
   gange, og hver eneste trimning afslørede noget forældet: #4269 stod både som næste
   opgave og som udskudt · #4334 stod som ikke-leveret dagen efter merge · "efter fredag"
   stod i en plan skrevet efter fredag. Trimning under pres efterlader halve sandheder.
2. **Beslutninger har intet andet hjem.** Verificeret samme aften:
   `grep -rniE "to regenereringer|regenerering.*forbudt" docs/*.md | grep -v NOW.md` → tomt.
   Samme for tie-break-gaten i `RACE_ENGINE_RULES.md` og katalog-loft-valget i
   `CALENDAR_RULES.md`. Alle tre lever kun i den fil der trimmes hyppigst.

## Fejlklassen er ikke ny

#4254 blev oprettet fordi præcis dette skete 25/8: en session målte at GT'erne kørte
17-18 etaper, læste `CALENDAR_RULES.md:115` ("GT'ens 21 er ejer-bekræftet") og
rapporterede en regression — mens komprimeringen var bevidst (PR #4121). Ejeren måtte rette.

Tre dage senere gentog jeg den tre gange på én aften. Issuet forudsagde fejlen; opgaven
er bare ikke udført endnu.

## Læring

**Et dokument der trimmes er ikke evidens.** Før noget rapporteres som åbent, brudt eller
i konflikt: verificér mod kilden — koden, migrationerne, en merged PR, prod. `NOW.md` og
`MASTERPLAN.md` fortæller hvad vi *planlagde*, ikke hvad der *gælder*.

Konkret tjek, i rækkefølge:
1. `grep` efter konstanten/flaget i `backend/lib/` — koden lyver ikke
2. `gh pr list --state merged --search "<N> in:title"` — repoet skriver issue-nr i PR-titlen
3. `git log origin/main --oneline | grep -i <emne>`
4. Først derefter: hvad siger dokumentet

**Og til #4176:** det er ikke nok at flytte reglerne over i SSOT-filerne. `TYPE_DAMPENING_ENABLED`
var rigtig hele tiden — koden vidste besked, dokumentet gjorde ikke. Vagten skal derfor
sammenligne dokument mod kode, ikke bare samle teksten ét sted. En SSOT der er bagud er
værre end ingen SSOT, fordi den bliver læst som sandhed. Det er #4254's egne ord, og de
holdt igen i dag.
