# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

123 features i FEATURE_REGISTRY.yml: live 102 · beta 1 · dormant 5 · building 6 · spec 1 · idea 2 · retired 6.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #6636 feat(race-library): upcoming races and scoped edition history (3d) — DIRTY
- #7459 fix(audit): preserve contract data on rider release (#7246) (0d) — groen
- #6665 feat(marketing): ny forside med godkendt tekst og ægte produktbilleder (#1369) (0d) — groen

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #26 [feature] Transfer war-room (shortlist + sammenligning + budget-forecast) (179d)
- #605 P0: Codex verdensklasse — markant hurtigere leverancer med målt kvalitet (161d)
- #930 [Epic] Staff & manager-rolle som direktør (ansatte, sportsdirektører, læger, fysioterapeu… (152d)
- #961 Kontekstuel hjaelp: omraade-specifikt FAQ-link overalt (banner -> ikon, progressive) (152d)
- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (146d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (146d)
- #1173 Vækst/viralitets-loop: referral (del spillet med en ven) (145d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (145d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (144d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (136d)
- #2236 Organic community outreach — Reddit + Discord posting (118d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (111d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (108d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (106d)
- #2794 [ux/IA] Løbssiden er informationsoverload: opdel ruteprofil / holdudtagelse / etape-takti… (101d)
- …og 70 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- ingen

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #6634 docs: implementeringsplan for løbsbibliotek med kommende løb og historik (3d) — groen
- #7462 fix(training): preserve first-time progress in daily receipts (0d) — groen

**Ikke-draft med roed tilstand:**

- ingen

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (160d)
- #1569 Ny-spiller onboarding-audit (2026-06-20) — prioriteret handlingsplan (134d)
- #1819 Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup (131d)
- #2557 [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage i træk + favorit-w… (107d)
- #2682 AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til FAIL (105d)
- #2770 [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonussekunder (103d)
- #2822 [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste managerspil (101d)
- #2840 Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte rytt… (101d)
- #2884 [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-times-vind… (99d)
- #3154 [ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dage + fuld prioriteri… (94d)
- #3426 [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsler + for mange bjerg… (87d)
- #3511 [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashboard og må… (86d)
- #3564 [design] Progressionskæden samlet: potentiale 1-99, lofter pr. ryttertype, træningsscore,… (84d)
- #3855 [design] Race engine v4: intra-etape-motoren — etapen beregnes undervejs (ejer-retning 17… (76d)
- #4010 Supabase-hærdning: realtime-MalformedJWT, sponsor-sweep, offset-paginering og getUser() p… (73d)
- …og 835 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #7333 [bug] Etapeplan: rytter sat til 'bliv i læ til sidste 10 km' angreb 44 km fra mål (jeppek… (3d)
- #7285 [bug] Transferhistorik: handler efter S5-start vises under sæson 4 (thelamba 26/10) (5d)
- #7294 [bug/planlægning] Udtagelse i sæsonmatrix flytter visuelt til forkerte datoer indtil genå… (5d)
- #7296 [bug/dashboard] Næste løb sender spilleren til et andet løb end forventet efter sæsonskif… (5d)
- #6853 [ux] Rytterens potentiale vises forskelligt på My Team og i akademiet (spiller 17/10) (14d)
- #7214 [motor] Udbrud i monumenter behandles som andre løb (7d)
- #7003 [feature/taktik] Delt kaptajn + arbejd/angrib deles op, så modsatrettede ordrer ikke kan… (11d)
- #6299 [investigation] 'Work'-ordren ser ud til at angribe uden 'try the break' + 27 mand i udbr… (25d)
- #7381 [taktik] To kanttilfælde efter #7377: alt ud-historie for plan-ryttere og holdarbejde på… (2d)
- #7334 [bug] Rutematch er væk fra Taktik-fanen undtagen på enkeltstarter (egomadsen 28/10) (3d)
- #7289 Løbssiden: Hold-fanen viser andre etapeprofiler end Etaper-fanen (5d)
- #7092 [ux] Løbsfilm: udbruds-ikoner blander morgenudbrud, senere angreb og ryttere uden angreb… (9d)
- #6469 [løbsfilm] Store huller uden forklaring: et hul på flere minutter opstår på få km uden at… (21d)
- #7232 [bug] Omdømme vises med forskelligt tal på Mit Hold og rytterprofilen tæt på en grænse (c… (6d)
- #7235 [bug] Pensionsvisningen skifter kortvarigt under sæsonskiftet - rytter der stopper ser ud… (6d)
- …og 37 mere
