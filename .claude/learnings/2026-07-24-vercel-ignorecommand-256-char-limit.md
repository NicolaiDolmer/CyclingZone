# Vercel ignoreCommand har en 256-tegns-grænse — for lang = "Deployment failed" uden build-log

**Dato:** 2026-07-24 · **Kontekst:** #2849 bølge 4, PR #2874

## Symptom
Vercel-status på PR-tippet: "Deployment failed" med target_url der peger på
project-configuration-docs — INGEN build-log (buildet startede aldrig).

## Rod-årsag
`ignoreCommand` i frontend/vercel.json blev udvidet til merge-base-diff med
echo-forklaringer og fulde refspecs (~600 tegn). Vercel afviser hele
konfigurationen når ignoreCommand overstiger **256 tegn** — deployet fejler som
config-fejl, ikke som build-fejl.

## Fix
Komprimeret til 229 tegn: drop echo-tekster, `git fetch -q --depth=100 origin
main` + `git merge-base HEAD FETCH_HEAD` (FETCH_HEAD undgår refspec-støj), og
lad case-grenens exit-status være svaret (0=skip, ellers build; fetch/merge-base
-fejl → exit 1 = fail-open til build).

## Læring
1. Target-url `vercel.com/docs/concepts/projects/project-configuration` på en
   fejlet deploy = **config-validering fejlede**, kig i vercel.json før du
   jagter build-loggen.
2. ignoreCommand-ændringer selv-tester på branchen (Vercel læser vercel.json fra
   committet der deployes) — push og se status i stedet for at gætte.
3. Hold ignoreCommand ≤256 tegn; forklaringer hører hjemme i git-historikken,
   ikke i kommandoen.
