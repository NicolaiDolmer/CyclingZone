# Postmortem · 2026-08-03 · Race-kort-header var kun delvist klikbar (#3187)

## Hvad skete der?
Clarity (27/7–3/8) fandt appens største enkelt-koncentration af dødeklik: 129 klik
på 6 minutter på løbskortene i Planlægnings-hubbens Holdudtagelse-fane (den gamle
URL `/races?tab=calendar&day=…&scope=mine` redirecter hertil). Brugerne klikkede
gentagne gange på "Løbsdag N" + etape/klasse-teksten uden reaktion.

## Root cause
`RaceColumn.jsx` og `StartListColumn.jsx` (samme headertoppen på "Andre
divisioner"-browse-varianten) havde kun titel-teksten pakket i `RaceLink` (et ægte
`<Link>`). Resten af headeren — "Løbsdag N", etape/klasse-linjen, status-chippen,
peak/payback-noterne — sad i en almindelig ikke-interaktiv `<div>` ved siden af.
Visuelt læses hele headeren som ÉT kort; kun en brøkdel af fladen var reelt et
hit-target.

## Fix
`frontend/src/components/racehub/RaceColumn.jsx` og
`frontend/src/components/racehub/StartListColumn.jsx`: hele header-blokken er nu
selve `RaceLink`-elementet (ét `<a>`), ikke kun titlen. Tilføjet `cursor-pointer` +
`hover:bg-cz-subtle/60` + `group-hover:text-cz-accent-t` på titlen, og en kortfattet
`aria-label` ("Åbn {name}") så skærmlæsere ikke får hele kortets brødtekst læst op
(samme mønster som `chip.openRace` i `CalendarPage.jsx`). Kroppen under headeren
(rytterrækker, roller, ×, afmeld — egne interaktive elementer) er urørt: den var
aldrig død, kun headeren manglede et rigtigt hit-target. `StartListColumn`s låste
("ikke-åbnet-endnu") kort-variant er bevidst IKKE gjort klikbar — den signalerer
korrekt at funktionen ikke er tilgængelig endnu (stiplet kant + lås-ikon).

## Forhindret-fremover
Ny regressionstest `frontend/tests/e2e/racehub-deadclick.spec.js` klikker
specifikt på det FØR-døde element ("Løbsdag N" / type-klasse-linjen), ikke titlen,
og forventer navigation — fanger et evt. tilbagefald til "kun titlen er et link".

## Læring
Et kort der visuelt fremstår som én flade, men kun har titel-teksten som ægte link,
er den mest almindelige dead-affordance-klasse i denne kodebase (#3067, #2227,
#1919, #1421 er alle varianter). Når et lignende kort dukker op igen: tjek om HELE
den ikke-interaktive header/tekst-blok er pakket i linket — ikke kun navnet — og om
søskende-kort-varianter (fx en read-only "browse"-udgave) har samme mønster.
