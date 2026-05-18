# 2026-05-18 — Auto-merge GraphQL permissions: statusCheckRollup kræver `checks: read` + `statuses: read`

## Bug

Auto-merge workflow ([`.github/workflows/auto-merge.yml`](../../.github/workflows/auto-merge.yml)) fejlede 100% på PR [#477](https://github.com/NicolaiDolmer/CyclingZone/pull/477) (sprint-metrics auto-snapshot, 2026-05-18T12:46Z) i step "Wait for required checks":

```
GraphQL: Resource not accessible by integration (node.statusCheckRollup.nodes.0.commit.statusCheckRollup)
```

PR'en var fuldt grøn (alle required checks SUCCESS), men `gh pr checks "$PR_NUMBER" --watch --fail-fast --required` kunne ikke læse rollup'en. Brugeren måtte køre `gh pr merge 477 --squash --delete-branch` manuelt for at unblocke #476-shipping. Failed run: [26034387879](https://github.com/NicolaiDolmer/CyclingZone/actions/runs/26034387879/job/76528440258).

## Root cause

`auto-merge.yml`'s permissions-blok deklarerede kun:

```yaml
permissions:
  contents: write
  pull-requests: write
  actions: write
```

`gh pr checks --watch --required` rammer GraphQL-feltet `statusCheckRollup` som flettedata fra:
- **Check Runs** (Checks API) — kræver scope `checks: read`
- **Commit Statuses** (Statuses API) — kræver scope `statuses: read`

Ingen af disse var grantet → GraphQL returnerer `Resource not accessible by integration` i stedet for at filtrere felter, og `gh` exit'er 1.

**Hvorfor det først bed nu, ikke 2026-05-08:** Backwards-check af de tre seneste failures viste at run [25555957477](https://github.com/NicolaiDolmer/CyclingZone/actions/runs/25555957477) (2026-05-08, PR #202) kørte forbi `gh pr checks --watch` med EKSAKT samme permissions (`Actions/Contents/Metadata/PullRequests`) og nåede `Refreshing checks status every 10 seconds`. Konklusion: GitHub strammede token-scope-krav på `statusCheckRollup` mellem 5/8 og 5/18 uden release-note. Andre `gh pr ...`-kald i workflow'en (label-edit, comment, merge, view --json mergeCommit) bruger REST og fortsatte med at virke under `pull-requests: write`.

## Fix

Tilføjet til `permissions`-blokken:

```yaml
checks: read     # gh pr checks + gh api .../check-runs (statusCheckRollup → check-runs)
statuses: read   # gh pr checks (statusCheckRollup → commit statuses)
```

Begge er **read-only** — ingen security-implikation. Følger principle of least privilege.

REST-kaldet i step 4 (`gh api repos/.../commits/$HEAD_SHA/check-runs?check_name=review`, linje 75) krævede også `checks: read` for at læse advisory AI-review, så fix'et dækker det parallelt.

## Verification path

Workflow har INGEN `workflow_dispatch`-trigger (kun `pull_request: labeled`), så verification kræver at apply `auto-merge` label på næste reelle PR. Hvis det fejler med samme symptom → fjern label, eskalér til denne postmortem, prøv næste skridt nedenfor.

## Læring

**1. `statusCheckRollup` er ikke dækket af `pull-requests: write`.** GraphQL-felter der wrapper Check-Runs/Statuses-API kræver SCOPED tokens selvom selve PR'en er accessible. Pull-request scope dækker labels, comments, merge — men ikke check/status-data attached til commits. Næste gang en workflow læser CI-state: tilføj `checks: read` + `statuses: read` forebyggende.

**2. GitHub kan stramme permission-checks uden release-note.** Samme workflow-kode + samme token-permissions virkede 2026-05-08 og fejlede 2026-05-18. Det er en silent regression fra GitHub's side. Lection: pin permissions eksplicit, og når en workflow pludselig fejler "Resource not accessible by integration" — tjek scope FØRST før koden.

**3. Forward-guard via inline-kommentar + filreference i `permissions`-blokken.** Tilføjet `# fjernes IKKE — GitHub strammede 2026-05-18, se .claude/learnings/...` så fremtidige refactors ikke fjerner scope'et som "vi bruger ikke disse". Pure-data scopes (read-only) er nul-omkostning at beholde.

**4. Backwards-check skiller "regression" fra "den-har-altid-været-broken".** Tre seneste failures gav helt forskellige root causes:
- 2026-05-07 (#182): `failed to run git: not a git repository` — pre-refactor `--auto`-flow
- 2026-05-08 (#202): `gh pr checks --watch` nåede frem til "Refreshing every 10s" — bug var et andet sted
- 2026-05-18 (#477): GraphQL-permissions

Uden backwards-check ville fix'et være båret af antagelse om at det altid har været brudt, og man havde måske over-fixet (fx skiftet hele check-strategien). Med checken: konklusion er præcist "GitHub-side ændring; minimum-scope-tilføjelse løser det".

## Hvis fix ikke virker

Hvis næste auto-merge fejler med samme GraphQL-signatur efter denne PR:

1. **Bekræft permissions reelt blev grantet:** I run-log under `##[group]GITHUB_TOKEN Permissions` skal stå `Checks: read` + `Statuses: read`.
2. **Plan B — bypass `gh pr checks --watch`:** Erstat step 3 med en manuel poll-loop mod `gh api repos/{repo}/commits/{sha}/check-runs` (samme path som step 4 bruger). Det er REST, ikke GraphQL — undgår `statusCheckRollup`-feltet helt.
3. **Plan C — `gh pr merge --auto` + accept anti-loop-cost:** Refresh design fra postmortem [2026-05-08-auto-merge-github-token-anti-loop.md](2026-05-08-auto-merge-github-token-anti-loop.md), men trigger deploy-verify fra `push: main`-event i stedet for fra auto-merge-workflow.
