# #7904: mulighed A, bundle-maaling 8/11

Refs #7904, #7849, #2511. Maalerapport til ejerens A/B-valg via Claude Code paa PC1. Ingen runtime-aendring og intet budgetloeft.

## Resultat

Mulighed A er allerede implementeret i #7849. `frontend/src/components/rider/RiderNameIcon.tsx` deklarerer begge overlays med `React.lazy`. Kortet renderes foerst ved hover, synligt tastaturfokus eller ikontryk; menuen foerst ved hoejreklik, langt tryk eller tastaturmenu. Et lukket overlay kalder ikke lazy-loaderen.

Vites build-manifest bekraefter det paa baade #7849 og main: `RiderLink` har `dynamicImports` til `RiderHoverCard` og `RiderContextMenu`. Ingen af dem findes i RiderLinks transitive **statiske** importgraf. Menuen importerer kortets delte datafunktioner statisk, saa aabning af menuen kan hente begge. Det er stadig efter interaktion. Dette er kilde- og build-bevis; der er ikke koert en browser-netvaerksmaaling.

`scripts/check-bundle-budget.mjs` summerer alle ikke-sprog-JS-chunks, den statiske engelske fallback og den stoerste valgfri sprogchunk. Lazy chunks taeller med. Mulighed A giver derfor **ingen yderligere aendring: 0 bytes / 0,0 KB** med det nuvaerende traes allerede lazy overlays. Ingen ny optimering er implementeret eller maalt.

## Friske lokale maalinger

Dato: 8/11 2026. Node 24.16.0, Vite 8.3.5, Windows, samme lockfile-hashede frontend-installation. KB nedenfor er gatens enhed, bytes / 1024; gzip niveau 9. Alle tre client-builds og gatens tre koersler afsluttede med exit 0.

| Frontend-kilder | Ref | Gzip bytes, gatens sum | KB | Talte chunks |
|---|---|---:|---:|---:|
| Foer #7849 | `7a07b7bc63860bd4da24541ce9326602da2b6803` | 1.420.748 | 1387,4 | 259 |
| Efter #7849 | `b80b8ddf2068f6f76f64917751888c4f76a2023b` | 1.436.326 | 1402,7 | 264 |
| Main ved start / denne kladde | `e19b709ef62b8c1cfa0e46a09d20eb14ce499054` | 1.437.162 | 1403,5 | 264 |

#7849 tilfører netto **15.578 bytes / 15,213 KB**. Senere frontend-aendringer frem til den maalte main tilfører netto **836 bytes / 0,816 KB**. Main-budgettet er uaendret **1339 KB + 5 % = 1405,95 KB**, med maalt hovedrum **2,471 KB**. Dette er et regressionsloft; det er ikke et maal for oplevet hastighed eller en releasegodkendelse. Issuets tidligere CI-tal 1404,4 KB er ikke genbrugt som lokal maaling; forskellen til denne lokale koersel er ikke forklaret.

## Hvor vaegten ligger

Sammenligningen umiddelbart foer/efter #7849 giver:

| Chunk | Foer, gzip bytes | Efter, gzip bytes | Forskel |
|---|---:|---:|---:|
| RiderLink | 272 | 6.152 | +5.880 |
| RiderHoverCard | 0 | 5.846 | +5.846 |
| RiderContextMenu | 0 | 1.998 | +1.998 |
| Engelsk fallback | 89.927 | 90.292 | +365 |
| Fransk, stoerste valgfri sprogchunk | 100.115 | 100.536 | +421 |

De fem poster forklarer 14.510 bytes af nettovaeksten paa 15.578 bytes. RiderLink er den stoerste vaekst blandt de eksisterende navne-/overlay-chunks; hele triggeren, flag-hooken og delte modeller ligger her. De to overlays er allerede udskilt.

Den stoerste **positive chunk-post** i hele sammenligningen er en ny `stageOrdersRecap` paa 9.512 bytes. Den maa ikke kaldes 9.512 bytes ny funktionalitet: chunkgraenser flytter eksisterende loebshjaelpere. Samtidig forsvinder `StageSplitTimes` (-5.088 bytes), og `RaceDetailPage` (-3.982), `useStageTimeline` (-2.794) og andre chunks bliver mindre. Kun summen over alle talte chunks viser nettovaeksten. Efter #7849 er `roadmapModel` den stoerste nye chunk (2.946 bytes), men den samlede senere vaekst er kun 836 bytes efter oevrige forskydninger.

## Reproduktion og graenser

I et rent, eget worktree paa main-ref'en ovenfor blev **kun frontend/** midlertidigt gendannet fra hver tabel-ref med `git restore --source=<ref> --worktree -- frontend`, derefter tilbage til HEAD. Resten af repoet var fast paa main-ref'en. Det er en sammenligning af frontend-snapshots under faelles buildbetingelser, ikke tre fulde historiske repo-checkouts. Frontend-lockfil og Vite-konfiguration er ens over #7849.

Hvert build koerte under `scripts/verify-lock.ps1 -Max 2` med `infisical run --env=dev --silent`, og `SENTRY_AUTH_TOKEN` blev fjernet i den lokale child-proces for at undgaa upload. Fra frontend-mappen: `npm exec -- vite build --manifest`; derefter fra roden: `node scripts/check-bundle-budget.mjs`. Manifestet bruges til at foelge `imports` rekursivt fra RiderLink og holde dem adskilt fra `dynamicImports`. Chunks maales med `gzipSync(buffer, { level: 9 })`; alternative sprog undtagen den stoerste undtages som i gaten. Der er kun maalt det friske client-output, ikke SSR eller viderefoerte gamle release-assets. De fulde npm-build-/e2e-suiter er ikke koert for denne docs-kladde.

SSOT: `docs/superpowers/specs/2026-06-13-world-class-performance-architecture-design.md` §5 og §9, samt gatens faktiske kode. SSOT, FEATURE_REGISTRY og patch notes aendres ikke: ingen kontrakt, feature, kontakt, spillertekst eller spilleradfaerd aendres.

## Handoff / aaben beslutning

Anbefaling til PC1: fremlaeg maalingerne for ejeren. A som formuleret er allerede leveret og skaber ikke plads i total-gaten. Et budgetloeft (B) eller et nyt scope med faktisk fjernelse af bytes kraever ejerens valg. Budget, margin og gate er urorte. Kladden forbliver kladde; Codex merger intet. #7904 er ikke loest af rapporten.
