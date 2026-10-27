# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

113 features i FEATURE_REGISTRY.yml: live 89 · dormant 8 · building 7 · spec 1 · idea 2 · retired 6.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #6665 feat(marketing): ny forside med godkendt tekst og ægte produktbilleder (#1369) (5d) — DIRTY
- #7243 feat(testport): monumenter som egen gruppe + favoritsejre pr. løbsgruppe (#7214) (0d) — groen
- #7191 feat(6461): Træn nu B fase 1 - klikket afregner rytterens hele kendte dato (slukket flag) (0d) — roed
- #7143 [merge efter 25/10] fix(training): aftenkørslen afregner sidste dato i netop afsluttet sæ… (0d) — roed
- #7101 feat(bestyrelse): U23-/juniorresultater i vurderingen af ungdomsarbejdet (Refs #7096) (0d) — roed
- #6636 feat(race-library): upcoming races and scoped edition history (0d) — DIRTY
- #7267 test(7266): motortests af spillernes ordrer under v3 (taktik-pakken) (0d) — roed
- #7265 feat(7239): delt kaptajn i appen + Race Hub tilfoejer ikke kaptajn i stilhed (0d) — groen
- #7269 docs(close-out): RACE_ENGINE_PLAN.md som SSOT for motor og taktik + NOW 26/10 aften (0d) — groen
- #7259 feat(motor-v3): fælles fremskrivning — farlige udbrud på snor + gates gcFromBreakaway/S3/… (0d) — groen
- #7278 fix(engine): sent soloangreb kun for ledere og fri rolle under s5_profiles_v3 (#6368) (0d) — groen
- #7268 feat(6746): sande tekster i taktik-pakken (rollebevidst Arbejd/Følg angrebene + Hjælp om… (0d) — groen

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #26 [feature] Transfer war-room (shortlist + sammenligning + budget-forecast) (173d)
- #605 P0: Codex verdensklasse — markant hurtigere leverancer med målt kvalitet (155d)
- #930 [Epic] Staff & manager-rolle som direktør (ansatte, sportsdirektører, læger, fysioterapeu… (146d)
- #961 Kontekstuel hjaelp: omraade-specifikt FAQ-link overalt (banner -> ikon, progressive) (146d)
- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (140d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (140d)
- #1173 Vækst/viralitets-loop: referral (del spillet med en ven) (139d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (139d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (138d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (130d)
- #2236 Organic community outreach — Reddit + Discord posting (112d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (105d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (102d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (99d)
- #2794 [ux/IA] Løbssiden er informationsoverload: opdel ruteprofil / holdudtagelse / etape-takti… (95d)
- …og 69 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- #7191 feat(6461): Træn nu B fase 1 - klikket afregner rytterens hele kendte dato (slukket flag) (0d) — roed
- #7240 feat(motor-v3): udbrud holder hjem oftere på kuperet og bjerg i etapeløb (#6804) (0d) — roed
- #7245 fix(youth): keep S5 AI lift within groups and value caps (0d) — groen

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #6634 docs: implementeringsplan for løbsbibliotek med kommende løb og historik (12d) — groen
- #7164 feat(motor): GT-enkeltstart mod bjergetaper målt mod virkeligheden (#6595) (2d) — DIRTY
- #7276 feat(5982): Sidste mand (luksushjælper) i v3-motoren (0d) — groen
- #7280 fix(6641): alt ud vinder tid paa rigtige felter under s5_profiles_v3 (0d) — groen
- #7272 feat(motor): dagsform under s5_profiles_v3 + 'dårlig dag' i løbsloggen (#6649) (0d) — groen
- #7279 feat(ops): ugentlig motor-drift-rapport paa rigtige loeb mod private gates (#2557) (0d) — groen
- #7281 feat(7003): spær modsatte ordrer i taktik-rækken og etapeplanen (0d) — roed
- #7274 feat(contracts): cover youth squads and mid-season acquisitions (0d) — groen
- #7240 feat(motor-v3): udbrud holder hjem oftere på kuperet og bjerg i etapeløb (#6804) (0d) — roed
- #7275 feat(film): hvorfor udbruddet holdt eller blev hentet + ordrer der gjorde forskellen (#64… (0d) — groen
- #7277 feat(6912): motor-beregnet udbrudschance i jaeger-boksen (S7 B) (0d) — DIRTY
- #7245 fix(youth): keep S5 AI lift within groups and value caps (0d) — groen

**Ikke-draft med roed tilstand:**

- #7191 feat(6461): Træn nu B fase 1 - klikket afregner rytterens hele kendte dato (slukket flag) (0d) — roed
- #7143 [merge efter 25/10] fix(training): aftenkørslen afregner sidste dato i netop afsluttet sæ… (0d) — roed
- #7101 feat(bestyrelse): U23-/juniorresultater i vurderingen af ungdomsarbejdet (Refs #7096) (0d) — roed
- #7267 test(7266): motortests af spillernes ordrer under v3 (taktik-pakken) (0d) — roed

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (154d)
- #1569 Ny-spiller onboarding-audit (2026-06-20) — prioriteret handlingsplan (128d)
- #1819 Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup (125d)
- #2682 AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til FAIL (99d)
- #2770 [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonussekunder (97d)
- #2822 [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste managerspil (95d)
- #2840 Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte rytt… (95d)
- #2884 [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-times-vind… (93d)
- #3154 [ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dage + fuld prioriteri… (88d)
- #3426 [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsler + for mange bjerg… (81d)
- #3511 [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashboard og må… (80d)
- #3564 [design] Progressionskæden samlet: potentiale 1-99, lofter pr. ryttertype, træningsscore,… (78d)
- #3855 [design] Race engine v4: intra-etape-motoren — etapen beregnes undervejs (ejer-retning 17… (70d)
- #4010 Supabase-hærdning: realtime-MalformedJWT, sponsor-sweep, offset-paginering og getUser() p… (67d)
- #4159 [guard] game_day-aksen maa aldrig kunne skrives skaevt igen: DB-trigger + lane-packer-fix… (63d)
- …og 797 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #5947 [bug] Udviklingshistorikken: gårsdagens stigninger mangler hos nogle ryttere, andre steg… (27d)
- #6456 [motor] Tidsgab nr. 10 på bjergetaper uden topankomst og uden nedkørselsfinale har intet… (15d)
- #5842 [bug] Ejer-direktiv 27/9: rytterværdierne ændrede sig søndag ved sæsonskiftet - det må de… (28d)
- #5928 [bug/HØJ] Træthed og form flytter sig 5x pr. dato: konstanterne er kalibreret til ét tick… (27d)
- #6362 [S5-profiler] Ny finale: stigende massespurt (uphill_sprint) (18d)
- #6363 [S5-profiler] Ny finale: mur-finale (wall_finish) (18d)
- #6773 [bestyrelse] S3-mandater står stadig aktive i S4 og kan skygge for S4-mandatet i bestyrel… (9d)
- #6590 [app] Push-notifikationer: opt-in, kategorier, loft, stille timer (spor 2 af #6584) (13d)
- #6504 Frigivne ryttere: intet ejerskifte registreres, og aftentræningen giver falsk 'needs_reco… (15d)
- #6964 [ungdom] 19-årige står stadig på juniorholdet efter sæsonskifte / oprykkede U23 sidder fa… (6d)
- #6771 [cutover] D3->D4-nedrykning udebliver 25/10: poolAllReal-gaten er lukket i alle D3-puljer… (9d)
- #6957 [liga] Vagt mod dobbelt oprykning (div 4→2 / 3→1) ved sæsonskifte (ejer-løfte 18/9: 'sker… (6d)
- #6946 [indbakke] Bestyrelsesbeskeder kommer igen efter sletning (ejer-løfte 5/10) (6d)
- #6499 Udvikling 2.0 del 1: tilbagegang D4 ved sæsonskiftet + prøvekørsel (bag flag) (15d)
- #6857 [design] Løbsidentitet: 8 faste løbstyper + signatur pr. løb + håndskrevne monumenter (ej… (8d)
- …og 36 mere
