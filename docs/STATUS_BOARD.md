# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

88 features i FEATURE_REGISTRY.yml: live 67 · beta 3 · dormant 3 · building 10 · spec 1 · idea 2 · retired 2.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #6248 fix(training): maks +1 pr. evne pr. rytter pr. dato, fælles værn (Refs #6210) (3d) — groen
- #6403 fix(economy): ingen vaerdiskrivning ved saesonskiftet, eet fast soendagstidspunkt (#5842) (0d) — groen
- #6426 feat(ops): #5878 databasevagt - probe hvert 5. min + Discord-ops-alarm (0d) — groen
- #6454 feat(dev): Motor-testbaenken - nedkoerselsfinaler for sig + een rute taeller een gang (0d) — groen
- #6443 fix(engine): gate trin 3 - GT-margin maalt, tidsankre doemt i realistisk felt (#6442) (0d) — groen
- #6455 fix(engine): gate trin 1 - tidsgab efter RULES (topankomster, uden udbrudssejre) (#6441) (0d) — groen
- #6459 perf(training): first-use-trigger scanner ikke længere alle træningsrapporter (akademi-si… (0d) — groen
- #6458 fix(engine): v3 udbrudsmargin + farlig klassementsrytter oven paa forslag A (#6457) (0d) — groen
- #6453 TAEND-PR: official_times_v3 bliver den aktuelle motor-revision (#6452) (0d) — groen
- #6448 fix(engine): official_times_v3 - etapeinteresse + additiv holdjagt (forslag A) + fair Udb… (0d) — groen

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #605 P0: Codex verdensklasse — markant hurtigere leverancer med målt kvalitet (139d)
- #1140 Strømlin ny-spiller-onboarding til ét sammenhængende flow (konsolidér 6+ elementer) (125d)
- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (124d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (124d)
- #1173 Vækst/viralitets-loop: referral (del spillet med en ven) (123d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (123d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (122d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (114d)
- #2236 Organic community outreach — Reddit + Discord posting (96d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (89d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (86d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (84d)
- #2794 [ux/IA] Løbssiden er informationsoverload: opdel ruteprofil / holdudtagelse / etape-takti… (80d)
- #2806 [monetization] /pro er ikke linket fra appen, og isPro() gater ingen funktionalitet (80d)
- #2885 [feature] Sælg rytter til AI efter N mislykkede auktioner — udvej for hold der ikke kan k… (77d)
- …og 54 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- #6248 fix(training): maks +1 pr. evne pr. rytter pr. dato, fælles værn (Refs #6210) (3d) — groen

## 3) Bygget men ikke merget
**Draft-PR'er:**

- ingen

**Ikke-draft med roed tilstand:**

- ingen

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (138d)
- #1569 Ny-spiller onboarding-audit (2026-06-20) — prioriteret handlingsplan (112d)
- #1819 Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup (109d)
- #2557 [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage i træk + favorit-w… (85d)
- #2682 AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til FAIL (84d)
- #2770 [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonussekunder (81d)
- #2822 [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste managerspil (79d)
- #2840 Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte rytt… (79d)
- #2884 [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-times-vind… (77d)
- #3154 [ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dage + fuld prioriteri… (72d)
- #3426 [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsler + for mange bjerg… (65d)
- #3461 [bug/balance] Restitutionens timing: 'Træn i dag' om morgenen brænder dagens eneste resti… (65d)
- #3511 [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashboard og må… (64d)
- #3564 [design] Progressionskæden samlet: potentiale 1-99, lofter pr. ryttertype, træningsscore,… (62d)
- #3855 [design] Race engine v4: intra-etape-motoren — etapen beregnes undervejs (ejer-retning 17… (54d)
- …og 705 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #5947 [bug] Udviklingshistorikken: gårsdagens stigninger mangler hos nogle ryttere, andre steg… (11d)
- #5845 [docs] Ejer-direktiv 27/9: roadmappen opdateres torsdag 1/10 (12d)
- #6158 [data] Giv formtoppe brugt uden virkning under v4 tilbage til managerne (ejer 4/10, koere… (6d)
- #6350 [race-film] Hændelser får motorens tjektidspunkt, ikke tidspunktet de skete (2d)
- #6187 [race-engine/v4] Et hold jagter udbruddet med sine egne ryttere i (Giro della Penisola e7… (5d)
- #5951 [bug/HØJ] v4: udbrud trækkes baglæns af jagten - indhentede udbrudsryttere taber op til 1… (11d)
- #6320 [bug] Usolgt auktion på U23/junior-rytter ender med oprykning eller at rytteren forsvinde… (3d)
- #5946 [bug] Bestyrelsen viser stadig top 5 efter genforhandling til top 7 (cybersimon 28/9) (11d)
- #6318 [ops] merge-køen: efter backend-merge der rører et cron-job, vent på jobbets næste check-… (3d)
- #5831 [ux] Besked til andet hold kan kun sendes via forum - mangler fra hold-, løbs- og rytters… (13d)
- #5917 [feature] Rytter på transferlisten skal kunne flyttes til U23-truppen (ejer lovede 28/9:… (11d)
- #6060 [feature] Træningsplan: kopiér en dags plan til de næste dage (spiller 1/10) (8d)
- #5897 Reparér 217 bestyrelser flyttet af U23-løb 28/9 (invers-delta + event-oprydning) (12d)
- #4522 [assistent] Assistent-forslag med programmer + 'start/styr assistenten'-knapper overalt h… (40d)
- #5945 [bug] Juniorhold med 3 ryttere står som "deltager" i taktik og træning, men kan ikke star… (11d)
- …og 10 mere
