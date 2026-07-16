# Stale CI-guard krævede refresh af et snapshot der ikke længere findes

**Dato:** 2026-07-16 · **Fix:** betinget guard i `scripts/check-patch-notes-version.js`

## Hvad skete

To ændringer, hver korrekt isoleret, blev tilsammen inkonsistente:

1. `26f2043b` (#1878, 25/6): required guard — ny top-PatchNotes-version kræver
   refreshede `core-smoke.spec.js-snapshots/patch-notes-*.png` ELLER opt-out-token
   i en commit-besked.
2. `2510dce1` (#2211, 5/7): `/patch-notes` fik `skipSnapshot: true` og alle
   patch-notes-PNG'er blev slettet — pixel-snapshottet var by-design ustabilt.

Efter (2) kunne guardens snapshot-gren ALDRIG opfyldes: der var intet at
refreshe. Hver eneste version-bump-PR blev tvunget til at bære opt-out-token'en
som kult-ritual, selvom risikoen guarden beskyttede mod (snapshot-drift) ikke
længere eksisterede. Ingen fejl blev rejst — token'en "virkede" jo.

## Rod-årsag

Guarden hardcodede en antagelse om testmekanismen (at `/patch-notes`
pixel-snapshottes) i stedet for at læse den. #2211 fjernede mekanismen uden at
kende/opdatere guarden — der var ingen kobling mellem de to filer.

## Fix

Guarden læser nu `core-smoke.spec.js` og kræver kun snapshot-refresh hvis
`/patch-notes`-entry'et faktisk snapshottes (ikke `skipSnapshot: true`).
Genaktiveres snapshottet, re-armeres kravet automatisk uden kodeændring.
Verificeret begge veje ved simuleret version-bump-commit + midlertidig
spec-ændring.

## Forward-guard / læring

- **En guard der refererer en anden fils mekanisme skal LÆSE den fil, ikke
  antage den.** Hardcodede antagelser på tværs af filer drifter stille.
- **Et opt-out-token der pludselig kræves i 100% af tilfældene er et symptom** —
  når escape-hatch bliver hovedvej, er guarden stale. Undrer du dig over hvorfor
  et ritual er nødvendigt: tjek om forudsætningen stadig findes.
- Bonus-fund under verifikation: token-matchen er en substring-søgning over hele
  PR'ens commit-log, så en commit-besked der CITERER token'en (fx i en
  forklaring) opter hele PR'en ud. Citér den aldrig bogstaveligt i commits.
