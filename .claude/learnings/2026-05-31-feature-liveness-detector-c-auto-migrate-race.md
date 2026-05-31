# Feature-liveness Detector C racede auto-migrate → falsk-positiv på hver migration-merge

**Dato:** 2026-05-31
**Trigger:** PR #844/#853 (countries-table) — og hver migration-merge siden mindst 30. maj.
**Fix:** [#854](https://github.com/NicolaiDolmer/CyclingZone/pull/854) — trigger Detector C via `workflow_run` på `Auto-migrate`-completion i stedet for på `push` til main.

## Root cause

Tre workflows mødtes i et timing-race:

1. `auto-migrate.yml` triggede på push til main og venter **bevidst** `sleep 180` (~3 min) før den anvender migrationen + skriver `schema_migrations`-rækken. Delayen er en workaround for upålidelig Vercel/Railway deploy-timing (race-fri margin).
2. `feature-liveness-audit.yml` triggede på **samme** push til main og kørte Detector C (migration-drift) **umiddelbart** (`--skip=A,B,D,E`).
3. Detector C ([`audit-feature-liveness.js`](../../backend/scripts/audit-feature-liveness.js) `detectorC()`) sammenligner committed `database/*.sql` mod applied `schema_migrations.filename`. Den netop-merged migration var committed men endnu ikke i `schema_migrations` (auto-migrate sov stadig) → **"committed men ikke applied"**.

Konkret (countries-table):

| Tidspunkt (CEST) | Hændelse |
|---|---|
| 12:27:13 | merge til main |
| 12:27:26 | feature-liveness audit → 1 finding (countries-table "ikke applied") |
| 12:30:24 | auto-migrate skrev rækken i `schema_migrations` |

En re-run efter 12:30 var grøn (run `26712582879` = `success` ved 12:39). Det `quality-drift`-issue (#790) blev *opdateret* ved hver migration-merge → main blinkede rød + ægte findings blev udvandet.

## Hvorfor det var et design-problem, ikke en script-bug

Detector C's logik var korrekt. Fejlen var at den blev **trigget parallelt** med den proces den auditerer, i stedet for **efter** den. #639 (Option D) tilføjede push-til-main-Detector-C for at fange en failed auto-migrate hurtigt (mean-time-to-detect minutter i stedet for op til 7 dage til weekly cron) — men koblede den på `push`, som fyrer samtidig med auto-migrate, ikke efter.

## Fix

`workflow_run` på `Auto-migrate`-completion:

```yaml
workflow_run:
  workflows: ['Auto-migrate']
  types: [completed]
  branches: [main]
```

Auditen kører nu først *når auto-migrate er færdig* — så `schema_migrations` er konsistent. Ved success: ingen finding. Ved failure: den manglende række er en **ægte** finding (præcis #639's intention, nu uden race). `types: [completed]` dækker både success og failure, så vi auditerer også når migrate fejler.

## Forkastede alternativer

- **Grace-periode på commit-tid** (ignorér finding hvis migration < 10 min gammel): kræver git-historik (`fetch-depth: 0` + `git log`) i et ellers git-agnostisk script, og svækker #639's detect-hastighed for ægte failed migrations (de skal vente grace-perioden ud).
- **"Warning kun hvis ældre end X":** samme git-afhængighed + skal splitte exit-kode/`total`/issue-logik i fejler/fejler-ikke. Mere kompleks for samme resultat.

## Trade-off

En push til main der *ikke* udløser auto-migrate (fx ren ændring af audit-scriptet eller workflow-filen) re-kører ikke Detector C før næste migration eller weekly cron. Acceptabelt: PR-run dækker A/B/D, og cron dækker alt.

## Læring

> Når et CI-tjek auditerer resultatet af en anden async proces, skal det trigges på den proces' **completion** (`workflow_run`), ikke på den **fælles upstream-event** (`push`). Ellers racer auditen den proces den måler — og en bevidst delay i den målte proces bliver til kronisk falsk-positiv. Samme klasse som [`2026-05-18-schema-migrations-double-record`](2026-05-18-schema-migrations-double-record.md) og [`2026-05-15-migration-schema-drift`](2026-05-15-migration-schema-drift.md): prod-state og bookkeeping er uafhængige spor der skal læses i konsistent rækkefølge.
