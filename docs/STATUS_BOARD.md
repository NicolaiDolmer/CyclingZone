# STATUS BOARD

> **GENERERET FIL - rediger den ALDRIG i haanden.**
> Kilde: `gh pr list` / `gh issue list` (live) + [`docs/FEATURE_REGISTRY.yml`](FEATURE_REGISTRY.yml)
> Regenerér: `node scripts/generate-status-board.mjs`

160 features i FEATURE_REGISTRY.yml: live 134 · dormant 7 · building 9 · spec 1 · idea 2 · retired 7.

## 1) Lige nu (merge-koe)
Aabne PR'er, ikke draft. Tilstand er CI (`statusCheckRollup`) - "roed" er en fejlet check. "DIRTY" er en aegte merge-konflikt (`mergeStateStatus`). GitHubs `mergeStateStatus: BLOCKED` (manglende review) taeller IKKE alene som roed (se slutrapport).

- #8625 feat(8548): Rotation og ugeblokke i Program R5 (Refs #8548 #8549) (0d) — roed
- #8616 feat(roadmap): fælles kategorier og faste tidspunkter (#8584) (0d) — roed
- #8630 chore(build-stop): ejerens go som markoer paa issuet (Refs #7336) (0d) — roed
- #8635 chore(build-stop): arbejdsforbedringer #6205 #8633 #8634 (ejer-go 23/11) (0d) — roed
- #8393 feat(taktik): telefonudgave B af taktikpanelet (Refs #8386) (0d) — roed
- #8624 feat(8548): rotationens motor og prognose (Refs #8548) (0d) — roed
- #8636 feat(autotrain): toget gen-bestiller Codex-review paa nyt hoved (Refs #7654) (0d) — roed
- #8632 chore(build-stop): prioriteringssessionen 23/11 paa finishList (19 issues) (0d) — groen
- #8623 fix(analytics): carry first-touch UTM through signup (Refs #8584) (0d) — groen
- #8601 feat(8549): Week blocks i motoren og prognosen bag training_week_priority (Refs #8549) (0d) — roed
- #8638 chore(deps): ugentlig lockfile-maintenance (0d) — roed
- #8627 docs(masterplan): MASTERPLAN i fem sektioner som intern sandhed (Refs #7631) (0d) — roed
- #8637 feat(training): én linje pr. rytter i I dag, Rapport og Udvikling (Refs #7947) (0d) — roed

## 2) Ejerens beslutninger
**Issues (`needs-decision` / `needs-design`):**

- #930 [Epic] Staff & manager-rolle som direktør (ansatte, sportsdirektører, læger, fysioterapeu… (174d)
- #961 Kontekstuel hjaelp: omraade-specifikt FAQ-link overalt (banner -> ikon, progressive) (174d)
- #1148 [Epic] World history & Club Museum — records, legends, rivalries and season stories (168d)
- #1154 [Epic] Rider personality & club relationship — roles, ambition, loyalty and rebuilding (168d)
- #1173 Vækst/viralitets-loop: referral (del spillet med en ven) (167d)
- #1177 Holddynamik-dybde: vejkaptajner + mentor + erfaring (167d)
- #1239 [Design] Board-DNA og holdfokus v2: sportslige fokus-typer, nationalitet, egen avl (165d)
- #1461 security(email): DMARC enforcement — p=none → quarantine → reject (158d)
- #2236 Organic community outreach — Reddit + Discord posting (139d)
- #2423 [infra/sikkerhed] Vercel-opsætning til verdensklasse: håndhæv CSP, skew-protection, Speed… (132d)
- #2675 [verify+decision] 19/7 aften: første stemplede udløbs-auktioner + kreditering — og ejer-v… (127d)
- #2885 [feature] Sælg rytter til AI efter N mislykkede auktioner — udvej for hold der ikke kan k… (121d)
- #2991 season_grand_tour_rider kan ingen menneskemanager opnå: Grand Tours er Division-1-only og… (120d)
- #3147 [feature] Sponsor race-day-udbetalinger løbende i stedet for klumpsum ved sæsonslut (116d)
- #3471 [feature] Kalender-spor med identitet (GT-spor / WT-spor / klassiker-spor) — spiller-fors… (108d)
- …og 68 mere

**PR'er der venter paa "ejer-go" (label eller PR-body):**

- #8630 chore(build-stop): ejerens go som markoer paa issuet (Refs #7336) (0d) — roed
- #8635 chore(build-stop): arbejdsforbedringer #6205 #8633 #8634 (ejer-go 23/11) (0d) — roed
- #8601 feat(8549): Week blocks i motoren og prognosen bag training_week_priority (Refs #8549) (0d) — roed

## 3) Bygget men ikke merget
**Draft-PR'er:**

- #8631 docs(audit): undersoegelse af #7456 (0d) — groen
- #8639 docs(audit): undersoegelse af #8026 (0d) — groen
- #8619 chore(email): prepare Season 6 email drafts (0d) — groen

**Ikke-draft med roed tilstand:**

- #8625 feat(8548): Rotation og ugeblokke i Program R5 (Refs #8548 #8549) (0d) — roed
- #8616 feat(roadmap): fælles kategorier og faste tidspunkter (#8584) (0d) — roed
- #8630 chore(build-stop): ejerens go som markoer paa issuet (Refs #7336) (0d) — roed
- #8635 chore(build-stop): arbejdsforbedringer #6205 #8633 #8634 (ejer-go 23/11) (0d) — roed
- #8393 feat(taktik): telefonudgave B af taktikpanelet (Refs #8386) (0d) — roed
- #8624 feat(8548): rotationens motor og prognose (Refs #8548) (0d) — roed
- #8636 feat(autotrain): toget gen-bestiller Codex-review paa nyt hoved (Refs #7654) (0d) — roed
- #8601 feat(8549): Week blocks i motoren og prognosen bag training_week_priority (Refs #8549) (0d) — roed
- #8638 chore(deps): ugentlig lockfile-maintenance (0d) — roed
- #8627 docs(masterplan): MASTERPLAN i fem sektioner som intern sandhed (Refs #7631) (0d) — roed
- #8637 feat(training): én linje pr. rytter i I dag, Rapport og Udvikling (Refs #7947) (0d) — roed

## 4) Ikke bygget
`claude:todo`, ingen aaben PR endnu. Sorteret efter priority-label, saa alder.

- #1819 Opfølgning efter præmie ÷20: bekræft økonomi-coherence + ryd backup (152d)
- #2557 [balance/HØJ] LIVE drift i race v3: hold-dominans (share4+) RØD 3 dage i træk + favorit-w… (129d)
- #2770 [build] Sub-2: Dybe konkurrencer — passage-ordener (KOM/point) + bonussekunder (125d)
- #2840 Løn skal være dagsbaseret (rigtige dage) — engangstræk ved sæsonstart gør sent købte rytt… (123d)
- #3426 [balance] Nedkørsel vejer for tungt: 30-50 sek tabt på korte nedkørsler + for mange bjerg… (109d)
- #3511 [perf] Bestyrelsens resultatqueries: gentagne opslag og dyr query-plan på dashboard og må… (108d)
- #3564 [design] Progressionskæden samlet: potentiale 1-99, lofter pr. ryttertype, træningsscore,… (106d)
- #4010 Supabase-hærdning: realtime-MalformedJWT, sponsor-sweep, offset-paginering og getUser() p… (95d)
- #4521 Ejer-direktiv 31/8: SSOT for patch notes (site + Discord) + efterkontrol siden 28/8 - foe… (84d)
- #4850 [Epic] Traening pr. loebsdag - loebsdagen bliver tick-enheden, live senest S4 28/9 (ejer-… (79d)
- #4914 [engine-v4] Kalibreringspakke foer flip: holdspil-gab, M12 all_out/grupetto, feltsprednin… (77d)
- #4964 [growth] Launch-kohorten holder 28,6 % mens etablerede holder 86,8 % - og signups faldt 2… (77d)
- #5327 [ryttere] Faerdiggoer PR #3512 arketype-prior: WIP-cherry-pick, groen test, foer/efter-fo… (67d)
- #5382 [balance] Dobbelthop mellem divisioner efterlader hold uden oekonomisk fodfaeste (66d)
- #5443 [epic/economy] Vaerdisystemet faerdigt: rigtig type for alle, omregnet formel, kvittering… (64d)
- …og 857 mere

## 5) Faerdigt
`claude:done` men stadig aabne — skal lukkes.

- #7474 [bug] Graduerings-sweep: to samtidige ticks afgjorde 7 ryttere to gange (dobbeltbesked) 1… (21d)
- #7536 [balance] Løbsdatoer med lette etaper giver mindre træthed end ren træning, så formen stå… (20d)
- #2230 [ux/perf] Layout-shift (CLS) på core-sider — mål via Speed Insights + fix reserved-space (140d)
- #8110 [board] Årsmandat-kørslen og andre bestyrelsesveje rammer stadig parkerede hold (10d)
- #7868 [ux] Siden husker hvor du var + links fra indbakken til præcis etape/rytter (15d)
- #6940 [motor] Gruppetto-ordre: ingen udbrud, energibesparelse efter etapetype (ejer-løfte 1/10) (34d)
- #6649 [motor/design] Dagsform og dominans: de bedste vinder for ofte i forhold til virkeligheden (39d)
- #7964 [bestyrelse] Vision-milepæl +20% kan ikke nås, fordi tidligere sæsoner ikke tælles (egoma… (13d)
- #8188 [bug] Monument-bonus står på 0, selvom holdet har 3 monument-resultater (spiller 14/11) (8d)
- #8190 [bug] Træningsvisningen viser præcis 100 % hos flere hold (spiller 14/11) (8d)
- #6299 [investigation] 'Work'-ordren ser ud til at angribe uden 'try the break' + 27 mand i udbr… (47d)
- #7290 [motor] Motoren kører bakkerne fra højdeprofilen (trin 2 af #7289) (27d)
- #8070 [design] Dagens designregler skrives ind i TASTE.md og PAGE_TEMPLATES.md (ejeren godkende… (10d)
- #8076 [design] Ét designsystem for web, mobil og app (dagens retning ind i designsystem-epicen) (10d)
- #8118 [bug] Bestyrelsen er utilfreds, selvom spilleren har nået alle mål (mandia 12/11) (10d)
- …og 80 mere
