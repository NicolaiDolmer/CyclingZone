# #5960: Løbsnavne afklippet efter fixture-dagen blev aktiv

- CI på d9d341df4: de to #5383-flader viste tekst højere end linjeboksen på dashboard og løbscenter. Lokalt reproduceret før ændring.
- Kilde: TodayStagesStrip og RaceCentreCard brugte leading-none sammen med display-font og truncate.
- Målt før på mobil/desktop: dashboard 16 px boks / 18 px tekst; løbscenter 22 / 25 px.
- Rettelse: eksisterende leading-tight. Efter: 20 / 20 px og 28 / 28 px. Font, størrelse, bredde og dashboardkortets faste 172 px-højde/skelet er bevaret.
- Guards, masks og allowlists er urørte. De to guard-tests bestod; hvert test måler DA/EN på mobil/desktop. Fire øvrige projektvarianter er deklarerede skips i denne guard.
- Frontend Node-tests: 4157 beståede. Native før/efter-billeder er gemt og kontrolleret, og read-only UI-review har ingen blokeringer.
- Patch note 7.322 dækker den brugerrettede læsbarhedsrettelse. Ingen prod-data er skrevet.
