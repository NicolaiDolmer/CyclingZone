# Elevation-liste — fra "ensartet" til verdensklasse

**Dato:** 2026-07-25 · **Issue:** [#2849](https://github.com/NicolaiDolmer/CyclingZone/issues/2849) bølge 6 · **Metode:** friske screenshots af de 8 vigtigste flader (dashboard, ryttere, løb, løbsdetalje, stillinger, træning, transferliste, T3-rytterprofil) i lys + mørk + mobil, holdt op mod `PAGE_TEMPLATES.md`, anti-slop-reglerne og genrens standard (Hattrick, Football Manager). Screenshots: `docs/screenshots/wave6-elevation/`.

## Hvor vi står

Bølge 0-6 har løst **ensartetheden**. Alle 52 sider bruger nu de samme tre skabeloner, samme kort-opskrift, samme states, én radius, én mikro-typeskala, én statusbaggrund. Det var det rigtige arbejde, og det er færdigt.

Det der skiller os fra genrens bedste er ikke længere konsistens. Det er **informationstæthed og redaktionel disciplin**. Hattrick og FM viser dig data først og forklaringer bagefter; vi gør det omvendt på tre af vores fem vigtigste flader. Og vi har stadig ét gennemgående anti-slop-brud som spec'en forbyder, men som ingen har talt op.

Nedenstående er prioriteret efter **hvad der løfter oplevelsen mest pr. krone**, ikke efter hvad der er let.

---

## 1. Chrome står foran data på de tungeste sider (største enkeltløft)

**Målt på 1280×900, fra toppen af indholdsområdet til første datarække:**

| Side | Chrome før data | Af skærmen | Består af |
|---|---|---|---|
| Transferliste | **603 px** | 67 % | sidehoved 96 · balance-kort 84 · faner+intro 118 · filterpanel 229 · sorterings-chips 76 |
| Ryttere | **463 px** | 51 % | sidehoved 96 · orphan-knaprække 58 · filterpanel 245 · kode-forklaring 34 |
| Daglig træning | **410 px** | 46 % | sidehoved 96 · tre forklarings-kort 270 · orphan-checkbox 44 |
| Stillinger *(reference)* | 188 px | 21 % | sidehoved 96 · filterbar 50 · zone-forklaring 42 |

På Ryttere — appens mest brugte dataflade — ser du **to ryttere** før du skal scrolle. I FM ser du tyve.

Spec'en siger det allerede: T2's filterbar er "search Input (sm, 240px) + up to 3 Selects (sm) + optional Checkbox". Virkeligheden er 8 felter i to rækker + 4 toggle-chips + en "EVNE-FILTRE"-udfoldning. Transferlisten har oveni **8 sorteringsknapper som chips**, selvom tabellens egne kolonneoverskrifter allerede sorterer (`SortableTh`) — to sorterings-mekanismer på samme side.

**Forslag:** kollaps T2-chrome til én linje: søgefelt + 3 selects + et "Flere filtre"-panel der er lukket som default. Slet chip-sorteringen og lad kolonnerne gøre arbejdet. Flyt orphan-knaprækkerne (Ryttere, træningens checkbox) op i `PageHeader`'s action-slot, hvor spec'en siger de hører. Flyt træningens tre forklarings-kort bag ét "Sådan virker træning"-link til Hjælp.

**Effekt:** ~250-400 px vundet på tre sider. Ryttere ville vise 8-10 ryttere over folden i stedet for 2.
**Risiko:** middel. Rører interaktion, ikke kun layout — kræver at du ser en mockup først.

---

## 2. 559 unicode-pile bruges som ikoner

`→` `←` `↔` `↑` `↓` optræder **559 gange i 153 filer** (344 i JSX, 215 i locale-strenge). De sidder i quiet actions ("Se alle →"), i pagination ("← Forrige"), i knap-labels ("↔ Sæt til salg"), i tilbage-links ("← Tilbage").

Spec'en er entydig: *"no emoji (stroke icon set only)"*, og quiet-action-opskriften siger `chevron-right 13px`. Vi har allerede `SectionAction`-primitiven der gør det rigtigt — og på dashboardet står de side om side: **"Fuld rangliste → ›"** har både en tekst-pil OG et rigtigt chevron-ikon.

Det er den slags detalje der adskiller "pænt" fra "professionelt". En tekst-pil arver linjehøjde, kan ikke farves konsistent, rammer ikke baseline, og ser forskellig ud på tværs af platforme og skriftstørrelser.

**Forslag:** ét mekanisk pass. JSX-siden (344) er ren find-and-replace til `ChevronRightIcon`/`ArrowUpIcon`/osv. Locale-siden (215) skal læses igennem, fordi nogle piles betydning er *indholdsmæssig* (fx et flow "A → B" i en forklaring) og skal blive.
**Effekt:** stor visuel gevinst for lav teknisk risiko.
**Risiko:** lav på JSX. Mellem på locales, fordi det er copy i to sprog og rammer snapshots bredt.

---

## 3. Mobil-datatabellen dropper al numerik

Ryttere på mobil viser **kun navn + én meta-linje**. Værdi, løn, alder, evner — alt det man faktisk sammenligner ryttere på — er væk. Der er ingen vandret scroll.

Spec'en beskriver det rigtige: *"name column pinned (min ~148px), secondary text columns fold into the name cell's subline; numeric columns scroll horizontally under the pinned column."* Den del er ikke bygget. `DataTable` har `fold`, men de numeriske kolonner bliver skjult i stedet for at kunne scrolles til.

Samtidig er mobil-typografien for stor: rytternavnet er ~19px og meta-linjen ~15px i uppercase, hvilket fylder to linjer pr. rytter. Genren kører 14-15px navn og 11px meta.

**Forslag:** implementér den vandrette scroll under den pinnede kolonne i `DataTable`, og stram mobil-typeskalaen. Dette overlapper #1602's mobil-P0'er — bør laves som ét stykke arbejde, ikke to.
**Effekt:** gør mobil brugbar til det den bruges til. 41 WAU / 8 DAU betyder at hver session tæller.
**Risiko:** middel, isoleret til `DataTable` + de 6 T2-sider.

---

## 4. Dashboardet har fire kort-idiomer på én side

Tælt på skærmbilledet: (a) kanonisk `Section`, (b) kort med **3px venstre-accent-bjælke** ("Du er klar", "Bestyrelse", "Hjælp & regler", "Sæson"), (c) kort med gold primary indeni ("Udtag dit løbshold"), (d) tomme-tilstands-kort med centreret tekst.

Venstre-accent-bjælken findes ikke i spec'en. Den er et femte stykke chrome der siger "vigtigt" oven i de fire vi allerede har (gold-knap, StatusBadge, tælle-pille, guld-keyline).

Derudover: overskrifterne blander **Title Case og sentence case** i dansk ("Aktive Auktioner", "Kommende Løb", "Transfers & Tilbud" vs. "Sådan gik det for dit hold"). Spec'en siger *"Sentence case always"*.

**Forslag:** afskaf venstre-accent-bjælken; lad `StatusBadge` + tælle-pillen bære prioritet. Kør et sentence-case-pass over overskrifts-nøglerne i begge sprog.
**Effekt:** dashboardet er den flade nye spillere ser først. 73 % kommer aldrig igen.
**Risiko:** lav på bjælken. Copy-passet er mekanisk men rører mange nøgler.

---

## 5. Dataviz findes næsten ikke

Vi har `ProgressMeter`, `StageStripe` og `RiderTypeRadar`. Det er alt. Tre steder hvor genren ville have en kurve, har vi et tal:

- **Formudvikling over sæsonen** pr. rytter — vi viser ét form-tal. FM viser en 10-kamps-kurve.
- **Holdets point pr. løbsdag** — Stillinger viser en slutsum. Hattrick viser serieudviklingen.
- **Markedsværdi over tid** — vi har `RiderValueTrendBadge` (op/ned), ikke en linje.

Spec'en har allerede opskriften: *"stage profiles / sparklines are inline SVG strokes (2px `--text-1` line, `--bg-subtle` flat fill, data-font `text-3xs` axis labels)"*. Primitiven mangler bare.

**Forslag:** byg én `Sparkline`-primitiv efter den opskrift, og brug den på de tre flader. Data findes allerede i alle tre tilfælde.
**Effekt:** det er dette der får et managerspil til at føles *dybt* frem for bare korrekt.
**Risiko:** lav — ny primitiv, ingen ændring af eksisterende flader før den bruges.

---

## 6. Tomme flader siger hvad der mangler, ikke hvad man gør

`EmptyState` bruges nu bredt, og anatomien er rigtig. Men copy'en er beskrivende i stedet for handlende: "Ingen aktive auktioner", "Ingen ryttere til salg", "Resultater vises her efter de første løb", "Ingen trænings-kørsler endnu".

Spec'en beder om *"ONE sentence description ... e.g. 'Draft your first rider in the live auction.'"* — altså en instruktion. Og et af de fire eksempler ovenfor har slet ingen handling.

På dashboardet er fire af otte kort tomme på en frisk konto. Det er det første en ny manager ser.

**Forslag:** skriv de ~15 tomme-tilstande om til handling + én knap. Det er en copy-opgave, ikke en design-opgave — og den hører sammen med #1140 (de første 20 minutter).
**Effekt:** direkte på det tal der brænder mest (73 % vender aldrig tilbage).
**Risiko:** ingen teknisk. Kræver en tone-runde med dig.

---

## 7. Mikrointeraktioner mangler helt

Ingen hover-tilstande på tabelrækker ud over baggrundsskift. Ingen fokus-ring-konsistens på tværs af klikbare kort. Ingen bekræftende bevægelse når en handling lykkes (bud placeret, tilbud sendt). Ingen optimistisk feedback — man venter på et fuldt genindlæs.

Det er sidste 5 % og bør ligge sidst. Men når resten er på plads, er det den forskel man *føler* uden at kunne pege på den.

**Forslag:** udskudt. Tages efter #1-#6.

---

## Lav-risiko fixet direkte i bølge 6's PR

- `TrainingHistory` havde en 10. header-stil (`h2 text-lg font-bold` på sidens baggrund) + håndrullede kort til loading/empty → kanonisk `Section` + `SectionHeader` + `SkeletonLines` + `EmptyState`.
- Unicode-pile fjernet fra privatlivssiderne, strategi-editorens knapper og planlæggerens legende (det subsæt der lå i bølge 6's egne filer).
- `seedData` beskrev en rytter med `secondary_type: "leadout"` — en type der er FJERNET fra modellen, så mobil-ryttertabellen rendrede den rå nøgle `types.leadout`. Fixturen beskrev en umulig rytter.

## Ikke ændret, men bemærket

- **Privatlivssiderne** blev delt op i 9 stakkede kort i denne bølge. Audit-fundet var kun "3. h2-stil". En juridisk tekst læses bedre som ét dokument, og siderne ligger uden for app-shellen. Kan rulles tilbage til ét dokument-kort med kanonisk overskrift-typografi hvis du foretrækker det — sig til.
- **Action-cluster-kontrakten er for stram.** Spec: "one Select + one primary Button. Nothing else." Notifications, Activity og Auctions har alle to utility-knapper uden gold primary. Tre sider afviger stiltiende. Spec'en bør beskrive virkeligheden: op til to quiet utility-actions ELLER én Select + én gold primary — aldrig to gold.
- **`ui/Checkbox` bruger `rounded-[3px]`**, off-token. Spec'en dækker ikke form-controls; enten tilføj en regel eller lad den stå.
