# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

118 features i FEATURE_REGISTRY.yml: live 97 · dormant 5 · building 7 · spec 1 · idea 2 · retired 6.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #6665 feat(marketing): ny forside med godkendt tekst og ægte produktbilleder (#1369) (9d) — DIRTY
- #6636 feat(race-library): upcoming races and scoped edition history (1d) — groen
- #7279 feat(ops): ugentlig motor-drift-rapport paa rigtige loeb mod private gates (#2557) (0d) — roed
- #7392 docs(registry): kurve B og træningskatalog v3 er live (30/10) (0d) — groen

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #26 [feature] Transfer war-room (shortlist + sammenligning + budget-forecast) (177d)
- #605 P0: Codex verdensklasse — markant hurtigere leverancer med målt kvalitet (159d)
- #930 [Epic] Staff & manager-rolle som direktør (ansatte, sportsdirektører, læger, fysioterapeu… (150d)
- #961 Kontekstuel hjaelp: omraade-specifikt FAQ-link overalt (banner -> ikon, progressive) (150d)
- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (144d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (144d)
- #1173 Vækst/viralitets-loop: referral (del spillet med en ven) (143d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (143d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (142d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (134d)
- #2236 Organic community outreach — Reddit + Discord posting (116d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (109d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (106d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (103d)
- #2794 [ux/IA] Løbssiden er informationsoverload: opdel ruteprofil / holdudtagelse / etape-takti… (99d)
- …og 76 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- #7392 docs(registry): kurve B og træningskatalog v3 er live (30/10) (0d) — groen

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #6634 docs: implementeringsplan for løbsbibliotek med kommende løb og historik (1d) — groen

**Ikke-draft med roed tilstand:**

- #7279 feat(ops): ugentlig motor-drift-rapport paa rigtige loeb mod private gates (#2557) (0d) — roed

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (157d)
- #1569 Ny-spiller onboarding-audit (2026-06-20) — prioriteret handlingsplan (132d)
- #1819 Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup (128d)
- #2682 AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til FAIL (103d)
- #2770 [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonussekunder (101d)
- #2822 [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste managerspil (99d)
- #2840 Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte rytt… (99d)
- #2884 [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-times-vind… (97d)
- #3154 [ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dage + fuld prioriteri… (92d)
- #3426 [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsler + for mange bjerg… (85d)
- #3461 [bug/balance] Restitutionens timing: 'Træn i dag' om morgenen brænder dagens eneste resti… (85d)
- #3511 [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashboard og må… (84d)
- #3855 [design] Race engine v4: intra-etape-motoren — etapen beregnes undervejs (ejer-retning 17… (74d)
- #4010 Supabase-hærdning: realtime-MalformedJWT, sponsor-sweep, offset-paginering og getUser() p… (71d)
- #4159 [guard] game_day-aksen maa aldrig kunne skrives skaevt igen: DB-trigger + lane-packer-fix… (67d)
- …og 850 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #5947 [bug] Udviklingshistorikken: gårsdagens stigninger mangler hos nogle ryttere, andre steg… (31d)
- #6456 [motor] Tidsgab nr. 10 på bjergetaper uden topankomst og uden nedkørselsfinale har intet… (19d)
- #5842 [bug] Ejer-direktiv 27/9: rytterværdierne ændrede sig søndag ved sæsonskiftet - det må de… (32d)
- #6362 [S5-profiler] Ny finale: stigende massespurt (uphill_sprint) (22d)
- #6363 [S5-profiler] Ny finale: mur-finale (wall_finish) (22d)
- #6773 [bestyrelse] S3-mandater står stadig aktive i S4 og kan skygge for S4-mandatet i bestyrel… (13d)
- #6590 [app] Push-notifikationer: opt-in, kategorier, loft, stille timer (spor 2 af #6584) (17d)
- #6504 Frigivne ryttere: intet ejerskifte registreres, og aftentræningen giver falsk 'needs_reco… (19d)
- #6964 [ungdom] 19-årige står stadig på juniorholdet efter sæsonskifte / oprykkede U23 sidder fa… (10d)
- #6771 [cutover] D3->D4-nedrykning udebliver 25/10: poolAllReal-gaten er lukket i alle D3-puljer… (13d)
- #6957 [liga] Vagt mod dobbelt oprykning (div 4→2 / 3→1) ved sæsonskifte (ejer-løfte 18/9: 'sker… (10d)
- #6946 [indbakke] Bestyrelsesbeskeder kommer igen efter sletning (ejer-løfte 5/10) (10d)
- #6499 Udvikling 2.0 del 1: tilbagegang D4 ved sæsonskiftet + prøvekørsel (bag flag) (19d)
- #6857 [design] Løbsidentitet: 8 faste løbstyper + signatur pr. løb + håndskrevne monumenter (ej… (12d)
- #6594 [s5/rute] Rigtig højdeprofil pr. etape (højdeserie fra rutegeneratoren) (16d)
- …og 59 mere
