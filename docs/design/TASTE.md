# TASTE.md: hvad verdensklasse er for Cycling Zone

> **Status:** udkast 2/9 2026, slice 1 af [#4622](https://github.com/NicolaiDolmer/CyclingZone/issues/4622) ([#4623](https://github.com/NicolaiDolmer/CyclingZone/issues/4623)). **Otte retningsvalg er truffet af ejeren 2/9 i visuel dialog (§6).** Bindende når ejeren har godkendt hele dokumentet. Indtil da er dokumentet det vi måler slice 2 (audit af alle 63 sider) op imod, og alt her kan ændres af ejeren med ét ord.
>
> **Forhold til de andre regler:** [`PAGE_TEMPLATES.md`](PAGE_TEMPLATES.md) siger HVAD en side består af (skabelon, sidehoved, kort, tabel, tilstande, fold-disciplin). Dette dokument siger HVORFOR og HVOR GODT: hvad der adskiller en side der blot følger skabelonen fra en side der er i verdensklasse. Skabelonen er gulvet, smagen er målet. Brand-DNA'et står i [`../brand/BRAND_BRIEF.md`](../brand/BRAND_BRIEF.md), copy-reglerne i [`../TONE_OF_VOICE.md`](../TONE_OF_VOICE.md). Ingen af dem gentages her, kun peges på.
>
> **Screenshots:** eksemplerne peger på spillets egne skærmbilleder i `docs/screenshots/wave6-elevation/` (taget 25/7 2026, lys, mørk og mobil) og `design_handoff_rider_profile/screenshots/`. Slice 2 tager friske billeder af alle 63 sider; dette dokument holder til fingrene på det vi allerede har set.

---

## 0. Én sætning

**Cycling Zone skal se ud som om det er lavet af folk der elsker cykelsport og data, ikke af en skabelon.**

Genrens bedste (Football Manager, Hattrick, OOTP) vinder ikke på pynt. De vinder på at spilleren ser sine tal først, forstår dem uden forklaring, og føler at verdenen er dyb fordi hver flade viser noget ægte. Det er vores standard. Alt der ligner "en app lavet med en AI og et komponentbibliotek" er et fund, også når det følger skabelonen.

---

## 1. Hvad vi går efter: ti principper med eksempler fra spillet

Hvert princip har: hvad det betyder, ét eksempel fra spillet selv (rigtigt eller forkert), og spørgsmålet man stiller sig når man dømmer. Spørgsmålene samles i tjeklisten i §4.

### P1 · Data først, forklaring bagefter

Spilleren kom for at se sine ryttere, sin stilling, sit løb. Det han kom for at se skal stå over folden på første skærm. Filtre, forklaringer, saldo-kort og introtekst er chrome, og chrome står under eller bag noget.

- **Forkert i dag:** `wave6-elevation/riders-desktop-light.png`. Rytterdatabasen viser 463 px chrome før første rytter (sidehoved, løsrevet knaprække "Vis stats / Min ønskeliste", filterpanel med 8 felter og 4 chips, kode-forklaring). På 1280×900 ser spilleren to ryttere. Football Manager viser tyve.
- **Forkert i dag:** `wave6-elevation/transfers-desktop-light.png`. 603 px chrome: saldo-kort, faner, introtekst, filterpanel, OG 8 sorteringsknapper som chips selvom kolonneoverskrifterne allerede sorterer. To sorterings-mekanismer på én side.
- **Rigtigt i dag:** `wave6-elevation/standings-desktop-light.png`. 188 px chrome, så tabellen. Filterbar på én linje, zone-forklaringen under tabellen hvor den hører til.
- **Ejer-retning 2/9 (fork 1, valg B "FM-tæt"):** filterbar på én linje (søg + 3 selects + "Flere filtre" lukket som default), `DataTable dense` (7 px lodret padding) som standard på rostere og databaser, 11 px meta-subline. Mål: 8-10 rækker over folden. **Gate:** ejeren godkender visuelt på den ÆGTE side (ikke mockup) før det indføres på hver T2-side; auditten må flagge afvigelsen som fund, men ingen side ændres uden det go.
- **Spørgsmål:** Ser spilleren mindst 8 datarækker (eller sidens primære indhold) uden at scrolle på 1280×900?

### P2 · Ægte cykel-data som billedsprog

Vores billeder er etapeprofiler, tidsgab, trøjefarver, resultatlister, stigningsprocenter, nationsflag. Aldrig stock-fotos, aldrig gradient-blobs, aldrig dekoration. Når en flade mangler liv, er svaret mere ægte data (en sparkline, en profil, et tidsgab), ikke pynt.

- **Rigtigt i dag:** `wave6-elevation/race-detail-desktop-dark.png`. Etapeprofilen som inline-SVG med stigninger markeret i rødt, målflag, km-akse, "18 KM NEDKØRSEL TIL MÅL" som terræn-signal. Det ER cykelsport. Ingen anden managergenre kan vise det.
- **Forkert på samme side:** profilen tegnes tre gange (thumbnail-række, stor profil, igen i etape-kortet under). Gentagelse er ikke dybde. Én stor profil + thumbnails er nok.
- **Mangler i dag:** formkurve pr. rytter (vi viser ét tal), point pr. løbsdag i stillingen (vi viser en slutsum), markedsværdi over tid (vi viser en pil). Data findes i alle tre tilfælde. `Sparkline`-primitiven mangler (ELEVATION #5).
- **Ejer-retning 2/9 (fork 5, valg A "monokrom streg"):** én `Sparkline`-opskrift til alle tre steder: 2 px streg i `--text-1`, flad `--bg-subtle`-fyld under kurven, slutpunktet markeret, akse-labels `text-3xs`. Kurven selv skifter ALDRIG farve efter retning; deltaet ved siden af tallet bærer grøn/rød. Søjler (variant C) kun som supplement til diskrete værdier (point pr. løbsdag), aldrig til form eller værdi.
- **Spørgsmål:** Bruger siden mindst ét ægte cykel-data-element som billede, og er der ingen dekorative elementer der ikke viser data?

### P3 · Redaktionel ro: hairlines, ét guld, luft

Aviser og L'Équipe-resultatsider deler flader med tynde streger og luft, ikke med kasser i kasser, skygger og farvede bjælker. Vores kort er hairline + 5 px radius + luft. Guld er rationeret: ét primært kald pr. view plus ledermarkører, og det er alt. Når alt råber, hører spilleren ingenting.

- **Rigtigt i dag:** `design_handoff_rider_profile/screenshots/01-own-light.png` og `wave6-elevation/rider-profile-desktop-light.png`. Hero-kortet med 2 px guld-keyline øverst, Bebas-navn, stat-række med hairline over. Én guld-knap ("Forlæng kontrakt"). Referencen for alle T3-sider.
- **Forkert i dag:** `wave6-elevation/dashboard-desktop-light.png`. Fire kort-idiomer på én side: kanonisk `Section`, kort med 3 px venstre-accent-bjælke ("Du er klar", "Bestyrelse", "Hjælp & regler"), kort med guld-knap indeni, tomme kort med centreret tekst. Venstre-bjælken findes ikke i spec'en; den er et femte "vigtigt"-signal oven i de fire vi har.
- **Ejer-retning 2/9 (fork 3, valg B "som i dag"):** guld må stå præcis fire steder: (1) én primær knap pr. view, (2) leder-markører (FØRER-pille, trøje), (3) guld-TEKST `--accent-t` på quiet actions og aktiv fane, (4) 2 px keyline kun på T3-heroen. Aldrig guld-tal, aldrig guld-tint på egen række, aldrig keyline på almindelige kort. Det er PAGE_TEMPLATES' regel; TASTE gør den til et fund når den brydes.
- **Spørgsmål:** Er der præcis ét guld-primært element, ingen skygger, ingen bjælker og ingen kasser inde i kasser ud over skabelonens kort-i-side?

### P4 · Bebas kun hvor det bærer

Bebas Neue er vores stemme når noget er STORT: rytternavnet i heroen, løbstitlen, en sejrsoverskrift. Den er ikke en label-font, ikke en knap-font, ikke en kort-titel-font. Bruges den overalt, mister den kraften det ene sted den skal have den.

- **Rigtigt i dag:** "ADA PEDERSEN" og "TOUR DE PREVIEW" i heroerne. Ét ord pr. side i display-størrelse, resten Inter Tight og DM Sans.
- **Forkert historisk:** KitchenSinks "kanoniske" eyebrow + `text-5xl`-titel som ingen sider fulgte, og de fem "editorial Gen 2"-sider med tre forskellige Bebas-størrelser (audit 23/7, F2). Nu konvergeret til ét sidehoved (Inter Tight 20/700), og Bebas kun i T3-heroer.
- **Ejer-retning 2/9 (fork 2, valg A "kun hero-navnet"):** Bebas Neue står kun på det ene STORE ord pr. side: rytternavn, løbstitel, holdnavn i T3-heroen (og landing/brand-flader uden for app-skabelonerne). Aldrig på kort-titler, aldrig på tal (Bebas har ikke tabulære cifre). Kort-titler forbliver 15/600 sentence case.
- **Spørgsmål:** Optræder Bebas kun i hero-navnet/-titlen, og er der højst ét display-element pr. skærm?

### P5 · Tæthed med hierarki

Tæt er ikke det samme som rodet. Football Manager er tæt fordi alt sidder i et gitter med tabulære tal, ens rækkehøjde og tydelig sortering. Vi går efter det samme: 13 px rækker (dense 7 px pad for rosters), tal højrestillet og tabulære, én radius, én mikro-typeskala (11 og 10 px, intet under).

- **Rigtigt i dag:** `standings-desktop-light.png`: kolonner højrestillet, tabulære tal, "FØRER"-pille i guld, DIG-markør, zone-forklaring under.
- **Forkert i dag:** `riders-desktop-light.png`: rytterens hold ("E2E Racing") ombrydes over to linjer i en smal kolonne, status-badge og type-badge har forskellig højde og farvelogik, og CLM-kolonnens 52/86 vises som farvede firkanter uden forklaring på fladen.
- **Forkert på mobil:** `riders-mobile-light.png`. Tabellen dropper al numerik og viser kun navn + én meta-linje i ~19 px og ~15 px uppercase. Genren kører 14 px navn og 11 px meta. Mobil skal være tæt, ikke stor (P10).
- **Spørgsmål:** Er tal tabulære og højrestillede, står ens ting ens (samme badge-højde, samme radius, samme rækkehøjde), og er der intet under 10 px?

### P6 · Tomme flader siger hvad man gør, ikke hvad der mangler

En tom flade er første indtryk for 73 % af nye spillere der aldrig kommer igen. "Ingen aktive auktioner" er en beskrivelse. "Byd på din første rytter i auktionen" er en handling. Skabelonen kræver én sætning + én knap; sætningen skal være en instruktion.

- **Forkert i dag:** `transfers-desktop-light.png`: "Ingen ryttere til salg" med et ikon og uden handling. `dashboard-desktop-light.png`: "Resultater vises her efter de første løb" (passiv), "Ingen aktive auktioner" (beskrivende). Fire af otte dashboard-kort er tomme på en frisk konto.
- **Rigtigt (skabelonens eget eksempel):** "Draft your first rider in the live auction." + sm-knap.
- **Ejer-retning 2/9 (fork 4, valg A "handling + én knap"):** anatomi = stroke-ikon 22-26 px `--text-3` · titel er en HANDLING i bydeform ("Byd på din første rytter") · én sætning med et konkret faktum ("Auktionerne lukker hver aften kl. 20.") · én sekundær sm-knap der fører derhen. Aldrig beskrivende titel ("Ingen aktive auktioner"), aldrig kun et link. De ~15 tomme tilstande skrives om i én tone-runde med ejeren (EN først, DA under).
- **Spørgsmål:** Er hver tom tilstand en handlings-sætning med én knap der fører derhen?

### P7 · Ikoner er streger, aldrig tegn

Vi har ét stroke-ikonsæt (16/20/24 px). Emoji, unicode-pile (→ ← ↔ ↑ ↓), tekst-glyffer (✓ ✕ ✦ ▲ ▼) og "ⓘ" er ikke ikoner. De arver linjehøjde, rammer ikke baseline, kan ikke farves konsistent og ser forskellige ud på hver platform. Det er detaljen der adskiller "pænt" fra "professionelt".

- **Forkert i dag:** `dashboard-desktop-light.png`: "Fuld rangliste → ›" har både en tekst-pil OG et rigtigt chevron-ikon. "← Forrige / Næste →" i pagination. "↔ Sæt til salg" i rytterprofilens knap. 559 forekomster i 153 filer (25/7).
- **Rigtigt i dag:** `SectionAction`-primitiven med `chevron-right 13px`. Findes, bruges bare ikke overalt.
- **Spørgsmål:** Er der nul emoji, nul unicode-pile og nul tekst-glyffer brugt som UI-chrome?

### P8 · Ét sprog for status og prioritet

Vi har fire måder at sige "vigtigt": guld-knap, `StatusBadge`, tælle-pille, guld-keyline. Fire er nok. Hver ny måde (farvet bjælke, fed baggrund, udråbstegn, blinkende prik) udvander de fire. Status-flader har ÉN opskrift (`bg-cz-{status}-bg`, 8 % alpha), og succes/fare/advarsel bruges kun når noget faktisk er godt/farligt/kræver handling.

- **Forkert i dag:** `riders-desktop-light.png` viser "U25" i blå pille og "AUK" i en anden blå pille med anden form; type-badges ("Sprinter", "Bjergrytter / Etapeløbsrytter") i en tredje stil. Tre pille-sprog i én række.
- **Rigtigt i dag:** `standings-desktop-light.png`: zone-forklaringen bruger tre små farvede kvadrater (guld/grøn/rød) og den samme farve i rækkerne. Ét sprog.
- **Spørgsmål:** Bruger siden kun de fire prioritetssignaler, og har alle piller/badges på siden samme anatomi?

### P9 · Kort på fladen, manualer i Hjælp

En sætning på fladen, resten bag et Hjælp-link (ejer 20/8, #4025). Introtekster over tabeller, tre forklarings-kort over træningen, "Sådan virker udbrudsjægeren"-afsnit under holdudtagelsen: alt det er manual, og manualen bor i `help.json`. Det spilleren skal vide for at handle står som ét ord i en label eller en tooltip.

- **Forkert i dag:** `transfers-desktop-light.png`: to linjer introtekst mellem faner og filter. `race-detail-desktop-dark.png`: fire linjer prosa under holdudtagelsen ("Sådan virker udbrudsjægeren…"). `training-desktop-light.png`: tre forklarings-kort før første rytter (410 px).
- **Spørgsmål:** Er al tekst på fladen enten en label, en værdi, en handlings-sætning eller én linje kontekst, og bor alt længere i Hjælp?

### P10 · Mobil er det samme spil, ikke et resumé

41 WAU og 8 DAU betyder at hver mobil-session tæller. Mobil-skærmen skal vise de samme tal som desktop, bare i en anden geometri: navnekolonne pinned, numeriske kolonner scroller vandret under den, filterbar kollapset til søg + to halve selects. Den må ikke skjule det man sammenligner ryttere på.

- **Forkert i dag:** `riders-mobile-light.png`: værdi, løn, alder, evner er væk. Ingen vandret scroll. Spilleren kan ikke gøre det siden er til.
- **Rigtigt i dag:** `standings-mobile-light.png` og `rider-profile-mobile-light.png`: samme data, stablet.
- **Ejer-retning 2/9 (fork 6, valg A "pinned navn + vandret scroll"):** navnekolonnen står fast (min ~148 px, navn 13 px/500 + `text-3xs`-meta), talkolonnerne scroller vandret under den, samme kolonner og sortering som desktop, filterbar kollapset til søg + to halve selects. Bygges én gang i `DataTable` og gælder alle T2-sider. Kort-pr.-rytter (variant B) afvist som standard.
- **Spørgsmål:** Kan spilleren udføre sidens primære handling og se sidens primære tal på 375 px uden at tabe kolonner?

### P11 · Ingenting opdigtet

Ingen falske tal, ingen mock-ryttere, ingen "Coming soon" som fejl-fallback, ingen tomme tabeller med kolonner der venter på data der ikke findes, ingen løfter i help-tekster om features der ikke er bygget. En flade der ikke har data siger det ærligt med en tom tilstand (P6). Ægte cykel-fluency med konkrete tal er den troværdighed AI-slop ikke kan efterligne (TONE_OF_VOICE, Voice DNA).

- **Forkert i dag:** `help.json` lover "your club's Senior/U23/Junior squad structure" før den findes (rettes i #4618). `rider-profile-desktop-light.png` viser en tankestreg for rating og "Evner endnu ikke beregnet" uden at sige hvorfor eller hvornår.
- **Spørgsmål:** Er hvert tal, hver liste og hver løfte på siden bakket af noget der findes i databasen nu?

---

## 2. Genre-referencer: hvad de gør bedre, hvad vi ikke vil

| Reference | Det de gør bedre end os (lær) | Det vi IKKE vil have (undgå) |
|---|---|---|
| **Football Manager** (SI Games) | Data over folden: 20 spillere pr. skærm. Attribut-farveskala som ét sprog. Form som 10-kamps-kurve, ikke ét tal. Kolonnesortering er den eneste sortering. Skærmen er et gitter, ikke en stak af kort | Mørk "skin"-æstetik med gradient-flader. Informations-overload uden hierarki (alt er lige vigtigt). Faner i faner i faner. Ikon-overflod |
| **Hattrick** | Alt på én skærm uden scroll. Langvarig verden (20 år) hvor historik er indhold. Tabeller der er tætte fordi rækkerne er små og ens. Ærlig "webside"-følelse: hurtig, ingen animationer | 2005-æstetik: tekstvægge, ikon-sprites, GIF-flag, tre farver pr. tabel. Forumtonen inde i produktet |
| **OOTP Baseball** | Rapportering som spil: almanak, karrierestatistik, "hvad skete der i år 7". Tal som fortælling. Tabeller der kan alt | Windows-95-dialogbokse. Gråt på gråt. Ingen redaktionel prioritet, alt er en tabel |
| **Pro Cycling Manager** (Cyanide) | Cykel-korrekthed: etapeprofiler, klassementer, trøjer, tidsgab som førsteklasses data. Genren ved hvad en køreplan er | Gaming-glow, 3D-render, esports-udtryk, italic-som-stil (BRAND_BRIEF anti-reference). "Spil-UI" i stedet for "manager-UI" |
| **procyclingstats.com** | Tidsgab, stigningsprocenter og resultater i kompromisløs tæthed. En resultatliste er en resultatliste | Ingen typografisk omsorg, ingen tomme tilstande, ingen mobil |
| **L'Équipe / avis-sportssider** | Hairlines, luft, ét stort ord, resten tæt. Resultatlisten som redaktionel form | Reklamer, billeder som fyld |
| **Whoop / Linear** (uden for genren, BRAND_BRIEF §9) | Restraint. Én accentfarve. Typografi der gør arbejdet. Ingen effekter der dater | Tomme "premium"-flader uden data. SaaS-generik |

Kort: **vi vil have FM's tæthed og datadisciplin, Hattricks alt-på-én-skærm, OOTP's historik, PCM's cykel-korrekthed, og L'Équipes redaktionelle ro.** Vi vil ikke have nogen af deres æstetiske arv.

**Ankeret når to principper trækker hver sin vej (ejer 2/9): Football Manager.** Trækker tæthed og ro i hver sin retning, vinder tætheden; roen skal komme fra typografi, hairlines og guld-rationering, ikke fra færre rækker. Auditten dømmer efter det.

---

## 3. Forbudslisten

Alt her er et fund uden diskussion. Kolonnen "sådan opdages det" er input til CI-vagterne i slice 4 (#4626); det der kan greppes SKAL greppes.

| Forbudt | Hvorfor | Sådan opdages det |
|---|---|---|
| Gradienter (baggrund, tekst, knapper) | Dater, skjuler data, BRAND_BRIEF §7.5 | grep `gradient` i JSX/CSS uden for `index.css`-tokens |
| Skygger (undtagen modal/popover-overlay) | Kort er hairlines, ikke svævende plader | grep `shadow-` og `box-shadow` uden for `Modal`/`Popover`/`Toast` |
| `rounded-2xl`, `rounded-xl`, `rounded-lg`, `rounded-md`, `rounded-[Npx]` | ÉN radius (5 px `rounded-cz`) + pill. Radius-drift var audit 23/7's største synder | grep `rounded-(2xl|xl|lg|md|\[)` |
| Emoji som UI | Stroke-ikoner kun | regex på emoji-ranges i JSX og locale-nøgler der er UI-chrome |
| Unicode-pile som ikoner (→ ← ↔ ↑ ↓ › «) | P7 | grep i JSX-tekst og locale-værdier; indholds-pile ("A → B" i en forklaring) whitelistes eksplicit |
| Tekst-glyffer som ikoner (✓ ✕ ✦ ▲ ▼ ○ ⓘ) | P7 | grep |
| Glow (`shadow-[0_0_...]`, `drop-shadow`, `blur`) og `backdrop-blur` | AI-Tailwind-tell nr. 1 | grep |
| Rå hex-farver i JSX | Alt går gennem tokens (vi er på 0 i sider, hold det) | grep `#[0-9a-fA-F]{3,8}` i `src/pages` og `src/components` uden for `index.css`, brand-SVG og chart-paletter |
| `text-[Npx]` under 12 px | Kun `text-2xs` (11) og `text-3xs` (10) | grep `text-\[(0?[0-9]|1[01])(\.\d+)?px\]` |
| To guld-primære pr. view | Guld er rationeret | visuel dom + `Button variant="primary"`-tælling pr. side i audit |
| Venstre-accent-bjælker, farvede top-bjælker ud over T3-keylinen | Femte prioritetssignal | grep `border-l-[234]`/`border-l-cz-accent` |
| Title Case i dansk og engelsk UI | Sentence case altid | tone-script over locale-nøgler for overskrifter |
| Em-dash i spillervendt tekst | TONE_OF_VOICE §Punktuation; `tone-check-em-dash.mjs` fejler allerede build | eksisterende vagt |
| Opdigtet indhold: falske tal, mock-navne i prod-UI, "Coming soon" som fejl-fallback, help-tekst om ubyggede features | P11 | audit + `[PLACEHOLDER]`-regel i design-briefs |
| "Free forever" | Misvisende; Pro findes | grep locale |
| Spinner inde i kort | Skeleton-linjer kun | grep `Spinner` uden for `PageLoader` |
| Centreret-alt hero, ens-kort-grids, "feature-tiles" med ikon + overskrift + sætning | AI-landing-tells | visuel dom |
| Data-slop: samme tal tre steder, tal uden enhed, procent uden nævner, tankestreg som værdi uden forklaring, tre decimaler hvor én rækker | P2/P11 | visuel dom i audit |
| Introtekst mellem sidehoved og indhold, forklarings-kort før data | P1/P9 | visuel dom; "chrome før data"-måling i px |
| Løsrevne knaprækker under sidehovedet | PAGE_TEMPLATES "no orphan action rows" | visuel dom |

---

## 4. Dommer-tjeklisten: ja/nej pr. side

Bruges i slice 2 på hver af de 63 sider, i lys, mørk og mobil. **Hvert "nej" er ét fund.** Auditten noterer det værste fund pr. side og sorterer siderne efter spillertrafik. Svar kun ja hvis du kan pege på det på skærmbilledet.

**Struktur**
1. Følger siden én af T1/T2/T3 uden egne opfindelser (sidehoved, bredde, padding, radius)? (PAGE_TEMPLATES)
2. Står sidens primære data over folden på 1280×900, med under 250 px chrome før første datarække? (P1)
3. Overholder siden fold-disciplinen: sidehoved + faner + højst 2 kort før 1000 px? (PAGE_TEMPLATES)
4. Er der ingen løsrevne knaprækker og ingen introtekst mellem sidehoved og indhold? (P1, P9)

**Data**
5. Bruger siden mindst ét ægte cykel-data-element som billede, hvor det giver mening (profil, tidsgab, trøje, kurve)? (P2)
6. Er alle tal tabulære, højrestillede i tabeller, med enhed, og vises intet tal to gange? (P5, P11)
7. Er alt indhold bakket af data der findes nu (ingen mock, ingen løfter, ingen "Coming soon" som fallback)? (P11)

**Chrome**
8. Er der præcis ét guld-primært element (plus ledermarkører) på skærmen? (P3)
9. Er der nul skygger, gradienter, glow, bjælker og off-token radier? (P3, §3)
10. Er alle ikoner stroke-ikoner, uden emoji, unicode-pile eller tekst-glyffer? (P7)
11. Har alle piller/badges på siden samme anatomi, og bruges kun de fire prioritetssignaler? (P8)
12. Optræder Bebas kun i hero-navnet/-titlen? (P4)

**Copy**
13. Er hver tom tilstand en handlings-sætning med én knap? (P6)
14. Er al tekst på fladen label, værdi, handling eller én linje kontekst, sentence case, uden em-dash, EN først? (P9, TONE)

**Mobil og mørk**
15. Viser 375 px-udgaven sidens primære tal og handling uden at tabe kolonner, med 16 px sidepadding? (P10)
16. Holder mørk tilstand samme hierarki (ingen flader der forsvinder, ingen guld-tekst der ikke er `--accent-t`-ækvivalent)? (GUIDELINES §2)

**Bonus-spørgsmålet der afgør verdensklasse**
17. Ville en Football Manager-spiller der ser siden i 5 sekunder tro at den var lavet af nogen der elsker cykelsport? Hvis nej: hvad mangler? Skriv det som fundet.

**Score (ejer-bekræftet 2/9):** 17/17 = verdensklasse-kandidat. 14-16 = på system, mangler smag. Under 14 = skal have en runde. Spørgsmål 2, 7, 8 og 13 vejer dobbelt, fordi de rammer det spillerne mærker først. Auditten rangerer sider efter (manglende point × spillertrafik), så den mest sete side med det største hul står øverst.

---

## 5. Sådan bruges dokumentet

- **Slice 2 (audit #4624):** screenshot af hver side i lys/mørk/mobil, tjeklisten besvares, ét fund pr. side, sorteret efter spillertrafik. Fund der gentager sig på 3+ sider er kit-fund (slice 3), ikke side-fund.
- **Slice 3 (kit #4625):** tilbagevendende fund løses i `components/ui`, så de ikke kan opstå igen. Eksempel: `DataTable` med vandret scroll på mobil løser P10 for alle T2-sider på én gang.
- **Slice 4 (CI #4626):** kolonnen "sådan opdages det" i §3 er specifikationen. Det der kan greppes skal fejle et build.
- **Slice 5 (spejl #4627):** §0-§3 kopieres som readme-afsnit i Claude Design-projektet `a332ec00`, så design-agenten tegner mod samme smag.
- **Nye sider og design-briefs:** briefen citerer P1-P11 og tjeklisten. Et design-go skal kunne svare ja på spørgsmål 1-4 før der tegnes videre.
- **Ejeren har sidste ord.** Dette dokument gør smag til en gate. Det erstatter ikke ejerens blik; det gør at vi fanger 90 % før han skal bruge det.

---

## 6. Ejer-beslutninger 2/9 (visuel dialog, genåbn dem ikke)

Otte forks blev vist som mockup-varianter (A/B/C) og afgjort af ejeren 2/9 2026. De står her som SSOT; principperne ovenfor citerer dem.

| # | Fork | Valg | Konsekvens |
|---|---|---|---|
| 1 | Tæthed på T2-datasider | **B · FM-tæt** (filterlinje + "Flere filtre" lukket, `dense`-rækker, 8-10 rækker over folden) | **Indføres først når ejeren har godkendt det visuelt på den ægte side**, side for side. Auditten flagger, ejeren giver go |
| 2 | Bebas Neue | **A · kun hero-navnet** | Kort-titler forbliver 15/600; ingen Bebas på tal |
| 3 | Guld | **B · som i dag** (én knap, leder-markører, guld-tekst på quiet actions og aktiv fane, keyline kun T3) | Guld-tal, guld-tints og keyline på almindelige kort er fund |
| 4 | Tomme flader | **A · handling + én knap** | ~15 tomme tilstande skrives om i én tone-runde (EN først) |
| 5 | Dataviz | **A · monokrom streg + slutpunkt** | Én `Sparkline`-primitiv; farve kun i deltaet; søjler kun som supplement til diskrete værdier |
| 6 | Mobil-tabel | **A · pinned navn + vandret scroll** | Bygges én gang i `DataTable`; gælder alle T2-sider |
| 7 | Genre-anker ved konflikt | **Football Manager** | Tæthed vinder over ro; roen kommer fra typografi |
| 8 | Tjeklistens strenghed | **Som skrevet** (17 spørgsmål, tre bånd, fire vejer dobbelt) | Fund = hvert nej; rangering = manglende point × trafik |

## 7. Kilder

`ELEVATION_2849.md` (25/7, de syv løft) · `PAGE_TEMPLATES.md` (23/7, bindende) · `../audits/design-composition-audit-2026-07-23.md` (52 sider, F1-F10) · `../brand/BRAND_BRIEF.md` (§3 personlighed, §4 anti-patterns, §9 inspiration) · `../brand/GUIDELINES.md` (marks, kontrast) · `../TONE_OF_VOICE.md` · `README.md` (Claude Design-spejlet, drift-punkter) · memory `feedback_anti_ai_slop_design_taste` (#672, 14/6) · #481 (brand) · #2849 (lukket, bølge 0-6) · #4622 (epic).
