# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

126 features i FEATURE_REGISTRY.yml: live 105 · dormant 7 · building 5 · spec 1 · idea 2 · retired 6.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #6665 feat(marketing): ny forside med godkendt tekst og ægte produktbilleder (#1369) (0d) — roed
- #7571 fix(ops): frigiv bølger efter dokumenteret stop af Windows-børn (0d) — roed
- #7528 fix(ops): require prod evidence before player-report builds (0d) — groen
- #7602 fix(scouting): missionsbesked viser aldrig råt antal ved fejlet synlighedsopslag (#6138) (0d) — groen
- #7531 fix(ops): preserve TOML value comment boundaries (0d) — groen
- #7532 fix(test): bound harness schema drift (#2635) (0d) — groen
- #7529 fix(ops): recover owned git probe markers safely (0d) — groen
- #7615 refactor(types): konverter ejerskabsaudit til TypeScript (0d) — DIRTY
- #7616 refactor(types): konverter akademiets pull-flag til TypeScript (0d) — groen
- #7617 refactor(types): konverter finaliseringens resume-flag til TypeScript (0d) — groen
- #7618 refactor(types): konverter ejerskabets invariant-vagt til TypeScript (0d) — groen
- #7619 refactor(types): konverter afslutningsvagten til TypeScript (0d) — groen
- #7670 feat(race-engine): #7640 tænd-ledning app_config -> raceRunner -> broen (slukket) (0d) — groen
- #7669 feat(6110): Udvikling 2.0 trin 2-3: migration (skjult grundtalent, gemte skøn) + potentia… (0d) — roed
- #7672 feat(roadmap-admin): faner, filtre og sortering (Refs #6204) (0d) — roed
- …og 9 mere

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #26 [feature] Transfer war-room (shortlist + sammenligning + budget-forecast) (182d)
- #605 P0: Codex verdensklasse — markant hurtigere leverancer med målt kvalitet (164d)
- #930 [Epic] Staff & manager-rolle som direktør (ansatte, sportsdirektører, læger, fysioterapeu… (155d)
- #961 Kontekstuel hjaelp: omraade-specifikt FAQ-link overalt (banner -> ikon, progressive) (155d)
- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (149d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (149d)
- #1173 Vækst/viralitets-loop: referral (del spillet med en ven) (148d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (148d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (147d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (139d)
- #2236 Organic community outreach — Reddit + Discord posting (121d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (114d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (111d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (108d)
- #2885 [feature] Sælg rytter til AI efter N mislykkede auktioner — udvej for hold der ikke kan k… (102d)
- …og 58 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- #7571 fix(ops): frigiv bølger efter dokumenteret stop af Windows-børn (0d) — roed
- #7528 fix(ops): require prod evidence before player-report builds (0d) — groen
- #7532 fix(test): bound harness schema drift (#2635) (0d) — groen
- #7529 fix(ops): recover owned git probe markers safely (0d) — groen
- #7669 feat(6110): Udvikling 2.0 trin 2-3: migration (skjult grundtalent, gemte skøn) + potentia… (0d) — roed
- #7524 fix(ops): reject broad shared directory ownership (0d) — groen
- #7667 perf(db): team_race_points_mv billigere at refreshe (#7664) (0d) — roed

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #7652 docs: beslutningspakke om vækst og varig fastholdelse (#7495) (0d) — groen
- #7661 docs(research): del B-grundlag og PC1-handoff (0d) — groen
- #7680 fix(7624): kopiér til næste etape er aldrig en lydløs no-op (0d) — groen

**Ikke-draft med roed tilstand:**

- #6665 feat(marketing): ny forside med godkendt tekst og ægte produktbilleder (#1369) (0d) — roed
- #7571 fix(ops): frigiv bølger efter dokumenteret stop af Windows-børn (0d) — roed
- #7669 feat(6110): Udvikling 2.0 trin 2-3: migration (skjult grundtalent, gemte skøn) + potentia… (0d) — roed
- #7672 feat(roadmap-admin): faner, filtre og sortering (Refs #6204) (0d) — roed
- #7674 ops(db-vagt): alarm ved DB-genstart, 5xx-stigning og langsomme forespørgsler (#7662) (0d) — roed
- #7671 ops(backend): kort cache på app_config-kontakter + lokalt login-tjek (#7663) (0d) — roed
- #7667 perf(db): team_race_points_mv billigere at refreshe (#7664) (0d) — roed
- #7681 docs(plan): Codex del B og ops-PR'er i planen + merge-fokus (0d) — roed

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (162d)
- #1569 Ny-spiller onboarding-audit (2026-06-20) — prioriteret handlingsplan (137d)
- #1819 Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup (133d)
- #2557 [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage i træk + favorit-w… (110d)
- #2682 AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til FAIL (108d)
- #2770 [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonussekunder (106d)
- #2822 [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste managerspil (104d)
- #2840 Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte rytt… (104d)
- #2884 [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-times-vind… (102d)
- #3154 [ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dage + fuld prioriteri… (97d)
- #3426 [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsler + for mange bjerg… (90d)
- #3511 [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashboard og må… (89d)
- #3564 [design] Progressionskæden samlet: potentiale 1-99, lofter pr. ryttertype, træningsscore,… (87d)
- #4010 Supabase-hærdning: realtime-MalformedJWT, sponsor-sweep, offset-paginering og getUser() p… (76d)
- #4159 [guard] game_day-aksen maa aldrig kunne skrives skaevt igen: DB-trigger + lane-packer-fix… (72d)
- …og 780 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #6299 [investigation] 'Work'-ordren ser ud til at angribe uden 'try the break' + 27 mand i udbr… (28d)
- #6472 [motor] Rullende etaper føles forkerte: bedste rutematch ender ikke forrest (friisisch 11… (24d)
- #7214 [motor] Udbrud i monumenter behandles som andre løb (10d)
- #7363 [ops] perf-gate springes over på Dependabot-PR'er, så bundle-vækst lander uset på main (5d)
- #7498 [ops] Cross-PC Stop-advarslen om .codex.local kommer igen ved hver ny state-fil (2d)
- #7474 [bug] Graduerings-sweep: to samtidige ticks afgjorde 7 ryttere to gange (dobbeltbesked) 1… (2d)
- #7246 [bug] Kontraktvarsler stopper ved 1.000 ryttere: ~45 % får intet varsel (S4 og S5) (9d)
- #7096 [bestyrelse] Ungdomsresultater (U23/junior) tæller i vurderingen af ungdomsarbejdet, ikke… (12d)
- #7489 [bug] Falsk træningsalarm når en manager frigiver ryttere mens aftentræningen kører (CYCL… (2d)
- #7003 [feature/taktik] Delt kaptajn + arbejd/angrib deles op, så modsatrettede ordrer ikke kan… (14d)
- #6975 [resultater] Løbssejr registreret før sæson 4 startede (15d)
- #7533 [ux] Kalendertabel + Løbshistorik: klik på navn, ikoner én gang, rigtig Klar-status, sort… (2d)
- #6156 [bug] Formtoppe og rytterform har ingen virkning i loeb siden v4-flippet 28/9 - spillerne… (31d)
- #6207 [bug/planlægning] Rutematch viser 56 i sæsonmatrix og 51 i Planlæg dag for samme rytter o… (30d)
- #6363 [S5-profiler] Ny finale: mur-finale (wall_finish) (27d)
- …og 29 mere
