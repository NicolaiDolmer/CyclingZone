# Engangs-opsaetning af VAPID-noegler til web push (#6590).
# Koeres af ejeren i sin EGEN PowerShell (ikke i Claude Code), fra C:\Dev\CyclingZone.
# Genererer et P-256-noeglepar og saetter det i Infisical (prod) og Railway
# (CyclingZone / production). Vaerdierne vises ALDRIG; kun "OK"/"FEJL" pr. trin.

$ErrorActionPreference = "Stop"
Set-Location "C:\Dev\CyclingZone"

# Koden skrives til en midlertidig fil: Windows PowerShell 5.1 fjerner
# dobbelte anfoerselstegn i argumenter til node -e (fejlede 19/10).
$gen = @'
const { createECDH } = require('node:crypto');
const e = createECDH('prime256v1'); e.generateKeys();
process.stdout.write(e.getPublicKey().toString('base64url') + ' ' + e.getPrivateKey().toString('base64url'));
'@
$genFile = Join-Path $env:TEMP "cz-vapid-gen.cjs"
Set-Content -Path $genFile -Value $gen -Encoding ASCII
$out = node $genFile
Remove-Item $genFile -ErrorAction SilentlyContinue
if (-not $out) { Write-Host "FEJL: noeglegenerering"; exit 1 }
$pair = $out.Split(" ")
if ($pair.Count -ne 2) { Write-Host "FEJL: noeglegenerering"; exit 1 }
$pub = $pair[0]; $priv = $pair[1]; $subject = "https://cyclingzone.org"

# 1. Infisical prod
infisical secrets set "VAPID_PUBLIC_KEY=$pub" "VAPID_PRIVATE_KEY=$priv" "VAPID_SUBJECT=$subject" --env=prod --silent *> $null
if ($LASTEXITCODE -ne 0) { Write-Host "FEJL: Infisical (er du logget ind? infisical login)"; exit 1 }
Write-Host "OK: Infisical prod"

# 2. Railway (samme vaerdier; udloeser eet redeploy af backend)
# Infisicals INF-log gaar til stderr; i PS 5.1 + Stop bliver det en fejl (19/10).
# Exit-koden afgoer resultatet.
$ErrorActionPreference = "Continue"
infisical run --env=dev --silent -- railway variables -s CyclingZone -e production --set "VAPID_PUBLIC_KEY=$pub" --set "VAPID_PRIVATE_KEY=$priv" --set "VAPID_SUBJECT=$subject" *> $null
if ($LASTEXITCODE -ne 0) { Write-Host "FEJL: Railway"; exit 1 }
Write-Host "OK: Railway (backend redeployer nu)"

Remove-Variable pub, priv, pair -ErrorAction SilentlyContinue
Write-Host "Faerdig. Skriv 'noegler sat' til Claude."
