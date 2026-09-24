# Tekst der går ud over sin boks eller ikke kan læses — fund 19/9 2026

> Kilde: [#5383](https://github.com/NicolaiDolmer/CyclingZone/issues/5383). Målt automatisk af
> `frontend/tests/e2e/5383-text-overflow-guard.spec.js` med måleren i
> `frontend/tests/e2e/lib/text-overflow-scan.js`.
>
> Ejer-direktiv 18/9, ordret: *"Det er meningen at du helt af dig selv skal opdage ting som, at teksten
> går ud over boksene. Det skal ikke kunne opstå."* Der er derfor ikke bedt om skærmbilleder;
> listen herunder er hvad måleren selv fandt.

## Sådan er der målt

16 manager-sider plus app-skallen (sidebar, topbar), hver på **dansk og engelsk** og i **to bredder**:
mobil 412x915 (Android) og desktop 1280x900. Det giver 68 målinger. Fire regler:

| Regel | Hvad den fanger |
|---|---|
| `clipped` | Elementet har sin egen tekst, overflowet er skjult, og indholdet er større end kassen — uden at afkortningen er tilsigtet. Tilsigtet = ellipsis eller line-clamp hvor en nær forfaders `title`/`aria-label` indeholder den klippede tekst, eller `data-allow-clip`. |
| `outside-container` | Tekstens synlige kasse stikker ud over nærmeste kort-, knap- eller badge-beholder, og beholderen klipper ikke. |
| `unreadable` | Nul bredde, dækket af et ugennemsigtigt søskende-element, eller farvekontrast under 3:1 mod sin egen baggrund. |
| `raw-i18n-key` | En oversættelsesnøgle står på fladen i stedet for en oversættelse. |

Måleren dømmer bevidst **ikke**: elementer i deres egen vandrette scroll-container (en bred datatabel
må scrolle i sig selv, T2), absolut placerede etiketter der ligger uden for deres forælder med vilje,
tekst over et baggrundsbillede eller en gradient (baggrunden kan ikke læses som én farve), og overlap
fra klæbende eller fastgjorte lag (en sticky topbar der glider hen over indhold under scroll, eller
auktionstabellens sticky bud-kolonne, er ikke en fejl).

## Resultat i tal

| | Antal |
|---|---|
| Rå i18n-nøgler på fladen | **0** |
| Usynlig eller nul-bredde tekst | **0** |
| Tekst uden for sin boks / klippet utilsigtet | **11 steder** (heraf 8 rettet, 3 udskudt) |
| Kontrast under 3:1 | **~1.300 elementer**, men kun **7 farvepar** — det er tokens, ikke sider |

## 1. Tekst uden for sin boks — rettet

### Rytterdatabasen, Akademiet, Mit hold og alle andre T2-tabeller (mobil)

Den foldede meta-linje i navnecellen (`status · alder · type`) stod på én linje uden mulighed for at
bryde, og rytternavnet arvede `whitespace-nowrap` fra siden. På 412 px stak

- rytternavnet 3-5 px ud over sin egen `<td>` (Rytterdatabasen),
- meta-linjen op til **84 px** ud ("AUK · 29 · BJERGRYTTER/ETAPELØBSRYTTER"),
- og 39 px på Akademiet ("BJERGRYTTER/ETAPELØBSRYTTER · 180.000").

Det er samtidig et brud på D-047 (TASTE P10): mobil-standarden lover *ingen vandret scroll*, og den
garanti holdt kun så længe ingen side satte `whitespace-nowrap` i navnecellen.

**Rettet ét sted** — `renderStickyCell` i `frontend/src/components/ui/DataTable.jsx`:

- mobil-tilstanden overstyrer `whitespace-nowrap` på alt inde i navnecellen, så navnet bryder til to
  linjer i stedet for at gøre tabellen bredere end telefonen,
- den foldede meta-linje får sin egen linje med ellipsis og hele teksten i `title`. Den må hverken
  brækkes midt i ordet (grimt, og allerede noteret som forkert i `TrainingPage.jsx`) eller sætte
  kolonnens min-bredde.

Fordi rettelsen sidder i kittet, gælder den alle T2-sider på én gang.

### Forum-listen og dashboardets forum-kort

Trådoverskriften afkortes hårdt i den smalle celle ("Which feature should we build next?" blev klippet
78 px på mobil), og der var ingen `title` nogen steder — hele overskriften kunne ikke læses uden at
åbne tråden. Rettet i `ForumHighlightsCard.jsx` og `ForumPage.jsx`: den afkortede titel har nu `title`.

### Kalender-chippen — ikke en fejl

Løbsnavnet i en kalendercelle afkortes hårdt, men hele navnet står allerede i linkets `title` og
`aria-label`. Måleren accepterer nu den slags, fordi etiketten beviseligt indeholder den klippede
tekst. Ingen ændring på fladen.

## 2. Tekst uden for sin boks — udskudt, står som navngiven undtagelse

### Træningssiden, dag-kolonnen (mobil)

Dag-kolonnen er 15vw, altså ca. 62 px på 412 px. Cellens `px-4` spiser 32 px og knappens egen padding
20 px, så der er under 10 px tilbage til labelen: "Vælg dag" klippes 16 px (32 px på engelsk) og
stikker 23 px ud over knappen. Rytternavnet i samme tabels navnecelle stikker 9-14 px ud over sin
`<td>` — tabellen er håndrullet og ikke en `DataTable`, så kit-rettelsen når den ikke.

**Hvorfor udskudt:** det er den gamle mobil-gren. Ejeren valgte 18/9 ([#3643](https://github.com/NicolaiDolmer/CyclingZone/issues/3643))
en helt ny mobil-træningstabel bag stadie-flaget `training_mobile_table`, som erstatter netop disse
celler. At omforme den døde gren nu ville være spildt arbejde. Står som **én** undtagelse i
`frontend/tests/e2e/lib/text-overflow-allowlist.js` med udløbsdato 31/12 2026.

## 3. Kontrast — det er tokens, ikke sider

~1.300 elementer måler under 3:1, men de fordeler sig på kun **syv farvepar**. Det er ikke et
side-problem; det er fire til fem token-værdier.

| Farve på baggrund | Ratio | Token | Hvor | Foreslået rettelse |
|---|---|---|---|---|
| `#9896b0` på `#fcfbf7` | 2,77 | `--text-3` på kort | 11 sider | `--text-3: #807ea0` → 3,75 |
| `#9896b0` på `#f4f2ec` | 2,56 | `--text-3` på canvas | 11 sider | samme → 3,47 |
| `#9896b0` på `#ece9e1` | 2,36 | `--text-3` på nedsænket flade | 9 sider | samme → 3,20 |
| `#9896b0` på `#faf6e5` | 2,64 | `--text-3` på guld-tonet flade | Indstillinger | samme → 3,58 |
| `#b29231` på `#fcfbf7` | 2,87 | `--accent-t` ved 80 % alfa | aktiv sorterings-overskrift | fuld alfa → 3,91 |
| `#53576a` på `#1a1f38` | 2,27 | `--text-sidebar-3` (hvid 25 %) | app-skallen | hvid 35 % → 3,16 |
| `#66637a` på `#1a1f38` | 2,80 | lyst temas `--text-2` brugt på mørk topbar | sprogvælgeren | brug `--text-sidebar-2` |

To ting værd at bemærke:

1. **Mørkt tema er allerede rettet, lyst er ikke.** `index.css` bærer kommentaren *"AA fix (D-TEXT3) —
   was #6b6d7e (3.75:1, FAILed AA)"* på `--text-3` i mørkt tema. Lyst tema fik aldrig den runde.
   Det her er altså en halvt udført oprydning, ikke et nyt krav.
2. **Sprogvælgeren er en token-forveksling**, ikke et paletvalg: den bruger det lyse temas sekundære
   tekstfarve på den mørke bjælke.

**Hvorfor ikke rettet i denne PR:** en ny værdi på `--text-3` flytter pixels i hvert eneste
pixel-snapshot i alle tre Playwright-projekter, og guld er ejer-låst i TASTE §6. Det hører hjemme i
sin egen PR med en samlet snapshot-runde, og det er et paletvalg ejeren skal se — ikke noget der
smugles med i den PR der indfører vagten.

**Hvordan vagten stadig virker:** kontrast dømmes pr. **farvepar**, ikke pr. side. De syv kendte par
står i `KNOWN_CONTRAST_DEBT` med målt ratio, foreslået ny værdi, begrundelse og udløbsdato. Et par der
ikke står der, fejler. Et nyt for lyst tekst-token kan altså ikke snige sig ind.

## 4. Det måleren ikke dækker

- **Løbsdetaljen (`/races/:id`)** står udenfor: standard-mocken returnerer ingen løb, så siden ville
  blive målt tom. Den skal have sit eget seed før den kan med.
- **Kun ét browser-projekt.** Vagten sætter selv sine to bredder og kører derfor i
  desktop-chromium-sharden. Safari-specifikke tekstbrud (hvordan WebKit bryder lange ord) fanges ikke
  her; det er fortsat `core-smoke`s og de tre projekters snapshots' opgave.
- **Kun lyst tema.** Mørkt tema er ikke målt. Kontrast-tallene ovenfor gælder lyst tema.
- **Dækket-af-reglen spørger kun inden for elementets synlige kasse** og springer over når elementet
  ikke deltager i pointer-testen (`pointer-events: none`) eller når det dækkende lag er klæbende.
  Uden de tre afgrænsninger gav reglen 30 falske fund og nul ægte.
- **Ikke alle sider.** 16 af appens sider er med — dem mock-seedet fylder med rigtigt indhold. Resten
  er udækkede.
- **`title` regnes som en gyldig udvej, og det er en beslutning du kan omgøre.** Når en afkortet tekst
  står fuldt ud i en nær forfaders `title`/`aria-label`, er den ikke et fund. Indvendingen (rejst af
  CodeRabbit 19/9) er god: et tooltip kræver hover, og et `aria-label` ser en seende bruger aldrig —
  på en telefon er ingen af delene en rigtig udvej. Barren er alligevel sat der, fordi alternativet —
  at kræve synlig ombrydning eller en udfoldning før en afkortning er lovlig — ville gøre hver eneste
  afkortede etikette i appen til et fund, og fordi D-047 udtrykkeligt bygger på at resten er "ét tryk
  væk": rækken linker selv derhen hvor hele teksten står. Skal barren hæves, er det dit valg.

## 5. Ordet der ikke var dansk

`frontend/public/locales/da/dashboard.json` → `board.exceeds` sagde **"Overget"**. Rettet til
**"Overgået"** (ejer-valgt 19/9, samme ord som `exceedsTitle` allerede bruger). Gamle patch notes er
ikke rørt.
