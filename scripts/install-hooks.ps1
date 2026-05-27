# Installerer git hooks i .git/hooks/ (Windows version)

$hookSource = "scripts/pre-push-hook.ps1"
$hookTarget = ".git/hooks/pre-push"

# Git hooks på Windows (Git Bash) forventer ofte et shell script, 
# så vi laver en lille wrapper der kalder PowerShell.
$wrapperContent = @"
#!/bin/sh
powershell.exe -ExecutionPolicy Bypass -File scripts/pre-push-hook.ps1
"@

if (-not (Test-Path $hookSource)) {
    Write-Host "❌ Fejl: $hookSource findes ikke." -ForegroundColor Red
    exit 1
}

Set-Content -Path $hookTarget -Value $wrapperContent
Write-Host "✅ Pre-push hook installeret i $hookTarget" -ForegroundColor Green
