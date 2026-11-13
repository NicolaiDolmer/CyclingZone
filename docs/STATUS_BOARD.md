# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

147 features i FEATURE_REGISTRY.yml: live 113 · beta 3 · dormant 10 · building 12 · spec 1 · idea 2 · retired 6.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #8056 feat(planning): planlaegningsside trin 1 bag beta-flag (Refs #7535) (0d) — DIRTY
- #8059 feat(app): Google Play som TWA, app-pakke, assetlinks-skabelon og ejer-vejledning (Refs #… (0d) — roed
- #8119 chore(deps): bump the frontend-minor-patch group across 1 directory with 11 updates (0d) — roed

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #26 [feature] Transfer war-room (shortlist + sammenligning + budget-forecast) (190d)
- #930 [Epic] Staff & manager-rolle som direktør (ansatte, sportsdirektører, læger, fysioterapeu… (164d)
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
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (117d)
- #2885 [feature] Sælg rytter til AI efter N mislykkede auktioner — udvej for hold der ikke kan k… (111d)
- #2991 season_grand_tour_rider kan ingen menneskemanager opnå: Grand Tours er Division-1-only og… (110d)
- …og 74 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- ingen

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #8014 docs(tactics): langt angreb design og baseline (#7884) (0d) — groen
- #8020 feat(web): scoped Query data for Dashboard and market (draft checkpoint) (0d) — roed
- #8130 chore(roadmap): roadmap-pakke 13/11, holdplaner-dublet, trupgraenser, loebssiden og fire… (0d) — groen
- #8131 fix(training): ny rytter starter med fast lav træthed i stedet for 0 (Refs #8089) (0d) — groen

**Ikke-draft med roed tilstand:**

- #8059 feat(app): Google Play som TWA, app-pakke, assetlinks-skabelon og ejer-vejledning (Refs #… (0d) — roed
- #8119 chore(deps): bump the frontend-minor-patch group across 1 directory with 11 updates (0d) — roed

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (171d)
- #1569 Ny-spiller onboarding-audit (2026-06-20) — prioriteret handlingsplan (146d)
- #1819 Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup (142d)
- #2557 [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage i træk + favorit-w… (119d)
- #2682 AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til FAIL (117d)
- #2770 [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonussekunder (114d)
- #2822 [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste managerspil (113d)
- #2840 Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte rytt… (112d)
- #2884 [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-times-vind… (111d)
- #3154 [ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dage + fuld prioriteri… (106d)
- #3426 [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsler + for mange bjerg… (99d)
- #3511 [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashboard og må… (97d)
- #4010 Supabase-hærdning: realtime-MalformedJWT, sponsor-sweep, offset-paginering og getUser() p… (84d)
- #4159 [guard] game_day-aksen maa aldrig kunne skrives skaevt igen: DB-trigger + lane-packer-fix… (81d)
- #4321 [growth] PostHog (EU) som analytics-lag: kanal-attribution, funnels, retention + MCP-adga… (77d)
- …og 903 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #6299 [investigation] 'Work'-ordren ser ud til at angribe uden 'try the break' + 27 mand i udbr… (37d)
- #7003 [feature/taktik] Delt kaptajn + arbejd/angrib deles op, så modsatrettede ordrer ikke kan… (23d)
- #6156 [bug] Formtoppe og rytterform har ingen virkning i loeb siden v4-flippet 28/9 - spillerne… (39d)
- #6456 [motor] Tidsgab nr. 10 på bjergetaper uden topankomst og uden nedkørselsfinale har intet… (33d)
- #6649 [motor/design] Dagsform og dominans: de bedste vinder for ofte i forhold til virkeligheden (29d)
- #6668 [S5] AI-ungdom løftes til menneskeholdenes niveau + menneskehold samles i færre grupper (… (28d)
- #6804 [motor] Kuperede udbrudssejre: maalt baseline + design (26d)
- #6940 [motor] Gruppetto-ordre: ingen udbrud, energibesparelse efter etapetype (ejer-løfte 1/10) (24d)
- #7160 [motor v3] Udbrud vinder for sjældent på store bjergetaper: mål mod GT 2023-24 og ret i v3 (19d)
- #7290 [motor] Motoren kører bakkerne fra højdeprofilen (trin 2 af #7289) (17d)
- #7294 [bug/planlægning] Udtagelse i sæsonmatrix flytter visuelt til forkerte datoer indtil genå… (16d)
- #7474 [bug] Graduerings-sweep: to samtidige ticks afgjorde 7 ryttere to gange (dobbeltbesked) 1… (11d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (119d)
- #7789 Roadmap-admin: graf og kategorier som spørgeskema-panelet (6d)
- #6204 [roadmap/admin] Faner, filtre og sortering i roadmap-admin (ejer 5/10) (38d)
- …og 24 mere
