# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

135 features i FEATURE_REGISTRY.yml: live 107 · beta 1 · dormant 9 · building 9 · spec 1 · idea 2 · retired 6.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #6665 feat(marketing): ny forside med godkendt tekst og ægte produktbilleder (#1369) (4d) — roed
- #7875 feat(market): pengelås PR 5, M3 og bud-gates bag slukket kontakt (#7872) (0d) — roed
- #7888 feat(riders): mestertrøjer ved rytternavne bag beta-kontakt (#7824) (0d) — groen
- #7870 feat(training): træningsrapporten viser hele evnepoint tydeligt og i profilens rækkefølge… (0d) — roed
- #7857 feat(taktik): trøjejagt, Hent point og Hent bjergpoint i etapeplanen bag kontakt (#7855) (0d) — groen
- #7907 fix(ops): push-vagterne tjekker pushets mål, ikke den lokale branch (0d) — roed
- #7913 fix(træning): auto-udtagelse regner træthed ved etapestart (#7801) (0d) — groen
- #7882 feat(riders): talentmærker Toptalent og Næste generation bag beta-kontakt (#7879) (0d) — roed
- #7914 feat(help): dagsform i ord, hjælp bag kontakten (#7725) (0d) — roed
- #7915 fix(løbsfilm): Hvorfor? og referat siger at rytteren røg uden for tidsgrænsen fordi han v… (0d) — groen

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #26 [feature] Transfer war-room (shortlist + sammenligning + budget-forecast) (185d)
- #930 [Epic] Staff & manager-rolle som direktør (ansatte, sportsdirektører, læger, fysioterapeu… (159d)
- #961 Kontekstuel hjaelp: omraade-specifikt FAQ-link overalt (banner -> ikon, progressive) (159d)
- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (153d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (153d)
- #1173 Vækst/viralitets-loop: referral (del spillet med en ven) (152d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (152d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (150d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (143d)
- #2236 Organic community outreach — Reddit + Discord posting (124d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (117d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (114d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (112d)
- #2885 [feature] Sælg rytter til AI efter N mislykkede auktioner — udvej for hold der ikke kan k… (106d)
- #2991 season_grand_tour_rider kan ingen menneskemanager opnå: Grand Tours er Division-1-only og… (105d)
- …og 61 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- #7888 feat(riders): mestertrøjer ved rytternavne bag beta-kontakt (#7824) (0d) — groen
- #7870 feat(training): træningsrapporten viser hele evnepoint tydeligt og i profilens rækkefølge… (0d) — roed
- #7857 feat(taktik): trøjejagt, Hent point og Hent bjergpoint i etapeplanen bag kontakt (#7855) (0d) — groen
- #7882 feat(riders): talentmærker Toptalent og Næste generation bag beta-kontakt (#7879) (0d) — roed

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #7652 docs: beslutningspakke om vækst og varig fastholdelse (#7495) (4d) — groen
- #7696 docs(design): sammenhængende taktikpris og indsatskort (#7638, #5101) (3d) — groen
- #7816 fix(træning): link til profilen fra navnet i mobilens I dag-detalje (#6524) (1d) — groen
- #7825 fix(mobil): større trykflader i Taktik (#6916) (1d) — groen
- #7878 feat(market): auto-accept PR 6, M2 og backend bag auto_accept_enabled (#2176) (0d) — roed
- #7841 feat(admin): roadmap-graf og kategorier som spørgeskema-panelet (#7789) (0d) — roed
- #7850 docs(race): hjælp og registerpost for tidsgrænse-varslet (#7715) (0d) — groen
- #7874 feat(market): pengelås PR 3, parkerede stier og afregning bag sale_escrow_enabled (#6181) (0d) — groen

**Ikke-draft med roed tilstand:**

- #6665 feat(marketing): ny forside med godkendt tekst og ægte produktbilleder (#1369) (4d) — roed
- #7875 feat(market): pengelås PR 5, M3 og bud-gates bag slukket kontakt (#7872) (0d) — roed
- #7870 feat(training): træningsrapporten viser hele evnepoint tydeligt og i profilens rækkefølge… (0d) — roed
- #7907 fix(ops): push-vagterne tjekker pushets mål, ikke den lokale branch (0d) — roed
- #7882 feat(riders): talentmærker Toptalent og Næste generation bag beta-kontakt (#7879) (0d) — roed
- #7914 feat(help): dagsform i ord, hjælp bag kontakten (#7725) (0d) — roed

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (166d)
- #1569 Ny-spiller onboarding-audit (2026-06-20) — prioriteret handlingsplan (141d)
- #1819 Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup (137d)
- #2557 [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage i træk + favorit-w… (114d)
- #2682 AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til FAIL (112d)
- #2770 [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonussekunder (110d)
- #2822 [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste managerspil (108d)
- #2840 Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte rytt… (108d)
- #2884 [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-times-vind… (106d)
- #3154 [ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dage + fuld prioriteri… (101d)
- #3426 [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsler + for mange bjerg… (94d)
- #3511 [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashboard og må… (93d)
- #3564 [design] Progressionskæden samlet: potentiale 1-99, lofter pr. ryttertype, træningsscore,… (91d)
- #4010 Supabase-hærdning: realtime-MalformedJWT, sponsor-sweep, offset-paginering og getUser() p… (80d)
- #4159 [guard] game_day-aksen maa aldrig kunne skrives skaevt igen: DB-trigger + lane-packer-fix… (76d)
- …og 847 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #6299 [investigation] 'Work'-ordren ser ud til at angribe uden 'try the break' + 27 mand i udbr… (32d)
- #7489 [bug] Falsk træningsalarm når en manager frigiver ryttere mens aftentræningen kører (CYCL… (6d)
- #7003 [feature/taktik] Delt kaptajn + arbejd/angrib deles op, så modsatrettede ordrer ikke kan… (18d)
- #6975 [resultater] Løbssejr registreret før sæson 4 startede (19d)
- #7533 [ux] Kalendertabel + Løbshistorik: klik på navn, ikoner én gang, rigtig Klar-status, sort… (5d)
- #6156 [bug] Formtoppe og rytterform har ingen virkning i loeb siden v4-flippet 28/9 - spillerne… (35d)
- #6456 [motor] Tidsgab nr. 10 på bjergetaper uden topankomst og uden nedkørselsfinale har intet… (28d)
- #6649 [motor/design] Dagsform og dominans: de bedste vinder for ofte i forhold til virkeligheden (24d)
- #6668 [S5] AI-ungdom løftes til menneskeholdenes niveau + menneskehold samles i færre grupper (… (24d)
- #6804 [motor] Kuperede udbrudssejre: maalt baseline + design (22d)
- #6940 [motor] Gruppetto-ordre: ingen udbrud, energibesparelse efter etapetype (ejer-løfte 1/10) (19d)
- #7160 [motor v3] Udbrud vinder for sjældent på store bjergetaper: mål mod GT 2023-24 og ret i v3 (14d)
- #7290 [motor] Motoren kører bakkerne fra højdeprofilen (trin 2 af #7289) (12d)
- #7294 [bug/planlægning] Udtagelse i sæsonmatrix flytter visuelt til forkerte datoer indtil genå… (12d)
- #6471 [motor/planlægning] Rutematch skal følge motorens regler og opdateres når reglerne ændres (28d)
- …og 23 mere
