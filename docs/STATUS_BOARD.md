# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

101 features i FEATURE_REGISTRY.yml: live 79 · beta 1 · dormant 5 · building 7 · spec 1 · idea 2 · retired 6.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #6636 feat(race-library): upcoming races and scoped edition history (6d) — DIRTY
- #6665 feat(marketing): ny forside med godkendt tekst og ægte produktbilleder (#1369) (3d) — DIRTY
- #7157 feat(6110): Udviklingsscore B, modul bag development_score_v2 (byggetrin a) (0d) — groen
- #7158 feat(6950): catch-up via løb som rent modul (S13, S14, S16), uden kaldere (0d) — roed
- #7154 feat(6110): S25 - 10-sæsoners-simulering før tænding (dev-harness) (0d) — roed
- #7150 feat(motor-v3): flere udgåede - sygdom af træthed, styrt pr. terræn, hjælper stiger af (#… (0d) — DIRTY
- #7155 feat(motor v3): bjergpoint i favoritgruppen + lead-out slår sjældent sin sprinter (#6937) (0d) — roed
- #7171 feat(engine): #6804 v3-basen P7+P1+P6+P2, G2/G11 og S0 (slukket s5_profiles_v3), genetabl… (0d) — DIRTY
- #7172 docs(patch): 7.377 aftenens ændringer 24/10 + etapeside 2.0 live i registret (0d) — roed

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #26 [feature] Transfer war-room (shortlist + sammenligning + budget-forecast) (171d)
- #605 P0: Codex verdensklasse — markant hurtigere leverancer med målt kvalitet (153d)
- #930 [Epic] Staff & manager-rolle som direktør (ansatte, sportsdirektører, læger, fysioterapeu… (144d)
- #961 Kontekstuel hjaelp: omraade-specifikt FAQ-link overalt (banner -> ikon, progressive) (144d)
- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (138d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (138d)
- #1173 Vækst/viralitets-loop: referral (del spillet med en ven) (137d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (137d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (136d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (128d)
- #2236 Organic community outreach — Reddit + Discord posting (110d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (103d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (100d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (97d)
- #2794 [ux/IA] Løbssiden er informationsoverload: opdel ruteprofil / holdudtagelse / etape-takti… (93d)
- …og 67 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- #7101 feat(bestyrelse): U23-/juniorresultater i vurderingen af ungdomsarbejdet (Refs #7096) (0d) — roed
- #7172 docs(patch): 7.377 aftenens ændringer 24/10 + etapeside 2.0 live i registret (0d) — roed

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #6634 docs: implementeringsplan for løbsbibliotek med kommende løb og historik (10d) — groen
- #7151 feat(motor-v3): udbrud på flad/rullende, pointjægere i udbrud, jagtafstand på gap_update… (0d) — groen
- #7143 [merge efter 25/10] fix(training): aftenkørslen afregner sidste dato i netop afsluttet sæ… (0d) — groen
- #7164 feat(motor): GT-enkeltstart mod bjergetaper målt mod virkeligheden (#6595) (0d) — groen
- #7166 feat(udvikling): potentiale som ét tal overalt, bedste rolle + typeboks (#6853) (0d) — DIRTY
- #7163 feat(motor): de 5 indsatstrin kalibreret + gruppetto-ordre (bag slukket flag) (0d) — groen
- #7161 feat(løbsfilm): kun morgenudbruddet hedder udbrud + egen ordre efter etapen (#6299) (0d) — groen
- #7101 feat(bestyrelse): U23-/juniorresultater i vurderingen af ungdomsarbejdet (Refs #7096) (0d) — roed

**Ikke-draft med roed tilstand:**

- #7158 feat(6950): catch-up via løb som rent modul (S13, S14, S16), uden kaldere (0d) — roed
- #7154 feat(6110): S25 - 10-sæsoners-simulering før tænding (dev-harness) (0d) — roed
- #7155 feat(motor v3): bjergpoint i favoritgruppen + lead-out slår sjældent sin sprinter (#6937) (0d) — roed
- #7172 docs(patch): 7.377 aftenens ændringer 24/10 + etapeside 2.0 live i registret (0d) — roed

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (151d)
- #1569 Ny-spiller onboarding-audit (2026-06-20) — prioriteret handlingsplan (126d)
- #1819 Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup (122d)
- #2557 [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage i træk + favorit-w… (99d)
- #2682 AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til FAIL (97d)
- #2770 [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonussekunder (95d)
- #2822 [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste managerspil (93d)
- #2840 Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte rytt… (93d)
- #2884 [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-times-vind… (91d)
- #3154 [ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dage + fuld prioriteri… (86d)
- #3426 [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsler + for mange bjerg… (79d)
- #3461 [bug/balance] Restitutionens timing: 'Træn i dag' om morgenen brænder dagens eneste resti… (79d)
- #3511 [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashboard og må… (78d)
- #3564 [design] Progressionskæden samlet: potentiale 1-99, lofter pr. ryttertype, træningsscore,… (76d)
- #3855 [design] Race engine v4: intra-etape-motoren — etapen beregnes undervejs (ejer-retning 17… (68d)
- …og 782 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #5947 [bug] Udviklingshistorikken: gårsdagens stigninger mangler hos nogle ryttere, andre steg… (25d)
- #6456 [motor] Tidsgab nr. 10 på bjergetaper uden topankomst og uden nedkørselsfinale har intet… (13d)
- #5842 [bug] Ejer-direktiv 27/9: rytterværdierne ændrede sig søndag ved sæsonskiftet - det må de… (26d)
- #6668 [S5] AI-ungdom løftes til menneskeholdenes niveau + menneskehold samles i færre grupper (… (9d)
- #5928 [bug/HØJ] Træthed og form flytter sig 5x pr. dato: konstanterne er kalibreret til ét tick… (25d)
- #6362 [S5-profiler] Ny finale: stigende massespurt (uphill_sprint) (16d)
- #6363 [S5-profiler] Ny finale: mur-finale (wall_finish) (16d)
- #6773 [bestyrelse] S3-mandater står stadig aktive i S4 og kan skygge for S4-mandatet i bestyrel… (7d)
- #6590 [app] Push-notifikationer: opt-in, kategorier, loft, stille timer (spor 2 af #6584) (11d)
- #6504 Frigivne ryttere: intet ejerskifte registreres, og aftentræningen giver falsk 'needs_reco… (13d)
- #6964 [ungdom] 19-årige står stadig på juniorholdet efter sæsonskifte / oprykkede U23 sidder fa… (4d)
- #6771 [cutover] D3->D4-nedrykning udebliver 25/10: poolAllReal-gaten er lukket i alle D3-puljer… (7d)
- #6957 [liga] Vagt mod dobbelt oprykning (div 4→2 / 3→1) ved sæsonskifte (ejer-løfte 18/9: 'sker… (4d)
- #6946 [indbakke] Bestyrelsesbeskeder kommer igen efter sletning (ejer-løfte 5/10) (4d)
- #7034 [ops] Backend-image bygges i GitHub Actions til GHCR, så Railway-build-nedbrud ikke bloke… (2d)
- …og 27 mere
