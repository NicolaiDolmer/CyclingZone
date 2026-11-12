# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

146 features i FEATURE_REGISTRY.yml: live 113 · beta 2 · dormant 8 · building 14 · spec 1 · idea 2 · retired 6.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #8052 feat(race-engine): trøjejagt efter ejerens tre valg (bag slukket kontakt) (0d) — groen
- #8056 feat(planning): planlaegningsside trin 1 bag beta-flag (Refs #7535) (0d) — roed
- #8059 feat(app): Google Play som TWA, app-pakke, assetlinks-skabelon og ejer-vejledning (Refs #… (0d) — roed
- #8061 test(race-engine): langt angreb trin 0, maalt udgangspunkt uden adfaerdsaendring (Refs #7… (0d) — groen
- #8022 fix(web): stabilize dashboard and auction loading (0d) — groen
- #8062 feat(race-page): løbssiden v6 trin 1, Resultater for en kørt etape bag slukket kontakt (R… (0d) — roed
- #8066 perf(training): Træn nu trin 1, det langsomme tjek i commit_training_date_tick som ét sam… (0d) — roed
- #8054 fix(training): træthed lige nu på Udtagelse, Holdfane og rytterkort (bag slukket kontakt)… (0d) — groen
- #8068 fix(board): parkerede hold faar ingen dom eller konsekvenser i den ugentlige bestyrelsesk… (0d) — groen

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #26 [feature] Transfer war-room (shortlist + sammenligning + budget-forecast) (190d)
- #930 [Epic] Staff & manager-rolle som direktør (ansatte, sportsdirektører, læger, fysioterapeu… (163d)
- #961 Kontekstuel hjaelp: omraade-specifikt FAQ-link overalt (banner -> ikon, progressive) (163d)
- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (157d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (157d)
- #1173 Vækst/viralitets-loop: referral (del spillet med en ven) (156d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (156d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (155d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (147d)
- #2236 Organic community outreach — Reddit + Discord posting (129d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (122d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (119d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (116d)
- #2885 [feature] Sælg rytter til AI efter N mislykkede auktioner — udvej for hold der ikke kan k… (110d)
- #2991 season_grand_tour_rider kan ingen menneskemanager opnå: Grand Tours er Division-1-only og… (110d)
- …og 75 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- ingen

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #8014 docs(tactics): langt angreb design og baseline (#7884) (0d) — groen
- #8041 feat(development): XP-motor dagsvariation + loebsdags-gulv bag slukket kontakt (Refs #611… (0d) — groen
- #8020 feat(web): scoped Query data for Dashboard and market (draft checkpoint) (0d) — roed

**Ikke-draft med roed tilstand:**

- #8056 feat(planning): planlaegningsside trin 1 bag beta-flag (Refs #7535) (0d) — roed
- #8059 feat(app): Google Play som TWA, app-pakke, assetlinks-skabelon og ejer-vejledning (Refs #… (0d) — roed
- #8062 feat(race-page): løbssiden v6 trin 1, Resultater for en kørt etape bag slukket kontakt (R… (0d) — roed
- #8066 perf(training): Træn nu trin 1, det langsomme tjek i commit_training_date_tick som ét sam… (0d) — roed

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (170d)
- #1569 Ny-spiller onboarding-audit (2026-06-20) — prioriteret handlingsplan (145d)
- #1819 Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup (141d)
- #2557 [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage i træk + favorit-w… (118d)
- #2682 AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til FAIL (116d)
- #2770 [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonussekunder (114d)
- #2822 [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste managerspil (112d)
- #2840 Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte rytt… (112d)
- #2884 [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-times-vind… (110d)
- #3154 [ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dage + fuld prioriteri… (105d)
- #3426 [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsler + for mange bjerg… (98d)
- #3511 [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashboard og må… (97d)
- #4010 Supabase-hærdning: realtime-MalformedJWT, sponsor-sweep, offset-paginering og getUser() p… (84d)
- #4159 [guard] game_day-aksen maa aldrig kunne skrives skaevt igen: DB-trigger + lane-packer-fix… (80d)
- #4321 [growth] PostHog (EU) som analytics-lag: kanal-attribution, funnels, retention + MCP-adga… (77d)
- …og 883 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #6299 [investigation] 'Work'-ordren ser ud til at angribe uden 'try the break' + 27 mand i udbr… (36d)
- #7003 [feature/taktik] Delt kaptajn + arbejd/angrib deles op, så modsatrettede ordrer ikke kan… (22d)
- #6156 [bug] Formtoppe og rytterform har ingen virkning i loeb siden v4-flippet 28/9 - spillerne… (39d)
- #6456 [motor] Tidsgab nr. 10 på bjergetaper uden topankomst og uden nedkørselsfinale har intet… (32d)
- #6649 [motor/design] Dagsform og dominans: de bedste vinder for ofte i forhold til virkeligheden (28d)
- #6668 [S5] AI-ungdom løftes til menneskeholdenes niveau + menneskehold samles i færre grupper (… (28d)
- #6804 [motor] Kuperede udbrudssejre: maalt baseline + design (26d)
- #6940 [motor] Gruppetto-ordre: ingen udbrud, energibesparelse efter etapetype (ejer-løfte 1/10) (23d)
- #7160 [motor v3] Udbrud vinder for sjældent på store bjergetaper: mål mod GT 2023-24 og ret i v3 (19d)
- #7290 [motor] Motoren kører bakkerne fra højdeprofilen (trin 2 af #7289) (16d)
- #7294 [bug/planlægning] Udtagelse i sæsonmatrix flytter visuelt til forkerte datoer indtil genå… (16d)
- #7474 [bug] Graduerings-sweep: to samtidige ticks afgjorde 7 ryttere to gange (dobbeltbesked) 1… (10d)
- #7663 [ops] #7659 trin 4: kort cache på app_config-kontakter + lokalt login-tjek (JWT) (8d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (119d)
- #7900 [løbsfilm] Filmens mål viser et andet hul end resultatlisten (sandhedsvagten R5) (4d)
- …og 29 mere
