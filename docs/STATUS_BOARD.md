# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

132 features i FEATURE_REGISTRY.yml: live 105 · beta 1 · dormant 11 · building 6 · spec 1 · idea 2 · retired 6.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #6665 feat(marketing): ny forside med godkendt tekst og ægte produktbilleder (#1369) (1d) — DIRTY
- #7571 fix(ops): frigiv bølger efter dokumenteret stop af Windows-børn (1d) — roed
- #7765 [EJER-GO KRÆVES] feat(motor): meget trætte ryttere risikerer tidsgrænsen, med varsel (#77… (0d) — DIRTY

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #26 [feature] Transfer war-room (shortlist + sammenligning + budget-forecast) (183d)
- #930 [Epic] Staff & manager-rolle som direktør (ansatte, sportsdirektører, læger, fysioterapeu… (157d)
- #961 Kontekstuel hjaelp: omraade-specifikt FAQ-link overalt (banner -> ikon, progressive) (157d)
- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (151d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (151d)
- #1173 Vækst/viralitets-loop: referral (del spillet med en ven) (149d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (149d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (148d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (141d)
- #2236 Organic community outreach — Reddit + Discord posting (122d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (115d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (112d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (110d)
- #2885 [feature] Sælg rytter til AI efter N mislykkede auktioner — udvej for hold der ikke kan k… (104d)
- #2991 season_grand_tour_rider kan ingen menneskemanager opnå: Grand Tours er Division-1-only og… (103d)
- …og 55 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- #7571 fix(ops): frigiv bølger efter dokumenteret stop af Windows-børn (1d) — roed

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #7652 docs: beslutningspakke om vækst og varig fastholdelse (#7495) (1d) — groen
- #7696 docs(design): sammenhængende taktikpris og indsatskort (#7638, #5101) (1d) — groen
- #7688 feat(udvikling): potentiale som tal + ord i frontend bag flag (#7686) (1d) — DIRTY
- #7769 fix(training): vis årsagen når en træningsdag næsten ikke gav fremgang (#7757) (0d) — groen

**Ikke-draft med roed tilstand:**

- #7571 fix(ops): frigiv bølger efter dokumenteret stop af Windows-børn (1d) — roed

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (164d)
- #1569 Ny-spiller onboarding-audit (2026-06-20) — prioriteret handlingsplan (139d)
- #1819 Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup (135d)
- #2557 [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage i træk + favorit-w… (112d)
- #2682 AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til FAIL (110d)
- #2770 [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonussekunder (108d)
- #2822 [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste managerspil (106d)
- #2840 Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte rytt… (106d)
- #2884 [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-times-vind… (104d)
- #3154 [ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dage + fuld prioriteri… (99d)
- #3426 [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsler + for mange bjerg… (92d)
- #3511 [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashboard og må… (91d)
- #3564 [design] Progressionskæden samlet: potentiale 1-99, lofter pr. ryttertype, træningsscore,… (89d)
- #4010 Supabase-hærdning: realtime-MalformedJWT, sponsor-sweep, offset-paginering og getUser() p… (78d)
- #4159 [guard] game_day-aksen maa aldrig kunne skrives skaevt igen: DB-trigger + lane-packer-fix… (74d)
- …og 824 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #6299 [investigation] 'Work'-ordren ser ud til at angribe uden 'try the break' + 27 mand i udbr… (30d)
- #6472 [motor] Rullende etaper føles forkerte: bedste rutematch ender ikke forrest (friisisch 11… (26d)
- #7214 [motor] Udbrud i monumenter behandles som andre løb (11d)
- #7498 [ops] Cross-PC Stop-advarslen om .codex.local kommer igen ved hver ny state-fil (4d)
- #7096 [bestyrelse] Ungdomsresultater (U23/junior) tæller i vurderingen af ungdomsarbejdet, ikke… (14d)
- #7489 [bug] Falsk træningsalarm når en manager frigiver ryttere mens aftentræningen kører (CYCL… (4d)
- #7003 [feature/taktik] Delt kaptajn + arbejd/angrib deles op, så modsatrettede ordrer ikke kan… (16d)
- #6975 [resultater] Løbssejr registreret før sæson 4 startede (17d)
- #7533 [ux] Kalendertabel + Løbshistorik: klik på navn, ikoner én gang, rigtig Klar-status, sort… (3d)
- #6156 [bug] Formtoppe og rytterform har ingen virkning i loeb siden v4-flippet 28/9 - spillerne… (33d)
- #6363 [S5-profiler] Ny finale: mur-finale (wall_finish) (28d)
- #6456 [motor] Tidsgab nr. 10 på bjergetaper uden topankomst og uden nedkørselsfinale har intet… (26d)
- #6486 [motor] D3: bjergetape uden topankomst (to lange stigninger, top ca. 15 km fra mål) stadi… (25d)
- #6649 [motor/design] Dagsform og dominans: de bedste vinder for ofte i forhold til virkeligheden (22d)
- #6668 [S5] AI-ungdom løftes til menneskeholdenes niveau + menneskehold samles i færre grupper (… (22d)
- …og 63 mere
