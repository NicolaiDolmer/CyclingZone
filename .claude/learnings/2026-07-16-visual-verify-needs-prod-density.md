# Visuel verifikation mod tyndt mock-data er et blindspot ved prod-tæthed

**Dato:** 2026-07-16 · **Refs:** #2519 (PR #2533 → hotfix PR #2539)

## Symptom

PR #2533 tilføjede dato-labels pr. løbshoved i sæsonplanlæggeren. Worker
verificerede visuelt i preview-mock + alle 3 Playwright-projekter — alt grønt.
Ejeren åbnede /planner i prod minutter efter deploy: "Jeg kan ikke se nogle
datoer ved løb i toppen."

## Rod-årsag

Labelen var gated på >34px luft til forrige løbskolonne. Canvasset mapper HELE
sæsonen til 618 viewBox-px (~4px/løbsdag), så ved prod-kalenderens tæthed
(løb hver 2-3 dag) fires gap-betingelsen næsten aldrig. Preview-mocken
(`plannerMock.js`) har **7 løb spredt over 5 måneder** — dér var gaps altid
store nok, så både workerens klik-test og snapshots viste labels pænt.

## Læring (generaliserbar)

- **Visuel verifikation af densitets-følsom UI skal ske mod prod-LIGNENDE
  datamængder, ikke fixtures.** Et mock med 7 rækker beviser rendering, ikke
  layoutet ved 60+ rækker. Spørg altid: "hvor mange elementer har PROD på
  denne flade?" (jf. beslægtet mønster: mocket Playwright beviser rendering,
  ikke backend-kontrakten — #1840/#1851).
- **"Vis kun hvor der er plads"-design degenererer til "vis aldrig" når
  pladsen er datastyret.** Garantér i stedet informationen på de elementer
  brugeren aktivt kigger på (valgt/targeted → chip, resten → hover/tooltip)
  — det var hotfixet i PR #2539.
- Konkret modforanstaltning ved planner/kalender-arbejde: mål px-pr-element
  (span/viewBox) med prod-tal FØR en tærskelbaseret synligheds-regel vælges.
