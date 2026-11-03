# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

123 features i FEATURE_REGISTRY.yml: live 104 · dormant 5 · building 5 · spec 1 · idea 2 · retired 6.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #7530 fix: normalize Cloudflare JSON only in Sentry events (0d) — groen
- #7531 fix(ops): preserve TOML value comment boundaries (0d) — groen
- #7532 fix(test): bound harness schema drift (#2635) (0d) — groen
- #6665 feat(marketing): ny forside med godkendt tekst og ægte produktbilleder (#1369) (0d) — groen
- #7511 fix(test): bound Windows backend test arguments (0d) — roed
- #7515 fix(ci): verify registry flags after migrations (#7348) (0d) — roed
- #7516 fix(ops): verify migrations before merge queue success (0d) — roed
- #7522 fix(ci): guard patch history and Tailwind codemod boundaries (0d) — groen
- #7524 fix(ops): reject broad shared directory ownership (0d) — roed

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #26 [feature] Transfer war-room (shortlist + sammenligning + budget-forecast) (180d)
- #605 P0: Codex verdensklasse — markant hurtigere leverancer med målt kvalitet (162d)
- #930 [Epic] Staff & manager-rolle som direktør (ansatte, sportsdirektører, læger, fysioterapeu… (154d)
- #961 Kontekstuel hjaelp: omraade-specifikt FAQ-link overalt (banner -> ikon, progressive) (154d)
- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (148d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (148d)
- #1173 Vækst/viralitets-loop: referral (del spillet med en ven) (146d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (146d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (145d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (138d)
- #2236 Organic community outreach — Reddit + Discord posting (119d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (112d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (109d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (107d)
- #2794 [ux/IA] Løbssiden er informationsoverload: opdel ruteprofil / holdudtagelse / etape-takti… (103d)
- …og 59 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- #7532 fix(test): bound harness schema drift (#2635) (0d) — groen
- #7529 fix(ops): recover owned git probe markers safely (0d) — DIRTY
- #7571 fix(ops): frigiv bølger efter dokumenteret stop af Windows-børn (0d) — roed
- #7511 fix(test): bound Windows backend test arguments (0d) — roed
- #7515 fix(ci): verify registry flags after migrations (#7348) (0d) — roed
- #7516 fix(ops): verify migrations before merge queue success (0d) — roed
- #7522 fix(ci): guard patch history and Tailwind codemod boundaries (0d) — groen
- #7524 fix(ops): reject broad shared directory ownership (0d) — roed
- #7528 fix(ops): require prod evidence before player-report builds (0d) — groen

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #7529 fix(ops): recover owned git probe markers safely (0d) — DIRTY
- #7571 fix(ops): frigiv bølger efter dokumenteret stop af Windows-børn (0d) — roed
- #7572 fix(training): genlæs truppen før unsafe-roster-tjekket (#7489) (0d) — roed
- #7573 fix(race-entry): løbsdags-besked og sen fyldning respekterer gulvet (#7339 A+B) (0d) — groen
- #7574 fix(training): race-date free-slot training weighs a full training day behind flag (#7536) (0d) — groen
- #7575 fix(riders): naturlig rolle ved lige bedste rolle + skaleret startklemme (#7560) (0d) — groen
- #7576 feat(training): rollen styrer løbsdagens basis-dag bag egen kontakt (#5950) (0d) — groen
- #7528 fix(ops): require prod evidence before player-report builds (0d) — groen

**Ikke-draft med roed tilstand:**

- #7511 fix(test): bound Windows backend test arguments (0d) — roed
- #7515 fix(ci): verify registry flags after migrations (#7348) (0d) — roed
- #7516 fix(ops): verify migrations before merge queue success (0d) — roed
- #7524 fix(ops): reject broad shared directory ownership (0d) — roed

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (161d)
- #1569 Ny-spiller onboarding-audit (2026-06-20) — prioriteret handlingsplan (136d)
- #1819 Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup (132d)
- #2557 [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage i træk + favorit-w… (109d)
- #2682 AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til FAIL (107d)
- #2770 [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonussekunder (105d)
- #2822 [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste managerspil (103d)
- #2840 Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte rytt… (103d)
- #2884 [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-times-vind… (101d)
- #3154 [ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dage + fuld prioriteri… (96d)
- #3426 [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsler + for mange bjerg… (89d)
- #3511 [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashboard og må… (88d)
- #3564 [design] Progressionskæden samlet: potentiale 1-99, lofter pr. ryttertype, træningsscore,… (86d)
- #4010 Supabase-hærdning: realtime-MalformedJWT, sponsor-sweep, offset-paginering og getUser() p… (75d)
- #4159 [guard] game_day-aksen maa aldrig kunne skrives skaevt igen: DB-trigger + lane-packer-fix… (71d)
- …og 780 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #3461 [bug/balance] Restitutionens timing: 'Træn i dag' om morgenen brænder dagens eneste resti… (88d)
- #6299 [investigation] 'Work'-ordren ser ud til at angribe uden 'try the break' + 27 mand i udbr… (27d)
- #6363 [S5-profiler] Ny finale: mur-finale (wall_finish) (25d)
- #6156 [bug] Formtoppe og rytterform har ingen virkning i loeb siden v4-flippet 28/9 - spillerne… (30d)
- #6668 [S5] AI-ungdom løftes til menneskeholdenes niveau + menneskehold samles i færre grupper (… (19d)
- #6683 Terræn-ikoner: ét farvet streg-ikon pr. etapetype overalt (18d)
- #6710 [youth] Afventer oprykning i stedet for automatisk salg ved fuld trup (#5833 plan-PR 1, f… (18d)
- #7160 [motor v3] Udbrud vinder for sjældent på store bjergetaper: mål mod GT 2023-24 og ret i v3 (9d)
- #1857 [enhancement] Race-sim reproducerbarhed: snapshot rytter-betingelser (form/træthed/abilit… (130d)
- #6456 [motor] Tidsgab nr. 10 på bjergetaper uden topankomst og uden nedkørselsfinale har intet… (23d)
- #6469 [løbsfilm] Store huller uden forklaring: et hul på flere minutter opstår på få km uden at… (23d)
- #6472 [motor] Rullende etaper føles forkerte: bedste rutematch ender ikke forrest (friisisch 11… (23d)
- #6486 [motor] D3: bjergetape uden topankomst (to lange stigninger, top ca. 15 km fra mål) stadi… (22d)
- #7246 [bug] Kontraktvarsler stopper ved 1.000 ryttere: ~45 % får intet varsel (S4 og S5) (8d)
- #6804 [motor] Kuperede udbrudssejre: maalt baseline + design (17d)
- …og 35 mere
