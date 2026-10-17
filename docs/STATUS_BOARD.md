# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

95 features i FEATURE_REGISTRY.yml: live 75 · beta 2 · dormant 5 · building 5 · spec 1 · idea 2 · retired 5.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #6248 fix(training): maks +1 pr. evne pr. rytter pr. dato, fælles værn (Refs #6210) (10d) — groen
- #6636 feat(race-library): upcoming races and scoped edition history (2d) — groen
- #6665 feat(marketing): ny forside med godkendt tekst og ægte produktbilleder (#1369) (1d) — groen
- #6643 feat(stage-page-v2): løbshistorien - replay, øjeblikke, mellemtider, Final 5 km, referat… (1d) — DIRTY
- #6680 feat(races): kalender-kort, status-prik og Løbshistorik bag race_library_v2 (#6514) (0d) — DIRTY

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #26 [feature] Transfer war-room (shortlist + sammenligning + budget-forecast) (163d)
- #605 P0: Codex verdensklasse — markant hurtigere leverancer med målt kvalitet (145d)
- #930 [Epic] Staff & manager-rolle som direktør (ansatte, sportsdirektører, læger, fysioterapeu… (137d)
- #961 Kontekstuel hjaelp: omraade-specifikt FAQ-link overalt (banner -> ikon, progressive) (136d)
- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (130d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (130d)
- #1173 Vækst/viralitets-loop: referral (del spillet med en ven) (129d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (129d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (128d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (120d)
- #2236 Organic community outreach — Reddit + Discord posting (102d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (95d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (92d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (90d)
- #2794 [ux/IA] Løbssiden er informationsoverload: opdel ruteprofil / holdudtagelse / etape-takti… (86d)
- …og 70 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- #6248 fix(training): maks +1 pr. evne pr. rytter pr. dato, fælles værn (Refs #6210) (10d) — groen
- #6703 fix(training): forbigaaende DB-fejl giver ny koersel, ikke traening uden bonus (#6596) (1d) — groen

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #6634 docs: implementeringsplan for løbsbibliotek med kommende løb og historik (2d) — groen
- #6703 fix(training): forbigaaende DB-fejl giver ny koersel, ikke traening uden bonus (#6596) (1d) — groen
- #6704 fix(training): parkerede hold koerer ikke laengere legacy-traening (#6536) (1d) — groen

**Ikke-draft med roed tilstand:**

- ingen

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (144d)
- #1569 Ny-spiller onboarding-audit (2026-06-20) — prioriteret handlingsplan (118d)
- #1819 Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup (115d)
- #2557 [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage i træk + favorit-w… (92d)
- #2682 AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til FAIL (90d)
- #2770 [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonussekunder (87d)
- #2822 [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste managerspil (86d)
- #2840 Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte rytt… (85d)
- #2884 [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-times-vind… (84d)
- #3154 [ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dage + fuld prioriteri… (78d)
- #3426 [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsler + for mange bjerg… (72d)
- #3461 [bug/balance] Restitutionens timing: 'Træn i dag' om morgenen brænder dagens eneste resti… (71d)
- #3511 [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashboard og må… (70d)
- #3564 [design] Progressionskæden samlet: potentiale 1-99, lofter pr. ryttertype, træningsscore,… (68d)
- #3855 [design] Race engine v4: intra-etape-motoren — etapen beregnes undervejs (ejer-retning 17… (60d)
- …og 735 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #5947 [bug] Udviklingshistorikken: gårsdagens stigninger mangler hos nogle ryttere, andre steg… (17d)
- #6456 [motor] Tidsgab nr. 10 på bjergetaper uden topankomst og uden nedkørselsfinale har intet… (6d)
- #5842 [bug] Ejer-direktiv 27/9: rytterværdierne ændrede sig søndag ved sæsonskiftet - det må de… (19d)
- #6428 [race-engine/v4] Kuperet endagsløb: udbruddet vinder med 9-16 min til feltet under offici… (6d)
- #6548 [ops] "Hvad brænder"-vagten: daglig rapport kl. 08 (GitHub Action + fast issue) (4d)
- #6359 [S5-profiler] Etapetypen udledes af ruten, ikke trukket først (8d)
- #6363 [S5-profiler] Ny finale: mur-finale (wall_finish) (8d)
- #6362 [S5-profiler] Ny finale: stigende massespurt (uphill_sprint) (8d)
- #6667 [S5] U23/junior uden S4's fejl: løftet AI-ungdom, samlede grupper, flere U23-løbsdage, ny… (1d)
- #5928 [bug/HØJ] Træthed og form flytter sig 5x pr. dato: konstanterne er kalibreret til ét tick… (17d)
- #6531 [security] CodeQL: 'Incomplete URL substring sanitization' (High) i scripts/ops/db-watchd… (4d)
- #6201 [race-engine/v4] Udbrud er for små på bjergetaper (median 3 mod mål 4-8) (11d)
- #6474 [økonomi] Økonomihistorikken viser både køb og salg for en rytter man kun har købt + salg… (5d)
- #6499 Udvikling 2.0 del 1: tilbagegang D4 ved sæsonskiftet + prøvekørsel (bag flag) (5d)
- #6367 [S5-profiler] Benchmark-gate: S5-kalenderen målt mod rigtige Grand Tours før live (8d)
- …og 6 mere
