# Graduation Day: to visuelle forslag til #7323

**FORSLAG – ikke bygget.** 10/11 2026. Kun billeder og dette beslutningsgrundlag.
Ingen app-, server-, schema-, flag-, produktions- eller Git-metadataændringer er foretaget.

[Åbn sammenligning A](comparison-A.png) · [Åbn sammenligning B](comparison-B.png)

| Forslag | Fordel | Ulempe |
|---|---|---|
| **A · status i valgkolonnen** | Bevarer den kendte sekskolonne-læsning. Auktionsstatus og vej til auktionen står dér, hvor valget normalt er. | Den smalle valgkolonne skal rumme status og frist; særlige rækker bliver højere. |
| **B · status og handling på egen linje** | Samler status, tidspunkt og handling under rytterdata; giver trænerens vurdering mere vandret plads. | Gør alle desktoprækker højere og øger scrolling ved større årgange. |

**Anbefaling: A.** Det viderefører den eksisterende T1-side med den mindste flytning af rytterdata.
B er et reelt alternativ, hvis tydelig adskillelse mellem data og handling vejer tungere end rækkehøjde.
Dette er et layoutvalg. D1/D2/D3 genåbnes ikke.

## Hvad er før, og hvad er efter?

- **Før er en reel lokal app-rendering**, ikke en rekonstruktion og ikke et produktionsscreenshot.
  Den fastlåste statiske build fra det eksisterende #2176-capture blev læst uændret.
  Worktree-HEAD ved opgaven: 6c52c88f258c7a997157a6477e3be2ff0280700d.
  Buildens version.json: frontend 7741c82783bce4db (release-feltet er tomt).
- Samme eksisterende E2E-fixtures, installNetworkMocks og 2491-graduation-day.fixture.js, leverer data.
  Identiteterne er erstattet med **Demo Alfa / Demo Beta / Demo Gamma**.
  Alle beløb, også saldoen i sidebar, er syntetiske mockdata. Ingen live-kald eller spillerdata.
- Fast browserur: **2026-11-10 12:00:00 UTC**. Beta har frist 11/11 kl. 12 UTC; de øvrige har 15/11 kl. 12 UTC.
- Baseline beviser kun, hvordan den nuværende Graduation Day renderer disse mock-gradueringer.
  Scenarieannotering for aktiv auktion og pending_promotion er ikke en valideret backend-/API-kontrakt;
  siden viser ikke denne koordinationskontekst. Dette er **ikke** bevis på en faktisk pending-promotion-tilstand i databasen.
- **Efter er selvstændige HTML-prototyper** udledt af den renderede baseline, med appens faktiske
  CSS, lokale fonte, tokens, shell og eksisterende tekster. Ingen produktkode er ændret.
  Knapperne udfører ikke de foreslåede handlinger. Ingen klik-, API-, samtidigheds- eller serveradfærd er implementeret eller testet.
- Originale fuldsidebilleder, HTML, capture- og pakkescripts er bevaret i ignoreret pr-screens/local/7323-options/.
  Kun udvalgte PNG-filer og denne README er tiltænkt offentlig review.

## Samme scenarie i begge forslag

- **Alfa:** almindelig aktiv auktion. Rækkens valg erstattes visuelt af eksisterende labels Active auction og View auction.
  Intentionen er at Confirm all behandler de andre ryttere uden at genoprette auktionen; det er ikke bygget.
- **Beta:** adminannulleret gradueringsauktion. Eksisterende label Auction cancelled, 24 timer og konkret frist ved valgene.
  Move up er fortsat synlig og disabled, fordi måltruppen i den syntetiske fixture er fuld; Sell er forvalgt.
- **Gamma:** normal U23→senior-overgang med de eksisterende tre valg, kontrakt, rating, potentiale og trænertekst.

D1 forbliver overgangens mål ved usolgt **gradueringsauktion**: Junior→U23 og U23→senior, med de aftalte plads-/økonomi-/venteregler.
D2 bevarer skellet mellem frivilligt salg og graduering.
D3 er 24 timer fra den bekræftede adminannullering, uden gentagen forlængelse eller automatisk handling i vinduet.
De udfald er ikke simuleret af billederne.

## Kilder og visuel kontrol

- [Issue #7323, seneste ejerstatus 9/11](https://github.com/NicolaiDolmer/CyclingZone/issues/7323#issuecomment-6750306968):
  produktvalg låst; visuelt design og lokal PG17-baseline kræves før byg.
- docs/YOUTH_RULES.md §2.2/§2.6; docs/TRANSFER_MARKET_RULES.md §1/§7.
- frontend/src/pages/GraduationDayPage.tsx, frontend/src/index.css,
  eksisterende EN-labels i academy.json, rider.json, notifications.json og backendMessages.json.
- docs/design/PAGE_TEMPLATES.md T1 (896px), docs/design/TASTE.md P1/P3/P5/P7/P9/P10.
- Desktop-viewport **1440×1000**; telefon **390×844, touch/coarse pointer**.
  Desktop efter-billeder er full-page (1031px høje inklusive den synlige forslag-markør).
  Telefonens top- og scrollede udsnit er rigtige 390×844-viewports; bundnavigationen er bevaret.
- Faktisk browser-capture med Chromium. A og B har målt scrollWidth == innerWidth ved både 1440 og 390.
  Tre rytterrækker i alle fire prototypevisninger. Det nye View auction-mål måler 115×44px på telefon og 115×30px på desktop.
- Originaler og begge layouts er visuelt inspiceret. Valg, frist, trupbegrænsning, rating, potentiale,
  kontrakt og trænertekst er læsbare; de scrollede mobilbilleder viser valgene fri af bundnavigationen.
  Der er én gold primary (Confirm all), hairlines, 5px hjørner og et stroke-ikon ved auktionslinket.
- Billederne dokumenterer disse viewports og syntetiske navne. De er ikke bred browser-/tilgængeligheds- eller langtekstverifikation.

## Testplan før en eventuel implementering

1. Ejeren ser A/B samt native desktop-/mobilbilleder; Claude færdiggør eventuel spillertekst.
2. Read-only teknisk design og **lokal PG17-baseline** før første implementerings-PR, jf. issue og regel 36.
3. TIER FULL + relevante frontend/e2e bag verify-semafor. Injicer fast now.
   Dæk almindelig/gradueringsauktion, med/uden bud, begge overgange, fuld måltrup og manglende råd;
   adminannullering/genafspilning, faktisk salg/ny ejer, tabt svar efter commit, to faner,
   sweep samtidig samt to ryttere om sidste plads.
4. Staging-runde med aktiv auktion + en anden handlingsklar rytter og et genåbnet 24-timers vindue.
   Confirm all skal kunne fortsætte for andre; én auktion må ikke blive to; valg efter annullering må ikke forsvinde tidligt.
5. Mobil og desktop på faktisk implementeret side før ejerens merge-go. SSOT, hjælp og patch notes følger implementeringsleverancen.

## Terminal og produktstatus

Alle browserkørsler blev kørt serielt under scripts/verify-lock.ps1 -Max 2 -Runtime codex.
Capture-scriptets finally observerede OWN_SERVER_CLOSED true efter server.close-callback.
Pakkescriptet observerede browserlukning; det startede ingen server.
Ingen commit, push, PR, kommentar, merge, deploy, migrering eller flagændring.
Patch-note-undtagelse: kun forslag/artifacts, ingen brugerrettet runtimeændring.
Hovedsessionen ejer review, offentlig artifact-PR og issue-handoff.
