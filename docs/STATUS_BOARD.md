# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

151 features i FEATURE_REGISTRY.yml: live 118 · beta 1 · dormant 10 · building 12 · spec 1 · idea 2 · retired 7.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- ingen

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #26 [feature] Transfer war-room (shortlist + sammenligning + budget-forecast) (193d)
- #930 [Epic] Staff & manager-rolle som direktør (ansatte, sportsdirektører, læger, fysioterapeu… (166d)
- #961 Kontekstuel hjaelp: omraade-specifikt FAQ-link overalt (banner -> ikon, progressive) (166d)
- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (160d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (160d)
- #1173 Vækst/viralitets-loop: referral (del spillet med en ven) (159d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (159d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (158d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (150d)
- #2236 Organic community outreach — Reddit + Discord posting (132d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (125d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (122d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (120d)
- #2885 [feature] Sælg rytter til AI efter N mislykkede auktioner — udvej for hold der ikke kan k… (113d)
- #2991 season_grand_tour_rider kan ingen menneskemanager opnå: Grand Tours er Division-1-only og… (113d)
- …og 74 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- ingen

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #8184 design: skitser enklere traeningsvalg (#7947) (0d) — roed
- #8187 docs(design): skitse #8013 a og c, fill-undtagelser og aarsag ved deaktiveret plan (0d) — groen
- #8185 design(6944): skitser for akademiets aldersgruppe (0d) — groen
- #8194 docs(i18n): Træn nu-tekster, udkast til afregningstidspunkt (Refs #7982) (0d) — groen
- #8191 docs(race): designoplaeg for sprintere paa kuperede og boelgede etaper (Refs #8189) (0d) — groen
- #8210 feat(training): traeningsrapport i XP-format, Today og 30 days (kladde, Refs #7627) (0d) — groen
- #8212 fix(train-now): belastning i hvert dag-felt + ingen afvisning ved løbssession midt i tryk… (0d) — groen
- #8211 feat(race): v6 planstatus pr. etape, vindernavn og fem review-rettelser (slukket) (0d) — groen
- #8205 feat(training): traeningsrapporten viser loebets bidrag pr. evne (Refs #7627) (0d) — groen
- #8213 feat(training): løbets session vises som kørt efter etapen, skærmdelen bag slukket kontak… (0d) — groen

**Ikke-draft med roed tilstand:**

- ingen

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (174d)
- #1569 Ny-spiller onboarding-audit (2026-06-20) — prioriteret handlingsplan (148d)
- #1819 Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup (145d)
- #2557 [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage i træk + favorit-w… (121d)
- #2682 AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til FAIL (120d)
- #2770 [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonussekunder (117d)
- #2822 [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste managerspil (115d)
- #2840 Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte rytt… (115d)
- #2884 [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-times-vind… (113d)
- #3154 [ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dage + fuld prioriteri… (108d)
- #3426 [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsler + for mange bjerg… (101d)
- #3511 [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashboard og må… (100d)
- #4010 Supabase-hærdning: realtime-MalformedJWT, sponsor-sweep, offset-paginering og getUser() p… (87d)
- #4159 [guard] game_day-aksen maa aldrig kunne skrives skaevt igen: DB-trigger + lane-packer-fix… (84d)
- #4321 [growth] PostHog (EU) som analytics-lag: kanal-attribution, funnels, retention + MCP-adga… (80d)
- …og 902 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #6299 [investigation] 'Work'-ordren ser ud til at angribe uden 'try the break' + 27 mand i udbr… (39d)
- #7003 [feature/taktik] Delt kaptajn + arbejd/angrib deles op, så modsatrettede ordrer ikke kan… (25d)
- #7290 [motor] Motoren kører bakkerne fra højdeprofilen (trin 2 af #7289) (19d)
- #7294 [bug/planlægning] Udtagelse i sæsonmatrix flytter visuelt til forkerte datoer indtil genå… (19d)
- #7474 [bug] Graduerings-sweep: to samtidige ticks afgjorde 7 ryttere to gange (dobbeltbesked) 1… (14d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (122d)
- #7789 Roadmap-admin: graf og kategorier som spørgeskema-panelet (9d)
- #6204 [roadmap/admin] Faner, filtre og sortering i roadmap-admin (ejer 5/10) (41d)
- #7561 [ux] Kalender: vis 'Klar · 6/8' når feltet har plads til flere end startgulvet (12d)
- #7536 [balance] Løbsdatoer med lette etaper giver mindre træthed end ren træning, så formen stå… (13d)
- #1407 SEO measurement layer: GSC + GA4 + Ahrefs + Morningscore korrekt opsat + ownership-doc (153d)
- #3797 [growth] GSC-data + konverterings-funnel per kanal i growth-dashboardet (92d)
- #7971 [roadmap] Gennemgang 10/11: opdateret roadmap, kategorier og admin-brugervenlighed (5d)
- #3564 [design] Progressionskæden samlet: potentiale 1-99, lofter pr. ryttertype, træningsscore,… (98d)
- #7832 [bug] Nyt hold oprettet sent på aftenen mister sin første træningsdato (CYCLINGZONE-A6) (8d)
- …og 32 mere
