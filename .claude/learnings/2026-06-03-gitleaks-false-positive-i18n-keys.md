# Postmortem · 2026-06-03 · gitleaks false-positive på i18n-nøgler med cifre

## Hvad skete der?
Under rangliste-rework (PR #993) blokerede pre-commit-hooken (`gitleaks protect --staged`) committen med "leaks found: 4". Ingen af de 4 var ægte secrets — det var i18n-nøgle-strenge.

## Root cause
gitleaks' default `generic-api-key`-regel matchede de nye i18n-nøgler `rankings.colTop3`, `rankings.shortTop3`, `rankings.colTop10`, `rankings.shortTop10` i `RiderRankingsPage.jsx`. Heuristikken trigger på `key: "..."`-mønstret (kolonne-definitionerne hedder `labelKey`/`shortKey`) kombineret med en streng der indeholder cifre ("Top3"/"Top10"). De øvrige nye nøgler uden cifre (fx `colClassicWins`) trippede ikke.

## Fix
Tilføjet en målrettet allowlist-regex i `.gitleaks.toml` (under `[allowlist].regexes`):
```
'''rankings\.(col|short)?Top\d+'''
```
Bevidst snæver (kun `rankings.*Top<n>`-nøgler), så scanneren ikke svækkes generelt. Commit på PR #993 (`bacc93a8`).

## Forhindret-fremover
Allowlist-reglen ligger nu i repoets `.gitleaks.toml`, som både pre-commit-hooken OG CI's `secret-scan.yml` bruger — så fremtidige `rankings.*Top<n>`-nøgler tripper hverken lokalt eller i CI. Mønstret at være opmærksom på: en i18n-nøgle (eller anden konstant) hvis værdi blander `key:`-agtige felt-navne med cifre/mixed-case kan ligne en API-key for gitleaks.

## Læring
Når gitleaks blokerer på noget der åbenlyst ikke er en secret: verificér med `gitleaks protect --staged -v` (viser redacted match + RuleID + fil:linje), og løs det med en **snæver allowlist-regel i `.gitleaks.toml`** — ikke `git commit --no-verify` (som CI's gitleaks alligevel fanger) og ikke ved at omdøbe kode for at please scanneren. Allowlist'en er den dokumenterede forward-guard-mekanisme i configen (jf. #634).
