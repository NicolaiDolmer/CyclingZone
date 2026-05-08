param(
  [string]$Repo = "NicolaiDolmer/CyclingZone"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$body = @{
  security_and_analysis = @{
    dependabot_security_updates = @{ status = "enabled" }
    secret_scanning = @{ status = "enabled" }
    secret_scanning_push_protection = @{ status = "enabled" }
    secret_scanning_non_provider_patterns = @{ status = "enabled" }
    secret_scanning_validity_checks = @{ status = "enabled" }
  }
} | ConvertTo-Json -Depth 10

$body | gh api -X PATCH "repos/$Repo" --input -

Write-Host "Requested GitHub security hardening for $Repo"
