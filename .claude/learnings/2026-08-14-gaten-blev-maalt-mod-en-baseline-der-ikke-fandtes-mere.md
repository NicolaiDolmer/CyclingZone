# En gate er kun så sand som den baseline den sammenligner med

**Dato:** 2026-08-14 · **Hvor:** #3741 (trin 4+5), `backend/scripts/rytterudviklingScorecard.js`

## Hvad skete der

Scorecardets G2 ("ankeret holder") sammenligner kandidat-modellen med "i dag"-modellen, og
"i dag" leveres som en `--baseline`-sti til et andet worktree. Worktreen `ref-3709-baseline` stod
på `d5477c67`. Trin 3 (håndværkstaget) blev merget til main **efter** den commit.

To sessioner i træk traf en beslutning på gatens output uden at tjekke hvad baselinen stod på:

1. Første måling: G2 rød, 29 → 27. Ejeren accepterede "alle bliver ~2 point dårligere".
2. Rettelsen samme aften: gaten målte `spids` mod `spids` i stedet for bedste opnåelige pr. rytter.
   Rettet til 29 → 30, G2 grøn, konklusionen blev "han får indflydelsen gratis".
3. Ved merge-vurderingen: samme script, samme seed, men baseline = nuværende main. **31 → 30.**
   G2 rød igen. Trin 3 havde hævet dagens niveau i mellemtiden.

Beslutning 17 blev altså truffet to gange på tal der ikke holdt, og begge gange var koden korrekt.

## Rod-årsagen

Baselinen er et **argument**, ikke en del af repoet. Den kan blive gammel uden at noget fejler, og
outputtet ser lige så autoritativt ud uanset hvad den peger på. En stacked PR gør det værre: mens
PR'en ligger åben, merges dens egne forgængere, så "i dag" bevæger sig under den.

## Hvad der skal gøres anderledes

- **Print baselinens commit i rapporten.** Scriptet kender stien; `git -C <sti> rev-parse HEAD`
  koster to linjer, og så kan ingen læse et scorecard uden at se hvad det blev målt imod.
- **Advar hvis baselinen ikke er `origin/main`.** En gate der skal afgøre om noget må merges til
  main, skal måle mod main.
- **Kør gates om efter rebase, ikke kun efter kodeændring.** Rebasen ændrer ikke diffen, men den
  ændrer sammenligningsgrundlaget, og det er lige så meget en ny måling.

## Hvad der virkede

At måle igen i stedet for at læse PR-beskrivelsen. Begge de fund PR'en ikke selv kendte kom af at
køre dens egne værktøjer forfra på den base den skulle merges ind i.
