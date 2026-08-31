# Migrations-header beskrev en fil der ikke fandtes

**Dato:** 2026-08-30
**Issue:** #4243 (rod-årsag #4217, #4231-slægtning)

## Rod-årsag

`database/2026-08-25-4217-spaend-binding.sql` blev splittet i to filer under
implementeringen: selve funktions-ændringen (`spaend-binding.sql`) og den
destruktive oprydning af overlappende udtagelser
(`ryd-overlappende-udtagelser.sql`). Headeren i `spaend-binding.sql` fulgte ikke
med i splittet — den blev stående med et helt afsnit om "KONFLIKT-RYDNING" og
`v_apply`-dry-run, selvom den funktionalitet nu boede i companion-filen. Filens
krop var i virkeligheden kun `create or replace function` + `comment on
function` — intet delete, intet `v_apply`.

## Konsekvens

Ved anvendelsen 25/8 læste operatøren headeren og forventede at oprydning +
genopbygning skete i ét hug. Det gjorde den ikke: funktionen blev erstattet,
men eksisterende `race_entry_days`-rækker for allerede indtastede udtagelser
blev ikke genopbygget (CREATE OR REPLACE ændrer kun definitionen — den kalder
ikke funktionen). Målt bagefter: 20 dag-rækker manglede på 3 løb, samme bug
migrationen skulle lukke. Fanget kun fordi der blev målt efter i stedet for at
stole på headeren.

## Læring

En migrations-header er den eneste dokumentation et menneske læser FØR det
kører noget mod prod. Når et script splittes i flere filer:

1. **Headeren flytter med funktionaliteten, eller den skal omskrives.** Kopiér
   aldrig en header videre "for kontekstens skyld" uden at fjerne de afsnit
   der nu beskriver companion-filens ansvar.
2. **Kryds-referér eksplicit.** Hver fil i et flerdelt migrations-sæt skal sige
   hvad den IKKE gør og pege på hvilken fil der gør det — i begge retninger.
3. **CREATE OR REPLACE er ikke det samme som et backfill.** Hvis en funktion
   ændrer output-kontrakten, skal headeren sige om eksisterende rækker fra FØR
   ændringen genopbygges automatisk eller kræver et separat kald — ellers
   antager operatøren automatisk backfill.
4. **Samme fejlklasse som `bundle-budget.json`'s forældede `_note` (#4231):**
   et dokument der beskriver en tilstand der ikke længere er sand, er værre
   end ingen dokumentation — det får operatøren til at springe
   efterverifikationen over.

## Ikke gjort i denne omgang (docs-only fix)

Issue #4243 foreslog også (a) et backfill-trin indbygget i selve migrationen
og (b) en preflight-vagt der fejler hvis en migrations-header nævner `v_apply`
eller `DRY-RUN` uden at kroppen indeholder ordet. Begge er kode-ændringer i en
allerede applied prod-migration/CI-pipeline og hører til et separat issue —
denne session rettede kun kommentar-teksten.
