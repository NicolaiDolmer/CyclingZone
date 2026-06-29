# Rytter-side rework — UI/UX-spec (SSOT)

> **Formål:** Samlet, durabel kilde til ALLE UI/UX-krav, -beslutninger og -referencer for rytter-side-rework'et (EPIC [#2000](https://github.com/NicolaiDolmer/CyclingZone/issues/2000)). En ny session skal kunne læse DENNE fil + de linkede issues og samle arbejdet op uden at miste kontekst. Skrevet 2026-06-29 (ejer-session). Inspiration: ejerens Claude Design-wireframes (`wireframes/`) + Football Manager + Virtual Manager. **Ikke slavisk kopi — markant bedre, cykel-native, verdensklasse-managerspil.**

## Vision: de 4 spørgsmål en rytter-side skal besvare
En verdensklasse-rytter-side besvarer på 3 sekunder øverst, og i dybden nedenunder:
1. **Hvem er han?** (identitet, historie)
2. **Hvad kan han — og hvor vinder han?** (abilities → terræn)
3. **Hvad bliver han?** (udvikling/potentiale — afgørende for unge)
4. **Hvad er han værd for MIG nu?** (værdi, kontrakt, start/sælg/forlæng)

Princip: smelt alle fire sammen til én **beslutningsflade** (action-first — managere logger ind for at *gøre* noget), ikke en stat-liste.

## Æstetik (ufravigelig)
Editorial, høj datatæthed, ægte cykel-data, ægte flag, Bebas-display-overskrifter. **0 AI-slop:** ingen rounded-2xl/glow/gradient-blobs/emoji-ikoner. Kun cz-design-tokens (ingen rå hex — `ui-anti-drift`-gaten håndhæver det). Player-facing copy: EN først, DA under; ingen em-dash (`tone-em-dash`-gaten). Se også memory `feedback_anti_ai_slop_design_taste`.

---

## Krav + beslutninger pr. område

### 1. Abilities (evne-visning)
- **Kun det nye 1-99-afledte evnesystem** (`rider_derived_abilities` via [`frontend/src/lib/abilities.js`](../../../frontend/src/lib/abilities.js)). **PCM `stat_*` BANDLYST fra al brugervendt visning** (lever kun som derive-kilde under motorhjelmen; permanent retirement-plan findes).
- **Grupperet i 3 kategorier** (defineret i `abilities.js` `ABILITY_CATEGORIES`), i denne rækkefølge, med ejer-bekræftet intern rækkefølge:
  - **Physical (10):** Climbing, Tempo, Punch, Sprint, Acceleration, Flat, Time trial, Endurance, Durability, Recovery. *(Logik: climbing-trio → eksplosiv finish → flad kraft → motor.)*
  - **Mental (2):** Aggression, Tactics.
  - **Technical (3):** Descending, Cobblestone, Positioning.
- **Baren = træningsprogress til næste +1** (`ability_progress` jsonb, 0..1 pr. evne) — **IKKE evnens størrelse**. Tallet bærer størrelsen (1-99); baren bærer fremgang. Synlig for ALLE managers. (Skiftet fra magnitude-bar leveret i Slice 1 #2003.)
- Ikon foran hver evne (`ABILITY_ICONS`).
- **Ensartethed (ejer-direktiv):** evne-rækkefølgen SKAL være identisk ALLE steder evner vises (lister, holdudtagelse, marked, hover, sammenlign). Forbrug `ABILITY_KEYS`/`ABILITY_CATEGORIES` — ingen lokal rækkefølge. Audit-issue: [#2002](https://github.com/NicolaiDolmer/CyclingZone/issues/2002).

### 2. Overall 1-99 rating ("Vurdering")
- **Ét absolut tal (V1)** for hvor god en rytter er på tværs af typer. **V2 (per-type relativ) FORKASTET** af ejer (hver types top=99 føltes forkert/vildledende).
- **Formel:** `O_best = 0.5·speciale_output(primary_type) + 0.5·mean(15 evner)`, α=0,5 (samme som værdimodellen → rating ↔ market_value konsistent). Genbruger `riderValuation.js`-logik. SSOT: [`frontend/src/lib/riderRating.js`](../../../frontend/src/lib/riderRating.js) `riderOverallRating()`.
- **Anker:** elite=99 ved **p99.5** af O_best (stabilt, IKKE populations-max). `O_ELITE≈67.4`, `O_MIN≈2.04`. Tunbar knap.
- **Bedste type = rytterens LAGREDE `primary_type`** (samme model som den viste primær/sekundær type — ejer-direktiv om ensartethed).
- **"Bedst i rolle" = KONTEKST, ikke et 2. tal.** Vis rating + type + evt. rang-i-type ("#3 af 312 sprintere"). Aldrig to konkurrerende overall-tal (FM-modellen: én CA + rolle som separat dimension).
- **Vises:** Vurdering-cirkel på rytter-side-header (farvet) + sorterbar rating-kolonne i lister/rangliste + hover-kort + sammenlign. (Leveret: cirkel + rangliste-kolonne, Slice 2 #2006/#2013. Resten: follow-up.)

### 3. Hover mini-profil (FM-stil)
- **Større, FM-agtig** mini-profil der popper op ved hover over rytternavn/billede **OVERALT** (lister, holdudtagelse, marked, løbsresultater) — ÉN genbrugskomponent.
- Indhold: foto-plads, identitet (navn/flag/type/alder/U23), overall-rating + potentiale, **alle 15 evner i P/M/T-kolonner**, "where he wins", "klik for fuld profil". Se mockup `mockups/` + wireframe `wireframes/rider-page-hi-fi.html`. Issue: [#2009](https://github.com/NicolaiDolmer/CyclingZone/issues/2009).

### 4. Handlinger (action-first)
- **Egen rytter:** forlæng kontrakt · frigiv (fyr) · op/ned akademi · start auktion · sæt på transferliste. (Endpoints findes: release, academyTransfer, auctions, transfer_listings.)
- **Anden managers / AI-rytter:** byd · start auktion (AI) — som i dag.
- Issue: [#2007](https://github.com/NicolaiDolmer/CyclingZone/issues/2007).

### 5. Potentiale
- Vist på EGEN rytter: dossier-KPI + Development-fane (projiceret loft på livstidskurven) + loft pr. evne (`ability_caps`) + hover-kort. Data: `hidden_potential` + `ability_caps` (populeret, #2001/#2004).
- Andres ryttere: **fuzzy/scoutet interval — kommer med talentspejder-feature (senere).** Nu: progress synlig for alle, potentiale præcist kun på egne.

### 6. Ryttertype-system
- Type udledes fra evner (`riderTypes.js`, z-score + kontrast + guards). 8 typer: sprinter, tt, climber, puncheur, brostensrytter, baroudeur, rouleur, gc.
- **Kendt problem (#1378, prioriteret senest 30/6):** klassifikatoren over-tildeler `tt` til en svag/udifferentieret hale (45%). **Rod-årsag:** 88% af populationen har INTET reelt speciale (peak-evne <55). Simuleret + afvist: drop-kontrast (dobler tt), per-type-std (flytter catch-all til sprinter+baroudeur), positiv-fit. **Behold:** z-normalisering + type-vægte + guards + kontrast.
- **Anbefalet løsning ([#2014](https://github.com/NicolaiDolmer/CyclingZone/issues/2014)):** FM-agtig **"utypet / udvikler sig endnu"-tilstand** for ryttere uden reelt speciale (ikke tving en specialist-etiket). Binder til udviklings-slicen. Kræver simulering + scorecard før ship.
- **Ensartethed:** rating-"bedste type" OG vist primær/sekundær type = SAMME model.

### 7. Faner (VM-ånd)
Overblik / Stats (abilities) / **Development/Træning** (XP-kurve + livstidsudvikling + projiceret loft — #2008, datalag #2012 leveret) / **History** (palmarès m. hold-attribution #1993-snapshot) / **Results** / **Interesse** (hvem byder/er interesseret — VM-stil). Issues: Slice 4 #2008, Slice 6 #2010.

### 8. Rytterbillede
Plads til foto — laves på sigt (ejer: senere).

---

## Beslutnings-log (med begrundelse)
| Beslutning | Valg | Hvorfor |
|---|---|---|
| Evne-system | Kun afledt 1-99, PCM bandlyst fra visning | Ejer-direktiv; PCM udfases |
| Evne-bar | Træningsprogress, ikke magnitude | Ejer-ønske; matcher VM |
| P/M/T-rækkefølge | Climbing,Tempo,Punch,Sprint,Acc,Flat,TT,End,Dur,Rec / Aggr,Tac / Desc,Cob,Pos | Ejer-bekræftet, grupperet efter brug |
| Overall-rating | V1 absolut (ikke V2, ikke begge) | Ét tal der betyder det samme overalt; V2 vildledte |
| Rating-formel | O_best, α=0,5, anker p99.5 | Konsistent med værdimodel; stabilt anker |
| Bedste type | Lagret primary_type (samme model som display) | Ensartethed |
| z-kontrast | BEHOLD (drop kun ved utypet-tilstand) | Sim viste kontrast er bremsen på tt |
| Type-hale-fix | Utypet/udvikler-sig-tilstand (#2014) | Sim afviste alle score-tweaks; 88% har intet speciale |
| Potentiale-synlighed | Egne præcist; andres fuzzy senere (talentspejdere) | Scouting-dybde |

## Referencer
- **Wireframes (ejerens, Claude Design):** [`wireframes/cyclingzone-wireframes.html`](wireframes/cyclingzone-wireframes.html) (struktur-udforskning), [`wireframes/rider-page-hi-fi.html`](wireframes/rider-page-hi-fi.html) (2 retninger: A sticky dossier, B editorial hero), [`wireframes/rider-detail-a.html`](wireframes/rider-detail-a.html). Original Claude Design-projekt: `c231b6a1-8397-4a6f-bf6d-2bbcae14211a`.
- **Mockups (session 29/6):** beskrevet i `mockups/README.md` — palmarès, abilities-v2 (P/M/T + progress), FM-hover-profil, V1-i-kontekst, før/efter-bar, ét-tal-vs-to-scores. Bygget med Ayoub Cherifs ægte data.

## Issue-kort
EPIC [#2000](https://github.com/NicolaiDolmer/CyclingZone/issues/2000) · Slice 1 #2003 ✅ · Slice 2 rating #2006/#2013 ✅ · Slice 3 handlinger #2007 · Slice 4 Development #2008 (datalag #2012 ✅) · Slice 5 hover #2009 · Slice 6 History/Interesse #2010 · Konsistens #2002 · Type-kalibrering #1378 + utypet #2014 (senest 30/6) · Fundament #1993/#1998 ✅ · Datagap #2001/#2004 ✅.

## Status (29/6)
**Live:** fundament (hold-attribution), Slice 1 (P/M/T + progress-barer), Slice 2 (overall-rating). **Næste:** Slice 3 handlinger (#2007, anbefalet) eller Slice 5 hover (#2009). **Prioriteret:** #1378/#2014 utypet-tilstand senest 30/6.
