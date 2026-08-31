# Session-prompt: Planner-forbedringer (matrix-hotfix + tidsakse + kø)

> Skrevet 31/8 2026 sent, umiddelbart efter at sæsonmatrixen (PR #4323) gik live og fik sin første
> spillerfeedback (friisisch + ejeren, Discord 22:08-22:22). Kopiér alt under linjen ind som første besked.
> Kontekst: matrixen ER live og blev godt modtaget ("rigtigt godt udgangspunkt"), men live-testen fandt
> én game-breaking fejl og ét forvirrende akse-layout. Ejeren tog 5 tester-forslag med i reworken;
> 2 større er allerede issues (#4530, #4531).

---

Du forbedrer sæsonplanneren i CyclingZone. Svar på dansk; spillervendt copy EN først, DA under (æøå).
Læs `docs/NOW.md` først — viser "🤖 Working agent" en anden aktiv session → STOP og spørg.

## Fase 0 — genverificér (5 min)

1. `gh issue view 4534 --json state` og `gh issue view 4535 --json state` — byg kun på det åbne.
2. Tjek at PR #4533 (#4485-kodefixet) er MERGED; er den ikke, er det første punkt.
3. Nattens kalender-invariant-audit (kørte 05:50 dansk tid) SKAL være grøn — det er #4507's endelige bevis.
   `gh run list --workflow calendar-invariant-audit.yml --limit 1`. Rød → diagnosticér før alt andet.

## Opgave 1 — #4534 HOTFIX (kritisk, FØRST)

Matrixens gem-vagt er asymmetrisk: tilføjelse til startede løb blokeres ("This race has started, so the
lineup is locked"), men FJERNELSE går igennem. friisisch fjernede sin kaptajn (Vidal) fra en igangværende
Giro — rytteren forsvandt fra løbet, kan ikke gen-tilføjes, og blev straks tilgængelig for andre løb.
Ejerens retning (Discord 22:21): man skal ikke kunne udgå frivilligt endnu; fjernelse blokeres som tilføjelse.

1. `PUT /races/selection/bulk` (backend/routes/api.js, #4316): afvis removals på startede løb, samme
   fejlklasse som adds. Grep FØRST efter legitime fjernelses-stier (admin?) før du strammer.
2. Frontend: `buildSaveError`-kataloget (frontend/src/lib/seasonMatrix.js) skal kende den nye årsag,
   så cellen forklarer sig selv.
3. Regressionstests begge retninger. Patch note (EN+DA).
4. **Datareparation (ejer-gated):** Vidal skal tilbage i Giro della Penisola. Find rækken/sletningen i prod
   (SELECT-only; friisisch' hold, Giroen, fjernet ~31/8 22:18), vis ejeren præcis hvad der genindsættes,
   og kør FØRST efter hans GO. Tjek også om andre spillere har ramt hullet siden launch
   (removals på startede løb siden 31/8 ~22:00).

## Opgave 2 — #4535 tidsaksen (mockup FØRST)

Datoer/løbsdage gentages pr. løbsgruppe efter akse-konverteringen, og overlap kan læse som ikke-overlap.
Akse-BESLUTNINGEN (én kolonne pr. løbsdag pr. løb, ejer-låst 31/8) står fast — det er præsentationen af
den delte tid der skal løses. Kandidater står i issuet (fælles dato-række øverst med lodret alignment er
favoritten). **Byg show_widget-mockup og få ejer-go FØR du rører fladen** (UI-reglen, ufravigelig).
Læs `docs/design/PAGE_TEMPLATES.md` før du bygger.

## Opgave 3 — kø, hvis der er slots

- **#4530** "Assign form peak here" i celle-popoveren (friisisch' forslag, allerede scopet)
- Rest af **#4522**: kortlæg ALLE sider hvor assistenten kan handle + start/styr-knapper dér
- **#4146 mulighed A** (teknisk, intet ejer-valg nødvendigt): omdøb `DIVISION_SQUAD_LIMITS` →
  `DIVISION_ROSTER_TARGETS` + docs, jf. beslutningsoplægget i issuet. Balance-delen røres IKKE.
- **#4531** (drag'n'drop) er efter S3 — rør den ikke.

## Ejer-beslutninger der også venter (stil dem enkeltvist, med kontekst i kortet)

Parkeret 31/8 til "i aften/i morgen": **#4495** (7 ryttere fanget i akademiet — minimal reparation, SQL
vises først) · **PR #4388** (#4376 sponsor-base, deadline FØR 27/9) · **#3494** (sponsor-målet, minimal =
pensionér sponsor_growth). Plus **#4485 genberegning**: review-grundlaget ligger i
`docs/audits/4485-genberegning-foreslag.md` (64 rækker, 2 forkerte trøje-vindere, anbefaling A:
efterbetal uden clawback).

## Guardrails (uændrede fra 31/8-sessionen)

Ingen prod-mutation uden ejer-GO på præcis det skridt · UI merges aldrig uden ejerens visuelle go ·
migrationsfiler i `database/2026-*.sql` AUTO-KØRES ved merge (manuel-only → `database/manual/`) ·
commit kun bag `guard-commit-branch.sh`, bare gh/git-kald, `git --no-pager` · preflight + `npm run lint`
ved frontend; orkestrator ejer e2e-slottet · patch note ved enhver spillervendt ændring ·
verificér FØR claim (tilsigtet ændring ≠ regression) · dublet-søg før issue-create ·
close-out: NOW.md (~1.200 tok) + MASTERPLAN + token-hygiejne-scriptet.
