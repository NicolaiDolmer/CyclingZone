# Loop B · Pre-push hook for PatchNotes-disciplin in PowerShell

$frontendTouched = git diff origin/main..HEAD --name-only | Select-String -Pattern "^frontend/src/" | Select-String -Pattern "PatchNotesPage.jsx" -NotMatch
$patchNotesTouched = git diff origin/main..HEAD --name-only | Select-String -Pattern "PatchNotesPage.jsx"

if ($frontendTouched -and -not $patchNotesTouched) {
    Write-Host "❌ FEJL: Du forsøger at pushe frontend-ændringer uden at opdatere PatchNotesPage.jsx." -ForegroundColor Red
    Write-Host "Dette er et krav i CyclingZone for at sikre, at brugerne ved hvad der er ændret."
    Write-Host ""
    Write-Host "Hvis dette er en bevidst undtagelse (f.eks. kun refaktorering), kan du køre:"
    Write-Host "  git push --no-verify"
    Write-Host ""
    exit 1
}

exit 0
