# `gh run rerun` genbruger PR'ens GAMLE merge-ref — brug `gh pr update-branch` når main er flyttet

**Dato:** 2026-07-25 · **Refs:** PR #2936/#2937 (patch notes 7.58 + audit-fix)

## Hvad skete

`audit`-checket fejlede på alle PR'er pga. et forældreløst endpoint. PR #2937 fjernede endpointet og blev merged. Derefter blev `audit` re-run på PR #2936 — men den fejlede STADIG: et rerun genbruger workflow-runnets oprindelige merge-commit (main FØR #2937), så fixet på main var usynligt for rerunnet. Løsning: `gh pr update-branch 2936` → ny merge-commit → frisk CI → grøn.

## Læring

1. **Rerun tester fortiden:** `gh run rerun` kører mod den merge-ref der blev bygget da runnet startede. Skal en PR se NYE main-commits, kræver det en ny run: `gh pr update-branch N` (eller push til branchen).
2. **Jobs der fejler med 0 fejlede steps = infrastruktur, ikke kode.** Tjek `gh api .../runs/<id>/jobs` og se om `steps[]` har failures; tomme step-lister betyder runner/setup-død (GitHub-ustabilitet 25/7 ramte ~15 jobs på tværs af 2 PR'er). Dér er rerun det rigtige svar — efter at have skelnet fra ægte fejl.
3. **Zombie-checks kan blokere merge:** et hængende `QUEUED` check-run fra et infra-dødt attempt kan tælle som det seneste for branch protection, selv når et nyere attempt er grønt. `gh run cancel <run>` + rerun rydder det.
