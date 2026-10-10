# Bundle-headroom (#6165) - undersoegelse 2026-10-10

Kind: investigate (#5220). Ingen kode aendret. Maalt paa `origin/main` (worktree investigate-6165-bundle-headroom, 3 commits bagud).

## Tal foer

`npm run build --prefix frontend` + `node scripts/check-bundle-budget.mjs`:

- Total gzip JS: **1240,1 KB** (gate) / 1242,5 KB (egen gzip-maaling) over 236 chunks. Budget 1182 KB + 5 % = loft 1241,1 KB. **Headroom: 1,0 KB.**
- Foerste indlaesning (index.html modulepreload): ca. 385 KB gz, heraf begge sprog-chunks (en 77,4 + da 81,3). En spiller henter reelt ca. 304-308 KB (kun eget sprog).
- Gaten summerer alt, inkl. begge sprog og lazy-chunks. Derfor taeller lazy-load ikke, og en spiller mærker ikke det tal gaten styrer.

Top 30 chunks (gzip KB):
87,4 CategoricalChart (recharts) · 81,3 i18n-messages-da · 77,4 i18n-messages-en · 66,3 react-vendor · 57,1 index · 53,5 supabase · 44,4 PlanningHubPage · 40,6 RaceDetailPage · 39,6 RiderStatsPage · 36,8 AdminGrowthPage · 26,0 DashboardPage · 23,4 TrainingPage · 22,3 dist (posthog) · 19,7 BoardPage · 16,8 AdminEconomyTab · 14,6 AuctionsPage · 14,6 NotificationsPage · 13,8 intl · 13,1 trainingTabParts · 13,1 TransfersPage · 12,4 RankingsHubPage · 12,2 AdminDataTab · 11,7 FinancePage · 10,7 AdminSeasonTab · 9,7 ResultaterPage · 9,5 Layout · 9,3 ui · 9,2 SeasonEndPage · 9,2 SeasonFinanceReportPanel · 9,0 BoardroomRoute

## Kandidater, prioriteret efter gevinst (gate-KB)

| # | Tiltag | Estimeret gevinst | Risiko | Noter |
|---|--------|-------------------|--------|-------|
| 1 | Erstat recharts med raa SVG (2 brugere: `admin/growth/TrendLineChart.jsx` linjediagram, `SeasonFinanceReportPanel.jsx` donut) | **ca. 80-83 KB** netto (87,4 KB chunk vaek, +4-7 KB ny SVG-kode) | Middel: donut skal ligne i dag (tooltip, farver via `chartPalette`), skal igennem UI-verify + ejer-go paa preview. `surveyCharts.jsx` bruger ALLEREDE raa SVG (kommentar linje 3), saa moensteret findes. | `SeasonFinanceReportPanel` er spiller-vendt: i dag henter en spiller 87 KB recharts for en donut. Fjerner ogsaa `recharts` fra package.json. Kun to filer importerer recharts (verificeret med grep). |
| 2 | Doede i18n-noegler i de 24 inlinede namespaces | **ca. 3,7 KB** (1,9 KB en + 1,8 KB da; begge taeller i gaten) | Lav-middel, men rør ALLE locale-filer (kolliderer med andre lanes) | 169 kandidat-noegler efter at have fjernet dynamiske praefikser (`t(\`x.${y}\`)`), `returnObjects`-containere og ns-praefikser. Fordeling: training 64, rider 44, races 32, sponsor 9, headtohead 4, academy 4, klub 3 + resten 1-2. Liste: se bunden. Skal manuelt verificeres pr. noegle (statisk scan, kan have faa falske positive, fx `headtohead.teamA` er ikke sikker). |
| 3 | `@e965/xlsx` | **0 KB** | Ingen | Bekraeftet ubrugt: ingen import i `frontend/src` (kun en kommentar i `chunkErrors.js` og patch-note-tekst); knip melder den som unused dependency. Kan fjernes fra package.json + lock for ren hygiejne, men aendrer ikke bundlen. |
| 4 | Doed kode (knip) | **0 KB** | - | Ubrugte filer i src: `OnboardingModal.jsx`, `WaitlistConsentText.jsx`, `race/StageScheduleCard.jsx`, `rider/RiderRatingTrajectory.jsx`, `lib/riderTerrain.js`, `pages/HallOfFamePage.jsx`, `entry-server.jsx` (flere er kun nævnt i kommentarer/tests, skal tjekkes). De er ikke importeret, saa de er allerede tree-shaket ud. Giver kun gevinst via deres egne i18n-noegler (indregnet i #2). |
| 5 | posthog (`dist`, 22,3 KB) / supabase (53,5 KB) | ikke undersoegt i dybden | - | Uden for scope; nævnt som stoerrelsesorden. |

Realistisk samlet: #1 + #2 = ca. **84-87 KB** headroom (fra 1,0 til ca. 85 KB). #1 alene loeser #6165 med margin.

## Anbefaling for #6165-modelskiftet

Skift gaten fra "sum af alle chunks" til to maal (ejer-retning 4/10):

1. **Loft paa foerste indlaesning** (index.html modulepreload-graf, eget sprog): i dag ca. 305 KB gz (en) / ca. 309 KB (da). Foreslaaet loft ca. 330 KB (ca. 8 % margin), beregnet automatisk ud fra dist/index.html. Dette er det en spiller faktisk mærker.
2. **Loft pr. chunk** med en lille undtagelsesliste (CategoricalChart 90, sprog-chunks 90, PlanningHubPage 50 osv.), saa ingen enkelt route kan vokse ubemærket. Pr.-chunk-gaten fanger de regressioner total-summen i dag fanger, uden at lazy-chunks og det ubrugte sprog straffer folk.
3. Behold evt. en blød samlet total (advarsel, ikke fejl), ellers gaar tendensdata tabt.

Raekkefoelge: byg #1 (recharts) FOERST hvis modelskiftet haster - det giver ca. 80 KB med det samme uden at aendre gaten. Modelskiftet loeser det strukturelle problem (hver ny feature rammer et loft der ikke afspejler spillerens oplevelse), men aendrer ikke noget for spillere. Gør IKKE kun modelskiftet og lad 1,0 KB headroom staa: det skjuler problemet i stedet for at fjerne bytes.

## Metode

- Build + gate som ovenfor. Egen gzip-maaling af `dist/assets/*.js`.
- Doede noegler: `scripts/i18n-check-keys.mjs` tjekker KUN sprog-paritet, ikke brug, saa der er skrevet et engangsscript (scratch, ikke committet). Det finder de 24 inlinede namespaces fra `src/i18n/messages.da.js`, flader noegler ud, og markerer en noegle som doed hvis hverken fuld sti i citationstegn, `ns:sti`, en dynamisk template-/concat-praefiks, eller en forfader-sti (returnObjects) findes i `frontend/src/**/*.{js,jsx,ts,tsx}` (ikke tests). Gzip-gevinst = gzip af samlet JSON med/uden de noegler. Foerste version uden .ts/.tsx og uden dynamiske praefikser gav 788 kandidater / 24 KB - forkert (falske positive) og forkastet; stikproever (grep) bekraeftede at den endelige liste er doed (`offers.title`, `weekPlan.title`, `gainJump`, `racePreview.title`, `legendSort`, `cost.upkeep`, `buyoutDone`).
- Doed kode: `knip@5 --include files,dependencies` koert lokalt fra scratch (intet committet).

## Bilag: doede-noegle-kandidater pr. namespace (antal)

common 2 · transfers 2 · dashboard 2 · rider 44 · riders 1 · sponsor 9 · headtohead 4 · races 32 · training 64 · academy 4 · klub 3 · landing 2 = 169.
Eksempler: `common nav.group.min, nav.item.hallOfFame` · `transfers celebration.buyoutDone.*` · `rider racePreview.title/beta/disclaimer/powerProfile/zones.*` · `sponsor offers.*, field.raceDayMath` · `races matrix.save/saving/restDay, racehub.role.*` · `training weekPlan.title, gainJump, noGains, toGo, flatDay` · `klub cost.upkeep/payroll/balance` · `landing nav.discordLabel, footer.rights`. Fuld liste genereres af scriptet naar byggesporet planlaegges.
