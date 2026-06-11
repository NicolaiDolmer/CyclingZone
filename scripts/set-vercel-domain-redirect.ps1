# set-vercel-domain-redirect.ps1
#
# Sætter/rydder redirect på et projekt-domæne via Vercel API (CLI'en har ingen
# kommando til det). Probe-wrapper-mønster jf. #634: token læses internt fra
# Vercel CLI's auth.json og printes ALDRIG — output er kun sanitized domæne-felter.
#
# Brug:
#   # Gør apex primary (ryd redirect):
#   pwsh -File scripts/set-vercel-domain-redirect.ps1 -Domain cyclingzone.org -ClearRedirect
#   # Redirect www -> apex (308):
#   pwsh -File scripts/set-vercel-domain-redirect.ps1 -Domain www.cyclingzone.org -RedirectTo cyclingzone.org
#   # Vis nuværende config uden at ændre noget:
#   pwsh -File scripts/set-vercel-domain-redirect.ps1 -List
#
# Refs: #1296 (domæne-flip cyclingzone.org).

[CmdletBinding()]
param(
  [string]$Domain = "",
  [string]$RedirectTo = "",
  [int]$StatusCode = 308,
  [switch]$ClearRedirect,
  [switch]$List,
  [string]$ProjectId = "prj_23QsiRSCv07gZUzbfaI8RzCwB7yO",
  [string]$TeamId = "team_VNyfMG4XH0M7OV64xl7uiWY6"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $List -and -not $Domain) {
  Write-Error "Angiv -Domain (eller -List for at vise nuværende config)."
  exit 1
}
if (-not $List -and -not $ClearRedirect -and -not $RedirectTo) {
  Write-Error "Angiv -RedirectTo <domæne> eller -ClearRedirect."
  exit 1
}

# Token: VERCEL_TOKEN fra env (sæt via Infisical eller dashboard-genereret token).
# Læses internt, printes aldrig.
$token = $env:VERCEL_TOKEN
if (-not $token) {
  Write-Error "VERCEL_TOKEN mangler i env. Generér på vercel.com/account/tokens og kør fx: `$env:VERCEL_TOKEN='...'; pwsh -File scripts/set-vercel-domain-redirect.ps1 -List"
  exit 1
}
$headers = @{ Authorization = "Bearer $token" }

function Show-DomainRow($d) {
  $redir = if ($d.PSObject.Properties.Name -contains "redirect" -and $d.redirect) {
    "-> $($d.redirect) ($($d.redirectStatusCode))"
  } else { "(primary / serves directly)" }
  Write-Output ("  {0,-45} {1}" -f $d.name, $redir)
}

$base = "https://api.vercel.com/v9/projects/$ProjectId/domains"

if ($List) {
  $resp = Invoke-RestMethod -Method Get -Uri "$base`?teamId=$TeamId" -Headers $headers
  Write-Output "Projekt-domæner ($ProjectId):"
  $resp.domains | ForEach-Object { Show-DomainRow $_ }
  exit 0
}

$body = if ($ClearRedirect) {
  @{ redirect = $null } | ConvertTo-Json
} else {
  @{ redirect = $RedirectTo; redirectStatusCode = $StatusCode } | ConvertTo-Json
}

$resp = Invoke-RestMethod -Method Patch -Uri "$base/$Domain`?teamId=$TeamId" `
  -Headers $headers -ContentType "application/json" -Body $body

Write-Output "Opdateret:"
Show-DomainRow $resp
