# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

88 features i FEATURE_REGISTRY.yml: live 67 · beta 3 · dormant 3 · building 10 · spec 1 · idea 2 · retired 2.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #6248 fix(training): maks +1 pr. evne pr. rytter pr. dato, fælles værn (Refs #6210) (5d) — groen
- #6535 chore(deps): ugentlig lockfile-maintenance (0d) — groen
- #6538 perf(training): rider_training_seen erstatter GIN-opslag i training_day_runs (#6490) (0d) — groen

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #605 P0: Codex verdensklasse — markant hurtigere leverancer med målt kvalitet (140d)
- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (126d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (126d)
- #1173 Vækst/viralitets-loop: referral (del spillet med en ven) (125d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (125d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (123d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (116d)
- #2236 Organic community outreach — Reddit + Discord posting (97d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (90d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (88d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (85d)
- #2794 [ux/IA] Løbssiden er informationsoverload: opdel ruteprofil / holdudtagelse / etape-takti… (81d)
- #2806 [monetization] /pro er ikke linket fra appen, og isPro() gater ingen funktionalitet (81d)
- #2885 [feature] Sælg rytter til AI efter N mislykkede auktioner — udvej for hold der ikke kan k… (79d)
- #2991 season_grand_tour_rider kan ingen menneskemanager opnå: Grand Tours er Division-1-only og… (78d)
- …og 61 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- #6248 fix(training): maks +1 pr. evne pr. rytter pr. dato, fælles værn (Refs #6210) (5d) — groen
- #6538 perf(training): rider_training_seen erstatter GIN-opslag i training_day_runs (#6490) (0d) — groen

## 3) Bygget men ikke merget
**Draft-PR'er:**

- ingen

**Ikke-draft med roed tilstand:**

- ingen

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (139d)
- #1569 Ny-spiller onboarding-audit (2026-06-20) — prioriteret handlingsplan (114d)
- #1819 Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup (110d)
- #2557 [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage i træk + favorit-w… (87d)
- #2682 AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til FAIL (85d)
- #2770 [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonussekunder (83d)
- #2822 [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste managerspil (81d)
- #2840 Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte rytt… (81d)
- #2884 [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-times-vind… (79d)
- #3154 [ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dage + fuld prioriteri… (74d)
- #3426 [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsler + for mange bjerg… (67d)
- #3461 [bug/balance] Restitutionens timing: 'Træn i dag' om morgenen brænder dagens eneste resti… (67d)
- #3511 [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashboard og må… (66d)
- #3564 [design] Progressionskæden samlet: potentiale 1-99, lofter pr. ryttertype, træningsscore,… (64d)
- #3855 [design] Race engine v4: intra-etape-motoren — etapen beregnes undervejs (ejer-retning 17… (55d)
- …og 733 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #5947 [bug] Udviklingshistorikken: gårsdagens stigninger mangler hos nogle ryttere, andre steg… (12d)
- #5845 [docs] Ejer-direktiv 27/9: roadmappen opdateres torsdag 1/10 (14d)
- #6350 [race-film] Hændelser får motorens tjektidspunkt, ikke tidspunktet de skete (4d)
- #6428 [race-engine/v4] Kuperet endagsløb: udbruddet vinder med 9-16 min til feltet under offici… (2d)
- #6456 [motor] Tidsgab nr. 10 på bjergetaper uden topankomst og uden nedkørselsfinale har intet… (1d)
- #5842 [bug] Ejer-direktiv 27/9: rytterværdierne ændrede sig søndag ved sæsonskiftet - det må de… (14d)
- #6464 [motor] Bjerg i D2-D4: nr. 10 er 3-8 min efter vinderen på topankomster (mål 1:00-2:30 i… (1d)
- #6500 Udvikling 2.0 del 1: ingen daglig udvikling uden for managerhold (D6, bag flag) (0d)
- #6499 Udvikling 2.0 del 1: tilbagegang D4 ved sæsonskiftet + prøvekørsel (bag flag) (0d)
- #5162 [Epic] Chunk-fejl CYCLINGZONE-56: samlet aarsagskaede og rettelsesplan efter Codex-audit… (31d)
- #6206 [bug/ungdom] EXP-ikon for udløbende kontrakt mangler på U23 og junior (Discord 5/10) (7d)
- #5943 [bug] Oprykning junior til U23 viser alder 16 for ryttere der er 19 (ez4prebren 28/9) (12d)
- #6473 [notifikationer] Ulæst-tælleren viser beskeder, der allerede er læst (flere faner, Edge)… (1d)
- #6385 [bug] Ingen overbudt-notifikation ved auktion - sket to gange paa faa dage (knud_r_flink… (3d)
- #6386 [bug] Ulaest-badgen bliver staaende efter 'marker alle som laest' og paa tvaers af faner… (3d)
- …og 3 mere
