# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

145 features i FEATURE_REGISTRY.yml: live 112 · beta 1 · dormant 8 · building 15 · spec 1 · idea 2 · retired 6.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #7960 docs(design): to Graduation Day-forslag med før/efter (#7323) (1d) — groen
- #7980 feat(tactics): holdplaner, opgavepriser og navngivne rutepunkter (#7864) (0d) — groen
- #8017 fix(market): auto-pris for alle ryttere og fri trupafgang (#8015) (0d) — groen

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #26 [feature] Transfer war-room (shortlist + sammenligning + budget-forecast) (189d)
- #930 [Epic] Staff & manager-rolle som direktør (ansatte, sportsdirektører, læger, fysioterapeu… (162d)
- #961 Kontekstuel hjaelp: omraade-specifikt FAQ-link overalt (banner -> ikon, progressive) (162d)
- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (156d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (156d)
- #1173 Vækst/viralitets-loop: referral (del spillet med en ven) (155d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (155d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (154d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (146d)
- #2236 Organic community outreach — Reddit + Discord posting (128d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (121d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (118d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (116d)
- #2885 [feature] Sælg rytter til AI efter N mislykkede auktioner — udvej for hold der ikke kan k… (109d)
- #2991 season_grand_tour_rider kan ingen menneskemanager opnå: Grand Tours er Division-1-only og… (109d)
- …og 62 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- #8017 fix(market): auto-pris for alle ryttere og fri trupafgang (#8015) (0d) — groen

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #8014 docs(tactics): langt angreb design og baseline (#7884) (0d) — groen

**Ikke-draft med roed tilstand:**

- ingen

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (170d)
- #1569 Ny-spiller onboarding-audit (2026-06-20) — prioriteret handlingsplan (144d)
- #1819 Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup (141d)
- #2557 [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage i træk + favorit-w… (117d)
- #2682 AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til FAIL (116d)
- #2770 [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonussekunder (113d)
- #2822 [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste managerspil (111d)
- #2840 Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte rytt… (111d)
- #2884 [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-times-vind… (109d)
- #3154 [ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dage + fuld prioriteri… (104d)
- #3426 [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsler + for mange bjerg… (97d)
- #3511 [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashboard og må… (96d)
- #3564 [design] Progressionskæden samlet: potentiale 1-99, lofter pr. ryttertype, træningsscore,… (94d)
- #4010 Supabase-hærdning: realtime-MalformedJWT, sponsor-sweep, offset-paginering og getUser() p… (83d)
- #4159 [guard] game_day-aksen maa aldrig kunne skrives skaevt igen: DB-trigger + lane-packer-fix… (80d)
- …og 870 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #6299 [investigation] 'Work'-ordren ser ud til at angribe uden 'try the break' + 27 mand i udbr… (35d)
- #7003 [feature/taktik] Delt kaptajn + arbejd/angrib deles op, så modsatrettede ordrer ikke kan… (21d)
- #6975 [resultater] Løbssejr registreret før sæson 4 startede (22d)
- #6156 [bug] Formtoppe og rytterform har ingen virkning i loeb siden v4-flippet 28/9 - spillerne… (38d)
- #6456 [motor] Tidsgab nr. 10 på bjergetaper uden topankomst og uden nedkørselsfinale har intet… (31d)
- #6649 [motor/design] Dagsform og dominans: de bedste vinder for ofte i forhold til virkeligheden (27d)
- #6668 [S5] AI-ungdom løftes til menneskeholdenes niveau + menneskehold samles i færre grupper (… (27d)
- #6804 [motor] Kuperede udbrudssejre: maalt baseline + design (25d)
- #6940 [motor] Gruppetto-ordre: ingen udbrud, energibesparelse efter etapetype (ejer-løfte 1/10) (22d)
- #7160 [motor v3] Udbrud vinder for sjældent på store bjergetaper: mål mod GT 2023-24 og ret i v3 (18d)
- #7290 [motor] Motoren kører bakkerne fra højdeprofilen (trin 2 af #7289) (15d)
- #7294 [bug/planlægning] Udtagelse i sæsonmatrix flytter visuelt til forkerte datoer indtil genå… (15d)
- #6471 [motor/planlægning] Rutematch skal følge motorens regler og opdateres når reglerne ændres (31d)
- #7339 [bug] Auto-fyld satte for få ryttere på ved S5-løbsdag 28/10 (did_not_start under gulv 6) (13d)
- #7246 [bug] Kontraktvarsler stopper ved 1.000 ryttere: ~45 % får intet varsel (S4 og S5) (16d)
- …og 28 mere
