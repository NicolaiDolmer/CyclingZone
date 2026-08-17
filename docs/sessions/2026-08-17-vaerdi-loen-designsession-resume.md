# Design-session 17/8 · Værdi & løn: alle beslutninger + hvor de ligger

**Form:** ejer + arkitekt, ren design/beslutning. Ingen kode, ingen prod-mutationer, NOW.md ikke rørt (bølge 3 ejede claimet). Alt målt read-only mod prod 17/8.

**Dette dokument er indgangen.** Hver beslutning er logget fuldt ud som issue-kommentar; her står konklusionen og linket.

---

## De fem beslutninger

### 1. Niveau-korrektionen: gate-styret fra 30/8, IKKE 23/8, IKKE 0,422 råt

- 23/8 rører ikke værdierne. Engangs-korrektionen fyrer første søndag (tidligst 30/8) hvor de to frie evidenskanaler (forhandlede handler + konkurrence-auktioner efter #2884) er enige inden for ±0,15, og ejeren har godkendt dry-run. Snapshot + rollback via #3835-værktøjet.
- Bundles **dræn-neutral** (`YOUTH_AUCTION_START_RATE` 0,25 → 0,25/c samme dag) og **løn-neutral** (A × c^-0,55, hver løn i kroner uændret).
- Nøglemåling bag fravalget af 0,422: auktionskanalen er cirkulær/censureret; den frie forhandlede kanal siger median 0,76 (0,65 uden >3x-afvigere, n=76-81, IQR 0,34-1,02). De to kandidater er faktor ~2 fra hinanden.
- **Fuld log:** [#3750-kommentaren](https://github.com/NicolaiDolmer/CyclingZone/issues/3750#issuecomment-5316992708)

### 2. Lønmodellen: A = 23.300, flipper 23/8

- Løn = 23.300 × (ankerværdi/100.000)^0,55, gulv 250, intet loft. Kalibreret mod 35 % af rå målt S2-indtægt (112,5M fremskrevet fuld sæson).
- **Bevidst blød landing:** S3 har 60 løbsdage mod S2's 28 (lønnen trækkes ÉN gang ved sæsonstart), så lønsummen lander på ~25 % af S3-indtægten. Fast regel fra S4: 35 % af sidste sæsons målte indtægt, normaliseret pr. løbsdag, skaleret til kommende kalender. Alternativet A=33.000 fravalgt: 23/48 D2- og 21/61 D4-hold over 60 % af indtægten i løn før upkeep, og G4-brud (669k > 600k D1-mediansponsor).
- **Drejebogens åbne spørgsmål besvaret: lønnen KAN flippe 23/8 trods RØD komponent 1** — ankerværdi-grundlaget afkobler den fra markedsvægten, og værdierne står bevidst stille.
- Nyt leverancekrav: **forventet sæsonløn på auktionskortet før man byder** (og transferlisten).
- Eksempler ved A=23.300: Riva (23,8M) 23.305 → 472.000 · Wolf (17 år, 4,0M) 63.333 → 177.000 · median-rytter (9.000) 70 → 6.200.
- **Fuld log:** [#3393-kommentaren](https://github.com/NicolaiDolmer/CyclingZone/pull/3393#issuecomment-5317068169)

### 3. Spillerbeskederne: to nye, begge FØR søndag 23/8

- Grøn-gate-varianten og 30/8-fallbacken (aldrig postet, verificeret i #the-roadbook) er kasseret.
- **Besked 2 (værdier):** står stille søndag, refit målte dårligere, niveau-justering kommer på en standard, ikke en dato. **Besked 3 (løn, NY):** reformen forklaret før spillerne ser lønbudgettet søndag morgen; postes når #3393 er merged + dry-run bekræftet, senest lørdag 22/8.
- **Klar til copy-paste:** [`docs/discord/2026-08-17-cutover-beskeder.md`](../discord/2026-08-17-cutover-beskeder.md) (commit `9eaf9bf2`). Ejeren poster selv.

### 4. Beslutning 7 (transferskat): afvist for nu, gate på 40 %

- Drænet er midt i målbåndet (53,3 %; frisk 28-dages: ~22M netto). Drænvagten i #3732 er triggeren: under 40 % → spørgsmålet stilles igen. #3757 er lukket, alle tre beslutninger på det truffet.
- **Fuld log:** [#3757-kommentaren](https://github.com/NicolaiDolmer/CyclingZone/issues/3757#issuecomment-5317160549)

### 5. Søndags-kvitteringen (#3733): skelet A valgt på mockup

- Klar tekst som headline (tre årsagstyper: udvikling / engangs-korrektion / marked), anker-marked-vægt-tal bag fold-ud. Ingen kvittering når intet flyttede sig, ingen forudsigelser.
- **Ny hård afhængighed:** korrektions-kvitteringen (trin 1) skal være bygget FØR niveau-gaten kan fyre (tidligst 30/8). Per-rytter-evidens (trin 2) venter på Z-sweepet.
- Mockup gemt: [`docs/design/mockups/2026-08-17-soendags-kvittering.html`](../design/mockups/2026-08-17-soendags-kvittering.html)
- **Fuld log:** [#3733-kommentaren](https://github.com/NicolaiDolmer/CyclingZone/issues/3733#issuecomment-5317160882)

---

## Bonus-målinger (nye fakta, målt 17/8)

- `forced_debt_sale`: **0 transaktioner nogensinde** (designkritikkens ukendt nr. 5 lukket; pengekilden har aldrig fyret).
- S3 har **60 løbsdage** mod S2's 28 (seasons-tabellen) — bærende for løn-kalibreringen.
- 921 ryttere frigives ved kontraktudløb før S3-payroll; 2.322 bliver (basis 1.347 af 1.689).
- Rytterkøb 28 dage: 35,1M ud / 13,1M ind.

## Samlet beslutnings-log

[`docs/audits/2026-08-15-oekonomi-beslutninger-1-3.md`](../audits/2026-08-15-oekonomi-beslutninger-1-3.md) §Tilbage er opdateret (commit `b6fddb39`): **alle 7 økonomi-beslutninger fra designkritikken er truffet.**

## Næste skridt (til build-sporet)

1. **#3393 omskrives:** ankerværdi-grundlag + A=23.300 + auktionskort-løn, dry-run mod staging (drejebogens komponent 2, gates uændrede).
2. **Korrektions-kvitteringen (trin 1 af #3733)** planlægges så den er klar før 30/8.
3. **Niveau-gate-måleren:** ugentlig søndagsmåling af de to kanal-faktorer fra 30/8 (kan være et script + admin-visning; hører sammen med #3755).
4. Besked 2 postes i denne uge; besked 3 efter #3393-merge, senest 22/8.
