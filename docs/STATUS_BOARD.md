# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

99 features i FEATURE_REGISTRY.yml: live 75 · beta 3 · dormant 4 · building 8 · spec 1 · idea 2 · retired 6.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #6248 fix(training): maks +1 pr. evne pr. rytter pr. dato, fælles værn (Refs #6210) (12d) — groen
- #6665 feat(marketing): ny forside med godkendt tekst og ægte produktbilleder (#1369) (2d) — roed
- #6636 feat(race-library): upcoming races and scoped edition history (1d) — groen
- #6921 docs(patch): 7.370 gældsmål, sidemenu og omdømme (0d) — roed

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #26 [feature] Transfer war-room (shortlist + sammenligning + budget-forecast) (166d)
- #605 P0: Codex verdensklasse — markant hurtigere leverancer med målt kvalitet (148d)
- #930 [Epic] Staff & manager-rolle som direktør (ansatte, sportsdirektører, læger, fysioterapeu… (139d)
- #961 Kontekstuel hjaelp: omraade-specifikt FAQ-link overalt (banner -> ikon, progressive) (139d)
- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (133d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (133d)
- #1173 Vækst/viralitets-loop: referral (del spillet med en ven) (132d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (132d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (131d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (123d)
- #2236 Organic community outreach — Reddit + Discord posting (105d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (98d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (95d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (92d)
- #2794 [ux/IA] Løbssiden er informationsoverload: opdel ruteprofil / holdudtagelse / etape-takti… (88d)
- …og 65 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- #6248 fix(training): maks +1 pr. evne pr. rytter pr. dato, fælles værn (Refs #6210) (12d) — groen

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #6634 docs: implementeringsplan for løbsbibliotek med kommende løb og historik (5d) — groen
- #6820 [EJER-GO KRÆVES - TÆNDING] S5 v2: s5_profiles_v2 bliver aktuel revision (#6818) (0d) — groen
- #6839 fix(training): Træn nu under aftenkørslen: 409 i stedet for fejl + "Kører…" der opdaterer… (0d) — groen

**Ikke-draft med roed tilstand:**

- #6665 feat(marketing): ny forside med godkendt tekst og ægte produktbilleder (#1369) (2d) — roed
- #6921 docs(patch): 7.370 gældsmål, sidemenu og omdømme (0d) — roed

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (146d)
- #1569 Ny-spiller onboarding-audit (2026-06-20) — prioriteret handlingsplan (121d)
- #1819 Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup (117d)
- #2557 [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage i træk + favorit-w… (94d)
- #2682 AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til FAIL (92d)
- #2770 [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonussekunder (90d)
- #2822 [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste managerspil (88d)
- #2840 Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte rytt… (88d)
- #2884 [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-times-vind… (86d)
- #3154 [ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dage + fuld prioriteri… (81d)
- #3426 [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsler + for mange bjerg… (74d)
- #3461 [bug/balance] Restitutionens timing: 'Træn i dag' om morgenen brænder dagens eneste resti… (74d)
- #3511 [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashboard og må… (73d)
- #3564 [design] Progressionskæden samlet: potentiale 1-99, lofter pr. ryttertype, træningsscore,… (71d)
- #3855 [design] Race engine v4: intra-etape-motoren — etapen beregnes undervejs (ejer-retning 17… (63d)
- …og 773 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #5947 [bug] Udviklingshistorikken: gårsdagens stigninger mangler hos nogle ryttere, andre steg… (20d)
- #6456 [motor] Tidsgab nr. 10 på bjergetaper uden topankomst og uden nedkørselsfinale har intet… (8d)
- #5842 [bug] Ejer-direktiv 27/9: rytterværdierne ændrede sig søndag ved sæsonskiftet - det må de… (21d)
- #6428 [race-engine/v4] Kuperet endagsløb: udbruddet vinder med 9-16 min til feltet under offici… (9d)
- #6201 [race-engine/v4] Udbrud er for små på bjergetaper (median 3 mod mål 4-8) (14d)
- #6499 Udvikling 2.0 del 1: tilbagegang D4 ved sæsonskiftet + prøvekørsel (bag flag) (8d)
- #6367 [S5-profiler] Benchmark-gate: S5-kalenderen målt mod rigtige Grand Tours før live (11d)
- #6668 [S5] AI-ungdom løftes til menneskeholdenes niveau + menneskehold samles i færre grupper (… (4d)
- #6710 [youth] Afventer oprykning i stedet for automatisk salg ved fuld trup (#5833 plan-PR 1, f… (3d)
- #6648 [motor] Kunstigt 3-sekunders trin i målet: nr. 2 på præcis +3 s i 84/137 bjergetaper (4d)
- #6645 [motor] Enkeltstart: top-10 for tæt (gap10 under 32,5-110 s) blokerer S5-kalenderen (4d)
- #6475 [løb/UI] Enkeltstart 40 km viser mærket 'Long day' - tjek mærker og hvad udholdenhed bety… (8d)
- #6772 [cutover] Load-test-gaten (#5904) er ikke opfyldt før 25/10, og sidste løbsdag fejler i d… (2d)
- #5928 [bug/HØJ] Træthed og form flytter sig 5x pr. dato: konstanterne er kalibreret til ét tick… (20d)
- #6233 [perf] Vercel preview-byg koerer altid: preview-filteret fejler paa manglende origin-remo… (14d)
- …og 30 mere
