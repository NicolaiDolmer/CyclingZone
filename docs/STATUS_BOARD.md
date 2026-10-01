# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

80 features i FEATURE_REGISTRY.yml: live 57 · beta 3 · dormant 5 · building 10 · spec 1 · idea 2 · retired 2.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #5829 docs(design): #5124 mobile season matrix options (0d) — roed
- #6003 fix(race): no mountain jersey prize without mountain points (#5956) (0d) — groen
- #6002 feat(engine-v4): GC context + chase reaction budget behind inactive rule revision (#5978) (0d) — groen
- #6005 fix(training): retry jobs only touch unfinished teams; dedupe date-close Sentry (#6004) (0d) — groen
- #6001 feat(training): training groups - one decision for several riders (beta) (0d) — roed

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (115d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (115d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (113d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (112d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (105d)
- #2259 [chore] Supabase DB-hygiejne: ryd ~20 backup_*-tabeller + covering-index på unindexed for… (83d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (79d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (76d)
- #2650 [balance/HØJ] Fatigue-mætning i hele populationen: AI-median 100, human-median 90 — recov… (75d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (74d)
- #2688 AI-audit 19/7: Fable-optimering — workflow/judge-panels/effort-routing/ultra-review (ejer… (74d)
- #2794 [ux/IA] Løbssiden er informationsoverload: opdel ruteprofil / holdudtagelse / etape-takti… (70d)
- #2885 [feature] Sælg rytter til AI efter N mislykkede auktioner — udvej for hold der ikke kan k… (68d)
- #2887 [feature/balance] Sportsdirektør: gør senior-træningsstatten meningsfuld (påvirker den de… (68d)
- #2991 season_grand_tour_rider kan ingen menneskemanager opnå: Grand Tours er Division-1-only og… (67d)
- …og 56 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- ingen

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #5827 5268 rating-neutral mental ability dry run V3 (2d) — groen
- #6011 fix(training): settle double race-day riders on canonical load (#6009) (0d) — groen
- #6008 fix(training): Train now settles non-entered riders for autopick teams (#6006) (0d) — groen
- #6007 feat(squad): opt youth squads out of races (#5944) (0d) — groen
- #6010 feat(racehub): season matrix mobile view behind beta flag + chip cleanup (#5124) (0d) — groen

**Ikke-draft med roed tilstand:**

- #5829 docs(design): #5124 mobile season matrix options (0d) — roed
- #6001 feat(training): training groups - one decision for several riders (beta) (0d) — roed

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #419 Discord: Inviter Carl-bot + Dyno + konfigurér auto-mod (138d)
- #428 [community] Fast ugentlig kommunikations-rytme (Man/Ons/Soen) - LOEBENDE opgave (138d)
- #481 Brand identity overhaul — logo + design manual (once-and-for-all) (135d)
- #658 chore(ops): Schedule check-agent-token-hygiene.ps1 as local cron (Windows Task Scheduler) (128d)
- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (128d)
- #931 [Epic] Træningssystem — nøglerytterplaner først, individuel dybde senere (121d)
- #932 [Epic] Ungdomsakademi — intake, udvikling, promotion og ungdomsauktion (121d)
- #954 [Epic] Transparens-hub: Changelog / Patch notes / Roadmap (+ voting & styrings-score) (121d)
- #994 [ops] Harness-oprettede worktrees mangler node_modules + .env (auto-setup hook/script) (120d)
- #1136 [Epic] Progression & livscyklus — rytterudvikling, træning, ungdom (samler #930/#931/#932… (115d)
- #1140 Strømlin ny-spiller-onboarding til ét sammenhængende flow (konsolidér 6+ elementer) (115d)
- #1270 Session-hardening hooks: pre-push område-tests (D1) + dep-sync-vagt (D7) + kollisionsvars… (112d)
- #1299 Dynamiske OG share-billeder via @vercel/og (etaperesultat-kort) — før 20/6-relaunch (111d)
- #1407 SEO measurement layer: GSC + GA4 + Ahrefs + Morningscore korrekt opsat + ownership-doc (108d)
- #1441 Epic: langsigtet sammenhængende økonomi — anti-inflation, gold sinks, rigtige sponsorer (106d)
- …og 671 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #4915 [engine-v4] TTT- og passage-foelgesager foer flip: uheld/tidsgraense paa TTT, TTT-point,… (24d)
- #5485 [design] Traeningssiden: ingen scroll, faner/modals, det mest brugte oeverst, Clarity-dat… (9d)
- #5484 [bug] Discord-MCP-connector fejler med Connection closed i Claude Code-sessioner (22/9) (9d)
- #5519 [trupper] U23 team- og Junior team-sider + Academy-kortet bliver ægte (bag youth_squad_pa… (8d)
- #4629 [design] Traeningsprogrammer: ugeplan med session pr. ugedag + 10-25 default-programmer (… (29d)
- #5951 [bug/HØJ] v4: udbrud trækkes baglæns af jagten - indhentede udbrudsryttere taber op til 1… (1d)
- #5867 [ux] Automatisk påmindelse i spillet, når holdet har for få ryttere til at stille til sta… (3d)
