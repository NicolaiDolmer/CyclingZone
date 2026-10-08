# Dækning af den oprindelige opgave og dublettjek

Læs [planen](README.md) først. Den oprindelige brief er `docs/drafts/codex-brief-vaekst-2026-09-17.md`. Dette register bevarer A-H, relevante sidefund og senere ejerpræciseringer. Ingen hypotese nedenfor er en konstateret årsag uden evidens.

## A: Efterprøvning af Claudes konklusioner

| Påstand | Vurdering og bevaret opgave |
|---|---|
| En SPA kan ikke indekseres | Forkert generelt: Google renderer JavaScript. Login, canonical, rendering og links er de konkrete problemer. #4067/#5307. |
| Hybrid-split er rigtigt | Behold det, men integrationskontrakter skal holde. Marketing→signup-tab er nu #5310. Ingen nul-forbrugsprisgaranti. |
| Next skal være slutmålet | Ikke dokumenteret nødvendigt. Evaluer konkrete flytninger med effekt/indsats. #5307, eksisterende #5249/#5250 består. |
| Astro er ubrugeligt | Relevant til greenfield-indhold og React-islands; ikke anbefalet migrationsprojekt her. #5307. |
| Offentlige rytternavne er SEO-guld | Ingen efterspørgselsevidens. Delbarhed er en mere direkte hypotese. #1299/#2824. |
| PWA/push er største retentionløft | Udokumenteret. "De glemmer det" er en hypotese, mobil-sessionandel er ikke installationsvillighed. #5307/#937. |
| Retention før akkvisition | Anbefales som afgrænset aktivering/genaktivering før betalt test, ikke stop for al organisk distribution. #4964/#1369. |
| Høj disciplin | Mange guards er ikke bevis for effektiv forretningsstyring. Stale status og populationsfejl er konkrete eksempler. Ingen ny generisk guard anbefalet. |

Kilder: [Google JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics), [Astro islands](https://docs.astro.build/en/concepts/islands/), [WebKit web push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [Vercel Pro](https://vercel.com/docs/plans/pro-plan). De dokumenterer platformsegenskaber, ikke effekten på CZ's retention.

## B: Diagnose af tilgangsfaldet (ejer: #4964, data: #3797/#1369)

Brug afsluttede uger 6/7-13/9, ens tidszone og populationsfilter. Ugen 14/9 var uafsluttet ved briefen 16/9. De fire fulde augustuger i briefen gav 16,75 signups/uge mod 6/uge i de to fulde septemberuger, ca. 64 % lavere. Dette er aritmetik på brugerens serie, ikke en ny prod-måling.

| Hypotese | Konkrete opslag | Afgørende skel |
|---|---|---|
| En kilde tørrede ud | users.created_at pr. uge, LEFT JOIN signup_attribution; UTM/referrer/kampagne/ukendt; match postkalender | Absolut kanaltab vs samtidig vækst i ukendt/self-referral. |
| Juli-top var engangsomtale | Daglige signups 13/7-2/8 mod eksakte datoer/URL'er for Hattrick, Reddit og andre omtaler | Koncentreret spike efter ét opslag vs vedvarende flere kilder. |
| Signup brød | Oprettet konto→bekræftet e-mail inden 24t→menneskehold inden 24t; Auth/Sentry for signup/callback/bootstrap | Stabil relevant trafik med dårligere gennemførelse vs færre indgange. |
| SEO-fald | GSC ugevis og 28d-trend: query/page/country/device, klik/impressions/CTR/position; brand/nonbrand; indeks/canonical | Tabte placeringer/indeksering vs stabil søgetrafik. Overlappende trendvinduer er ikke uafhængige stikprøver. |
| Sæsonalitet | Flere års Google Trends for relevante søgeord/sprog, mod egne GSC-queries og faktisk posting | Bredt tilbagevendende efterspørgselsfald med stabile egne placeringer. Ikke kausal dokumentation alene. |
| Målebrud ved hybrid-split | Før/efter routingdeploy: traffic_events pr. sti, UTM-andel, self-referral, landing=/login og faktiske kontooprettelser | Nævner forsvinder mens konti fortsætter vs begge falder. #5310. |

Kildeudtørring/engangsomtale er første undersøgelsesspor, ikke en konstateret årsag. Marketingændringen i september kan ikke alene forklare hele faldet siden juli. Signup-attribution skrives ved holdoprettelse og ser ikke alle fejl før holdet. Cookie-fri visits er IP/UA/dag-deduplikerede besøg, ikke en personkohorte. `last_seen` er seneste tidspunkt, ikke fuld besøgshistorik.

## Tal der ikke må gentages ukritisk

- 86,8 % etablerede vs 28,6 % nye sammenligner overlevende etablerede med nyankomne og brugte samtykkebegrænsede events. Se den eksisterende aldersjusterede audit på #4964. Dens gamle tal er historisk korrektion, ikke ny baseline.
- Briefens 45 aktive/30d konflikter med GROWTH-loggens 117 aktive/30d og 74 aktive/7d den 14/9. Mulig NPS-undergruppe er en hypotese; afstem original SQL/population før brug. #4964/#5306.
- 241 hold/brugere med løbsdage er ikke 241 manuelt aktiverede spillere. Auto-udfyldning/afvikling skal skilles fra spillerhandling.
- Survey #5121: slutstatus 34 gennemførte/246 berettigede, 41 begyndte. 40 svarede tilfredshed (4,03/5); problemspørgsmål 41: træning 18, udtagelse 14, løb 13, mobil 11. Kun fire besvarere fra division 4. Det er ikke et frafaldsinterview.
- Invite-friend var multivalg, n=31: sendbart link 10, nemmere start 8, belønning 3. Interesse beviser hverken brug eller betalingsvillighed.
- Teknikomfang, samlet bundle-budget og mobilandel er taget fra briefens 16/9-måling; der blev ikke startet en ny bred måling af dem.
- 92 win-back-kandidater og 659,33 kr. MRR/18 abonnementer er 14/9-snapshots, ikke tal til afsendelse eller næste måneds business-case.

## C-H: Alle værdifulde områder har et hjem

| Oprindeligt område | Bevares som konkrete opgaver | Issues |
|---|---|---|
| C: første 10 minutter | Fem nye observerede spillere, første officielle udtagelse, forståelig ventetid, reversible dismiss-rest | #1140 #1569 #5104 #4964 |
| C: SEO | Indeksbevis, interne links, eksisterende PCM-side, Mac/mobil/no-download, fakta og sprog/canonical | #4067 #1407 #3797 #4322 |
| C: marketing | PCM, Hattrick/FMFreaks, directory, mindre creators, EN/DA først, lille FR-test, ingen bred TikTok-maskine | #2236 #2759 |
| C: tracking | Seams, populationsdefinitioner, kanal→aktiv→betalt, minimal vendor-stack, samtykkerelevant guard | #5310 #3796 #3797 #1369 #5305 #4321 |
| C: hastighed | Kold initial payload/flow, p75 field-vitals med n, klik→kvittering; ingen krone-tab udledt af bundlebudget | #5131 #1375 #4952 |
| C: mobil | Gennemfør kernespilopgaven; D-047/eksisterende tabelarbejde; ingen PWA som erstatning for brugbar UI | #1602 #5131 |
| C: spiloplevelse | Beslutning→faktisk resultat→forklaring, klubrelation/egen historie; ingen nyt system med opdigtet kausalitet | #1140 #2853 #3855 #1997 #1148 |
| C: retention | Leveret ét-klik-træning måles; første handling/resultat; allerede bygget mail; genaktivering og cohort-readout | #4964 #1140 #2760 #2853 |
| D: hvilken ende først | Afgrænset aktivering/genaktivering, derefter målbar distribution; ikke måneders omskrivning | #4964 #1369 |
| E: prioriteret plan | Tabel i README med rækkefølge, timer, kroner, mål, kilde, vindue og stop. MASTERPLAN besluttes 17/9. | #4964 som review-indgang |
| F: arkitektur/Astro/PWA | Behold hybrid uden obligatorisk fuld migration; seams; betinget PWA/push; bevarede ejerbeslutninger | #5307 #5249 #5250 #937 |
| G: penge | Eksisterende Pro-pakke, månedlig-default-eksperiment, actual renewals/churn, bidrag/CAC og levebrødsscenarier | #2806 #4646 #1369 |
| H: adgang | GSC-servicekonto/script eller eksport; GA4-eksport/browser; SQL/Sentry/Clarity/Alunta. Ingen nødvendig betalt Ahrefs eller Vercel-WA-reparation. Discord-MCP ikke blocker. | #3797 #1407 #5305 |
| Øvrigt: click-ids | Bevar emnet, lavere prioritet; UTM-test kan køre uden, paid må ikke udledes af fbclid alene | #5304 |
| Øvrigt: NPS | Faktisk eksponering før cooldown; undlad ukritisk frekvensudvidelse | #5306 |
| Øvrigt: resultatdeling/referral | Genbrug eksisterende moment/PNG, public-safe resultatindgang, mål pilot; tidligere belønning bevares | #1299 #2824 #1173 |
| Øvrigt: survey | Resultat findes; #5121 lukket, rest-formidling under #4943. Ingen ny survey bygget. | #4943 #5121 |

## Dubletregister og statuskontrol 16/9

Søgninger blev kørt med både `gh issue list --state all --search ...` og `gh search issues --repo NicolaiDolmer/CyclingZone --match title,body ...`. Ord: attribution, marketing UTM, Pro, monthly semiannual, conversion, salgs, kampagne/S4, delbar/resultatside/share, CAC/unit economics/rentabilitet/levebrød, første løb/D-038, arkitektur/PWA, analytics/NPS. Relevante hits blev læst inklusive kommentarer, også lukkede issues.

**Ét nyt issue: #5310.** Det ejer det browserobserverede tab gennem marketing→SPA og dækningen på marketing, ikke tagging af source-links (#3796), rapportering (#3797), routing-cache (#5249), sessionsbro (#5250), click-ids (#5304) eller den allerede rettede SetupWizard-fallback (#2079).

**Eksisterende issues udvidet med sessionens beslutninger/evidens/forslag:** #1140, #5104, #1569, #2806, #4646, #2760, #2236, #2759, #1299, #1173, #4067, #3796, #3797, #1407, #4322, #5131, #1602, #4952, #5305, #5304, #5306, #5307, #2853, #1369. #4964 får samlet handoff og link til pakken.

Leveret scope, der IKKE genoprettes:
- #4649 Pro v1.1 (Founder/historik/gemte filtre): lukket, kode findes. #2806's gamle "ingen funktioner" er stale.
- #3397 Hero & Agony + PNG og #3398 Maiden Win: lukket/leveret, komponenter findes på dashboard. #1299 ejer fortsat OG/share-URL-arbejdet.
- #5241 ét-klik-træning: merget via #5244; koden er i OnboardingProgressCard.
- #2760 win-back: kode merget via #5247, men udsendelse/måling ikke leveret endnu.
- #4067 marketing-forside og PCM-side: kode/nyere merge-kommentarer findes; hele epic er ikke lukket.
- #2084 blev konsolideret ind i #2853; brug #2853, ingen genåbning.
- #1114 TdF-paraply er konsolideret ind i #2236/#2759. Ingen ny tom kampagne-epic.
- #937 er en lukket, betinget beslutning om PWA; #5307 bruges til vurderingen, ingen automatisk genåbning.

Ingen eksisterende issues er lukket, ingen prioriteringslabels omfordelt, og ingen gammel ejerbeslutning er erstattet af en anbefaling. #5310 får anbefalet high som målefejl før paid; det er ikke en ny MASTERPLAN-placering.

## Konkrete kode-/browserbeviser

- `marketing/components/landing/landing-page.tsx` og `site-chrome.tsx`: faste `/login?mode=signup`-links. Browser 16/9: tagget landing→klik→login uden UTM. DB-række efter nyt signup ikke testet. `frontend/src/main.jsx` kalder capture, `attribution.js` læser aktuel URL/referrer. #5310.
- `OnboardingProgressCard.jsx` onDismiss og `backend/routes/api.js` POST `/me/onboarding-progress/dismiss`: ubetinget tidsstempel. Impact-antal ukendt. #1569.
- `ProUpgradePage.jsx`: `useState("semiannual")`; pro.json: badge/identity-pitch. `RiderAbilityHistoryPro.jsx` og `SavedFiltersBar.jsx` eksisterer. Ingen ny prod-checkout kørt. #2806.
- `frontend/src/App.jsx`: lazy routes/vendors. `webVitalsIntegration.jsx`: value er delta-baseret, metric_value og metric_id medsendes. Brug den rigtige værdi ved percentiler. #5131.
- Supabase blev kun læst til et konkret design-eksempel: rigtig pulje, kommende etapeløb og trup. Ingen spillerdata blev ændret. Private kontakter/credentials og detaljerede spillerdata er ikke kopieret til denne pakke.

## Vigtige rettelser til egne tidligere anbefalinger

- Det tidlige forslag om introduktionsløb er forkastet, ikke en backlog-idé til senere genoplivning.
- Påstand om at vi skal bygge win-back/ét-klik-træning/momentdeling fra bunden er forkert. Genbrug leverede dele.
- Forslaget om at stoppe referral-belønning er IKKE en ejerbeslutning; 23/7-modellen står ved magt indtil eksplicit ændring.
- Rå evne-tal i skitsens DB-snapshot er ikke en verificeret produktionsvisning. Implementering skal bruge eksisterende spiller-visible ability-/eligibility-kontrakter, ikke kopiere mockdata eller rå storagefelter.
- Hele fremtidens premium-pakke, vendor-skift, mål og spend er anbefalinger. Kun backlog-capture og den beskrevne onboarding-retning er valgt i denne session.
