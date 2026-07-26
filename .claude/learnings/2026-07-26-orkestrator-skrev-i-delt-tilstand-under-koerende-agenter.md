# Orkestratoren skrev i delt tilstand mens agenter kørte (bølge 4, 25-26/7)

## Hvad skete der

Lørdagsbølge 4 kørte 10-13 parallelle agenter og leverede 31 merged PR'er. Men de sidste to timer gik med at rydde op efter fejl **orkestratoren selv** havde skabt, ikke efter agenternes arbejde.

Fem fejl, alle med samme form:

1. **Commit til `main` mens en PR var åben mod den.** Close-out-commit i `docs/NOW.md` skabte den konflikt der blokerede patch notes 7.64.
2. **Slettede 51 worktrees mens en agent arbejdede i én af dem.** Kørt som baggrundskommando for at "afslutte pænt". Patch-notes-agentens mappe forsvandt under den; dens `git rev-parse --show-toplevel` begyndte stille at pege på hoved-checkoutet. Agenten fangede det selv — ellers kunne den have committet i det forkerte repo.
3. **Antog `league_division_id` var division.** Det er pulje-id. Førte til den forkerte konklusion at rytter-peaks kunne flyttes på tværs af divisioner ved sæsonskiftet. Ejeren fangede den: ingen løbsnavne deles på tværs af tiers (D1 25 · D2 27 · D3 46 · D4 24 løb, 0 overlap). Samme forveksling er dokumenteret i MASTERPLAN fra en tidligere audit.
4. **Brugte transcript-filstørrelse som mål for agent-fremdrift.** 0 bytes blev læst som "har aldrig produceret noget", men den pågældende agent havde leveret en komplet PR. Fejlmeldte arbejde som resultatløst.
5. **Lod en agent køre halvanden time på en statuskode alene**, uden at kræve livstegn, og gentog "den kører" i stedet for at hente bevis.

## Rodårsag

Fælles nævner for alle fem: **skrivning til eller konklusion om delt tilstand uden først at tjekke hvem eller hvad der ellers rørte den.**

Den underliggende årsag er skalaen. Med 10-13 samtidige spor kunne afhængighederne ikke holdes i hovedet, og verifikation blev erstattet af antagelser. Optimeringen for gennemløb blev betalt tilbage med renter.

## Regler fremover

**Maks 4-5 parallelle agent-spor.** Over det koster fejlene mere end parallelismen sparer. Antallet er en orkestrator-beslutning, ikke noget der skal eskalere fordi der er flere issues tilbage.

**Ingen skrivning til delt tilstand uden et tjek først.** Gælder `main`, worktrees, og filer flere agenter rører (`docs/NOW.md`, `frontend/src/data/patchNotes.js`, `package.json`, `.github/workflows/ci.yml`, locale-JSON).

**Oprydning er den allersidste handling.** Aldrig worktree-sletning, branch-prune eller preview-stop mens en agent kan være i gang. Stop alt, verificér at alt er stoppet, ryd derefter op.

**Patch notes samles umiddelbart efter bølgen er merget**, mens `main` står stille. Ikke som sidste punkt under nedlukning, hvor orkestratorens egne close-out-commits garanterer konflikt.

**Datamodel-antagelser koster ét kald at bekræfte.** Særligt id-kolonner hvis navn antyder én ting (`league_division_id` → pulje, ikke division).

**Agent-fremdrift måles på om en besked sættes i kø eller genoptager en stoppet agent** — ikke på transcript-filstørrelse, som er upålidelig. Kræv livstegn efter ~20 minutter på tunge opgaver.

## Præcisering af instruks der gik galt

Agenterne fik "rør ikke `frontend/src/pages/PatchNotesPage.jsx`". Dataene ligger i `frontend/src/data/patchNotes.js`. To agenter skrev derfor i god tro i datafilen — én under version **7.62**, to versioner tilbage, hvor ingen ville have læst det. Fred filen der faktisk indeholder indholdet, ikke den der render det.

## Hvad der virkede, og bør gentages

- **Negativ kontrol på hver ny guard.** Introducér fejlen, se guarden fange den, fjern den igen. Afdækkede at `financeTypeConstraintGuard` selv havde en drevet fil-liste, og at invariant-checket paginerede uden `ORDER BY` (talte 11 hvor SQL sagde 14).
- **Krav om at agenter måler mod prod før de bygger.** Tre issue-præmisser holdt ikke: 96 % gråt var 90,8 %, "akademiet tømmes" var falsk, og "5 ting tabes ved skiftet" var færre.
- **At splitte en PR når den blander risikoprofiler.** #3000's guard (nul runtime-effekt) kunne merges straks; de 8 motor-rettelser ventede på ejer-beslutning.

Refs #2974, #3018, #3025
