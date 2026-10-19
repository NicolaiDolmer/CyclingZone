# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

97 features i FEATURE_REGISTRY.yml: live 75 · beta 2 · dormant 5 · building 6 · spec 1 · idea 2 · retired 6.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #6248 fix(training): maks +1 pr. evne pr. rytter pr. dato, fælles værn (Refs #6210) (11d) — DIRTY
- #6665 feat(marketing): ny forside med godkendt tekst og ægte produktbilleder (#1369) (1d) — roed
- #6839 fix(training): Traen nu paa loebsdags-stien svarer 409 ved holdt reservation (Refs #6827) (0d) — roed
- #6636 feat(race-library): upcoming races and scoped edition history (0d) — DIRTY
- #6878 docs(registry): race_library_v2-flaget registreret efter merge af #6680 (0d) — groen
- #6879 fix(ci): løft shard-planen så natlig Playwright Smoke bliver grøn (#5792) (0d) — groen
- #6880 fix(calendar): afsluttet sæsons egen pulje kommer fra slutstillingen (#6875) (0d) — roed

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #26 [feature] Transfer war-room (shortlist + sammenligning + budget-forecast) (165d)
- #605 P0: Codex verdensklasse — markant hurtigere leverancer med målt kvalitet (147d)
- #930 [Epic] Staff & manager-rolle som direktør (ansatte, sportsdirektører, læger, fysioterapeu… (138d)
- #961 Kontekstuel hjaelp: omraade-specifikt FAQ-link overalt (banner -> ikon, progressive) (138d)
- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (132d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (132d)
- #1173 Vækst/viralitets-loop: referral (del spillet med en ven) (131d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (131d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (130d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (122d)
- #2236 Organic community outreach — Reddit + Discord posting (104d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (97d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (94d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (92d)
- #2794 [ux/IA] Løbssiden er informationsoverload: opdel ruteprofil / holdudtagelse / etape-takti… (88d)
- …og 66 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- #6248 fix(training): maks +1 pr. evne pr. rytter pr. dato, fælles værn (Refs #6210) (11d) — DIRTY
- #6849 docs(6765): design for inkrementelle rangliste-matviews (1d) — groen
- #6880 fix(calendar): afsluttet sæsons egen pulje kommer fra slutstillingen (#6875) (0d) — roed

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #6634 docs: implementeringsplan for løbsbibliotek med kommende løb og historik (4d) — groen
- #6813 docs(6804): design for kuperede udbrudssejre (rod-aarsag + A/B, bag s5_profiles_v2) (1d) — groen
- #6819 [EJER-GO KRÆVES - TÆNDING] chore(db): s5_profiles_v2 bliver en lovlig regel-revision (#68… (1d) — groen
- #6820 [EJER-GO KRÆVES - TÆNDING] S5 v2: s5_profiles_v2 bliver aktuel revision (#6818) (1d) — groen
- #6843 docs(6814): design for jagtafstand på gap_update (bag s5_profiles_v2) (1d) — groen
- #6849 docs(6765): design for inkrementelle rangliste-matviews (1d) — groen

**Ikke-draft med roed tilstand:**

- #6665 feat(marketing): ny forside med godkendt tekst og ægte produktbilleder (#1369) (1d) — roed
- #6839 fix(training): Traen nu paa loebsdags-stien svarer 409 ved holdt reservation (Refs #6827) (0d) — roed
- #6880 fix(calendar): afsluttet sæsons egen pulje kommer fra slutstillingen (#6875) (0d) — roed

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (146d)
- #1569 Ny-spiller onboarding-audit (2026-06-20) — prioriteret handlingsplan (120d)
- #1819 Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup (117d)
- #2557 [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage i træk + favorit-w… (93d)
- #2682 AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til FAIL (92d)
- #2770 [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonussekunder (89d)
- #2822 [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste managerspil (87d)
- #2840 Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte rytt… (87d)
- #2884 [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-times-vind… (85d)
- #3154 [ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dage + fuld prioriteri… (80d)
- #3426 [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsler + for mange bjerg… (73d)
- #3461 [bug/balance] Restitutionens timing: 'Træn i dag' om morgenen brænder dagens eneste resti… (73d)
- #3511 [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashboard og må… (72d)
- #3564 [design] Progressionskæden samlet: potentiale 1-99, lofter pr. ryttertype, træningsscore,… (70d)
- #3855 [design] Race engine v4: intra-etape-motoren — etapen beregnes undervejs (ejer-retning 17… (62d)
- …og 769 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #5947 [bug] Udviklingshistorikken: gårsdagens stigninger mangler hos nogle ryttere, andre steg… (19d)
- #6456 [motor] Tidsgab nr. 10 på bjergetaper uden topankomst og uden nedkørselsfinale har intet… (8d)
- #5842 [bug] Ejer-direktiv 27/9: rytterværdierne ændrede sig søndag ved sæsonskiftet - det må de… (20d)
- #6428 [race-engine/v4] Kuperet endagsløb: udbruddet vinder med 9-16 min til feltet under offici… (8d)
- #6201 [race-engine/v4] Udbrud er for små på bjergetaper (median 3 mod mål 4-8) (13d)
- #6499 Udvikling 2.0 del 1: tilbagegang D4 ved sæsonskiftet + prøvekørsel (bag flag) (7d)
- #6367 [S5-profiler] Benchmark-gate: S5-kalenderen målt mod rigtige Grand Tours før live (10d)
- #6668 [S5] AI-ungdom løftes til menneskeholdenes niveau + menneskehold samles i færre grupper (… (3d)
- #6710 [youth] Afventer oprykning i stedet for automatisk salg ved fuld trup (#5833 plan-PR 1, f… (2d)
- #6648 [motor] Kunstigt 3-sekunders trin i målet: nr. 2 på præcis +3 s i 84/137 bjergetaper (3d)
- #6645 [motor] Enkeltstart: top-10 for tæt (gap10 under 32,5-110 s) blokerer S5-kalenderen (3d)
- #6590 [app] Push-notifikationer: opt-in, kategorier, loft, stille timer (spor 2 af #6584) (5d)
- #6475 [løb/UI] Enkeltstart 40 km viser mærket 'Long day' - tjek mærker og hvad udholdenhed bety… (7d)
- #6772 [cutover] Load-test-gaten (#5904) er ikke opfyldt før 25/10, og sidste løbsdag fejler i d… (1d)
- #5928 [bug/HØJ] Træthed og form flytter sig 5x pr. dato: konstanterne er kalibreret til ét tick… (19d)
- …og 7 mere
