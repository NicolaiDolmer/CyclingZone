# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

108 features i FEATURE_REGISTRY.yml: live 80 · dormant 11 · building 8 · spec 1 · idea 2 · retired 6.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #6665 feat(marketing): ny forside med godkendt tekst og ægte produktbilleder (#1369) (4d) — DIRTY
- #7191 feat(6461): Træn nu B fase 1 - klikket afregner rytterens hele kendte dato (slukket flag) (0d) — DIRTY
- #6636 feat(race-library): upcoming races and scoped edition history (0d) — DIRTY
- #7225 docs(masterplan): status efter S5-skiftet 25/10 (0d) — groen
- #7205 feat(motor-v3): delt kaptajn + spurtkaptajn som eneste leder, slukket s5_profiles_v3 (#59… (0d) — roed

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #26 [feature] Transfer war-room (shortlist + sammenligning + budget-forecast) (172d)
- #605 P0: Codex verdensklasse — markant hurtigere leverancer med målt kvalitet (154d)
- #930 [Epic] Staff & manager-rolle som direktør (ansatte, sportsdirektører, læger, fysioterapeu… (145d)
- #961 Kontekstuel hjaelp: omraade-specifikt FAQ-link overalt (banner -> ikon, progressive) (145d)
- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (139d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (139d)
- #1173 Vækst/viralitets-loop: referral (del spillet med en ven) (138d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (138d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (137d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (129d)
- #2236 Organic community outreach — Reddit + Discord posting (111d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (104d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (101d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (99d)
- #2794 [ux/IA] Løbssiden er informationsoverload: opdel ruteprofil / holdudtagelse / etape-takti… (95d)
- …og 68 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- #7101 feat(bestyrelse): U23-/juniorresultater i vurderingen af ungdomsarbejdet (Refs #7096) (1d) — roed

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #6634 docs: implementeringsplan for løbsbibliotek med kommende løb og historik (11d) — groen
- #7143 [merge efter 25/10] fix(training): aftenkørslen afregner sidste dato i netop afsluttet sæ… (1d) — groen
- #7164 feat(motor): GT-enkeltstart mod bjergetaper målt mod virkeligheden (#6595) (1d) — DIRTY
- #7101 feat(bestyrelse): U23-/juniorresultater i vurderingen af ungdomsarbejdet (Refs #7096) (1d) — roed

**Ikke-draft med roed tilstand:**

- #7205 feat(motor-v3): delt kaptajn + spurtkaptajn som eneste leder, slukket s5_profiles_v3 (#59… (0d) — roed

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (153d)
- #1569 Ny-spiller onboarding-audit (2026-06-20) — prioriteret handlingsplan (127d)
- #1819 Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup (124d)
- #2557 [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage i træk + favorit-w… (100d)
- #2682 AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til FAIL (99d)
- #2770 [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonussekunder (96d)
- #2822 [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste managerspil (94d)
- #2840 Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte rytt… (94d)
- #2884 [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-times-vind… (92d)
- #3154 [ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dage + fuld prioriteri… (87d)
- #3426 [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsler + for mange bjerg… (80d)
- #3511 [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashboard og må… (79d)
- #3564 [design] Progressionskæden samlet: potentiale 1-99, lofter pr. ryttertype, træningsscore,… (77d)
- #3855 [design] Race engine v4: intra-etape-motoren — etapen beregnes undervejs (ejer-retning 17… (69d)
- #4010 Supabase-hærdning: realtime-MalformedJWT, sponsor-sweep, offset-paginering og getUser() p… (66d)
- …og 800 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #5947 [bug] Udviklingshistorikken: gårsdagens stigninger mangler hos nogle ryttere, andre steg… (26d)
- #6456 [motor] Tidsgab nr. 10 på bjergetaper uden topankomst og uden nedkørselsfinale har intet… (15d)
- #5842 [bug] Ejer-direktiv 27/9: rytterværdierne ændrede sig søndag ved sæsonskiftet - det må de… (27d)
- #5928 [bug/HØJ] Træthed og form flytter sig 5x pr. dato: konstanterne er kalibreret til ét tick… (26d)
- #6362 [S5-profiler] Ny finale: stigende massespurt (uphill_sprint) (17d)
- #6363 [S5-profiler] Ny finale: mur-finale (wall_finish) (17d)
- #6773 [bestyrelse] S3-mandater står stadig aktive i S4 og kan skygge for S4-mandatet i bestyrel… (8d)
- #6590 [app] Push-notifikationer: opt-in, kategorier, loft, stille timer (spor 2 af #6584) (12d)
- #6504 Frigivne ryttere: intet ejerskifte registreres, og aftentræningen giver falsk 'needs_reco… (14d)
- #6964 [ungdom] 19-årige står stadig på juniorholdet efter sæsonskifte / oprykkede U23 sidder fa… (5d)
- #6771 [cutover] D3->D4-nedrykning udebliver 25/10: poolAllReal-gaten er lukket i alle D3-puljer… (8d)
- #6957 [liga] Vagt mod dobbelt oprykning (div 4→2 / 3→1) ved sæsonskifte (ejer-løfte 18/9: 'sker… (5d)
- #6946 [indbakke] Bestyrelsesbeskeder kommer igen efter sletning (ejer-løfte 5/10) (5d)
- #6499 Udvikling 2.0 del 1: tilbagegang D4 ved sæsonskiftet + prøvekørsel (bag flag) (14d)
- #6857 [design] Løbsidentitet: 8 faste løbstyper + signatur pr. løb + håndskrevne monumenter (ej… (7d)
- …og 28 mere
