# GitHub-audit 10/10 nat

Billig sweep (scripts + titel-match, 0 agenter). 792 åbne issues, 200 merged PRer læst, 41 åbne `claude:done`.

## Flippet til claude:done i nat (10)

Arbejdet er merget, done-mærket manglede. Kommentar med PR på hvert issue.

| Issue | Hvad | PR |
|---|---|---|
| #6383 | Train now-låsen gråner ryttere ud på dagsboard og sæsonmatrix | #6390 #6394 |
| #6111 | Sæsonens træningspoint vises før aftenafregningen | #6388 |
| #6035 | Programmer: vælg rytter først (løfte 1/10) | #6053 |
| #6199 | Tidsforskelle: official_times_v2 for alle nye løb | #6389 |
| #5268 | Holdarbejde/Lederskab fyldt (apply 9/10, patch note 7.350) | #6371 #6393 #6396 |
| #6342 | Migrations-lint (lock_timeout, CONCURRENTLY) | #6347 |
| #6278 | PostHog-milepæl "første løb med egen trup" | #6279 |
| #6257 | Scorecard: nedkørsels-ankeret måler ejerens regel | #6260 |
| #3813 | Ryttertyper forklaret i Hjælp | #6180 |
| #6229 | Fail-closed staging refresh | #6297 |

## claude:done til ejeren (lukkes af dig)

**Klar til at lukke: merget, på main og med patch note eller ingen spillertekst:**
- #6261 #6262 #6263 #6264: penge låst i bud kan ikke bruges til anlæg, staff og akademi (#6308, patch 7.345). Fire søskende, luk samlet.
- #6298: bestyrelsens omdømme-udfordring tæller nye ryttere (#6311, 7.345).
- #6304: "X vandt af X" i rytterhistorik (#6312, 7.345).
- #6332: Tour etape 11 er kuperet (prod-rettet 8/10, 7.346).
- #6343: presence-heartbeat pauses i skjulte faner (#6348, 7.347).
- #6294: mærker og løbsfilm fortæller det motoren regnede (#6355, 7.347).
- #6314: daglig kvittering crasher ikke (#6316, 7.350).
- #5916 #5940: sponsorbeløb og præmie-estimat (#6215, 7.343).
- #6006 #6027 #6139 #4847 #6000 #4629 #6383 #6035 #6111: træningspakken, live for alle 9/10 23:23 (7.347 + 7.349).
- #5124: mobilmatrix live for alle (7.344).
- #6199 #3460 #6257: ny løbsmotor live for nye løb fra 10/10 (7.348 + 7.350). Første løb kl. 12 verificeres.
- #5268: Holdarbejde/Lederskab (kontrol 0 NULL, 0 fald, 0 ratingændringer; 7.350).
- Teknik uden spillertekst: #5692 rangliste-refresh, #6102 stall-watchdog, #6235 frontend-vagt, #6271 Tailwind 4, #6341 RLS pr. række, #6342 migrations-lint, #6278 PostHog, #6292 attribution, #6229 staging, #3813 Hjælp-tekst.

**Ikke lukkeklar (bliver stående):**
- #6158 giv formtoppe tilbage: kun dry-run (#6306), apply er din beslutning sammen med form #6156.
- #6318 merge-køens cron-bevis: opfølgning er i nattens bølge (deploy-verify ventede ~40 min).
- #6350 race-film-tidspunkter: Discord-testcase 9/10 skal bekræftes på første nye løb.
- #5947 udviklingshistorik og #5845 roadmap torsdag: ingen merged PR i 200-vinduet; tjekkes i morgenblokken.

## Dubletter

Titel-scan (Jaccard ≥ 0,3, 792 issues) fandt ingen sikre dubletter. Kun søskende:
- #6261-#6264: samme rod (låste budpenge), allerede rettet af én PR. Forslag: luk alle fire samlet (står ovenfor).
- #4620/#4621 (U23/junior-pyramide) er bevidst to slices, ikke dubletter.
Semantiske dubletter (fx #6130/#6122 mod de merged bestyrelses-PRer #6195/#6197) verificeres af nattens spec-research og står i bølge-rapporten.

## Kategori K (glemt-done) udestående

70 kandidater, 30 med issue-nummer i PR-titlen. 10 flippet ovenfor; resten er multi-slice eller bliver dækket af nattens spor (motor #6201/#6200/#6185/#6234/#6187, sæsonskifte #5864/#5904/#5897, #6285, #5915, #5911, #5928, #6184, #6061, #6129, #6329).
