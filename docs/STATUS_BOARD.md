# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

80 features i FEATURE_REGISTRY.yml: live 57 · beta 3 · dormant 5 · building 10 · spec 1 · idea 2 · retired 2.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #6053 feat(training): Programs - pick rider or group first, then the program (#6035) (0d) — groen
- #6037 chore(deps): Bump @sentry/node from 10.75.3 to 11.0.0 in /backend (0d) — roed
- #6043 chore(deps-dev): Bump eslint from 9.39.5 to 10.11.0 in /marketing (0d) — roed
- #6040 chore(deps): Bump @sentry/react from 10.75.3 to 11.0.0 in /frontend (0d) — groen
- #6085 chore(deps): Bump anthropics/claude-code-action from 1.0.234 to 1.0.235 in the gha-all gr… (0d) — groen
- #6107 perf(flags): batch player-visible config reads (Refs #6103) (0d) — groen

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (116d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (116d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (115d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (114d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (106d)
- #2259 [chore] Supabase DB-hygiejne: ryd ~20 backup_*-tabeller + covering-index på unindexed for… (84d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (81d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (78d)
- #2650 [balance/HØJ] Fatigue-mætning i hele populationen: AI-median 100, human-median 90 — recov… (76d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (75d)
- #2688 AI-audit 19/7: Fable-optimering — workflow/judge-panels/effort-routing/ultra-review (ejer… (75d)
- #2794 [ux/IA] Løbssiden er informationsoverload: opdel ruteprofil / holdudtagelse / etape-takti… (71d)
- #2885 [feature] Sælg rytter til AI efter N mislykkede auktioner — udvej for hold der ikke kan k… (69d)
- #2887 [feature/balance] Sportsdirektør: gør senior-træningsstatten meningsfuld (påvirker den de… (69d)
- #2991 season_grand_tour_rider kan ingen menneskemanager opnå: Grand Tours er Division-1-only og… (68d)
- …og 56 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- ingen

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #5827 5268 rating-neutral mental ability dry run V3 (4d) — groen

**Ikke-draft med roed tilstand:**

- #6037 chore(deps): Bump @sentry/node from 10.75.3 to 11.0.0 in /backend (0d) — roed
- #6043 chore(deps-dev): Bump eslint from 9.39.5 to 10.11.0 in /marketing (0d) — roed

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #419 Discord: Inviter Carl-bot + Dyno + konfigurér auto-mod (139d)
- #428 [community] Fast ugentlig kommunikations-rytme (Man/Ons/Soen) - LOEBENDE opgave (139d)
- #481 Brand identity overhaul — logo + design manual (once-and-for-all) (137d)
- #658 chore(ops): Schedule check-agent-token-hygiene.ps1 as local cron (Windows Task Scheduler) (130d)
- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (129d)
- #931 [Epic] Træningssystem — nøglerytterplaner først, individuel dybde senere (122d)
- #932 [Epic] Ungdomsakademi — intake, udvikling, promotion og ungdomsauktion (122d)
- #954 [Epic] Transparens-hub: Changelog / Patch notes / Roadmap (+ voting & styrings-score) (122d)
- #994 [ops] Harness-oprettede worktrees mangler node_modules + .env (auto-setup hook/script) (121d)
- #1136 [Epic] Progression & livscyklus — rytterudvikling, træning, ungdom (samler #930/#931/#932… (117d)
- #1140 Strømlin ny-spiller-onboarding til ét sammenhængende flow (konsolidér 6+ elementer) (117d)
- #1270 Session-hardening hooks: pre-push område-tests (D1) + dep-sync-vagt (D7) + kollisionsvars… (113d)
- #1299 Dynamiske OG share-billeder via @vercel/og (etaperesultat-kort) — før 20/6-relaunch (113d)
- #1407 SEO measurement layer: GSC + GA4 + Ahrefs + Morningscore korrekt opsat + ownership-doc (109d)
- #1441 Epic: langsigtet sammenhængende økonomi — anti-inflation, gold sinks, rigtige sponsorer (107d)
- …og 684 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #4915 [engine-v4] TTT- og passage-foelgesager foer flip: uheld/tidsgraense paa TTT, TTT-point,… (26d)
- #5485 [design] Traeningssiden: ingen scroll, faner/modals, det mest brugte oeverst, Clarity-dat… (10d)
- #5484 [bug] Discord-MCP-connector fejler med Connection closed i Claude Code-sessioner (22/9) (10d)
- #5519 [trupper] U23 team- og Junior team-sider + Academy-kortet bliver ægte (bag youth_squad_pa… (9d)
- #4629 [design] Traeningsprogrammer: ugeplan med session pr. ugedag + 10-25 default-programmer (… (30d)
- #5951 [bug/HØJ] v4: udbrud trækkes baglæns af jagten - indhentede udbrudsryttere taber op til 1… (3d)
- #5867 [ux] Automatisk påmindelse i spillet, når holdet har for få ryttere til at stille til sta… (4d)
- #6004 [bug/brand] Trænings-datolukning genkører 143 hold hvert 5. min (41.000 Supabase-fejl/døg… (1d)
- #5956 [bug] Bjergpoint uddeles på flad enkeltstart (6 point til nr. 1) - ejer: "Det må jeg lige… (3d)
- #4956 [omdoemme] PR 3: synlighed (profil/marked/auktion, ordbaand + hvorfor-liste) + bestyrelse… (25d)
- #6000 [træning] Træningsgrupper: én beslutning for flere ryttere (ejer 1/10) (1d)
- #6006 [bug/brand] Train now (beta) træner kun 10 af 45 ryttere: autopick-hold behandles som om… (1d)
- #6009 [bug] 2 ryttere kørte 2 løb på samme løbsdag (S4 dag 12) → holdets træning 30/9 kan ikke… (1d)
- #5944 [feature] Fravælg U23-/juniorløb pr. trup - assistenten tilmelder automatisk (knud_r_flin… (3d)
- #5915 [ux] Træningsrapporten og rytteren viser kun én af datoens 5 løbsdage: spillere læser det… (3d)
- …og 26 mere
