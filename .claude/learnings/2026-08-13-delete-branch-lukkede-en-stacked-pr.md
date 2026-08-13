# `--delete-branch` lukkede en stacked PR uden varsel

**Dato:** 2026-08-13 · **Ramte:** PR #3674 · **Begået af:** orkestrator-sessionen (mig), ikke den session der ejede arbejdet

## Hvad skete der

PR #3672 blev merged med `gh pr merge 3672 --squash --delete-branch`. To sekunder senere var PR #3674 lukket.

```
#3672 merged  17:04:38
#3674 lukket  17:04:40
```

#3674 var **stacked**: den pegede på `fix/3667-transparens-tre-usande-tekster` som base, ikke på `main`. Da `--delete-branch` slettede base-branchen, lukkede GitHub automatisk enhver PR der pegede på den.

Det kunne ikke rulles tilbage. GitHub afviser både at skifte base og at genåbne en PR hvis dens base-branch er væk:

```
GraphQL: Cannot change the base branch of a closed pull request.
GraphQL: Could not open the pull request.
```

## Hvorfor det var slemt, og hvorfor det ikke var værre

**Slemt:** den ejende session havde to commits på branchen, herunder e2e-dækning af en flade der slet ikke havde nogen. Den var midt i sit arbejde og fik en lukket PR uden forklaring. Genopretningen kostede en rebase og en ny PR (#3676).

**Ikke værre:** ingen kode gik tabt. Kun *head*-branchen bærer arbejdet, og den blev ikke rørt — `--delete-branch` sletter base'en. Alt lå på origin hele tiden.

## Rod-årsag

To ting, hvoraf kun den ene er GitHub's:

1. **`--delete-branch` er destruktivt for tredjepart.** Flaget lyder som oprydning af noget der er brugt op. Det er det også — medmindre nogen har bygget oven på det.
2. **Jeg vidste at de to PR'er hang sammen og tjekkede alligevel ikke.** Jeg havde selv advaret om at #3672 og #3674 delte tre filer, og selv anbefalet rækkefølgen "merge #3672 først, rebase #3674 bagefter". Jeg tænkte på *fil*-koblingen og overså *branch*-koblingen. Advarslen var på plads; kontrollen var ikke.

## Læring

**Før `--delete-branch`: tjek om nogen peger på branchen.**

```bash
gh pr list --state open --json number,baseRefName \
  --jq '.[]|select(.baseRefName!="main")|"\(.number) → \(.baseRefName)"'
```

Er der en stacked PR: merge **uden** `--delete-branch`. GitHub retargeter så dependenten til den merged base's egen base, og branchen kan slettes bagefter. Det blev verificeret samme dag: #3676 blev merget uden flaget, og #3675 retargetede korrekt til `main` i stedet for at blive lukket.

**Bredere:** et flag der er sikkert i en enkelt-PR-verden kan være destruktivt i en verden med flere samtidige sessioner. Når flere agenter arbejder i samme repo, er "ryd op efter dig" ikke længere en lokal handling. Samme familie som [delt checkout-branchen](2026-06-13-verify-branch-in-commit-chain.md): antag ikke at du er alene om ressourcen.

**Og:** da fejlen var sket, var det rigtige at sige det med det samme og præcist — hvilken kommando, hvilket tidsstempel, hvad der var tabt (intet), og hvad vejen tilbage var. Den ejende session kunne fortsætte uden at bruge tid på at diagnosticere noget den ikke havde forårsaget.

## Forward-guard

Tilføjet som tjek i orkestrator-rutinen. Ikke automatiserbart i CI — det er en handling et menneske eller en agent tager mod GitHub's API, ikke noget der passerer en pipeline. Kontrollen er ét `gh pr list`-kald før merge.
