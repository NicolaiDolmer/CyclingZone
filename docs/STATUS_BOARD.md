# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

122 features i FEATURE_REGISTRY.yml: live 100 · dormant 6 · building 7 · spec 1 · idea 2 · retired 6.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #6636 feat(race-library): upcoming races and scoped edition history (2d) — groen
- #7405 feat(7336): genberegn de låste motor-fingeraftryk i ét trin (kun domme) (0d) — groen
- #7415 chore(6853): fjern gammel flag-vej for rider_best_role_display (0d) — groen
- #7403 feat(6595): tænd enkeltstartens egen terrænvægt (0d) — groen
- #6665 feat(marketing): ny forside med godkendt tekst og ægte produktbilleder (#1369) (0d) — roed

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #26 [feature] Transfer war-room (shortlist + sammenligning + budget-forecast) (178d)
- #605 P0: Codex verdensklasse — markant hurtigere leverancer med målt kvalitet (160d)
- #930 [Epic] Staff & manager-rolle som direktør (ansatte, sportsdirektører, læger, fysioterapeu… (151d)
- #961 Kontekstuel hjaelp: omraade-specifikt FAQ-link overalt (banner -> ikon, progressive) (151d)
- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (145d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (145d)
- #1173 Vækst/viralitets-loop: referral (del spillet med en ven) (144d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (144d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (143d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (135d)
- #2236 Organic community outreach — Reddit + Discord posting (116d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (110d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (107d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (104d)
- #2794 [ux/IA] Løbssiden er informationsoverload: opdel ruteprofil / holdudtagelse / etape-takti… (100d)
- …og 75 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- ingen

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #6634 docs: implementeringsplan for løbsbibliotek med kommende løb og historik (2d) — groen

**Ikke-draft med roed tilstand:**

- #6665 feat(marketing): ny forside med godkendt tekst og ægte produktbilleder (#1369) (0d) — roed

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (158d)
- #1569 Ny-spiller onboarding-audit (2026-06-20) — prioriteret handlingsplan (133d)
- #1819 Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup (129d)
- #2557 [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage i træk + favorit-w… (106d)
- #2682 AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til FAIL (104d)
- #2770 [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonussekunder (102d)
- #2822 [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste managerspil (100d)
- #2840 Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte rytt… (100d)
- #2884 [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-times-vind… (98d)
- #3154 [ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dage + fuld prioriteri… (93d)
- #3426 [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsler + for mange bjerg… (86d)
- #3511 [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashboard og må… (85d)
- #3564 [design] Progressionskæden samlet: potentiale 1-99, lofter pr. ryttertype, træningsscore,… (83d)
- #3855 [design] Race engine v4: intra-etape-motoren — etapen beregnes undervejs (ejer-retning 17… (75d)
- #4010 Supabase-hærdning: realtime-MalformedJWT, sponsor-sweep, offset-paginering og getUser() p… (72d)
- …og 835 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #7382 [udvikling] Blød overgang for ryttere over det nye loft når kurve B tændes (1d)
- #7381 [taktik] To kanttilfælde efter #7377: alt ud-historie for plan-ryttere og holdarbejde på… (1d)
- #7334 [bug] Rutematch er væk fra Taktik-fanen undtagen på enkeltstarter (egomadsen 28/10) (2d)
- #7316 [bug] Træning S5: programmets hovedevne (klatring/sprint/TT/punch) giver ingen fremgang,… (3d)
- #7296 [bug/dashboard] Næste løb sender spilleren til et andet løb end forventet efter sæsonskif… (4d)
- #7294 [bug/planlægning] Udtagelse i sæsonmatrix flytter visuelt til forkerte datoer indtil genå… (4d)
- #7289 Løbssiden: Hold-fanen viser andre etapeprofiler end Etaper-fanen (4d)
- #7285 [bug] Transferhistorik: handler efter S5-start vises under sæson 4 (thelamba 26/10) (4d)
- #7284 [bug] Rytter står stadig på transferlisten efter at have forladt holdet (knud_r_flink 27/… (4d)
- #7258 [motor] v3.1: klassementet afgøres for ofte af udbrud; farlige udbrud skal holdes på snor (5d)
- #7251 [beslutning] S4-ryttere frigivet uden varsel: tilbagekøbsret eller tilbageførsel + hårdt… (5d)
- #7235 [bug] Pensionsvisningen skifter kortvarigt under sæsonskiftet - rytter der stopper ser ud… (5d)
- #7219 Akademiet: tekst om fuld evaluering er misvisende (trænet uge eller dage på holdet?) (6d)
- #7134 [bot] Playwright Smoke rød på main (nightly) (7d)
- #7096 [bestyrelse] Ungdomsresultater (U23/junior) tæller i vurderingen af ungdomsarbejdet, ikke… (8d)
- …og 65 mere
