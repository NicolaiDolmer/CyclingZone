# Postmortem · 2026-08-31 · Markeringen laa på rækken og blev malet under cellerne

## Hvad skete der?

`#2795` blev shippet som "egne ryttere fremhæves i ranglister og startlister" (PR #4403) og markeret `claude:done`. Ejeren så et skærmbillede og sagde at markeringen var svær at få øje på. Ved undersøgelsen viste den sig ikke at være svag, men reelt usynlig: funktionen havde aldrig virket på nogen af de flader den blev leveret til.

## Root cause

Markeringen var `inset 0 0 0 1.5px rgb(var(--me-ring) / 0.5)` sat som inline `boxShadow` på `<tr>`. To uafhængige forhold gjorde den usynlig, og ingen af dem handler om farve eller alpha:

1. `box-shadow` på en `<tr>` males ikke pålideligt i en `border-collapse`-tabel.
2. `.sticky-name-cell` (`frontend/src/index.css`) sætter `background-color: var(--bg-card)` og maler sin egen ugennemsigtige baggrund præcis dér hvor venstre kant skulle stå.

Diagnosen blev bekræftet empirisk før fixet: den samme ring med alpha fjernet var stadig usynlig. Først da markeringen blev flyttet til `<td>`, kunne den ses.

Samme defekt fandtes to steder mere med samme teknik: op-/nedrykningsbjælkerne på `SeasonEndPage` og sammenlign-valgt-ringen på `StandingsPage`. Begge var lige så usynlige, og ingen havde opdaget det.

Koden vidste faktisk halvdelen i forvejen. `StandingsPage.jsx` har en kommentar der noterer at zone-tinten "sidder på `<td>` og maler derfor OVEN PÅ `<tr>`'ens baggrund" — men me-ringen blev alligevel lagt på rækken.

## Fix

PR #4420 (merged 31/8). Markeringen flyttet til celle-niveau som klasser i `frontend/src/index.css`: `.cz-me`, `.cz-me-bar`, `.cz-me-block`, `.cz-zone-up`, `.cz-zone-down`, `.cz-compare`, plus kombinations-regler når zone og "dig" mødes på samme række. Alle otte kaldesteder konverteret, så udtrykket er ens på rangliste, stilling, global rank, dashboard, sæson-afslutning, løbsdetalje og startlister.

## Forhindret-fremover

`frontend/tests/e2e/me-marker-cells.spec.js` låser **to** ting:

1. rækken for eget hold bærer `.cz-me` (og en fremmed række gør ikke)
2. første celles **beregnede** `box-shadow` er ikke `none`

Punkt 2 er hele pointen. En test der kun havde tjekket klassenavnet ville have været grøn i hele den periode hvor funktionen ikke virkede.

## Læring

**En test der kun tjekker at koden siger det rigtige, beviser ikke at brugeren ser det.** Klassenavn, prop eller inline style kan alle være korrekte samtidig med at resultatet aldrig når skærmen. Ved visuelle features skal mindst én assertion læse `getComputedStyle` eller et rendret pixel-resultat.

Tre følgeregler:

- **Når ejeren siger "den er svær at se", så mistro først at den virker.** Den hurtige konklusion var "skru farven op". Den rigtige var at markeringen aldrig blev tegnet. At bevise det tog ét ekstra forsøg: samme ring uden alpha, stadig usynlig.
- **Grep efter teknikken, ikke efter symptomet.** Da rod-årsagen var kendt, afslørede en søgning efter `inset ... på <tr>` to andre markeringer med samme fejl. Var der kun rettet den ene, ville to usynlige signaler være blevet stående.
- **En kommentar der beskriver en faldgrube er ikke en vagt.** `StandingsPage` beskrev præcis mekanismen, og fejlen blev lavet i samme fil alligevel.
