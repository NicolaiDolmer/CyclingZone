# Postmortem · 2026-07-18 · #2617 sigtede på den døde gren — det live hul var naboen

## Hvad skete der?
Issue #2617 (fra adversarisk verify af #2579) flaggede at `executeAutoPurchase`
i squad-enforcement manglede active-stage-race-guarden (#1995). Korrekt fund —
men auto-købs-grenen har været **inert i prod siden 5/6** (trup-minimum = 0).
Den anden gren i SAMME fil, `executeAutoSale` (over-max, kører live ved hver
vindueslukning), havde præcis samme manglende guard og var IKKE i issuet.
Ejer-spørgsmålet "har vi overhovedet brug for squad-enforcement uden
minimumstrup?" udløste verifikationen der fandt det.

## Root cause
Issue-oprettelsen (fra verify-fundet) scopede mekanisk til den funktion
verify-agenten havde kigget på, uden at spørge: (a) kører denne kodesti
overhovedet i prod? (b) har søster-stierne i samme fil samme fejlklasse?
Subagenten implementerede loyalt issuets scope — grænsen blev aldrig udfordret.

## Fix
PR #2633 dækker begge grene: køb parkeres via `pending_team_id` (#2579-mekanik);
salg kan IKKE parkeres (salg til fri agent har intet mål-team-id at parkere mod),
så guarden er kandidat-udvælgelse — løbs-aktive ryttere fredes, næst-nyeste
sælges; er alt låst, udskydes salget til næste vindue (bøden uændret).

## Læring
1. Når et guard-hul findes i én gren af en enforcement-fil: tjek ALLE grene i
   filen for samme klasse (backwards-check-reglen gælder også intra-fil).
2. Prioritér efter om grenen er LIVE i prod, ikke efter hvor fundet blev gjort —
   "inert kodegren" ændrer et fix fra bug til forward-guard.
3. Parkering (`pending_team_id`) kan ikke repræsentere "til fri agent" — vælg
   skip-kandidat-mønstret for exits, parkerings-mønstret for entries.
