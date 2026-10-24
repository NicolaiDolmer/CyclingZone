# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

100 features i FEATURE_REGISTRY.yml: live 76 · beta 3 · dormant 4 · building 8 · spec 1 · idea 2 · retired 6.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #6636 feat(race-library): upcoming races and scoped edition history (5d) — DIRTY
- #6665 feat(marketing): ny forside med godkendt tekst og ægte produktbilleder (#1369) (2d) — DIRTY
- #7071 docs(training): Train now kun 4 sessioner - undersoegelse + design (#6461) (0d) — roed
- #7075 feat(6210): maks +1 pr. evne pr. dato bag slukket flag (Udvikling 2.0) (0d) — roed
- #7133 chore(deps): Bump multer from 2.4.0 to 2.5.0 in /backend (0d) — roed
- #7117 fix(resultater): maiden_win-titel til Rider's first win (#6975) (0d) — roed
- #7118 feat(ux): nationalitet som flag paa mobil + Evner (#7032) (0d) — roed
- #7119 feat(race): tre udbruds-ikoner i resultater (#7092) (0d) — groen
- #7121 feat(i18n): fr/es/nl i beta for alle spillere med Beta-maerke (#7087) (0d) — roed
- #7122 feat(dashboard): næste værdiopdatering og akademi-intake i Næste træk (#6962) (0d) — roed
- #7123 feat(seasons): GC-sejre og trøjevindere i sæsonoversigten (#6961) (0d) — roed
- #7125 feat(inbox): bedste placeringer i loebsbeskeden efter endagsloeb (#7085) (0d) — roed
- #7129 feat(notifications): indbakkebesked når en rytter bliver skadet i træning (#7086) (0d) — groen
- #7130 feat(kontrakter): Kontrakter-fane, forlæng flere 1-3 sæsoner, sortering huskes (#6855) (0d) — roed
- #7113 feat(6110): byggetrin 1 - harness for potentiale-skønnet (read-only) (0d) — roed

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #26 [feature] Transfer war-room (shortlist + sammenligning + budget-forecast) (170d)
- #605 P0: Codex verdensklasse — markant hurtigere leverancer med målt kvalitet (152d)
- #930 [Epic] Staff & manager-rolle som direktør (ansatte, sportsdirektører, læger, fysioterapeu… (144d)
- #961 Kontekstuel hjaelp: omraade-specifikt FAQ-link overalt (banner -> ikon, progressive) (143d)
- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (137d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (137d)
- #1173 Vækst/viralitets-loop: referral (del spillet med en ven) (136d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (136d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (135d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (127d)
- #2236 Organic community outreach — Reddit + Discord posting (109d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (102d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (99d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (97d)
- #2794 [ux/IA] Løbssiden er informationsoverload: opdel ruteprofil / holdudtagelse / etape-takti… (93d)
- …og 70 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- #7101 feat(bestyrelse): U23-/juniorresultater i vurderingen af ungdomsarbejdet (Refs #7096) (0d) — roed

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #6634 docs: implementeringsplan for løbsbibliotek med kommende løb og historik (9d) — groen
- #7024 docs(analytics): workshop design, history audit and pc1 handoff (2d) — groen
- #7101 feat(bestyrelse): U23-/juniorresultater i vurderingen af ungdomsarbejdet (Refs #7096) (0d) — roed
- #7132 docs(patch): 7.375 natbølgen 24/10 (0d) — groen

**Ikke-draft med roed tilstand:**

- #7071 docs(training): Train now kun 4 sessioner - undersoegelse + design (#6461) (0d) — roed
- #7075 feat(6210): maks +1 pr. evne pr. dato bag slukket flag (Udvikling 2.0) (0d) — roed
- #7133 chore(deps): Bump multer from 2.4.0 to 2.5.0 in /backend (0d) — roed
- #7117 fix(resultater): maiden_win-titel til Rider's first win (#6975) (0d) — roed
- #7118 feat(ux): nationalitet som flag paa mobil + Evner (#7032) (0d) — roed
- #7121 feat(i18n): fr/es/nl i beta for alle spillere med Beta-maerke (#7087) (0d) — roed
- #7122 feat(dashboard): næste værdiopdatering og akademi-intake i Næste træk (#6962) (0d) — roed
- #7123 feat(seasons): GC-sejre og trøjevindere i sæsonoversigten (#6961) (0d) — roed
- #7125 feat(inbox): bedste placeringer i loebsbeskeden efter endagsloeb (#7085) (0d) — roed
- #7130 feat(kontrakter): Kontrakter-fane, forlæng flere 1-3 sæsoner, sortering huskes (#6855) (0d) — roed
- #7113 feat(6110): byggetrin 1 - harness for potentiale-skønnet (read-only) (0d) — roed

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (151d)
- #1569 Ny-spiller onboarding-audit (2026-06-20) — prioriteret handlingsplan (126d)
- #1819 Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup (122d)
- #2557 [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage i træk + favorit-w… (99d)
- #2682 AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til FAIL (97d)
- #2770 [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonussekunder (94d)
- #2822 [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste managerspil (93d)
- #2840 Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte rytt… (92d)
- #2884 [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-times-vind… (91d)
- #3154 [ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dage + fuld prioriteri… (86d)
- #3426 [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsler + for mange bjerg… (79d)
- #3461 [bug/balance] Restitutionens timing: 'Træn i dag' om morgenen brænder dagens eneste resti… (78d)
- #3511 [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashboard og må… (77d)
- #3855 [design] Race engine v4: intra-etape-motoren — etapen beregnes undervejs (ejer-retning 17… (67d)
- #4010 Supabase-hærdning: realtime-MalformedJWT, sponsor-sweep, offset-paginering og getUser() p… (64d)
- …og 793 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #5947 [bug] Udviklingshistorikken: gårsdagens stigninger mangler hos nogle ryttere, andre steg… (24d)
- #6456 [motor] Tidsgab nr. 10 på bjergetaper uden topankomst og uden nedkørselsfinale har intet… (13d)
- #5842 [bug] Ejer-direktiv 27/9: rytterværdierne ændrede sig søndag ved sæsonskiftet - det må de… (26d)
- #6668 [S5] AI-ungdom løftes til menneskeholdenes niveau + menneskehold samles i færre grupper (… (8d)
- #5928 [bug/HØJ] Træthed og form flytter sig 5x pr. dato: konstanterne er kalibreret til ét tick… (25d)
- #6362 [S5-profiler] Ny finale: stigende massespurt (uphill_sprint) (15d)
- #6363 [S5-profiler] Ny finale: mur-finale (wall_finish) (15d)
- #6773 [bestyrelse] S3-mandater står stadig aktive i S4 og kan skygge for S4-mandatet i bestyrel… (6d)
- #6590 [app] Push-notifikationer: opt-in, kategorier, loft, stille timer (spor 2 af #6584) (10d)
- #6504 Frigivne ryttere: intet ejerskifte registreres, og aftentræningen giver falsk 'needs_reco… (12d)
- #6964 [ungdom] 19-årige står stadig på juniorholdet efter sæsonskifte / oprykkede U23 sidder fa… (4d)
- #6935 [kvalitet] Spil-dækkende gennemgang: fjern information der kan være forkert (ejer-princip… (4d)
- #6771 [cutover] D3->D4-nedrykning udebliver 25/10: poolAllReal-gaten er lukket i alle D3-puljer… (6d)
- #6957 [liga] Vagt mod dobbelt oprykning (div 4→2 / 3→1) ved sæsonskifte (ejer-løfte 18/9: 'sker… (4d)
- #6946 [indbakke] Bestyrelsesbeskeder kommer igen efter sletning (ejer-løfte 5/10) (4d)
- …og 41 mere
