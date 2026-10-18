# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

96 features i FEATURE_REGISTRY.yml: live 75 · beta 2 · dormant 5 · building 5 · spec 1 · idea 2 · retired 6.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #6248 fix(training): maks +1 pr. evne pr. rytter pr. dato, fælles værn (Refs #6210) (11d) — DIRTY
- #6636 feat(race-library): upcoming races and scoped edition history (3d) — DIRTY
- #6665 feat(marketing): ny forside med godkendt tekst og ægte produktbilleder (#1369) (1d) — roed
- #6839 fix(training): Traen nu paa loebsdags-stien svarer 409 ved holdt reservation (Refs #6827) (0d) — roed
- #6680 feat(races): kalender-kort, status-prik og Løbshistorik bag race_library_v2 (#6514) (0d) — roed
- #6780 fix(board): mandater fra en afsluttet saeson skygger ikke for det aktuelle mandat (#6773) (0d) — roed
- #6873 docs(patch-notes): 7.368, samlet 17-18/10 (EN+DA) (0d) — roed

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #26 [feature] Transfer war-room (shortlist + sammenligning + budget-forecast) (165d)
- #605 P0: Codex verdensklasse — markant hurtigere leverancer med målt kvalitet (146d)
- #930 [Epic] Staff & manager-rolle som direktør (ansatte, sportsdirektører, læger, fysioterapeu… (138d)
- #961 Kontekstuel hjaelp: omraade-specifikt FAQ-link overalt (banner -> ikon, progressive) (138d)
- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (132d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (132d)
- #1173 Vækst/viralitets-loop: referral (del spillet med en ven) (131d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (131d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (129d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (122d)
- #2236 Organic community outreach — Reddit + Discord posting (103d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (96d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (94d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (91d)
- #2794 [ux/IA] Løbssiden er informationsoverload: opdel ruteprofil / holdudtagelse / etape-takti… (87d)
- …og 70 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- #6248 fix(training): maks +1 pr. evne pr. rytter pr. dato, fælles værn (Refs #6210) (11d) — DIRTY
- #6849 docs(6765): design for inkrementelle rangliste-matviews (0d) — groen
- #6873 docs(patch-notes): 7.368, samlet 17-18/10 (EN+DA) (0d) — roed

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #6634 docs: implementeringsplan for løbsbibliotek med kommende løb og historik (3d) — groen
- #6813 docs(6804): design for kuperede udbrudssejre (rod-aarsag + A/B, bag s5_profiles_v2) (1d) — groen
- #6819 [EJER-GO KRÆVES - TÆNDING] chore(db): s5_profiles_v2 bliver en lovlig regel-revision (#68… (0d) — groen
- #6820 [EJER-GO KRÆVES - TÆNDING] S5 v2: s5_profiles_v2 bliver aktuel revision (#6818) (0d) — groen
- #6843 docs(6814): design for jagtafstand på gap_update (bag s5_profiles_v2) (0d) — groen
- #6849 docs(6765): design for inkrementelle rangliste-matviews (0d) — groen

**Ikke-draft med roed tilstand:**

- #6665 feat(marketing): ny forside med godkendt tekst og ægte produktbilleder (#1369) (1d) — roed
- #6839 fix(training): Traen nu paa loebsdags-stien svarer 409 ved holdt reservation (Refs #6827) (0d) — roed
- #6680 feat(races): kalender-kort, status-prik og Løbshistorik bag race_library_v2 (#6514) (0d) — roed
- #6780 fix(board): mandater fra en afsluttet saeson skygger ikke for det aktuelle mandat (#6773) (0d) — roed
- #6873 docs(patch-notes): 7.368, samlet 17-18/10 (EN+DA) (0d) — roed

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (145d)
- #1569 Ny-spiller onboarding-audit (2026-06-20) — prioriteret handlingsplan (120d)
- #1819 Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup (116d)
- #2557 [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage i træk + favorit-w… (93d)
- #2682 AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til FAIL (91d)
- #2770 [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonussekunder (89d)
- #2822 [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste managerspil (87d)
- #2840 Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte rytt… (87d)
- #2884 [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-times-vind… (85d)
- #3154 [ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dage + fuld prioriteri… (80d)
- #3426 [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsler + for mange bjerg… (73d)
- #3461 [bug/balance] Restitutionens timing: 'Træn i dag' om morgenen brænder dagens eneste resti… (73d)
- #3511 [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashboard og må… (72d)
- #3564 [design] Progressionskæden samlet: potentiale 1-99, lofter pr. ryttertype, træningsscore,… (70d)
- #3855 [design] Race engine v4: intra-etape-motoren — etapen beregnes undervejs (ejer-retning 17… (61d)
- …og 757 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #5947 [bug] Udviklingshistorikken: gårsdagens stigninger mangler hos nogle ryttere, andre steg… (18d)
- #6456 [motor] Tidsgab nr. 10 på bjergetaper uden topankomst og uden nedkørselsfinale har intet… (7d)
- #5842 [bug] Ejer-direktiv 27/9: rytterværdierne ændrede sig søndag ved sæsonskiftet - det må de… (20d)
- #6428 [race-engine/v4] Kuperet endagsløb: udbruddet vinder med 9-16 min til feltet under offici… (8d)
- #6548 [ops] "Hvad brænder"-vagten: daglig rapport kl. 08 (GitHub Action + fast issue) (5d)
- #6359 [S5-profiler] Etapetypen udledes af ruten, ikke trukket først (10d)
- #6363 [S5-profiler] Ny finale: mur-finale (wall_finish) (10d)
- #6362 [S5-profiler] Ny finale: stigende massespurt (uphill_sprint) (10d)
- #5928 [bug/HØJ] Træthed og form flytter sig 5x pr. dato: konstanterne er kalibreret til ét tick… (19d)
- #6531 [security] CodeQL: 'Incomplete URL substring sanitization' (High) i scripts/ops/db-watchd… (6d)
- #6201 [race-engine/v4] Udbrud er for små på bjergetaper (median 3 mod mål 4-8) (13d)
- #6474 [økonomi] Økonomihistorikken viser både køb og salg for en rytter man kun har købt + salg… (7d)
- #6499 Udvikling 2.0 del 1: tilbagegang D4 ved sæsonskiftet + prøvekørsel (bag flag) (6d)
- #6367 [S5-profiler] Benchmark-gate: S5-kalenderen målt mod rigtige Grand Tours før live (10d)
- #6668 [S5] AI-ungdom løftes til menneskeholdenes niveau + menneskehold samles i færre grupper (… (3d)
- …og 47 mere
