# Loop B · Pre-push hook for PatchNotes-disciplin in PowerShell

# Selve note-dataene bor i frontend/src/data/patchNotes.js (flyttet 20/6, #4308-refutation
# fandt at hooken stadig kun matchede den gamle renderer-fil PatchNotesPage.jsx).
$frontendTouched = git diff origin/main..HEAD --name-only | Select-String -Pattern "^frontend/src/" | Select-String -Pattern "PatchNotesPage.jsx|data/patchNotes.js" -NotMatch
$patchNotesTouched = git diff origin/main..HEAD --name-only | Select-String -Pattern "PatchNotesPage.jsx|data/patchNotes.js"

if ($frontendTouched -and -not $patchNotesTouched) {
    Write-Host "❌ FEJL: Du forsøger at pushe frontend-ændringer uden at opdatere patch notes (frontend/src/data/patchNotes.js)." -ForegroundColor Red
    Write-Host "Dette er et krav i CyclingZone for at sikre, at brugerne ved hvad der er ændret."
    Write-Host ""
    Write-Host "Hvis dette er en bevidst undtagelse (f.eks. kun refaktorering), kan du køre:"
    Write-Host "  git push --no-verify"
    Write-Host ""
    exit 1
}

exit 0
