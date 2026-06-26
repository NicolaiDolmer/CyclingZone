# Katalog-udvidelse — UDKAST (ejeren retter)

> **Status:** UDKAST. Ingen DB-ændring, intet seed kørt, ikke committet.
> **Mål:** Spejle spil-kataloget (`scripts/race_pool_seed.csv`, 122 løb) mod en ægte UCI-kalender-struktur, men med FIKTIVE løbsnavne i samme stil som de eksisterende.
> **Navnestil-regel:** Fiktive europæiske/internationale navne (fx "De Vlaamse Ronde", "L'Enfer du Nord", "Clásica del Cantábrico", "Hamburger Klassiker", "Tour des Alpes Suisses", "Giro della Penisola"). INGEN ægte UCI-navne. INGEN em-dash i navnene.
> **Sådan retter du:** Hvert foreslået løb står på sin egen linje i tabellerne nedenfor. Ret blot navnet i kolonnen "Foreslået navn"; resten (race_class, type, stages) er forslag du også kan justere.

---

## 1. Gap-tabel — pr. race_class

CSV bruger den menneskelæselige kategori-tekst i kolonne `Kategori` (fx "Other WorldTour A"); enum-key fra `frontend/src/lib/uciRaceClasses.js` er i parentes.

| race_class (enum-key) | CSV-kategori | UCI-kode | Nu: endags | Nu: etape | UCI-mål (endags) | UCI-mål (etape) | Foreslået nye (endags) | Foreslået nye (etape) |
|---|---|---|---|---|---|---|---|---|
| TourFrance | Tour de France | 2.UWT | 0 | 1 | 0 | 1 (komplet) | 0 | 0 |
| GiroVuelta | Giro, Vuelta | 2.UWT | 0 | 2 | 0 | 2 (komplet) | 0 | 0 |
| Monuments | Monuments | 1.UWT | 5 | 0 | 5 (komplet) | 0 | 0 | 0 |
| OtherWorldTourA | Other WorldTour A | 1.UWT / 2.UWT | **0** | 6 | ~6 (de STØRSTE ikke-monument-klassikere) | ~5-6 (OK) | **6 (A)** | 0 |
| OtherWorldTourB | Other WorldTour B | 1.UWT / 2.UWT | 10 | 4 | del af ~18-25 WT-endags | del af ~11-15 WT-etape | 2 (B) | 0 |
| OtherWorldTourC | Other WorldTour C | 1.UWT / 2.UWT | 6 | 2 | del af ~18-25 WT-endags | del af ~11-15 WT-etape | 2 (B) | 1 (B) |
| ProSeries | ProSeries races | 1.Pro / 2.Pro | 35 | 26 | ~40-50 | ~20-25 | 6 (B) | 0 |
| Class1 | Class 1 races | 1.1 / 2.1 | 7 | 5 | mange (Tier 4) | mange (Tier 4) | 8 (C, lav) | 4 (C, lav) |
| Class2 | Class 2 races | 1.2 / 2.2 | 9 | 3 | mange (Tier 4) | mange (Tier 4) | 8 (C, lav) | 4 (C, lav) |
| **I ALT** | | | **72** | **49** | | | **+34 endags** | **+9 etape** |

**Vigtigste observationer:**
- **OtherWorldTourA = 0 endagsløb** er det største hul. UCI har her sine tungeste ikke-monument-klassikere (Strade Bianche-, San Sebastián-, E3-, Gent-Wevelgem-, Amstel Gold-, Flèche Wallonne-typen). Spillet har disse typer liggende i WT-B/C i dag, men ingen i A — så prestige-laget under monumenterne mangler helt. **Prioritet A.**
- WorldTour-etapeløb (2.UWT): 12 i alt (A:6, B:4, C:2) = inden for UCI-målet ~11-15. Ingen nye etapeløb foreslået i WT.
- WorldTour-endagsløb (1.UWT, ekskl. monumenter): 16 i dag (B:10, C:6), mål ~18-25. Efter A-tilføjelsen + lidt finpudsning: 16 + 6 (A) + 4 (B) = 26 → i den høje ende, trim evt. en eller to af de svageste.
- ProSeries: 26 etape + 35 endags. Mål ~20-25 etape (let over) + ~40-50 endags (under). Foreslår KUN +6 endags for at ramme målbåndet; rør ikke etapeløbene.
- Class1/Class2 (Tier 4): TOM i sæson 1 → **lav prioritet (C)**. Kun skitseret så ejeren har et udgangspunkt når Tier 4 aktiveres; en fuld 140-løbsdags-sæson på Tier 4 kræver væsentligt flere end de skitserede 24.

---

## 2. Foreslåede nye løb

Kolonner: **Foreslået navn · race_class (CSV-kategori) · race_type · stages · begrundelse (ægte løbstype den spejler)**

`race_type`: `single` = endagsløb · `stage_race` = etapeløb.
Stages-norm: WT-endags 1 · WT-etape 5-8 · ProSeries-etape 4-5 · Class1/2-etape 3-4.

### PRIORITET A — WT-A endagsklassikere (6 nye, 0 endags i dag)

Disse skal være de STØRSTE ikke-monument-klassikere. Stilen følger de eksisterende: terræn-/region-baseret, ingen ægte navne, ingen em-dash.

| # | Foreslået navn | race_class | race_type | stages | Begrundelse (spejler) |
|---|---|---|---|---|---|
| A1 | Strade del Sale | Other WorldTour A | single | 1 | Grusvejs-forårsklassiker (Strade Bianche-typen) |
| A2 | Clásica del Golfo Vasco | Other WorldTour A | single | 1 | Hård sen-sommer-kystklassiker (San Sebastián-typen) |
| A3 | Grote Prijs der Vlaamse Heuvels | Other WorldTour A | single | 1 | Belgisk brosten/bakke-optakt til Flandern (E3-typen) |
| A4 | Schelde-Leie Klassieker | Other WorldTour A | single | 1 | Flad belgisk spurter-brosten-klassiker (Gent-Wevelgem-typen) |
| A5 | Klassieker van het Maasland | Other WorldTour A | single | 1 | Hollandsk Ardenner-optakt med korte stigninger (Amstel Gold-typen) |
| A6 | La Flèche des Côtes | Other WorldTour A | single | 1 | Punchør-klassiker med stejl slutstigning (Flèche Wallonne-typen) |

### PRIORITET B — flere WT-endags + ProSeries-finpudsning (11 nye)

#### B-del 1: WT-endags (4 nye — løfter WT-endags-laget mod målbåndets midte)

| # | Foreslået navn | race_class | race_type | stages | Begrundelse (spejler) |
|---|---|---|---|---|---|
| B1 | Clásica de Levante | Other WorldTour B | single | 1 | Spansk tidlig-sæson endagsløb (Clásica de Almería-typen) |
| B2 | Trofeo dell'Etruria | Other WorldTour B | single | 1 | Italiensk kuperet sen-sommer-klassiker (Coppa Sabatini-/Toscana-typen) |
| B3 | Grand Prix de la Sarthe | Other WorldTour C | single | 1 | Fransk forårs-endagsløb for alrounder (GP Cholet-/franske endags-typen) |
| B4 | Wielerronde van Brabant-Noord | Other WorldTour C | single | 1 | Hollandsk/belgisk efterårsklassiker (Brussels Cycling-/Brabant-typen) |

#### B-del 2: WT-etape (1 nyt — holder WT-etape i UCI-målbåndet ~11-15)

| # | Foreslået navn | race_class | race_type | stages | Begrundelse (spejler) |
|---|---|---|---|---|---|
| B5 | Tour des Pyrénées-Atlantiques | Other WorldTour C | stage_race | 5 | Kort bjergrigt WT-etapeløb (Itzulia-/Tour de Romandie-typen, let vægt) |

#### B-del 3: ProSeries-endags (6 nye — løfter fra 35 mod målbåndet ~40-50)

| # | Foreslået navn | race_class | race_type | stages | Begrundelse (spejler) |
|---|---|---|---|---|---|
| B6 | Grand Prix de l'Escaut Oriental | ProSeries races | single | 1 | Flad belgisk semi-klassiker (Nokere Koerse-/Scheldeprijs-typen) |
| B7 | Coppa dei Colli Marchigiani | ProSeries races | single | 1 | Italiensk kuperet ProSeries-endagsløb (Trofeo Matteotti-typen) |
| B8 | Classique du Roussillon | ProSeries races | single | 1 | Syd-fransk forårs-endagsløb (Classic Var-/Provence-typen) |
| B9 | Vuelta a la Rioja Alta | ProSeries races | single | 1 | Spansk kuperet endagsløb (Clásica de Ordizia-typen) |
| B10 | Rundfahrt durch das Sauerland | ProSeries races | single | 1 | Tysk bakket ProSeries-endagsløb (Sparkassen-/tyske endags-typen) |
| B11 | Grand Prix de la Vendée | ProSeries races | single | 1 | Atlanterhavs-kyst fransk endagsløb (Tro-Bro-/vestfransk-typen) |

### PRIORITET C — Class1/Class2 til Tier 4 (24 nye, LAV PRIORITET — Tier 4 tom i sæson 1)

> **Bemærk:** Disse er kun et udgangspunkt. En fuld 140-løbsdags Tier-4-sæson kræver væsentligt flere end 24; udvid når Tier 4 aktiveres. Stages bevidst lave (Class1: 3-4, Class2: 3).

#### Class 1 — endags (8 nye)

| # | Foreslået navn | race_class | race_type | stages | Begrundelse (spejler) |
|---|---|---|---|---|---|
| C1 | Grand Prix de l'Ardèche Méridionale | Class 1 races | single | 1 | Fransk .1 endagsløb |
| C2 | Trofeo dei Laghi Lombardi | Class 1 races | single | 1 | Italiensk .1 sø-distrikt-klassiker |
| C3 | Clásica de la Meseta | Class 1 races | single | 1 | Spansk .1 højsletteklassiker |
| C4 | Omloop van het Waasland | Class 1 races | single | 1 | Belgisk .1 brosten-endagsløb |
| C5 | Grosser Preis des Schwarzwalds | Class 1 races | single | 1 | Tysk .1 bjergrigt endagsløb |
| C6 | Circuit de la Côte d'Opale | Class 1 races | single | 1 | Nordfransk .1 kystklassiker |
| C7 | Gran Premio dell'Umbria | Class 1 races | single | 1 | Italiensk .1 kuperet endagsløb |
| C8 | Ronde van het Drentse Land | Class 1 races | single | 1 | Hollandsk .1 vind-/flad endagsløb |

#### Class 1 — etape (4 nye)

| # | Foreslået navn | race_class | race_type | stages | Begrundelse (spejler) |
|---|---|---|---|---|---|
| C9 | Tour des Préalpes | Class 1 races | stage_race | 4 | Fransk .1 kort bjerg-etapeløb |
| C10 | Giro dell'Appennino Centrale | Class 1 races | stage_race | 4 | Italiensk .1 kuperet etapeløb |
| C11 | Vuelta a la Sierra Norte | Class 1 races | stage_race | 3 | Spansk .1 bjerg-etapeløb |
| C12 | Ronde van de Lage Polders | Class 1 races | stage_race | 3 | Hollandsk/belgisk .1 fladt etapeløb |

#### Class 2 — endags (8 nye)

| # | Foreslået navn | race_class | race_type | stages | Begrundelse (spejler) |
|---|---|---|---|---|---|
| C13 | Grand Prix du Cantal | Class 2 races | single | 1 | Fransk .2 endagsløb |
| C14 | Trofeo della Brianza | Class 2 races | single | 1 | Italiensk .2 endagsløb |
| C15 | Clásica del Bierzo | Class 2 races | single | 1 | Spansk .2 endagsløb |
| C16 | Omloop van de Antwerpse Kempen | Class 2 races | single | 1 | Belgisk .2 endagsløb |
| C17 | Preis der Lausitz | Class 2 races | single | 1 | Tysk .2 endagsløb |
| C18 | Circuit du Périgord | Class 2 races | single | 1 | Fransk .2 endagsløb |
| C19 | Gran Premio della Sabina | Class 2 races | single | 1 | Italiensk .2 endagsløb |
| C20 | Ronde van Zeeland | Class 2 races | single | 1 | Hollandsk .2 vind-endagsløb |

#### Class 2 — etape (4 nye)

| # | Foreslået navn | race_class | race_type | stages | Begrundelse (spejler) |
|---|---|---|---|---|---|
| C21 | Tour du Limousin Vert | Class 2 races | stage_race | 3 | Fransk .2 kort etapeløb |
| C22 | Giro della Lucania | Class 2 races | stage_race | 3 | Italiensk .2 etapeløb |
| C23 | Vuelta a la Alpujarra | Class 2 races | stage_race | 3 | Spansk .2 bjerg-etapeløb |
| C24 | Ronde van de Veluwe | Class 2 races | stage_race | 3 | Hollandsk .2 etapeløb |

---

## 3. Antal nye løb pr. prioritet

| Prioritet | Endags | Etape | I alt |
|---|---|---|---|
| **A** — WT-A endagsklassikere | 6 | 0 | **6** |
| **B** — flere WT-endags + WT-etape + ProSeries | 8 | 1 | **9** |
| **C** — Class1/2 Tier-4 (lav prioritet) | 16 | 8 | **24** |
| **I ALT** | 30 | 9 | **39** |

(A+B = 15 nye løb til den nuværende aktive struktur; C = 24 til Tier 4 når det aktiveres.)

---

## 4. Datoer (åben — ejeren beslutter)

Dette udkast specificerer bevidst IKKE kalenderdatoer (CSV-kolonne `Dato`). De skal indpasses i de eksisterende vinduer uden at overlappe forkert (jf. overlap-fix-arbejdet i branch-navnet). Forslag til placering, hvis ønsket:
- **A1-A6** (WT-A klassikere): forår (feb-apr) hvor de ægte modstykker ligger, undgå kollision med monumenterne 21/3, 5/4, 12/4, 26/4.
- **B1-B11**: spredt; ProSeries-endags kan fylde tomme uger i sen-sommer/efterår.
- **C1-C24**: kun relevant ved Tier-4-aktivering.

---

## 5. Åbne spørgsmål til ejeren

1. **Navnestil-godkendelse:** Rammer A1-A6 stilen? (Strade del Sale, Clásica del Golfo Vasco osv.) Ret frit.
2. **WT-endags-loft:** Efter A+B rammer vi ~26 WT-endags (mål ~18-25). Vil du trimme 1-2 af de svageste eksisterende WT-B/C-endags, eller acceptere den høje ende?
3. **Class-kategori-fordeling:** CSV bruger fælles kategori for endags+etape (".1"/".2" via `single`/`stage_race`). Bekræfter du den split?
4. **Tier-4-omfang:** Skal C udvides nu (mod 140-løbsdags-sæson) eller vente til Tier 4 aktiveres?
