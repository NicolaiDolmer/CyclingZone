# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

123 features i FEATURE_REGISTRY.yml: live 101 · dormant 6 · building 7 · spec 1 · idea 2 · retired 6.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #6636 feat(race-library): upcoming races and scoped edition history (3d) — groen
- #6665 feat(marketing): ny forside med godkendt tekst og ægte produktbilleder (#1369) (0d) — roed

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #26 [feature] Transfer war-room (shortlist + sammenligning + budget-forecast) (178d)
- #605 P0: Codex verdensklasse — markant hurtigere leverancer med målt kvalitet (160d)
- #930 [Epic] Staff & manager-rolle som direktør (ansatte, sportsdirektører, læger, fysioterapeu… (152d)
- #961 Kontekstuel hjaelp: omraade-specifikt FAQ-link overalt (banner -> ikon, progressive) (151d)
- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (145d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (145d)
- #1173 Vækst/viralitets-loop: referral (del spillet med en ven) (144d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (144d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (143d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (136d)
- #2236 Organic community outreach — Reddit + Discord posting (117d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (110d)
- #2511 [perf/ci] Bundle-drift: gaten måler kun PR-diffs — main kan summe forbi loftet ubevogtet… (107d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (105d)
- #2794 [ux/IA] Løbssiden er informationsoverload: opdel ruteprofil / holdudtagelse / etape-takti… (101d)
- …og 74 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- ingen

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #6634 docs: implementeringsplan for løbsbibliotek med kommende løb og historik (3d) — groen

**Ikke-draft med roed tilstand:**

- #6665 feat(marketing): ny forside med godkendt tekst og ægte produktbilleder (#1369) (0d) — roed

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #671 Brand minimum: accent + font + wordmark (TdF-deadline subset af #481) (159d)
- #1569 Ny-spiller onboarding-audit (2026-06-20) — prioriteret handlingsplan (134d)
- #1819 Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup (130d)
- #2557 [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage i træk + favorit-w… (107d)
- #2682 AI-audit 19/7: NOW.md 2x over token-budget + CLAUDE.md-trim; gør token-WARN til FAIL (105d)
- #2770 [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonussekunder (103d)
- #2822 [fable] Verdensklasse-benchmark: hvor staar Cycling Zone mod de bedste managerspil (101d)
- #2840 Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte rytt… (101d)
- #2884 [feature] Auktioner: længere varighed + anti-snipe-forlængelse ved sene bud (1-times-vind… (99d)
- #3154 [ops] Ejer-direktiv 26/7: backlog ned til ~200 åbne issues på 7-14 dage + fuld prioriteri… (94d)
- #3426 [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsler + for mange bjerg… (87d)
- #3511 [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashboard og må… (86d)
- #3564 [design] Progressionskæden samlet: potentiale 1-99, lofter pr. ryttertype, træningsscore,… (84d)
- #3855 [design] Race engine v4: intra-etape-motoren — etapen beregnes undervejs (ejer-retning 17… (75d)
- #4010 Supabase-hærdning: realtime-MalformedJWT, sponsor-sweep, offset-paginering og getUser() p… (73d)
- …og 827 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #7380 [motor] Nedkørselsangreb ignorerer rytterens ordre (rytter på 'Bliv i læ' angreb 44 km fr… (2d)
- #6368 [motor] Soloangreb sent i løbet som motoradfærd (ikke finaletype) (23d)
- #7103 [træning] Enkeltstart kan næsten ikke trænes målrettet: Aero er kun let, Threshold træner… (9d)
- #6990 [bug/bestyrelse] Vision-milepælen 'Min. 6 U25-ryttere' tæller ikke ryttere under 23 (egom… (11d)
- #6855 [kontrakter] Kontrakter-fane: forlæng flere ad gangen, 1-3 sæsoner, sortering huskes (14d)
- #7003 [feature/taktik] Delt kaptajn + arbejd/angrib deles op, så modsatrettede ordrer ikke kan… (11d)
- #1857 [enhancement] Race-sim reproducerbarhed: snapshot rytter-betingelser (form/træthed/abilit… (128d)
- #2757 [balance] Pointtrøje: sprintpoint på bakke-/bjergetaper vægter for højt — flad-etape-vind… (103d)
- #3461 [bug/balance] Restitutionens timing: 'Træn i dag' om morgenen brænder dagens eneste resti… (86d)
- #5059 [ux] Sprint-toget findes ikke i prod: ordre-kolonnen er gated bag TACTICS_V4_PREVIEW (jon… (53d)
- #5319 [balance] De gamle traeningsformer matcher ikke ryttertyper som de tre nye - Taerskel/tem… (45d)
- #5842 [bug] Ejer-direktiv 27/9: rytterværdierne ændrede sig søndag ved sæsonskiftet - det må de… (34d)
- #5947 [bug] Udviklingshistorikken: gårsdagens stigninger mangler hos nogle ryttere, andre steg… (32d)
- #5982 [design] Hjælperarbejde pr. løbsfase: gem luksushjælperen til bjerget eller finalen (31d)
- #6156 [bug] Formtoppe og rytterform har ingen virkning i loeb siden v4-flippet 28/9 - spillerne… (28d)
- …og 61 mere
