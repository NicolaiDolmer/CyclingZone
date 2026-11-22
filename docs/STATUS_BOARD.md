# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

160 features i FEATURE_REGISTRY.yml: live 134 · dormant 7 · building 9 · spec 1 · idea 2 · retired 7.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #8248 design(training): samlet træningsdesign med 5 felter pr. dato (Refs #7947) (2d) — roed
- #8506 design(7947): R5 Program-fanen - desktop efter wireframe + telefon A-V1/A-V2/B/skifter (R… (1d) — roed
- #8598 docs(now): close-out 22/11 PC1, stafet til Dolmer PC + postmortem (0d) — roed

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #930 [Epic] Staff & manager-rolle som direktør (ansatte, sportsdirektører, læger, fysioterapeu… (173d)
- #961 Kontekstuel hjaelp: omraade-specifikt FAQ-link overalt (banner -> ikon, progressive) (173d)
- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (167d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (167d)
- #1173 Vækst/viralitets-loop: referral (del spillet med en ven) (166d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (166d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (165d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (157d)
- #2236 Organic community outreach — Reddit + Discord posting (138d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (131d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (126d)
- #2885 [feature] Sælg rytter til AI efter N mislykkede auktioner — udvej for hold der ikke kan k… (120d)
- #2991 season_grand_tour_rider kan ingen menneskemanager opnå: Grand Tours er Division-1-only og… (119d)
- #3147 [feature] Sponsor race-day-udbetalinger løbende i stedet for klumpsum ved sæsonslut (115d)
- #3471 [feature] Kalender-spor med identitet (GT-spor / WT-spor / klassiker-spor) — spiller-fors… (107d)
- …og 68 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- #8596 design(8595): fælles kolonnerækkefølge for rytterlister, forslag (merges aldrig) (0d) — roed

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #8287 docs(ux): gennemgang 3/4 løb (6d) — groen
- #8305 design(8300): dashboardet som spillets bedste side, research + skitse A/B/C (Refs #8300) (5d) — roed
- #8445 design(sketch): letlæselig indbakke + tabel-kontroller, 3 retninger hver (Refs #8280) (3d) — groen
- #8446 design(sketch): rytterprofilens top med plads til billede, 3 retninger (Refs #8281) (3d) — groen
- #8507 design(7947): R5 I dag - paritetshuller i skitsen + side-om-side-billeder (2d) — groen
- #8393 feat(taktik): telefonudgave B af taktikpanelet (Refs #8386) (2d) — DIRTY
- #8466 fix(balance): show the same available balance across the app (Refs #8357) (2d) — DIRTY
- #8579 fix(8546): ryttere uden plan gemmer det koerte niveau til aldringsbremsen (0d) — roed
- #8596 design(8595): fælles kolonnerækkefølge for rytterlister, forslag (merges aldrig) (0d) — roed

**Ikke-draft med roed tilstand:**

- #8248 design(training): samlet træningsdesign med 5 felter pr. dato (Refs #7947) (2d) — roed
- #8506 design(7947): R5 Program-fanen - desktop efter wireframe + telefon A-V1/A-V2/B/skifter (R… (1d) — roed
- #8598 docs(now): close-out 22/11 PC1, stafet til Dolmer PC + postmortem (0d) — roed

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #1819 Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup (151d)
- #2557 [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage i træk + favorit-w… (128d)
- #2770 [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonussekunder (124d)
- #2840 Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte rytt… (122d)
- #3426 [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsler + for mange bjerg… (108d)
- #3511 [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashboard og må… (107d)
- #3564 [design] Progressionskæden samlet: potentiale 1-99, lofter pr. ryttertype, træningsscore,… (105d)
- #4010 Supabase-hærdning: realtime-MalformedJWT, sponsor-sweep, offset-paginering og getUser() p… (94d)
- #4511 [billing/moms] EU-privatkunder bogfoeres momsfrit paa konto 1050 - forkert under 10.000 E… (83d)
- #4512 [billing] Abonnement udloeber uden fornyelsessti - current_period_end passerer mens CHECK… (83d)
- #4514 [billing/HOEJ] Kunde havde ubetalt faktura i 23 dage med fuld Pro-adgang - ingen alarm no… (83d)
- #4521 Ejer-direktiv 31/8: SSOT for patch notes (site + Discord) + efterkontrol siden 28/8 - foe… (83d)
- #4850 [Epic] Traening pr. loebsdag - loebsdagen bliver tick-enheden, live senest S4 28/9 (ejer-… (78d)
- #4914 [engine-v4] Kalibreringspakke foer flip: holdspil-gab, M12 all_out/grupetto, feltsprednin… (77d)
- #4964 [growth] Launch-kohorten holder 28,6 % mens etablerede holder 86,8 % - og signups faldt 2… (76d)
- …og 909 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #7474 [bug] Graduerings-sweep: to samtidige ticks afgjorde 7 ryttere to gange (dobbeltbesked) 1… (20d)
- #7536 [balance] Løbsdatoer med lette etaper giver mindre træthed end ren træning, så formen stå… (19d)
- #2230 [ux/perf] Layout-shift (CLS) på core-sider — mål via Speed Insights + fix reserved-space (139d)
- #8110 [board] Årsmandat-kørslen og andre bestyrelsesveje rammer stadig parkerede hold (9d)
- #7860 [løbsside] Resultater: én ren fuld liste (15d)
- #7868 [ux] Siden husker hvor du var + links fra indbakken til præcis etape/rytter (15d)
- #6940 [motor] Gruppetto-ordre: ingen udbrud, energibesparelse efter etapetype (ejer-løfte 1/10) (33d)
- #6649 [motor/design] Dagsform og dominans: de bedste vinder for ofte i forhold til virkeligheden (38d)
- #7964 [bestyrelse] Vision-milepæl +20% kan ikke nås, fordi tidligere sæsoner ikke tælles (egoma… (12d)
- #8188 [bug] Monument-bonus står på 0, selvom holdet har 3 monument-resultater (spiller 14/11) (7d)
- #8190 [bug] Træningsvisningen viser præcis 100 % hos flere hold (spiller 14/11) (7d)
- #6299 [investigation] 'Work'-ordren ser ud til at angribe uden 'try the break' + 27 mand i udbr… (46d)
- #7290 [motor] Motoren kører bakkerne fra højdeprofilen (trin 2 af #7289) (26d)
- #8070 [design] Dagens designregler skrives ind i TASTE.md og PAGE_TEMPLATES.md (ejeren godkende… (9d)
- #8076 [design] Ét designsystem for web, mobil og app (dagens retning ind i designsystem-epicen) (9d)
- …og 34 mere
