# Branch-opgørelse — 2026-09-18

> Read-only opgørelse (#5391), bygget videre på #4924's afsluttede worktree-audit (`docs/audits/2026-09-18-orphan-worktrees-uge38.md`). Ingen branches slettet af dette pas. Repo: `NicolaiDolmer/CyclingZone`, sammenlignet mod `origin/main`.

**43 remote branches** i alt (ekskl. `main` selv) — 0 kan slettes sikkert, 43 har unikt arbejde eller en åben PR.

## Forward-guards (verificeret 2026-09-18, #5391)

- `delete_branch_on_merge` er allerede **slået til** på repoet (`gh api repos/NicolaiDolmer/CyclingZone`) - enhver merge, uanset vej (UI, `gh pr merge`, `scripts/merge-queue.ps1`), sletter automatisk branchen. Ingen ændring nødvendig.
- `scripts/merge-queue.ps1` merger allerede med `--delete-branch` som en ekstra, eksplicit garanti oveni repo-indstillingen. Ingen ændring nødvendig.
- **Konsekvens for listen herunder:** fordi merge altid sletter branchen, er der ingen "merget, men stadig til stede"-branches i denne opgørelse - alle 43 er enten en åben PR eller reelt forældreløs (aldrig merget/afvist/glemt). "Kan slettes sikkert" (0 stk. lige nu) vil derfor typisk kun ramme forældreløse branches hvis spids allerede findes på main via en ANDEN branch (samme commits, ingen unik historik) - ikke selve merge-sporet.
- Ny ugentlig rutine (`.github/workflows/stale-branches-report.yml` + `scripts/stale-branches-report.mjs`): opretter/ajourfører ÉT issue med branches 14+ dage uden åben PR, se sektionen nedenfor. Kører read-only (kun `issues: write` for selve issue-oprettelsen/-redigeringen, ingen branch-mutation).

## Kan slettes sikkert

(ingen)

## Har unikt arbejde (kræver et blik før noget slettes)

Åben PR, eller forældreløs med commits foran main der ikke findes andre steder.

| Branch | Status | Alder (dage) | Commits foran main | Sidste commit |
|---|---|---|---|---|
| `claude/issue-2684-20260718-2316` | forældreløs | 61 | 2902 | `cb92d5fa8` fix(ai-ops): drift-vagt-hærdning — prefix-glob + staleness-WARN (`#2684`) |
| `claude/practical-lovelace-c12077` | forældreløs | 45 | 1 | `c86bae1fc` docs(worktree): gotcha - preview_start bruger main-checkoutets cwd |
| `feat/3651-limited-upside-training` | forældreløs | 35 | 1 | `35c152cfb` feat(3651): "Limited upside for this rider type" ogsaa paa rytterprofilen |
| `feat/3360-loenbasis-markedsvaerdi` | forældreløs | 30 | 2 | `93773cf52` fix(economy): post-rebase test-fixes + race_days_total + salary-sort under market-basis (`#3360`) |
| `fix/3997-spejder-tidspunkt` | forældreløs | 29 | 2 | `61f001115` fix(3997): da-copy 'spejder-koeresel' -> 'spejder-koersel' |
| `feat/4030-b1-climb` | forældreløs | 28 | 13 | `428249b4f` feat(engine-v4): M2 climb selection mechanic + tests (`#4030` B1) |
| `feat/4030-b2-descent` | forældreløs | 28 | 13 | `662a82212` feat(engine-v4): M3 nedkoersel v2 - monotoni-garanti + descent attack + risiko-kobling (`#4030` B2) |
| `feat/4030-b3-finale` | forældreløs | 28 | 13 | `c52353e6a` feat(engine-v4): M4 punch-finale + placerings-opgoer (finale.ts) |
| `feat/4030-b4-timeline` | forældreløs | 28 | 15 | `a8db22ef2` feat(engine-v4): headToHeadV4.js - B4 head-to-head-harness-stub (`#4030`) |
| `feat/3448-level-anchor` | forældreløs | 27 | 3 | `e3dd70f50` wip(economy): BACKUP-commit af a_floor_shift-anker + dry-run-harness (`#3448`) |
| `measure/3337-specialisering` | forældreløs | 27 | 1 | `2f2a9fa77` chore(3337): backup af specialiserings-maaleharness (4 dev-scripts) |
| `claude/issue-4189-20260824-1737` | forældreløs | 25 | 1 | `7dcd24020` docs: notér `#4189` actor-guard-analyse i NOW.md |
| `fix/4172-d4-spredning` | forældreløs | 25 | 4 | `8752e8b41` feat(pools): `#4172` fyld D4 med EKSISTERENDE frie ryttere i stedet for nye |
| `claude/issue-4241-20260825-1245` | forældreløs | 24 | 1 | `9ace731d3` feat(ops): migreringsscript til ruleset-baseret collab-gate (`#4241`) |
| `fix/4223-alder-mellem-saesoner` | forældreløs | 24 | 1 | `0ae68c07c` fix(riders): alderen forsvandt mellem to saesoner |
| `feat/4030-h2h-scorecard` | forældreløs | 23 | 2 | `941b29f04` feat(4030): head-to-head observer-helpers (utrackede filer sikret) |
| `fix/3709-signaturfaktor-110` | forældreløs | 23 | 2 | `16074e5f7` feat(3709): spillervendte gates-script (utracket fil sikret) |
| `chore/4361-coderabbit-auto-trigger` | forældreløs | 21 | 1 | `a30345dd0` chore(ci): auto-trigger CodeRabbit-review paa nye PR mod main (`#4361`) |
| `feat/4535-matrix-calendar-strip` | forældreløs | 17 | 1 | `c8c1bd8d9` wip(planning): `#4535` header-iterationer - EN kalender, label-raekker, skraa navne, saeson-loebsdage |
| `feat/4613-training-overview-first` | forældreløs | 15 | 5 | `01fd39c11` merge origin/main into feat/4613-training-overview-first |
| `fix/4595-asset-404-immutable-cache` | forældreløs | 15 | 2 | `09758ac97` fix(frontend): ret-runde paa `#4595` - patch note + korrigeret rodaarsag (`#4595`) |
| `feat/3458-archetype-gen-pr2` | åben PR (https://github.com/NicolaiDolmer/CyclingZone/pull/3512) | 14 | - | `af525c8c2` Merge branch 'main' into feat/3458-archetype-gen-pr2 |
| `ci/4404-auto-merge-label` | forældreløs | 13 | 1 | `c9389ee72` ci(auto-merge): fjern doed auto-merge-label-workflow, ejer-beslutning 4/9 (`#4404`) |
| `fix/4750-academy-intake-gain` | forældreløs | 13 | 5 | `e1176aa25` fix(training): pagination-safe kommentar paa udvidet maalescripts riders-select (`#4750`) |
| `feat/4632-intention-ui` | forældreløs | 12 | 3 | `1f014e112` fix(race): etape-vaelgerens knapper faar deres eget navn (`#4632`) |
| `feat/v4-order-chain-ui` | forældreløs | 12 | 2 | `d70cd49a0` feat(races): taktik-kortet kobles paa den rigtige ordre-kaede og viser rollen som standardordre (`#4246`) |
| `fix/5060-mobile-sticky-rider-column` | forældreløs | 8 | 5 | `68ce464d4` test(e2e): find de pinnede celler paa beregnet stil, ikke paa fixets egen klasse |
| `feat/5033-release-detect-reload` | forældreløs | 7 | 6 | `6454579b3` test(e2e): fjern to race-fejl i 5033-release-detect-reload-specen |
| `fix/5145-demote-age-gate-21` | forældreløs | 4 | 7 | `81a2eb681` fix(frontend): `#5145` academyDemoteGate som .ts (hard rule 31, reviewer-fund) |
| `feat/4845-calendar-packs-equal-race-days` | åben PR (https://github.com/NicolaiDolmer/CyclingZone/pull/5169) | 3 | - | `ef5d36843` fix(calendar): `#4845` --apply skrev den skaeve akse; tastefejl slog gaten fra |
| `feat/4847-b3-remove-training-bonus` | åben PR (https://github.com/NicolaiDolmer/CyclingZone/pull/5281) | 3 | - | `f41319aee` fix(i18n): `#4847` fjern em-dash i tour.runToday.body (tone-em-dash) |
| `fix/4860-4376-sponsor-base-s4` | forældreløs | 3 | 1 | `efe14ad67` fix(sponsor): price S4 contracts at activation (refs `#4860` `#4376`) |
| `codex/growth-plan-2026-09-16` | forældreløs | 2 | 1 | `5c7932f8e` docs(growth): preserve review plan and backlog coverage (Refs `#4964` `#5310`) |
| `feat/4847-race-day-close-trigger` | åben PR (https://github.com/NicolaiDolmer/CyclingZone/pull/5264) | 1 | - | `44d41f7c3` merge: main ind i feat/4847-race-day-close-trigger (B4) - konflikter loest, flake `#5276` med (Refs `#4847`) |
| `wip/4577-dotenv-scripts-cleanup` | forældreløs | 1 | 1 | `897807f8e` wip(scripts): dotenv-oprydning i 26 backend-/dev-scripts (Refs `#4577`) |
| `wip/4582-demote-inherits-contract` | forældreløs | 1 | 1 | `ac616293d` wip(academy): nedrykning arver kontrakten (ejer 4/9) - backend + modal + i18n (Refs `#4582`) |
| `wip/assistant-training-suggestions` | forældreløs | 1 | 1 | `4d091f91a` wip(training): assistentens traeningsforslag - panel, logik og tests (ejer-direktiv 31/8) |
| `wip/v4-tuning-experiment-0109` | forældreløs | 1 | 1 | `14ffd66cf` wip(engine): v4 segmentLoop/tuning-eksperiment fra natten 1/9 |
| `chore/5391-branch-og-worktree-rutiner` | åben PR (https://github.com/NicolaiDolmer/CyclingZone/pull/5399) | 0 | - | `3a2e02b6b` wip: lane start |
| `dependabot/npm_and_yarn/frontend/frontend-minor-patch-a2a6ea07fe` | åben PR (https://github.com/NicolaiDolmer/CyclingZone/pull/5379) | 0 | - | `6c62f3527` chore(deps): Bump the frontend-minor-patch group across 1 directory with 10 updates |
| `dependabot/npm_and_yarn/marketing/marketing-minor-patch-84396dbae2` | åben PR (https://github.com/NicolaiDolmer/CyclingZone/pull/5356) | 0 | - | `8c487b8e1` chore(deps): Bump the marketing-minor-patch group |
| `feat/3624-notify-udgaaende-koe` | åben PR (https://github.com/NicolaiDolmer/CyclingZone/pull/5398) | 0 | - | `47e630dab` wip: lane start (Refs `#3624`) |
| `feat/3643-traeningssiden-paa-mobil` | åben PR (https://github.com/NicolaiDolmer/CyclingZone/pull/5397) | 0 | - | `21f18f6f5` wip: lane start (Refs `#3643`) |

## Forældreløse 14+ dage gamle uden åben PR (samme kriterie som den ugentlige rutine, se `scripts/stale-branches-report.mjs`)

- `claude/issue-2684-20260718-2316` — 61 dage, 2902 commit(s) foran main
- `claude/practical-lovelace-c12077` — 45 dage, 1 commit(s) foran main
- `feat/3651-limited-upside-training` — 35 dage, 1 commit(s) foran main
- `feat/3360-loenbasis-markedsvaerdi` — 30 dage, 2 commit(s) foran main
- `fix/3997-spejder-tidspunkt` — 29 dage, 2 commit(s) foran main
- `feat/4030-b1-climb` — 28 dage, 13 commit(s) foran main
- `feat/4030-b2-descent` — 28 dage, 13 commit(s) foran main
- `feat/4030-b3-finale` — 28 dage, 13 commit(s) foran main
- `feat/4030-b4-timeline` — 28 dage, 15 commit(s) foran main
- `feat/3448-level-anchor` — 27 dage, 3 commit(s) foran main
- `measure/3337-specialisering` — 27 dage, 1 commit(s) foran main
- `claude/issue-4189-20260824-1737` — 25 dage, 1 commit(s) foran main
- `fix/4172-d4-spredning` — 25 dage, 4 commit(s) foran main
- `claude/issue-4241-20260825-1245` — 24 dage, 1 commit(s) foran main
- `fix/4223-alder-mellem-saesoner` — 24 dage, 1 commit(s) foran main
- `feat/4030-h2h-scorecard` — 23 dage, 2 commit(s) foran main
- `fix/3709-signaturfaktor-110` — 23 dage, 2 commit(s) foran main
- `chore/4361-coderabbit-auto-trigger` — 21 dage, 1 commit(s) foran main
- `feat/4535-matrix-calendar-strip` — 17 dage, 1 commit(s) foran main
- `feat/4613-training-overview-first` — 15 dage, 5 commit(s) foran main
- `fix/4595-asset-404-immutable-cache` — 15 dage, 2 commit(s) foran main

## Næste skridt

1. Ejeren ser listerne og siger "slet" for "kan slettes sikkert" (samme go-mønster som #4924).
2. "Har unikt arbejde" kræver et blik pr. branch (åbne PR'er følger deres eget flow; forældreløse med unikt arbejde afgøres enkeltvis - flet, genåbn som PR, eller bekræft skrot).
