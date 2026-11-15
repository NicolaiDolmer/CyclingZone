# Byggespecs, natbølge 15.-16/11 (ejer-go 15/11, tavle #7911)

Fælles for alle spor: intet merges, intet tændes, ingen prod-skrivning. Alt nyt bag slukket kontakt (slukket = som i dag). Ingen patch note i sporets PR (udkast EN først, DA under, uden tankestreger, i PR-body). Rør ikke `docs/NOW.md`, `frontend/src/data/patchNotes.js`, `docs/FEATURE_REGISTRY.yml` eller åbne `codex/`-grene. Fast ur i prøver. Spillere, managers og hold nævnes aldrig ved navn; private tal uden for repoet citeres aldrig. UI følger `docs/design/PAGE_TEMPLATES.md` og `docs/design/TASTE.md`; billeder ved 1440 og 390 px, før og efter, i `pr-screens/<issue>/`. Læs issuets seneste kommentarer først.

Skitse-spor: byg 2-3 levende varianter med rigtige (anonymiserede) data, kun nye filer under `frontend/src/preview/sketches/<issue>/` og `pr-screens/<issue>/`. Draft-PR, ingen merge. PR-body: hvad hver variant løser, fordele og ulemper, og en anbefaling.

## S1. #7801 Træning hurtig med kontakten tændt (byg)

Prognosens opslag i `loadTeamFatigueForecast` (`backend/lib/trainingWeekPlanForecast.js` ca. 214-296) ligger efter hinanden (ca. 11 runder). Start kontaktlæsningerne (`isConditionModelV2Enabled`, `isRaceDateTrainingDayEnabled`, `isFatigueNow7801Enabled`), `loadTeamMedicalBonus`, `riders` og `resolveDayCloseStatus` i første runde, og flyt `fatigueRulesForForecast` og `loadInstantConditions` ind i den store `Promise.all`. Alle fejlgrene bevares; slukket vej og alle tal bit-identiske. Stram loftet i `backend/lib/riderFatigueNowCalls7801.test.js`. Valgfrit: `sharedReadsClient` i `riderFatigueNow.js` deler igangværende promises. Nyt måle-script `backend/scripts/dev/measure7801Svartid.mjs` (kun GET/HEAD, køres ikke af sporet mod prod). Fravalgt: skøn fra prognose-ruten og cache mellem ruterne. Prøver: `lib/riderFatigueNowCalls7801.test.js`, `lib/dommer7801RestByg.*.test.js`, `lib/riderFatigueNow7801View.test.js`, `lib/fatigueNow7801Surfaces.test.js`.

## S2. #6181 Kontakten er binær overalt (byg, prøver)

Ny ren funktion `adminFlagView(flag, row)` (ny fil `backend/lib/adminFlagView6181.js`): for nøgler i `PLAYER_VISIBLE_BINARY_FLAG_KEYS` er `boolean_only` sand, en skrevet "beta" vises som slukket med advarsel, og "beta" tilbydes aldrig. Kobles på `GET /admin/feature-flags` i `backend/routes/api.js` (ca. 15735-15765, få linjer). Ny adfærdsprøve `backend/lib/saleEscrowFlag6181.behavior.test.js`, tabelstyret over rå værdier (ingen række, "off", "beta", "on", true, false, "ON", ukendt): `isSaleEscrowEnabled`, `/api/feature-flags` og SQL (`hold_sale_escrow` via PGlite) skal være enige; PATCH med "beta" giver 409 og ingen skrivning (kør handleren, ikke regex over kildetekst). Rendering-prøve for `FeatureFlagBoardSection.jsx`. Bevis også: slukket kontakt med holdte rækker viser og afregner dem stadig. Patch note-udkast i PR-body (står på #6181-specens kommentar).

## S3. #6110 Prisbund og aldersforløb (byg, Fable-dom)

Ejer 14/11: R16 "A, fast bund" og R5 "ca. en fjerdedel af fuld udvikling ved 31". `backend/lib/developmentXp.ts`: valgfrit felt i `price` (fx `floor: { belowLevel, minCost }`) i `validateDevelopmentXpParams`; `xpPriceForNextPoint` bruger `max(formel, minCost)` under grænsen. Uden feltet: nøjagtig som før (golden og `developmentXpWiring.test.js` må ikke rykke). Prøver i `developmentXp.test.ts`. `dommer6110.private-parametre.test.js`: `NAESTEN_INTET` følger ejerens "ca. en fjerdedel"; tilføj R16-prøve for løbsdage inkl. enkeltstart. Dokumentér i `docs/PROGRESSION_RULES.md` §11. Private tal lægges aldrig i repoet. Bag `development_xp_model` (slukket).

## S4. #7757 Prøvekørslen måler det, motoren tænder med (byg)

`backend/scripts/dev/tenSeasonSim6110.mjs`: `applyPrivateXp` tager variation fra `priv.xp.variation` (fjern den anden sandhed `sim.variationSpan`/`variationMemory`); lær løbsdagsgulvet (R15b) og mål R16 også på løbsdage, især enkeltstart; sæt `sim.requirements`. Prøver i `tenSeasonSim6110.test.mjs`. Ret kun kommentaren øverst i `backend/lib/developmentXpVariation.ts`. Rører ikke `developmentXp.ts`.

## S5. #6490 Ny læsevej for træningshistorik (byg, Fable-dom)

Design: `docs/superpowers/specs/2026-11-15-6490-traeningstabeller-plads-design.md`. I nat kun trin b1, b2 og c: RPC `training_history_runs` + `useTrainingHistory.js` bag `training_history_from_ticks_6490` (seed "off"); `api.js:3182` og `racePeakPlans.loadTeamTrainingRuns` på samme kontakt; `dailyTrainingEngine.js:572` henter kun `report->condition_per_date`. Sammenligningsscript `scripts/ops/6490-history-parity.sql` (kun SELECT; køres ikke af sporet). Intet slettes, intet udløber, kopien skrives stadig.

## S6. #8153 Frigivelse venter til etapeløbets slut, backend (byg, Fable-dom)

Design: `docs/superpowers/specs/2026-11-14-8153-frigivelse-venter-design.md`, med disse rettelser fra kodegennemgangen:
1. `releaseRiderUnderTeamLock` kan ikke genbruges til bestilling. Ny SQL-funktion `order_rider_release_8153` (lås hold, lås rytter, afvis ved pending_team_id, aktiv auktion eller aktiv række, tjek saldo minus bundne penge, indsæt række, træk gebyr med idempotensnøgle) og `execute_pending_rider_release_8153` (idempotent).
2. Tabellen får `race_id`.
3. Trup-minimum: ventende frigivelser tæller som AFGÅENDE i gulvtjekket ved bestilling (sikker læsning; ejeren ser valget på kortet), men som til stede i visninger, maksimum og løbsudtagelse.
4. Ejerskabs-RPC'erne for salg, bytte og auktion afviser en rytter med aktiv række.
5. Udførelsen rydder også fremtidige løbstilmeldinger og lukker transfer-opslag.
6. Rytteren kan ikke udtages til løb efter det igangværende.
7. Sæsonskifte-spærren tæller ventende frigivelser; `betaResetService.js` rydder tabellen.
Kontakt `release_defer_8153`, binær, seed "off". Kontrakt til frontend: release svarer `{ pending: true, race: { id, name }, fee }`; `release-quote` får `pendingRace`; ny `GET /api/me/pending-releases` giver `[{ riderId, raceId, raceName }]`. Backend-tekster i `backendMessages.json` og `errors.json` på 5 sprog (EN og DA ordret fra designet).

## S7. #8153 Frigivelse venter, frontend (byg)

Ekstra linje i bekræftelsen og mærke "Leaves after {race}" i `RiderManageActions.jsx` og `TeamPage.jsx`; hook der læser `GET /api/me/pending-releases` (mønster `LockedSaleEscrows.tsx`), mocket efter kontrakten i S6. Tekster i NYT namespace `frontend/public/locales/{en,da,es,fr,nl}/pendingRelease.json` (EN og DA ordret fra designet). Rører ikke `help.json` eller `rider.json`.

## S8. #2176 Beta-sætningen ud (byg, draft til tændingsdagen)

Fjern beta-sætningen i `help.json` (`sections.transfers.autoAcceptPrice.text`) og `rider.json` (`sellRider.autoHelp`) på 5 sprog. `npm run check:i18n`. Draft-PR: merges først samme dag som tændingen. Patch note-udkast "Auto-accept price is now for everyone" i PR-body.

## S9. #7865 Løbssiden v6 trin 2a: plan mod det der skete (byg)

Ejer-valg 11, 14, 18, 19 på #7778 og spec `docs/superpowers/specs/2026-11-07-race-page-redesign-discord.md`. Ny `frontend/src/components/race/v6/V6TacticsAfter.tsx` og `planVsActualModel.ts` (+ test): for hver egen rytter planens trin ved siden af det, optegnelsen viser. Trin uden hændelse er "ikke set", aldrig "mislykket". Kun egne ryttere, ingen samlet dom, ingen nye motorforklaringer, angreb som to linjer. `RacePageV6.tsx`: Taktik på en kørt etape viser den nye visning. `StagePageV2.tsx`: prop `hideOrdersRecap` (v6 sender true). Tekster i `races.json` under `racePageV6.tacticsAfter.*`. Bag `race_page_v6` (slukket). Rører ikke `RaceDetailPage.jsx` eller `RaceTacticsTab.jsx`.

## S10. #7860 Resultater: søgning, Mit hold og manglende tal (byg)

Ejer 7/11 på #7860 og 9/11 på #7864. `RaceDetailPage.jsx` (kun `ResultTable` og `renderV6Results`), ny `V6ResultsControls.tsx` med model og test, tekster i `results.json`. Søgning og Mit hold kun under v6. Bekræft først i koden, hvilke tal (tidsgab i Hold og Ungdom, point i Bjerg og Spurt) der faktisk mangler i spillet; ret kun dem. Intet nationsfilter. Rører ikke `races.json`.

## S11. #7868 Det samlede indbakke-link åbner seneste kørte etape (byg)

`frontend/src/components/notifications/aggregateLink.ts` og `frontend/src/lib/notificationLink.js` med prøver. Ingen kontakt.

## S12. #6365 Etapeprofilen følger TASTE (byg)

`StageProfileCard.jsx` og `StageProfileGraph.jsx`: tal i tabulære cifre (aldrig display-skrift på tal), ingen tekst under 10 px på mobil. Tjek også #8013 d (profil uden rutedata); ret kun en reel fejl.

## Skitse-spor

- K1 #8016 købers kort ved auto-pris: A to kort side om side (bud / start auktion, hver med eget felt og forklaring); B segmenteret valg med ét felt. Auto-prisen tydelig, også på ryttersiden.
- K2 #6944 akademiets aldersgruppe: hvor valget bor (ved profilen på akademisiden), hvilke aldre (16-19), standardfordeling.
- K3 #7627 træningsrapporten: vis løbets bidrag pr. evne og pr. dag (visningsmangel, ikke motorfejl).
- K4 #7947 enklere træningsvalg (layout A valgt 10/11): indsats x træning-matrix, hvor aktiv restitution, nedkørsel og taktik bor, og overgang for gemte planer.
- K5 #8013 a og c: undtagelser mod etaper udfyldt af "fill", og årsagen ved en deaktiveret plan.
