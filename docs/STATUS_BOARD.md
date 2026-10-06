# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

87 features i FEATURE_REGISTRY.yml: live 64 · beta 6 · dormant 3 · building 9 · spec 1 · idea 2 · retired 2.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #6053 feat(training): Programs - pick rider or group first, then the program (#6035) (2d) — groen
- #6198 chore(5864): dry-run + ejer-gated haandhaevelse af udloebne kontrakter (1d) — groen
- #6254 fix(ops): migrate Supabase Log Watch to unified logs endpoint (0d) — groen
- #6248 fix(training): maks +1 pr. evne pr. rytter pr. dato, fælles værn (Refs #6210) (0d) — groen
- #6259 chore(cron): fjern død Deadline Day-cron og afstem sæsonskifte-readiness (0d) — groen
- #6260 chore(race-engine): v3-nedkoerselsanker maaler ejerens regel (Refs #6257) (0d) — groen
- #6247 fix(race-engine): udbruddets størrelse følger etapeprofilen (orders_gc_v3, #6201) (0d) — groen
- #6265 fix(db): indeks-migrationen for #6184 faar et loft paa 20 min i sessionen (0d) — groen
- #6269 docs(patch-notes): 7.343 - præmieprognose, udbrudsetiketter, scouting, udtagelse (0d) — groen
- #6270 chore(deps): sharp 0.35.5 i roden og marketing (Dependabot #66 #67) (0d) — groen

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (120d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (120d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (118d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (117d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (110d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (84d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (81d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (79d)
- #2794 [ux/IA] Løbssiden er informationsoverload: opdel ruteprofil / holdudtagelse / etape-takti… (75d)
- #2885 [feature] Sælg rytter til AI efter N mislykkede auktioner — udvej for hold der ikke kan k… (73d)
- #2887 [feature/balance] Sportsdirektør: gør senior-træningsstatten meningsfuld (påvirker den de… (73d)
- #2991 season_grand_tour_rider kan ingen menneskemanager opnå: Grand Tours er Division-1-only og… (72d)
- #3050 [feature] Venskabsløb / custom turneringer på tværs af divisioner (spiller-oprettede sim-… (71d)
- #3147 [feature] Sponsor race-day-udbetalinger løbende i stedet for klumpsum ved sæsonslut (68d)
- #3413 [balance] Udbrudsforsøg er gratis (ingen fatigue, ingen placeringsrisiko) — 2 spillere hæ… (61d)
- …og 43 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- #6248 fix(training): maks +1 pr. evne pr. rytter pr. dato, fælles værn (Refs #6210) (0d) — groen
- #6259 chore(cron): fjern død Deadline Day-cron og afstem sæsonskifte-readiness (0d) — groen
- #6247 fix(race-engine): udbruddets størrelse følger etapeprofilen (orders_gc_v3, #6201) (0d) — groen
- #6269 docs(patch-notes): 7.343 - præmieprognose, udbrudsetiketter, scouting, udtagelse (0d) — groen

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #5827 5268 rating-neutral mental ability dry run V3 (7d) — groen
- #6136 fix(watchdog): bound result metadata with SQL summaries (#6102) (2d) — groen
- #6170 test(loadtest): fail closed on staging data prerequisites (#5904) (0d) — groen

**Ikke-draft med roed tilstand:**

- ingen

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (133d)
- #1569 Ny-spiller onboarding-audit (2026-06-20) — prioriteret handlingsplan (108d)
- #1819 Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup (104d)
- #2557 [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage i træk + favorit-w… (81d)
- #2682 AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til FAIL (79d)
- #2770 [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonussekunder (77d)
- #2822 [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste managerspil (75d)
- #2840 Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte rytt… (75d)
- #2884 [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-times-vind… (73d)
- #3154 [ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dage + fuld prioriteri… (68d)
- #3461 [bug/balance] Restitutionens timing: 'Træn i dag' om morgenen brænder dagens eneste resti… (61d)
- #3511 [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashboard og må… (60d)
- #3564 [design] Progressionskæden samlet: potentiale 1-99, lofter pr. ryttertype, træningsscore,… (58d)
- #3855 [design] Race engine v4: intra-etape-motoren — etapen beregnes undervejs (ejer-retning 17… (49d)
- #4010 Supabase-hærdning: realtime-MalformedJWT, sponsor-sweep, offset-paginering og getUser() p… (47d)
- …og 686 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #4629 [design] Traeningsprogrammer: ugeplan med session pr. ugedag + 10-25 default-programmer (… (34d)
- #6000 [træning] Træningsgrupper: én beslutning for flere ryttere (ejer 1/10) (5d)
- #6006 [bug/brand] Train now (beta) træner kun 10 af 45 ryttere: autopick-hold behandles som om… (5d)
- #5124 [mobil] D-047-standarden til de fire haandrullede tabeller: Auktioner, Transferlisten, Da… (25d)
- #6027 [træning] Train now giver ingen synlig respons: rapporten skjuler løbsdag 1-4 indtil dato… (4d)
- #5947 [bug] Udviklingshistorikken: gårsdagens stigninger mangler hos nogle ryttere, andre steg… (6d)
- #4847 [træning] "Træn nu" tilbage uden bonus: tidsuafhængigt resultat, dagen afgøres i begge re… (30d)
- #5845 [docs] Ejer-direktiv 27/9: roadmappen opdateres torsdag 1/10 (8d)
- #6095 [bug] Gem af etapetaktik overskriver alle etapers intentioner: Giro-intentioner for 17 et… (4d)
- #3460 [bug/balance] effort er ikke koblet til kaptajnens støtte — 'Spar kræfter' er gratis, 'Ar… (61d)
- #6219 [proposals-drift] Forslag er anvendt i prod uden at være forfremmet (1d)
- #6174 [security] Flyt roadmap_split_item og roadmap_resync_flags bag backend (revoke fra authen… (1d)
- #6221 [supabase-advisor-sweep] Nye advisor-fund uden for accept-listen (0d)
