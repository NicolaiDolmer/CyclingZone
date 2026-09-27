# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

77 features i FEATURE_REGISTRY.yml: live 53 · beta 3 · dormant 5 · building 11 · spec 1 · idea 2 · retired 2.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #5705 chore(deps): Bump intl-messageformat from 11.2.14 to 12.1.0 in /frontend (1d) — roed
- #5281 [traening] B3-rest: fjern manager-klik-bonussen (bonusMult) + spor (#4847) (1d) — groen
- #5786 docs(help): U23/junior hjaelpetekster + pyramide 1/2/4/4 + patch note-udkast (#5519) (0d) — groen
- #5782 feat(training): show % of a point a session moved the ability (#5539) (0d) — groen
- #5809 fix(races): Race Hub auto-fill no longer double-books a rider on one race day (Refs #5789) (0d) — groen
- #5803 fix(calendar): GT-raekkefoelgen Giro -> Tour -> Vuelta + ingen GT paa saesonens foerste d… (0d) — groen
- #5801 feat(training): training programs per race day + 22 standard programs, beta (Refs #4629) (0d) — groen
- #5815 feat(email): tilmeldings-påmindelse før parkering, ny mailtype season_signup_reminder (Re… (0d) — groen
- #5810 fix(squad,training): U23/junior sorterer efter efternavn + mobil-sortering over tabellen… (0d) — groen
- #5800 feat(economy): upkeep pr. seniorloebsdag bag flag upkeep_per_race_day (Refs #4385) (0d) — groen

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (110d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (110d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (109d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (108d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (100d)
- #2259 [chore] Supabase DB-hygiejne: ryd ~20 backup_*-tabeller + covering-index på unindexed for… (78d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (75d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (72d)
- #2650 [balance/HØJ] Fatigue-mætning i hele populationen: AI-median 100, human-median 90 — recov… (70d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (70d)
- #2688 AI-audit 19/7: Fable-optimering — workflow/judge-panels/effort-routing/ultra-review (ejer… (70d)
- #2794 [ux/IA] Løbssiden er informationsoverload: opdel ruteprofil / holdudtagelse / etape-takti… (66d)
- #2885 [feature] Sælg rytter til AI efter N mislykkede auktioner — udvej for hold der ikke kan k… (63d)
- #2887 [feature/balance] Sportsdirektør: gør senior-træningsstatten meningsfuld (påvirker den de… (63d)
- #2991 season_grand_tour_rider kan ingen menneskemanager opnå: Grand Tours er Division-1-only og… (63d)
- …og 43 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- #5801 feat(training): training programs per race day + 22 standard programs, beta (Refs #4629) (0d) — groen

## 3) Bygget men ikke merget
**Draft-PR'er:**

- ingen

**Ikke-draft med roed tilstand:**

- #5705 chore(deps): Bump intl-messageformat from 11.2.14 to 12.1.0 in /frontend (1d) — roed

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #419 Discord: Inviter Carl-bot + Dyno + konfigurér auto-mod (134d)
- #428 [community] Fast ugentlig kommunikations-rytme (Man/Ons/Soen) - LOEBENDE opgave (134d)
- #481 Brand identity overhaul — logo + design manual (once-and-for-all) (131d)
- #658 chore(ops): Schedule check-agent-token-hygiene.ps1 as local cron (Windows Task Scheduler) (124d)
- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (124d)
- #931 [Epic] Træningssystem — nøglerytterplaner først, individuel dybde senere (116d)
- #932 [Epic] Ungdomsakademi — intake, udvikling, promotion og ungdomsauktion (116d)
- #954 [Epic] Transparens-hub: Changelog / Patch notes / Roadmap (+ voting & styrings-score) (116d)
- #1136 [Epic] Progression & livscyklus — rytterudvikling, træning, ungdom (samler #930/#931/#932… (111d)
- #1140 Strømlin ny-spiller-onboarding til ét sammenhængende flow (konsolidér 6+ elementer) (111d)
- #1270 Session-hardening hooks: pre-push område-tests (D1) + dep-sync-vagt (D7) + kollisionsvars… (107d)
- #1299 Dynamiske OG share-billeder via @vercel/og (etaperesultat-kort) — før 20/6-relaunch (107d)
- #1407 SEO measurement layer: GSC + GA4 + Ahrefs + Morningscore korrekt opsat + ownership-doc (103d)
- #1441 Epic: langsigtet sammenhængende økonomi — anti-inflation, gold sinks, rigtige sponsorer (101d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (100d)
- …og 585 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #4453 [ops] Backendens Railway-logstrøm har ingen vagt — 25 strukturerede signaler går uset (si… (27d)
- #4915 [engine-v4] TTT- og passage-foelgesager foer flip: uheld/tidsgraense paa TTT, TTT-point,… (20d)
- #5485 [design] Traeningssiden: ingen scroll, faner/modals, det mest brugte oeverst, Clarity-dat… (4d)
- #5493 [analytics] Ahrefs Web Analytics-script (ungated, ingen GTM) + IndexNow-noeglefil (4d)
- #5484 [bug] Discord-MCP-connector fejler med Connection closed i Claude Code-sessioner (22/9) (4d)
- #5741 [economy] Ingen akademi-drift for U23-/juniorryttere ved S3-skiftet 27/9 (588 ryttere x 5… (1d)
- #5742 [trupper] Flyt-knappen hedder stadig 'Move to academy': skal sige U23/Junior med loft og… (1d)
- #5743 [trupper] U23-/juniorsiderne viser ikke loftet 12/10; My Team siger stadig 'academy (off-… (1d)
- #5751 [bestyrelse beta] Boardroom viser stadig gammelt maal efter forhandling: negotiated_at er… (1d)
- #5748 [trupper] Flyt-dialogen: junior-alder rytter skal kunne vaelge U23 (opad altid tilladt) -… (1d)
- #5754 [board] Mandat-launch C: Mandat-fanen viser det foreslaaede mandat i stedet for et tomt r… (1d)
- #5753 [board] Mandat-launch B: 'The board's verdict' som highlight i saesonrecappen med formand… (1d)
- #5752 [board] Mandat-launch A: aarsmoedet indkaldes i samme minut som saesonskiftet + bestyrels… (1d)
- #5755 [board] Mandat-launch D: start-guidens bestyrelses-linje siger 'Sign your mandate' + till… (1d)
- #5437 [docs] NIGHT_WAVE_RUNBOOK.md: sed-korruption 4 steder, Regel 5 og 8 har mistet titel + te… (6d)
- …og 19 mere
