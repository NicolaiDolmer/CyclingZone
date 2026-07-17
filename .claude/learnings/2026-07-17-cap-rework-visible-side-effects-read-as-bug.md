# Postmortem · 2026-07-17 · Loft-omlægning læstes som "træningen er død" (#2578)

## Hvad skete der?
Morgenen efter #2471/#2472 (livstidsloft genberegnet pr. tick + alders-taper)
rapporterede @friisisch at "en masse ryttere har 0 progress på Hard/Normal/Easy"
og at den viste skill på trænings-oversigten skiftede. Det lignede en regression
fra nattens bølge.

## Root cause
Ingen motor-fejl. To synlige bivirkninger uden UI-kommunikation:
1. Loft-genberegningen åbnede mange fejl-frosne evner → gennembruds-bølge
   (hard-snit 0,64→2,25 point/dag; 66 % af hard-rækker med +point). Progress-
   barer wrapper til ~0 efter +1, og `focusProgress()` vælger fokus-evnen med
   højeste bar → både "0 %" og skiftende vist skill. Spillerne FIK point.
2. Ryttere på loftet (inkl. 29+ via ejer-valgt taper) står permanent stille —
   loftet var 100 % skjult i UI, så det lignede en bug.

## Fix
PR #2586: server-beregnet `capped`-map (kun ability-nøgler, aldrig tal — #1162),
"Fully developed in this focus"-markering i stedet for død bar, "+N today"-badge
efter gennembrud, help-tekst (en+da), patch notes v7.13.

## Læring
Når en balance-/motor-ændring bevidst ændrer hvad spillerne SER (frys, bursts,
nye plateauer), skal UI-kommunikationen shippes i SAMME bølge — ellers læses den
korrekte adfærd som regression og koster en bug-triage-cyklus. Sim-gaten fangede
tallene (3.585 nye frosne rækker stod i PR-beskrivelsen!) men ingen spurgte
"hvordan ser det ud for spilleren i morgen tidlig?". Tilføj det spørgsmål til
balance-PR'ers scorecard.

Diagnose-metode der virkede: aggregér `training_day_runs.report` over 3 dage
(gains/score pr. intensitet + frosne pr. aldersbånd) FØR kode-læsning af
symptomet — skelner "motor død" fra "visning misforstået" på ét query.
