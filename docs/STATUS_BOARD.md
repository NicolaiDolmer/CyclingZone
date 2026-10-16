# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

93 features i FEATURE_REGISTRY.yml: live 72 · beta 2 · dormant 6 · building 6 · spec 1 · idea 2 · retired 4.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #6248 fix(training): maks +1 pr. evne pr. rytter pr. dato, fælles værn (Refs #6210) (9d) — groen
- #6636 feat(race-library): upcoming races and scoped edition history (1d) — groen
- #6665 feat(marketing): ny forside med godkendt tekst og ægte produktbilleder (#1369) (0d) — groen
- #6662 feat(academy): hent-knappen vises selv med åbne tilbud (#6155) (0d) — groen
- #6643 feat(stage-page-v2): løbshistorien - replay, øjeblikke, mellemtider, Final 5 km, referat… (0d) — groen
- #6671 fix(youth): AI-ungdom på menneskeholdenes niveau + færre menneskegrupper (#6668) (0d) — groen
- #6680 feat(races): kalender-kort, status-prik og Løbshistorik bag race_library_v2 (#6514) (0d) — groen
- #6673 feat(academy): optag 2.0 - hent ugens kandidater, prognose gennem traening, profil via fa… (0d) — groen
- #6657 ops(ci): risikostyret review-gate (Codex paa alt, Claude paa hoejrisiko, CodeRabbit valgf… (0d) — groen
- #6705 feat(ops): udloebsregel for ikke-live flag (#6701) (0d) — groen
- #6702 fix(scout): loftbaand-alder bruger saesonalder (#6700) (0d) — groen
- #6707 docs(patch-notes): 7.362 - renere ikoner og hjælp der passer til løbene (0d) — groen

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #26 [feature] Transfer war-room (shortlist + sammenligning + budget-forecast) (162d)
- #605 P0: Codex verdensklasse — markant hurtigere leverancer med målt kvalitet (144d)
- #930 [Epic] Staff & manager-rolle som direktør (ansatte, sportsdirektører, læger, fysioterapeu… (136d)
- #961 Kontekstuel hjaelp: omraade-specifikt FAQ-link overalt (banner -> ikon, progressive) (135d)
- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (129d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (129d)
- #1173 Vækst/viralitets-loop: referral (del spillet med en ven) (128d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (128d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (127d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (119d)
- #2236 Organic community outreach — Reddit + Discord posting (101d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (94d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (91d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (89d)
- #2794 [ux/IA] Løbssiden er informationsoverload: opdel ruteprofil / holdudtagelse / etape-takti… (85d)
- …og 70 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- #6248 fix(training): maks +1 pr. evne pr. rytter pr. dato, fælles værn (Refs #6210) (9d) — groen
- #6703 fix(training): forbigaaende DB-fejl giver ny koersel, ikke traening uden bonus (#6596) (0d) — groen
- #6707 docs(patch-notes): 7.362 - renere ikoner og hjælp der passer til løbene (0d) — groen

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #6634 docs: implementeringsplan for løbsbibliotek med kommende løb og historik (1d) — groen
- #6703 fix(training): forbigaaende DB-fejl giver ny koersel, ikke traening uden bonus (#6596) (0d) — groen
- #6704 fix(training): parkerede hold koerer ikke laengere legacy-traening (#6536) (0d) — groen
- #6699 [EJER-GO KRÆVES - TÆNDING] S5-motorregler: s5_profiles_v1 bliver aktuel revision (#6369) (0d) — DIRTY

**Ikke-draft med roed tilstand:**

- ingen

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (143d)
- #1569 Ny-spiller onboarding-audit (2026-06-20) — prioriteret handlingsplan (117d)
- #1819 Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup (114d)
- #2557 [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage i træk + favorit-w… (91d)
- #2682 AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til FAIL (89d)
- #2770 [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonussekunder (86d)
- #2822 [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste managerspil (85d)
- #2840 Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte rytt… (84d)
- #2884 [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-times-vind… (83d)
- #3154 [ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dage + fuld prioriteri… (77d)
- #3426 [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsler + for mange bjerg… (71d)
- #3461 [bug/balance] Restitutionens timing: 'Træn i dag' om morgenen brænder dagens eneste resti… (70d)
- #3511 [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashboard og må… (69d)
- #3564 [design] Progressionskæden samlet: potentiale 1-99, lofter pr. ryttertype, træningsscore,… (67d)
- #3855 [design] Race engine v4: intra-etape-motoren — etapen beregnes undervejs (ejer-retning 17… (59d)
- …og 728 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #5947 [bug] Udviklingshistorikken: gårsdagens stigninger mangler hos nogle ryttere, andre steg… (16d)
- #6456 [motor] Tidsgab nr. 10 på bjergetaper uden topankomst og uden nedkørselsfinale har intet… (5d)
- #5842 [bug] Ejer-direktiv 27/9: rytterværdierne ændrede sig søndag ved sæsonskiftet - det må de… (18d)
- #6464 [motor] Bjerg i D2-D4: nr. 10 er 3-8 min efter vinderen på topankomster (mål 1:00-2:30 i… (5d)
- #6428 [race-engine/v4] Kuperet endagsløb: udbruddet vinder med 9-16 min til feltet under offici… (5d)
- #6543 [races] Auto-udtag dobbeltbooker: binding-opslaget afkortes ved over 1000 entries pr. hol… (3d)
- #6548 [ops] "Hvad brænder"-vagten: daglig rapport kl. 08 (GitHub Action + fast issue) (3d)
- #6359 [S5-profiler] Etapetypen udledes af ruten, ikke trukket først (7d)
- #6363 [S5-profiler] Ny finale: mur-finale (wall_finish) (7d)
- #6579 [ops] Engangs-refusion: 9 scout-missioner (54.000) ramt af #6551 (2d)
- #6574 [growth] Delbart road book-billede pr. etape (OG-billede, 0 kr.) til S5-lanceringen (2d)
- #6602 ops: cross-PC sync kræver bash på PATH + OneDrive-memory ligger cloud-only (1d)
- #6608 deps(frontend): @vercel/og 0.9 -> 1.0, OG-billede verificeret (1d)
- #6606 deps(frontend): eslint react.version 18.3 -> 19.3 + React 19-regler til igen (1d)
- #6607 deps: Sentry 10 -> 11 i frontend + backend, events verificeret (1d)
- …og 32 mere
