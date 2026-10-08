# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

88 features i FEATURE_REGISTRY.yml: live 67 · beta 3 · dormant 3 · building 10 · spec 1 · idea 2 · retired 2.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #6053 feat(training): Programs - pick rider or group first, then the program (#6035) (4d) — groen
- #6248 fix(training): maks +1 pr. evne pr. rytter pr. dato, fælles værn (Refs #6210) (1d) — groen
- #6310 feat(5162): gamle frontend-assets baeres videre mellem deploys (K1-K3) (0d) — groen

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #605 P0: Codex verdensklasse — markant hurtigere leverancer med målt kvalitet (136d)
- #1140 Strømlin ny-spiller-onboarding til ét sammenhængende flow (konsolidér 6+ elementer) (122d)
- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (121d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (121d)
- #1173 Vækst/viralitets-loop: referral (del spillet med en ven) (120d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (120d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (119d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (111d)
- #2236 Organic community outreach — Reddit + Discord posting (93d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (86d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (83d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (81d)
- #2794 [ux/IA] Løbssiden er informationsoverload: opdel ruteprofil / holdudtagelse / etape-takti… (77d)
- #2806 [monetization] /pro er ikke linket fra appen, og isPro() gater ingen funktionalitet (77d)
- #2885 [feature] Sælg rytter til AI efter N mislykkede auktioner — udvej for hold der ikke kan k… (74d)
- …og 49 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- #6248 fix(training): maks +1 pr. evne pr. rytter pr. dato, fælles værn (Refs #6210) (1d) — groen
- #6310 feat(5162): gamle frontend-assets baeres videre mellem deploys (K1-K3) (0d) — groen

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #5827 5268 rating-neutral mental ability dry run V3 (9d) — groen
- #6297 draft(ops): fail-closed staging refresh gates (#6229) (1d) — groen
- #6305 fix(6156): samlet form og formtoppe i løbsmotor v4 bag slukket regel-revision (0d) — groen
- #6325 ops: require fresh affected-cron proof after deploy (#6318) (0d) — groen
- #6330 draft(race): shared group-time prototype behind inactive revision (#6199) (0d) — roed

**Ikke-draft med roed tilstand:**

- ingen

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (135d)
- #1569 Ny-spiller onboarding-audit (2026-06-20) — prioriteret handlingsplan (109d)
- #1819 Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup (106d)
- #2557 [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage i træk + favorit-w… (83d)
- #2682 AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til FAIL (81d)
- #2770 [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonussekunder (78d)
- #2822 [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste managerspil (76d)
- #2840 Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte rytt… (76d)
- #2884 [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-times-vind… (74d)
- #3154 [ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dage + fuld prioriteri… (69d)
- #3426 [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsler + for mange bjerg… (62d)
- #3461 [bug/balance] Restitutionens timing: 'Træn i dag' om morgenen brænder dagens eneste resti… (62d)
- #3511 [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashboard og må… (61d)
- #3564 [design] Progressionskæden samlet: potentiale 1-99, lofter pr. ryttertype, træningsscore,… (59d)
- #3855 [design] Race engine v4: intra-etape-motoren — etapen beregnes undervejs (ejer-retning 17… (51d)
- …og 705 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #4629 [design] Traeningsprogrammer: ugeplan med session pr. ugedag + 10-25 default-programmer (… (35d)
- #6006 [bug/brand] Train now (beta) træner kun 10 af 45 ryttere: autopick-hold behandles som om… (6d)
- #5947 [bug] Udviklingshistorikken: gårsdagens stigninger mangler hos nogle ryttere, andre steg… (8d)
- #4847 [træning] "Træn nu" tilbage uden bonus: tidsuafhængigt resultat, dagen afgøres i begge re… (32d)
- #5845 [docs] Ejer-direktiv 27/9: roadmappen opdateres torsdag 1/10 (10d)
- #3460 [bug/balance] effort er ikke koblet til kaptajnens støtte — 'Spar kræfter' er gratis, 'Ar… (62d)
- #5124 [mobil] D-047-standarden til de fire haandrullede tabeller: Auktioner, Transferlisten, Da… (27d)
- #6298 [bug] Bestyrelsens omdømme-udfordring tæller kun én rytter efter omdømme-opdateringen (kn… (1d)
- #6304 [bug/tekst] Besked: et hold står som vinder over sig selv ('X vandt af X') (feedback 2/10) (1d)
- #6261 [bug] Facility-opgradering kan betales med penge der er låst i auktionsbud (opfølger #623… (1d)
- #6262 [bug] Staff-ansættelse kan betales med penge der er låst i auktionsbud (opfølger #6237) (1d)
- #6263 [bug] Staff-fratrædelse (release) kan betales med penge der er låst i auktionsbud (opfølg… (1d)
- #6264 [bug] Akademi-signing kan betales med penge der er låst i auktionsbud (opfølger #6237) (1d)
- #6292 Attribution: 28 % af nye signups har egen side som kilde (kilden tabes) (1d)
- #6158 [data] Giv formtoppe brugt uden virkning under v4 tilbage til managerne (ejer 4/10, koere… (3d)
- …og 6 mere
