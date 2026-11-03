# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

125 features i FEATURE_REGISTRY.yml: live 104 · dormant 7 · building 5 · spec 1 · idea 2 · retired 6.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #7530 fix: normalize Cloudflare JSON only in Sentry events (0d) — groen
- #7531 fix(ops): preserve TOML value comment boundaries (0d) — groen
- #7532 fix(test): bound harness schema drift (#2635) (0d) — groen
- #6665 feat(marketing): ny forside med godkendt tekst og ægte produktbilleder (#1369) (0d) — groen
- #7524 fix(ops): reject broad shared directory ownership (0d) — roed
- #7579 feat(calendar): Klar · 6/8 når feltet har plads til flere (#7561) (0d) — roed
- #7592 fix(ops): merge-køens commit-opslag må ikke hænge CI (#6172) (0d) — roed
- #7586 feat(engine): #6912 forspringskurve for udbrud bag slukket kontakt (0d) — roed
- #7590 fix(race-engine): loft på favoritgab over sidste top på dronningeetaper (bag slukket kont… (0d) — roed
- #7593 refactor(types): konverter auktionsregler til TypeScript (0d) — roed

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #26 [feature] Transfer war-room (shortlist + sammenligning + budget-forecast) (181d)
- #605 P0: Codex verdensklasse — markant hurtigere leverancer med målt kvalitet (163d)
- #930 [Epic] Staff & manager-rolle som direktør (ansatte, sportsdirektører, læger, fysioterapeu… (154d)
- #961 Kontekstuel hjaelp: omraade-specifikt FAQ-link overalt (banner -> ikon, progressive) (154d)
- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (148d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (148d)
- #1173 Vækst/viralitets-loop: referral (del spillet med en ven) (147d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (147d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (146d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (138d)
- #2236 Organic community outreach — Reddit + Discord posting (120d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (113d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (110d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (107d)
- #2794 [ux/IA] Løbssiden er informationsoverload: opdel ruteprofil / holdudtagelse / etape-takti… (103d)
- …og 59 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- #7532 fix(test): bound harness schema drift (#2635) (0d) — groen
- #7524 fix(ops): reject broad shared directory ownership (0d) — roed
- #7528 fix(ops): require prod evidence before player-report builds (0d) — groen
- #7529 fix(ops): recover owned git probe markers safely (0d) — groen
- #7571 fix(ops): frigiv bølger efter dokumenteret stop af Windows-børn (0d) — roed

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #7528 fix(ops): require prod evidence before player-report builds (0d) — groen
- #7529 fix(ops): recover owned git probe markers safely (0d) — groen
- #7571 fix(ops): frigiv bølger efter dokumenteret stop af Windows-børn (0d) — roed

**Ikke-draft med roed tilstand:**

- #7524 fix(ops): reject broad shared directory ownership (0d) — roed
- #7579 feat(calendar): Klar · 6/8 når feltet har plads til flere (#7561) (0d) — roed
- #7592 fix(ops): merge-køens commit-opslag må ikke hænge CI (#6172) (0d) — roed
- #7586 feat(engine): #6912 forspringskurve for udbrud bag slukket kontakt (0d) — roed
- #7590 fix(race-engine): loft på favoritgab over sidste top på dronningeetaper (bag slukket kont… (0d) — roed
- #7593 refactor(types): konverter auktionsregler til TypeScript (0d) — roed

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
- …og 781 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #1857 [enhancement] Race-sim reproducerbarhed: snapshot rytter-betingelser (form/træthed/abilit… (131d)
- #6299 [investigation] 'Work'-ordren ser ud til at angribe uden 'try the break' + 27 mand i udbr… (27d)
- #6472 [motor] Rullende etaper føles forkerte: bedste rutematch ender ikke forrest (friisisch 11… (23d)
- #7214 [motor] Udbrud i monumenter behandles som andre løb (9d)
- #7099 [supabase-log-watch] Fejl-terskel-brud eller ny fejlklasse i log-strømmen (11d)
- #7363 [ops] perf-gate springes over på Dependabot-PR'er, så bundle-vækst lander uset på main (4d)
- #7498 [ops] Cross-PC Stop-advarslen om .codex.local kommer igen ved hver ny state-fil (1d)
- #7474 [bug] Graduerings-sweep: to samtidige ticks afgjorde 7 ryttere to gange (dobbeltbesked) 1… (1d)
- #7246 [bug] Kontraktvarsler stopper ved 1.000 ryttere: ~45 % får intet varsel (S4 og S5) (8d)
- #7096 [bestyrelse] Ungdomsresultater (U23/junior) tæller i vurderingen af ungdomsarbejdet, ikke… (11d)
- #7489 [bug] Falsk træningsalarm når en manager frigiver ryttere mens aftentræningen kører (CYCL… (1d)
- #7536 [balance] Løbsdatoer med lette etaper giver mindre træthed end ren træning, så formen stå… (0d)
- #7003 [feature/taktik] Delt kaptajn + arbejd/angrib deles op, så modsatrettede ordrer ikke kan… (13d)
- #7092 [ux] Løbsfilm: udbruds-ikoner blander morgenudbrud, senere angreb og ryttere uden angreb… (11d)
- #6975 [resultater] Løbssejr registreret før sæson 4 startede (14d)
- …og 34 mere
