# Claude Design-brief: Akademiet, Junior team, U23 team, Graduation Day, rytterens rejse

> Til brug i claude.ai/design. Ejer-beslutninger 2/9 2026, regler i [`docs/YOUTH_RULES.md`](../../YOUTH_RULES.md), spec i
> [`docs/superpowers/specs/2026-09-02-akademi-tre-trupper-design.md`](../../superpowers/specs/2026-09-02-akademi-tre-trupper-design.md).
> Handoff-eksport fra Claude Design gemmes i denne mappe (`docs/design/youth-tiers/`). Slet aldrig design-planer.

## 1. Sådan bruger du briefen

1. Opret et nyt design-projekt i claude.ai/design. Vedhæft repoet via GitHub-connectoren (eller upload filerne under §2).
2. Kopiér prompten i §6 ind som første besked. Den er skrevet til at Claude Design læser koden først og tegner bagefter.
3. Lad Claude Design lave 2-3 lavfidelitets-retninger pr. skærm først. Vælg. Derefter hi-fi.
4. Eksportér "design handoff" til denne mappe når du er tilfreds. Slice 0 (kommer snart) bygges herfra.

## 2. Filer Claude Design SKAL læse før den tegner

| Fil | Hvorfor |
|---|---|
| `docs/design/PAGE_TEMPLATES.md` | Bindende sideskabeloner T1/T2/T3, sidehoved, kort, tabel, tilstande, fold-disciplin, hard don'ts |
| `docs/design/design_handoff_page_templates/Manager Page Templates (standalone).html` | Artboards for de tre skabeloner, pixel-reference |
| `frontend/src/index.css` (linje 110-200) | Tokens: farver, radius, motion, sidebar, status, jersey-farver |
| `frontend/tailwind.config.js` (fontFamily) | DM Sans (brødtekst), Inter Tight (`font-data`, tal og labels), Bebas Neue (display, navne) |
| `frontend/src/pages/AcademyPage.jsx` | Dagens Akademi-side: T2, header med saldo + pladser, Graduating riders, Intake candidates, Academy roster (DataTable), regnskab |
| `frontend/public/locales/en/academy.json` | Dagens EN-copy (title, subtitle, knapper, tabelkolonner, tomme tilstande) |
| `frontend/src/components/klub/FacilityTrackCard.jsx` | "Coming soon"-pillen som mønster |
| `frontend/src/pages/TrainingPage.jsx` | Tre-fane-struktur med roster øverst (#3721), reference for fold-disciplin |
| `frontend/src/components/rider/profile/` | Rytterprofilen (T3): hero-kort, faner, hvor rejse-blokken skal bo |
| `docs/YOUTH_RULES.md` | Reglerne: navne, aldersloft, flyt, ungdomsløb, kommer snart |

## 3. Bindende designregler (kort udgave, fuld tekst i PAGE_TEMPLATES)

- **Tokens (lys tilstand, Chalk):** `--bg-body #f4f2ec` · `--bg-card #fcfbf7` · `--bg-elevated #ffffff` · `--bg-subtle #ece9e1` · `--border #e5e0d5` · `--text-1 #0e0f15` · `--text-2 #66637a` · `--text-3 #9896b0` · `--accent rgb(232 197 71)` (guld, kun fyld og markører) · `--accent-t #a07800` (guld som tekst på lys) · `--on-accent #1a1f38` · sidebar `#1a1f38` · `--success #15772f` · `--danger #a81e1e` · `--warning #9a5b00` · `--info #1a47c0`; status-baggrunde = farven i 8 % alpha.
- **Radius:** 5 px overalt (`rounded-cz`). Piller 9999 px. Ingen skygger (kun modal-overlay). Ingen gradienter. Ingen emoji, kun stroke-ikoner (16/20/24 px).
- **Typografi:** sidetitel Inter Tight 20/700, undertitel 13 `--text-2`; korttitel 15/600; meta-labels `text-2xs` 11 px uppercase tracking .08em `--text-3`; `text-3xs` 10 px til stat-labels og piller; intet under 10 px. Tal altid `font-data` + tabular. Navne i hero: Bebas Neue 40, caps.
- **Sidehoved:** ÉN opskrift: titel + undertitel venstre, action-cluster højre = enten ét Select + én guld-knap, eller op til to stille sekundære. Én guld-knap pr. view. Ingen løse kontrolrækker under headeren.
- **Kort:** 1 px hairline, 20 px padding (16 mobil), header med titel + ENTEN quiet action (12/500 `--accent-t`, chevron) ELLER uppercase meta-label. Kort stables med 14 px gap.
- **Tabeller (T2):** header-celler `text-2xs` uppercase, rækker 13 px, første kolonne sticky med navn + `text-3xs` subline, tal højrestillet, række-knapper sekundære (aldrig guld). Zone-tints (op/nedrykning): fuld række `--success-bg`/`--danger-bg` + 2 px separator + zone-pille.
- **Tilstande:** loading = skeleton-linjer (aldrig spinner i kort), empty = stiplet inset + ikon + titel + ÉN sætning + ÉN sm-handling, error = samme anatomi, retry sekundær.
- **Fold-disciplin:** sidehoved + faner + maks 2 kort før 1000 px. Nyt indhold bor helst i et eksisterende element, dernæst bag en fold, dernæst i en fane. Nyt stablet kort er aldrig default.
- **Mobil ≤ 640 px:** 16 px sidepadding, navnekolonne pinned, numeriske kolonner scroller vandret, filterbar kollapser til søg + to halve selects. Ingen falsk statusbar.
- **Copy:** EN først (DA under i handoff-noten), sentence case, ingen em-dash, kort på fladen, forklaringer bag hjælp-link. Aldrig "free forever". Aldrig opdigtede tal der ligner ægte data uden [PLACEHOLDER]-markering.

## 4. De fire skærme (desktop 1280 + mobil 375 pr. skærm)

### S1 · Academy (T2 wide, den vigtigste)

**Hvad den er:** klubbens ungdomsafdeling som paraply. Erstatter dagens Akademi-side, samme rute.

**Skal indeholde:**
- Header: title "Academy", subtitle (én linje, fx "Your junior and U23 squads, intake and promotions."), action-cluster: saldo + pladser som stille tekst ("Junior 6/10 · U23 9/12"), ingen guld-knap i headeren (siden har ingen primær handling).
- **Graduation Day-banner** øverst KUN når der er ryttere der skal flyttes (link til S3). Ellers ikke synlig.
- **Intake candidates** (som i dag): kort pr. kandidat: navn, nation, alder, type, scout-bånd for potentiale (aldrig et tal), signing fee, frist-pille, Sign / Reject. Tom tilstand: "No candidates on offer. New candidates arrive every Sunday."
- **Junior team** (16-18): DataTable (nation, rider, age, type, potential band, value, salary, contract, action). 16-årige får subline "Eligible from 17". Række-handling: "Move up" (til U23) som sekundær; "Sell"/"Release" i overflow. Kort-header meta: "6 / 10 places".
- **U23 team** (19-22): samme tabel. Række-handling: "Move up" (til Senior) og "Move down" (til Junior, kun hvis alder ≤ 18, ellers disabled med tooltip). Kort-header meta: "9 / 12 places".
- **Senior team:** ingen tabel her. Én linje/quiet action "Senior team → Riders" (seniorer bor på Riders-siden).
- Under trupperne, bag fold: "Class of S3" (årgangs-linje: hvor mange fra kuldet der stadig er i klubben, realiseret udvikling; aldrig potentiale-rangering) og "Academy accounts" (P&L som i dag).
- Fold-disciplin: Intake + Junior team er de to kort over folden; U23 team følger under (det er en tabel-side, spilleren scroller til trupper som på Riders).

**Variant S1b · "Coming soon" (bygges FØRST, slice 0):** dagens side som den er (Intake candidates, Academy roster, regnskab) + ét ekstra kort "Youth squads" under roster-kortet: to rækker, Junior team og U23 team, hver med pillen "Coming soon", én sætning ("Ages 16-18. Own races and standings." / "Ages 19-22. Own races, divisions and promotion.") og kortets quiet action "Roadmap". Ingen tomme tabeller, ingen falske tal.

### S2 · Youth races and standings (T2 wide)

**Hvad den er:** U23- og juniorholdets løb, resultater og pyramide. Én side med et Select i headeren: "U23 team / Junior team".

**Skal indeholde:**
- Header: title "Youth races", subtitle (division og gruppe for valgt trup, fx "U23 · Division 2 · Group B"), action-cluster: ét Select (trup) + én guld-knap "Set tactics" (åbner Planning Center for næste løb).
- Faner under headeren: **Calendar** · **Results** · **Standings** · **Rankings**.
- Calendar: liste pr. løbsdag: dato, løbsnavn, klasse, terræn-glyf, udtagelse ("Auto" pille eller "Manual · 6 riders"), status. Række-handling "Select riders" sekundær. Ingen taktik-cockpit her (det er Planning Center).
- Results: seneste løb med top 10, klubbens ryttere fremhævet med `--me-ring` navy.
- Standings: tabel for gruppen med zone-tints (oprykning `--success-bg`, nedrykning `--danger-bg`) og zone-piller "Promotion"/"Relegation". Under tabellen: "Showing 12 teams".
- Rankings: rytter-rangliste pr. trup (points, ikke præmier). Ingen præmiekolonne (der er ingen præmier i v1).
- Tom tilstand for et hold uden junior-trup: "No junior riders yet. Sign a candidate from the intake to enter junior races."

### S3 · Graduation Day (T1 standard, 896 px)

**Hvad den er:** dagen ved sæsonskifte hvor ryttere der er vokset ud af en trup skal flyttes. Nås fra banneret på S1 og fra notifikationen.

**Skal indeholde:**
- Header: title "Graduation Day", subtitle "3 riders have outgrown their squad. Decide before Sunday." Action-cluster: én guld-knap "Confirm all" (udfører de valgte handlinger).
- Ét kort pr. overgang: **From Junior team → U23 team** (ryttere der fylder 19) og **From U23 team → Senior team** (ryttere der fylder 23). Hver række: navn, alder, type, rating-plade, scout-bånd, kontrakt og løn (uændret ved flyt), trænerens vurdering i én sætning (fog-sprog, aldrig "nåede sit loft"), valg som segment: **Move up** (default) · **Sell** · **Release**. Blokeret "Move up" viser hvorfor: "Senior team is full (30/30)" eller "Cannot afford salary".
- Frist-pille "5d to decide" og en linje om standard-adfærden: "If you do nothing, riders move up when there is room, otherwise they are listed for sale."
- Tom tilstand (uden for sæsonskiftet): "Nobody is graduating right now. The next Graduation Day is at the season turn."

### S4 · Rider journey (blok på rytterprofilen, T3)

**Hvad den er:** rytterens vej gennem klubben som en tidslinje. Bor i profilens History-fane (ikke et nyt kort på Overview).

**Skal indeholde:**
- Vandret eller lodret tidslinje med kun ÆGTE hændelser: "Discovered · Class of S3" (intake), "Junior team · S3", "U23 team · S5", "First win · Ronde van Vlaanderen U23 · S6", "Senior team · S8". Tier-skift, første sejr, kontrakt, salg. Ingen potentiale, ingen projektion.
- Mikro-format: datofont `text-3xs` uppercase for sæson, 13.5/500 for hændelsen, hairline mellem punkter. "Developed by [club]" som stille linje nederst når rytteren har skiftet klub.
- Tom tilstand: "This rider joined as a senior. No youth journey recorded."

## 5. Det Claude Design IKKE må

- Opfinde et nyt sidehoved, container-bredde, kort-padding, radius eller typografi-trin.
- Bruge emoji, gradienter, skygger, rounded-2xl, farvede venstreborder på kort, eller Inter/Roboto/Arial.
- Vise potentiale som et tal eller stjerner uden bånd. Vise præmiepenge i ungdomsløb. Vise en fjerde "akademi-trup".
- Tegne falsk iOS-statusbar eller tastatur på mobil-artboards.
- Skrive DA som primærsprog på fladen. EN først; DA i handoff-noten.
- Fylde med data-slop (ekstra stats, ikoner, tal der ikke hjælper en beslutning).

## 6. Prompt til Claude Design (kopiér alt herunder)

```
Du designer wireframes til Cycling Zone, et browser-baseret cykel-managerspil (React + Tailwind). Læs FØRST disse filer i repoet NicolaiDolmer/CyclingZone, og tegn derefter. Du må ikke opfinde egne komponenter: alt skal bygges af de skabeloner, tokens og komponenter der allerede findes.

Læs først:
1. docs/design/PAGE_TEMPLATES.md (bindende sideskabeloner T1/T2/T3, sidehoved, kort, tabel, tilstande, fold-disciplin, hard don'ts)
2. docs/design/design_handoff_page_templates/Manager Page Templates (standalone).html (artboards for skabelonerne)
3. frontend/src/index.css linje 110-200 (tokens) og frontend/tailwind.config.js (fonte: DM Sans brødtekst, Inter Tight tal og labels, Bebas Neue display)
4. frontend/src/pages/AcademyPage.jsx + frontend/public/locales/en/academy.json (dagens Akademi-side og dens copy)
5. frontend/src/components/klub/FacilityTrackCard.jsx ("Coming soon"-pillen)
6. frontend/src/pages/TrainingPage.jsx (tre faner, roster øverst, fold-disciplin i praksis)
7. frontend/src/components/rider/profile/ (rytterprofilen, T3)
8. docs/YOUTH_RULES.md (reglerne for akademi, Junior team, U23 team, flyt, ungdomsløb, kommer snart)
9. docs/design/youth-tiers/CLAUDE_DESIGN_BRIEF.md §3-5 (denne briefs regler og de fire skærme)

Kontekst du skal designe efter (låst af ejeren 2/9 2026):
- Akademiet er klubbens ungdomsafdeling og én side. Under den: Junior team (sæsonalder 16-18, løbsberettiget fra 17) og U23 team (19-22). Senior team (23+, 30-cap) bor på Riders-siden.
- Spilleren flytter selv ryttere. Opad er altid tilladt, nedad kun inden for aldersloftet. Alle ryttere har samme kontrakt, løn, auktion, forlængelse og transfer. Hver besat ungdomsplads koster fast drift pr. sæson.
- Junior og U23 har egne kalendere, egne divisioner/grupper/ranglister med op- og nedrykning, frivillig udtagelse (auto som standard), taktik kan vælges. Ingen præmiepenge i v1.
- Graduation Day ved sæsonskifte: ryttere der fylder 19 skal ud af Junior team, ryttere der fylder 23 skal ud af U23 team. Spilleren vælger Move up / Sell / Release, ellers vælger systemet.
- Potentiale vises ALTID som et scout-bånd, aldrig som et tal.
- Navne: Academy / Junior team / U23 team / Senior team. UI-copy på engelsk, sentence case, ingen em-dash. Dansk kun i handoff-noten.

Lav fire skærme, hver i desktop 1280 px og mobil 375 px, som separate artboards:
S1 Academy (T2 wide). Header "Academy" + undertitel + stille saldo/pladser-tekst. Graduation Day-banner kun når relevant. Kort: Intake candidates (kandidatkort med Sign/Reject, signing fee, frist-pille, scout-bånd), Junior team (DataTable, 16-årige har subline "Eligible from 17", række-handling "Move up"), U23 team (DataTable, "Move up"/"Move down"), én quiet action "Senior team → Riders". Bag fold: "Class of S3"-linje og "Academy accounts". Lav OGSÅ varianten S1b "Coming soon": dagens side plus ét kort "Youth squads" med to rækker (Junior team, U23 team), hver med pillen "Coming soon", én sætning og kortets quiet action "Roadmap". Ingen tomme tabeller, ingen falske tal i S1b.
S2 Youth races (T2 wide). Header "Youth races", undertitel med division/gruppe, action-cluster: ét Select (U23 team / Junior team) + én guld-knap "Set tactics". Faner: Calendar, Results, Standings, Rankings. Standings med zone-tints og zone-piller for oprykning/nedrykning. Ingen præmiekolonne.
S3 Graduation Day (T1, 896 px). Header + "Confirm all" som eneste guld-knap. Ét kort pr. overgang (Junior → U23, U23 → Senior). Pr. rytter: navn, alder, type, rating-plade, scout-bånd, kontrakt/løn (uændret ved flyt), trænerens vurdering i én sætning, segment Move up / Sell / Release, blokeret Move up viser årsagen. Frist-pille og én linje om standard-adfærd. Tom tilstand uden for sæsonskiftet.
S4 Rider journey (blok i rytterprofilens History-fane, T3). Tidslinje med kun ægte hændelser: Discovered · Class of S3, Junior team S3, U23 team S5, First win, Senior team S8. Ingen potentiale eller projektion. Tom tilstand for ryttere der kom som seniorer.

Arbejdsform: Start med 2-3 lavfidelitets-retninger for S1 (kun struktur, gråtoner, placeholder-tekst) så jeg kan vælge. Når jeg har valgt, byg hi-fi for alle fire skærme i den valgte retning med de rigtige tokens. Brug [PLACEHOLDER] hvor du mangler et ægte tal eller navn. Sig i én linje hvad du matchede fra koden (fonte, radius, tokens, kontrolhøjder) før du viser noget.
```

## 7. Efter Claude Design

- Eksportér handoff til `docs/design/youth-tiers/` (mappen findes). Commit som `docs(design): youth-tiers wireframes fra Claude Design`.
- Slice 0 bygges mod S1b. Ejer-visuelt go på screenshots før merge. Slice 1-3 mod S1, S2, S3, S4.
- Ændrer wireframes en regel (fx aldersloft eller navn), rettes `docs/YOUTH_RULES.md` i samme PR. En regel der kun står i en wireframe er en parallel plan.
