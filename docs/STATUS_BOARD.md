# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

88 features i FEATURE_REGISTRY.yml: live 67 · beta 3 · dormant 3 · building 10 · spec 1 · idea 2 · retired 2.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #6248 fix(training): maks +1 pr. evne pr. rytter pr. dato, fælles værn (Refs #6210) (5d) — groen
- #6482 fix(notifications): ulaest-taeller paa tvaers af faner, overbudt-notif, ingen mail ved eg… (0d) — groen
- #6483 fix(youth): EXP-badge paa U23/junior + saeson-alder paa Graduation Day (0d) — groen
- #6530 feat(fairplay): #2226 gem rytterværdi på handels-rækken ved gennemførelse (0d) — roed

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #605 P0: Codex verdensklasse — markant hurtigere leverancer med målt kvalitet (140d)
- #1140 Strømlin ny-spiller-onboarding til ét sammenhængende flow (konsolidér 6+ elementer) (126d)
- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (125d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (125d)
- #1173 Vækst/viralitets-loop: referral (del spillet med en ven) (124d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (124d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (123d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (115d)
- #2236 Organic community outreach — Reddit + Discord posting (97d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (90d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (87d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (85d)
- #2794 [ux/IA] Løbssiden er informationsoverload: opdel ruteprofil / holdudtagelse / etape-takti… (81d)
- #2806 [monetization] /pro er ikke linket fra appen, og isPro() gater ingen funktionalitet (81d)
- #2885 [feature] Sælg rytter til AI efter N mislykkede auktioner — udvej for hold der ikke kan k… (79d)
- …og 55 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- #6248 fix(training): maks +1 pr. evne pr. rytter pr. dato, fælles værn (Refs #6210) (5d) — groen
- #6506 docs(training): design og implementeringsplan for #6490 (0d) — groen
- #6507 feat(training): atomic history lookup projection candidate (#6490 L1) (0d) — groen
- #6508 feat(training): guarded resumable history backfill (#6490 L2) (0d) — groen
- #6509 perf(training): guarded history readers and atomic restore (#6490 L3) (0d) — groen
- #6518 perf(training): guarded membership backfill and pair parity (#6490 M2) (0d) — groen

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #6506 docs(training): design og implementeringsplan for #6490 (0d) — groen
- #6507 feat(training): atomic history lookup projection candidate (#6490 L1) (0d) — groen
- #6508 feat(training): guarded resumable history backfill (#6490 L2) (0d) — groen
- #6509 perf(training): guarded history readers and atomic restore (#6490 L3) (0d) — groen
- #6510 test(training): native deadlock evidence and design addendum (#6490 L4) (0d) — groen
- #6511 perf(training): per-report membership foundation (#6490 M1) (0d) — groen
- #6518 perf(training): guarded membership backfill and pair parity (#6490 M2) (0d) — groen

**Ikke-draft med roed tilstand:**

- #6530 feat(fairplay): #2226 gem rytterværdi på handels-rækken ved gennemførelse (0d) — roed

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (139d)
- #1569 Ny-spiller onboarding-audit (2026-06-20) — prioriteret handlingsplan (114d)
- #1819 Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup (110d)
- #2557 [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage i træk + favorit-w… (87d)
- #2682 AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til FAIL (85d)
- #2770 [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonussekunder (82d)
- #2822 [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste managerspil (81d)
- #2840 Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte rytt… (80d)
- #2884 [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-times-vind… (79d)
- #3154 [ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dage + fuld prioriteri… (73d)
- #3426 [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsler + for mange bjerg… (67d)
- #3461 [bug/balance] Restitutionens timing: 'Træn i dag' om morgenen brænder dagens eneste resti… (66d)
- #3511 [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashboard og må… (65d)
- #3564 [design] Progressionskæden samlet: potentiale 1-99, lofter pr. ryttertype, træningsscore,… (63d)
- #3855 [design] Race engine v4: intra-etape-motoren — etapen beregnes undervejs (ejer-retning 17… (55d)
- …og 733 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #5947 [bug] Udviklingshistorikken: gårsdagens stigninger mangler hos nogle ryttere, andre steg… (12d)
- #5845 [docs] Ejer-direktiv 27/9: roadmappen opdateres torsdag 1/10 (14d)
- #6158 [data] Giv formtoppe brugt uden virkning under v4 tilbage til managerne (ejer 4/10, koere… (7d)
- #6350 [race-film] Hændelser får motorens tjektidspunkt, ikke tidspunktet de skete (3d)
- #6187 [race-engine/v4] Et hold jagter udbruddet med sine egne ryttere i (Giro della Penisola e7… (7d)
- #5951 [bug/HØJ] v4: udbrud trækkes baglæns af jagten - indhentede udbrudsryttere taber op til 1… (12d)
- #6320 [bug] Usolgt auktion på U23/junior-rytter ender med oprykning eller at rytteren forsvinde… (4d)
- #5946 [bug] Bestyrelsen viser stadig top 5 efter genforhandling til top 7 (cybersimon 28/9) (12d)
- #6318 [ops] merge-køen: efter backend-merge der rører et cron-job, vent på jobbets næste check-… (4d)
- #5831 [ux] Besked til andet hold kan kun sendes via forum - mangler fra hold-, løbs- og rytters… (14d)
- #5917 [feature] Rytter på transferlisten skal kunne flyttes til U23-truppen (ejer lovede 28/9:… (13d)
- #6060 [feature] Træningsplan: kopiér en dags plan til de næste dage (spiller 1/10) (10d)
- #5897 Reparér 217 bestyrelser flyttet af U23-løb 28/9 (invers-delta + event-oprydning) (13d)
- #4522 [assistent] Assistent-forslag med programmer + 'start/styr assistenten'-knapper overalt h… (41d)
- #5945 [bug] Juniorhold med 3 ryttere står som "deltager" i taktik og træning, men kan ikke star… (12d)
- …og 33 mere
