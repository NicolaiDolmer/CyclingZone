# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

79 features i FEATURE_REGISTRY.yml: live 57 · beta 2 · dormant 5 · building 10 · spec 1 · idea 2 · retired 2.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #5894 feat: advar om for lille seniortrup før start (#5867) (1d) — groen
- #5829 docs(design): #5124 mobile season matrix options (1d) — DIRTY
- #5828 feat: show rider reputation visibility (1d) — groen
- #5959 fix(races): holdklassement ved lige tid følger UCI-reglen (#5952) (0d) — groen
- #5962 fix(training): preserve first-use condition and stop legacy sweep after cutover (0d) — roed

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (113d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (113d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (112d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (111d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (103d)
- #2259 [chore] Supabase DB-hygiejne: ryd ~20 backup_*-tabeller + covering-index på unindexed for… (81d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (78d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (75d)
- #2650 [balance/HØJ] Fatigue-mætning i hele populationen: AI-median 100, human-median 90 — recov… (73d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (73d)
- #2688 AI-audit 19/7: Fable-optimering — workflow/judge-panels/effort-routing/ultra-review (ejer… (72d)
- #2794 [ux/IA] Løbssiden er informationsoverload: opdel ruteprofil / holdudtagelse / etape-takti… (68d)
- #2885 [feature] Sælg rytter til AI efter N mislykkede auktioner — udvej for hold der ikke kan k… (66d)
- #2887 [feature/balance] Sportsdirektør: gør senior-træningsstatten meningsfuld (påvirker den de… (66d)
- #2991 season_grand_tour_rider kan ingen menneskemanager opnå: Grand Tours er Division-1-only og… (66d)
- …og 53 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- #5959 fix(races): holdklassement ved lige tid følger UCI-reglen (#5952) (0d) — groen

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #5827 5268 rating-neutral mental ability dry run V3 (1d) — groen

**Ikke-draft med roed tilstand:**

- #5962 fix(training): preserve first-use condition and stop legacy sweep after cutover (0d) — roed

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #419 Discord: Inviter Carl-bot + Dyno + konfigurér auto-mod (137d)
- #428 [community] Fast ugentlig kommunikations-rytme (Man/Ons/Soen) - LOEBENDE opgave (137d)
- #481 Brand identity overhaul — logo + design manual (once-and-for-all) (134d)
- #658 chore(ops): Schedule check-agent-token-hygiene.ps1 as local cron (Windows Task Scheduler) (127d)
- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (127d)
- #931 [Epic] Træningssystem — nøglerytterplaner først, individuel dybde senere (119d)
- #932 [Epic] Ungdomsakademi — intake, udvikling, promotion og ungdomsauktion (119d)
- #954 [Epic] Transparens-hub: Changelog / Patch notes / Roadmap (+ voting & styrings-score) (119d)
- #994 [ops] Harness-oprettede worktrees mangler node_modules + .env (auto-setup hook/script) (118d)
- #1136 [Epic] Progression & livscyklus — rytterudvikling, træning, ungdom (samler #930/#931/#932… (114d)
- #1140 Strømlin ny-spiller-onboarding til ét sammenhængende flow (konsolidér 6+ elementer) (114d)
- #1270 Session-hardening hooks: pre-push område-tests (D1) + dep-sync-vagt (D7) + kollisionsvars… (110d)
- #1299 Dynamiske OG share-billeder via @vercel/og (etaperesultat-kort) — før 20/6-relaunch (110d)
- #1407 SEO measurement layer: GSC + GA4 + Ahrefs + Morningscore korrekt opsat + ownership-doc (106d)
- #1441 Epic: langsigtet sammenhængende økonomi — anti-inflation, gold sinks, rigtige sponsorer (104d)
- …og 674 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #4453 [ops] Backendens Railway-logstrøm har ingen vagt — 25 strukturerede signaler går uset (si… (30d)
- #4915 [engine-v4] TTT- og passage-foelgesager foer flip: uheld/tidsgraense paa TTT, TTT-point,… (23d)
- #5485 [design] Traeningssiden: ingen scroll, faner/modals, det mest brugte oeverst, Clarity-dat… (7d)
- #5493 [analytics] Ahrefs Web Analytics-script (ungated, ingen GTM) + IndexNow-noeglefil (7d)
- #5484 [bug] Discord-MCP-connector fejler med Connection closed i Claude Code-sessioner (22/9) (7d)
- #5741 [economy] Ingen akademi-drift for U23-/juniorryttere ved S3-skiftet 27/9 (588 ryttere x 5… (4d)
- #5742 [trupper] Flyt-knappen hedder stadig 'Move to academy': skal sige U23/Junior med loft og… (4d)
- #5743 [trupper] U23-/juniorsiderne viser ikke loftet 12/10; My Team siger stadig 'academy (off-… (4d)
- #5748 [trupper] Flyt-dialogen: junior-alder rytter skal kunne vaelge U23 (opad altid tilladt) -… (4d)
- #5754 [board] Mandat-launch C: Mandat-fanen viser det foreslaaede mandat i stedet for et tomt r… (4d)
- #5753 [board] Mandat-launch B: 'The board's verdict' som highlight i saesonrecappen med formand… (4d)
- #5752 [board] Mandat-launch A: aarsmoedet indkaldes i samme minut som saesonskiftet + bestyrels… (4d)
- #5755 [board] Mandat-launch D: start-guidens bestyrelses-linje siger 'Sign your mandate' + till… (4d)
- #5437 [docs] NIGHT_WAVE_RUNBOOK.md: sed-korruption 4 steder, Regel 5 og 8 har mistet titel + te… (9d)
- #5677 [ops] guarded-merge: fil-ejerskab og state-laas blokerer merge af faerdige og ustartede s… (5d)
- …og 32 mere
