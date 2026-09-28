# Postmortem · 2026-09-26 · Rytterfiltre gendannes ikke ved "tilbage" naar React kollapser routerens mellem-locations (mobile-webkit)

## Hvad skete der?
`frontend-smoke` blev roed paa to uafhaengige PR'er (#5773 og feat/5519) i samme
mobile-webkit-lane, begge gange paa `5292-riders-scout-filters.spec.ts`
"filters, sort and page survive a rider visit and browser back": forventet URL
i raa noegle-raekkefoelge, modtaget den kanoniske. Lokalt (Playwright 1.63,
webkit-2359) bestod DEN test, men soestertesten "returning through history
restores the URL filters" fejlede 2/4 og 5/10: efter `goBack()` stod URL'en
korrekt paa `q=Ada`, `popstate` var fyret, men inputtet blev ved med at vise
"Sofie" og listen blev aldrig genindlaest. Samme koersel viste ogsaa to
`locator.click`-timeouts paa andre specs (board-negotiate-deadclick,
network-abort-leaves-no-stuck-loading), begge groenne ved retry.

## Root cause
To forskellige ting, én af dem i appen.

1. **Appen (#5292's gendannelses-logik).** `RidersPage` opdagede en navigation
   ved i render-fasen at sammenligne `searchParams.toString()` med den sidst
   renderede vaerdi (`lastSearch`). `BrowserRouter` (react-router 8) committer
   location-opdateringer i `React.startTransition`. Naar en egen REPLACE
   (`?q=Sofie`) og et umiddelbart efterfoelgende POP (tilbage) lander i samme
   transition-lane, renderer React ALDRIG mellem-locations: siden ser
   `default|q=Ada` foer og `default|q=Ada` efter, `lastSearch === currentSearch`,
   og resync springes over, selv om filtrene i mellemtiden er "Sofie".
   Instrumenteret render-log beviste det (12 koersler; det fejlende tilfaelde
   havde aldrig en render med den pushede eller replacede location). En
   `location.key`-baseret variant fejlede af praecis samme grund: den
   committede key var ogsaa uaendret. Render-fase-bogholderi kan principielt
   ikke se en navigation React ikke committer.

2. **Testen.** `filteredUrl = page.url()` blev taget umiddelbart efter at
   inputtet viste "Ada". Inputtet har vaerdien fra foerste paint; den kanoniske
   omskrivning af URL'en (replaceState i sync-effekten) kommer efter commit.
   Paa en langsom WebKit-lane vandt assertion'en kaploebet, og den raa URL blev
   sammenlignet med history-entry'en, som bar den omskrevne.

Click-timeouts'ene ("waiting for element to be visible, enabled and stable"
uden én eneste retry-linje i 10 s) er en kendt miljoe-klasse paa mobile-webkit
(`e2e-flakes`-artefakter 22/9 og 26/9 viser samme signatur paa forum-images,
landing-hydration, deadclick, network-abort), altid groen ved retry. Ikke
spec-specifik; retries-mekanismen daekker den.

## Fix
- `frontend/src/pages/RidersPage.jsx`: `popstate`-lytter der gendanner filtrene
  fra `window.location.search` i det oejeblik traversalen sker (kun mens
  pathname stadig er sidens egen; at forlade siden er routerens job). Browser-
  eventet er uafhaengigt af hvad React committer. Render-fase-blokken bevares
  til PUSH/REPLACE.
- `frontend/tests/e2e/5292-riders-scout-filters.spec.ts`: vent paa at den
  kanoniske omskrivning er sket (`not.toHaveURL(raa)`) og laes href fra
  dokumentet i stedet for `page.url()`.
- Verificeret: 5292-spec'en 6x paa mobile-webkit (workers=2) + 1x paa begge
  chromium-projekter, lint + `node --test` groenne.

## Forhindret-fremover
Soestertesten "returning through history" fanger nu appens del deterministisk
nok paa WebKit (0/24 efter fixet mod 7/14 foer). Test 1 er robust mod
paint-vs-effect-kaploebet. Click-stall-klassen har ingen spec-fix; den skal
ses i `e2e-flakes` (14 dages retention) hvis den vokser.

## Laering
Al "gendan fra URL"-logik der lever af at sammenligne med SIDST RENDEREDE
location er usikker under concurrent React: en transition kan kollapse
A -> B -> A til én render, og komponenten ser ingen navigation, mens dens egen
state er flyttet. For en history-traversal er `popstate` den eneste kilde der
garanteret fyrer én gang pr. traversal med den rigtige URL. Og i e2e: en
`page.url()`-capture lige efter en DOM-assertion maaler ofte "foerste paint",
ikke "effekten er koert" - vent paa den tilstand testen faktisk vil bruge.

Refs: #5292, #5773, #5747.
