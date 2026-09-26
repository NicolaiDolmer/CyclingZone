# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

77 features i FEATURE_REGISTRY.yml: live 52 · beta 3 · dormant 5 · building 12 · spec 1 · idea 2 · retired 2.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #5705 chore(deps): Bump intl-messageformat from 11.2.14 to 12.1.0 in /frontend (0d) — roed
- #5281 [traening] B3-rest: fjern manager-klik-bonussen (bonusMult) + spor (#4847) (0d) — groen
- #5766 feat(training,squad): U23/JR-mærke i træningstabellen + seniorer-bliver-hint (#5763, #551… (0d) — groen
- #5765 docs: mockup /roadmap i faner (variant A/B) + vis-kun-ustemte (0d) — groen
- #5767 docs(drafts): samlet spilleropslag om saesonskiftet S3->S4 (EN + DA) (0d) — groen
- #5768 feat(engine-v4): win type from the finale, not a placeholder (#5577) (0d) — groen
- #5769 feat(training): show training score in the training report (0d) — groen
- #5770 fix(career): count ALL prior wins across seasons, not a bounded 30-row window (#5733) (0d) — groen
- #5771 feat(training): rider name in training card links to profile (#5735) (0d) — groen
- #5772 feat(sponsors): forklar at sponsorbeloeb foelger klubbens omdoemme (0d) — groen
- #5774 test(boardroom): automatiske layout-guard-tests (390 + 1440) - fund 6 #5633 (0d) — groen
- #5777 fix(compare): don't highlight either rider when compared stats tie (#5316) (0d) — groen
- #5778 docs(runbook): gendan sed-korrupte Regel 5/8 + VERCEL_GIT_PREVIOUS_SHA i NIGHT_WAVE_RUNBO… (0d) — groen
- #5775 fix(dashboard): Full standings link lands on own group, not whole division (0d) — groen
- #5773 fix(e2e): wait for i18n init before language switch in 4851-training-score (#5747) (0d) — roed
- …og 4 mere

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (109d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (109d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (108d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (107d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (99d)
- #2259 [chore] Supabase DB-hygiejne: ryd ~20 backup_*-tabeller + covering-index på unindexed for… (77d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (74d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (71d)
- #2650 [balance/HØJ] Fatigue-mætning i hele populationen: AI-median 100, human-median 90 — recov… (69d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (69d)
- #2688 AI-audit 19/7: Fable-optimering — workflow/judge-panels/effort-routing/ultra-review (ejer… (69d)
- #2794 [ux/IA] Løbssiden er informationsoverload: opdel ruteprofil / holdudtagelse / etape-takti… (65d)
- #2885 [feature] Sælg rytter til AI efter N mislykkede auktioner — udvej for hold der ikke kan k… (62d)
- #2887 [feature/balance] Sportsdirektør: gør senior-træningsstatten meningsfuld (påvirker den de… (62d)
- #2991 season_grand_tour_rider kan ingen menneskemanager opnå: Grand Tours er Division-1-only og… (62d)
- …og 43 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- #5784 chore(ops): generate docs/STATUS_BOARD.md from FEATURE_REGISTRY + GitHub (#5674) (0d) — groen

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #5444 feat(economy): V4 re-fit mod ny ryttertype-inddeling, kandidat-model + scorecard (Refs #3… (1d) — DIRTY
- #5461 docs(economy): vaerdiskifte patch note + help.json (MERGES FOERST PAA KOERSELS-DAGEN) (1d) — DIRTY
- #5776 fix(notifications): stage_result-link lander paa etapens resultat (#5317) (0d) — groen
- #5783 feat(season-end): vis klassikersejre i sæson-recappen (0d) — groen
- #5784 chore(ops): generate docs/STATUS_BOARD.md from FEATURE_REGISTRY + GitHub (#5674) (0d) — groen
- #5785 fix(ops): guarded-merge file ownership + state-lock fallback (#5677) (0d) — groen

**Ikke-draft med roed tilstand:**

- #5705 chore(deps): Bump intl-messageformat from 11.2.14 to 12.1.0 in /frontend (0d) — roed
- #5773 fix(e2e): wait for i18n init before language switch in 4851-training-score (#5747) (0d) — roed

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #419 Discord: Inviter Carl-bot + Dyno + konfigurér auto-mod (133d)
- #428 [community] Fast ugentlig kommunikations-rytme (Man/Ons/Soen) - LOEBENDE opgave (133d)
- #481 Brand identity overhaul — logo + design manual (once-and-for-all) (130d)
- #658 chore(ops): Schedule check-agent-token-hygiene.ps1 as local cron (Windows Task Scheduler) (123d)
- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (123d)
- #931 [Epic] Træningssystem — nøglerytterplaner først, individuel dybde senere (115d)
- #932 [Epic] Ungdomsakademi — intake, udvikling, promotion og ungdomsauktion (115d)
- #954 [Epic] Transparens-hub: Changelog / Patch notes / Roadmap (+ voting & styrings-score) (115d)
- #1136 [Epic] Progression & livscyklus — rytterudvikling, træning, ungdom (samler #930/#931/#932… (110d)
- #1140 Strømlin ny-spiller-onboarding til ét sammenhængende flow (konsolidér 6+ elementer) (110d)
- #1270 Session-hardening hooks: pre-push område-tests (D1) + dep-sync-vagt (D7) + kollisionsvars… (106d)
- #1299 Dynamiske OG share-billeder via @vercel/og (etaperesultat-kort) — før 20/6-relaunch (106d)
- #1407 SEO measurement layer: GSC + GA4 + Ahrefs + Morningscore korrekt opsat + ownership-doc (102d)
- #1441 Epic: langsigtet sammenhængende økonomi — anti-inflation, gold sinks, rigtige sponsorer (100d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (99d)
- …og 578 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #4453 [ops] Backendens Railway-logstrøm har ingen vagt — 25 strukturerede signaler går uset (si… (26d)
- #4915 [engine-v4] TTT- og passage-foelgesager foer flip: uheld/tidsgraense paa TTT, TTT-point,… (19d)
- #5485 [design] Traeningssiden: ingen scroll, faner/modals, det mest brugte oeverst, Clarity-dat… (3d)
- #5493 [analytics] Ahrefs Web Analytics-script (ungated, ingen GTM) + IndexNow-noeglefil (3d)
- #5484 [bug] Discord-MCP-connector fejler med Connection closed i Claude Code-sessioner (22/9) (3d)
- #5519 [trupper] U23 team- og Junior team-sider + Academy-kortet bliver ægte (bag youth_squad_pa… (3d)
- #5741 [economy] Ingen akademi-drift for U23-/juniorryttere ved S3-skiftet 27/9 (588 ryttere x 5… (0d)
- #5742 [trupper] Flyt-knappen hedder stadig 'Move to academy': skal sige U23/Junior med loft og… (0d)
- #5743 [trupper] U23-/juniorsiderne viser ikke loftet 12/10; My Team siger stadig 'academy (off-… (0d)
- #5751 [bestyrelse beta] Boardroom viser stadig gammelt maal efter forhandling: negotiated_at er… (0d)
- #5748 [trupper] Flyt-dialogen: junior-alder rytter skal kunne vaelge U23 (opad altid tilladt) -… (0d)
- #5754 [board] Mandat-launch C: Mandat-fanen viser det foreslaaede mandat i stedet for et tomt r… (0d)
- #5753 [board] Mandat-launch B: 'The board's verdict' som highlight i saesonrecappen med formand… (0d)
- #5752 [board] Mandat-launch A: aarsmoedet indkaldes i samme minut som saesonskiftet + bestyrels… (0d)
- #5755 [board] Mandat-launch D: start-guidens bestyrelses-linje siger 'Sign your mandate' + till… (0d)
