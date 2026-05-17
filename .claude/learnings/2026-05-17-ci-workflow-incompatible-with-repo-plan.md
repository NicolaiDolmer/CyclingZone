# CI-workflow inkompatibel med repo-plan — blokerer hver PR

**Dato:** 2026-05-17
**PRs:** [#463](https://github.com/NicolaiDolmer/CyclingZone/pull/463) (offer), [#467](https://github.com/NicolaiDolmer/CyclingZone/pull/467) (fix)

## Hvad gik galt

`actions/dependency-review-action@v5` kræver GitHub Advanced Security
(betalt) eller public repo. Vores repo er privat uden GHAS.

Workflowet `dependency-review.yml` fejlede derfor på **hver eneste PR**
med:

> Dependency review is not supported on this repository. Please ensure
> that Dependency graph is enabled along with GitHub Advanced Security

PR #463 (ren chore: flyttede 6 Discord-scripts, rørte ikke dependencies)
viste `UNSTABLE` merge-state og krævede admin-bypass selvom alt reelt
indhold var grønt.

## Rod-årsag

Workflow blev tilføjet uden at verificere at action'en kan køre på den
faktiske repo-konfiguration. Action-doc'et var klart om kravet — vi
checkede ikke.

## Fix

Slettet `dependency-review.yml` (PR #467). Dependency-sikkerhed er
fortsat dækket af:
- CodeQL (statisk analyse)
- gitleaks (secret-scan)
- Dependabot + auto-merge (CVE-monitoring)

## Forward-guard

**Når et nyt workflow tilføjes:** Verificér at action'en kan køre på
private repos uden GHAS, ELLER skriv eksplicit i kommentar at den kun
virker på public/GHAS. Hvis i tvivl: kør den én gang og se om den fejler
strukturelt før den committes som blocking.

**Backwards-check udført:** Andre workflows i `.github/workflows/`
(`codeql.yml`, `secret-scan.yml`, `ci.yml`, `dependabot-auto-merge.yml`)
bruger ikke GHAS-only actions. Ingen kendte tilsvarende blokeringer.

## Princip

CI-værktøjer skal matche repo-planen. Et workflow der altid fejler er
værre end ingen workflow — det normaliserer "rød CI er OK" og kræver
admin-bypass som rutine. Det forsvarer ikke det det skulle.
