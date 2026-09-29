# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

79 features i FEATURE_REGISTRY.yml: live 57 · beta 2 · dormant 5 · building 10 · spec 1 · idea 2 · retired 2.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #5705 chore(deps): Bump intl-messageformat from 11.2.14 to 12.1.0 in /frontend (3d) — roed
- #5910 fix(ci): genkend dagsafgrænset træningsquery (#5896) (0d) — groen
- #5889 fix(auctions): resolve acquisition season across cutover (#5847) (0d) — roed
- #5894 feat: advar om for lille seniortrup før start (#5867) (0d) — roed
- #5829 docs(design): #5124 mobile season matrix options (0d) — DIRTY
- #5828 feat: show rider reputation visibility (0d) — roed

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (112d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (112d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (111d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (110d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (102d)
- #2259 [chore] Supabase DB-hygiejne: ryd ~20 backup_*-tabeller + covering-index på unindexed for… (80d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (77d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (74d)
- #2650 [balance/HØJ] Fatigue-mætning i hele populationen: AI-median 100, human-median 90 — recov… (72d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (72d)
- #2688 AI-audit 19/7: Fable-optimering — workflow/judge-panels/effort-routing/ultra-review (ejer… (72d)
- #2794 [ux/IA] Løbssiden er informationsoverload: opdel ruteprofil / holdudtagelse / etape-takti… (68d)
- #2885 [feature] Sælg rytter til AI efter N mislykkede auktioner — udvej for hold der ikke kan k… (65d)
- #2887 [feature/balance] Sportsdirektør: gør senior-træningsstatten meningsfuld (påvirker den de… (65d)
- #2991 season_grand_tour_rider kan ingen menneskemanager opnå: Grand Tours er Division-1-only og… (65d)
- …og 50 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- #5889 fix(auctions): resolve acquisition season across cutover (#5847) (0d) — roed

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #5827 5268 rating-neutral mental ability dry run V3 (0d) — groen

**Ikke-draft med roed tilstand:**

- #5705 chore(deps): Bump intl-messageformat from 11.2.14 to 12.1.0 in /frontend (3d) — roed
- #5889 fix(auctions): resolve acquisition season across cutover (#5847) (0d) — roed
- #5894 feat: advar om for lille seniortrup før start (#5867) (0d) — roed
- #5828 feat: show rider reputation visibility (0d) — roed

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #419 Discord: Inviter Carl-bot + Dyno + konfigurér auto-mod (136d)
- #428 [community] Fast ugentlig kommunikations-rytme (Man/Ons/Soen) - LOEBENDE opgave (136d)
- #481 Brand identity overhaul — logo + design manual (once-and-for-all) (133d)
- #658 chore(ops): Schedule check-agent-token-hygiene.ps1 as local cron (Windows Task Scheduler) (126d)
- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (126d)
- #931 [Epic] Træningssystem — nøglerytterplaner først, individuel dybde senere (119d)
- #932 [Epic] Ungdomsakademi — intake, udvikling, promotion og ungdomsauktion (119d)
- #954 [Epic] Transparens-hub: Changelog / Patch notes / Roadmap (+ voting & styrings-score) (118d)
- #1136 [Epic] Progression & livscyklus — rytterudvikling, træning, ungdom (samler #930/#931/#932… (113d)
- #1140 Strømlin ny-spiller-onboarding til ét sammenhængende flow (konsolidér 6+ elementer) (113d)
- #1270 Session-hardening hooks: pre-push område-tests (D1) + dep-sync-vagt (D7) + kollisionsvars… (110d)
- #1299 Dynamiske OG share-billeder via @vercel/og (etaperesultat-kort) — før 20/6-relaunch (109d)
- #1407 SEO measurement layer: GSC + GA4 + Ahrefs + Morningscore korrekt opsat + ownership-doc (105d)
- #1441 Epic: langsigtet sammenhængende økonomi — anti-inflation, gold sinks, rigtige sponsorer (103d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (102d)
- …og 651 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #4453 [ops] Backendens Railway-logstrøm har ingen vagt — 25 strukturerede signaler går uset (si… (29d)
- #4915 [engine-v4] TTT- og passage-foelgesager foer flip: uheld/tidsgraense paa TTT, TTT-point,… (22d)
- #5485 [design] Traeningssiden: ingen scroll, faner/modals, det mest brugte oeverst, Clarity-dat… (6d)
- #5493 [analytics] Ahrefs Web Analytics-script (ungated, ingen GTM) + IndexNow-noeglefil (6d)
- #5484 [bug] Discord-MCP-connector fejler med Connection closed i Claude Code-sessioner (22/9) (6d)
- #5741 [economy] Ingen akademi-drift for U23-/juniorryttere ved S3-skiftet 27/9 (588 ryttere x 5… (3d)
- #5742 [trupper] Flyt-knappen hedder stadig 'Move to academy': skal sige U23/Junior med loft og… (3d)
- #5743 [trupper] U23-/juniorsiderne viser ikke loftet 12/10; My Team siger stadig 'academy (off-… (3d)
- #5748 [trupper] Flyt-dialogen: junior-alder rytter skal kunne vaelge U23 (opad altid tilladt) -… (3d)
- #5754 [board] Mandat-launch C: Mandat-fanen viser det foreslaaede mandat i stedet for et tomt r… (3d)
- #5753 [board] Mandat-launch B: 'The board's verdict' som highlight i saesonrecappen med formand… (3d)
- #5752 [board] Mandat-launch A: aarsmoedet indkaldes i samme minut som saesonskiftet + bestyrels… (3d)
- #5755 [board] Mandat-launch D: start-guidens bestyrelses-linje siger 'Sign your mandate' + till… (3d)
- #5437 [docs] NIGHT_WAVE_RUNBOOK.md: sed-korruption 4 steder, Regel 5 og 8 har mistet titel + te… (8d)
- #5677 [ops] guarded-merge: fil-ejerskab og state-laas blokerer merge af faerdige og ustartede s… (4d)
- …og 29 mere
