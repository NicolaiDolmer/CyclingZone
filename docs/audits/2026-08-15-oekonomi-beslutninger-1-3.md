# Økonomi-beslutninger 1-3, truffet 15/8

**Form:** beslutnings-log · **Stiller spørgsmålene:** [`2026-08-14-oekonomi-designkritik.md`](../superpowers/specs/2026-08-14-oekonomi-designkritik.md) §7 (PR [#3728](https://github.com/NicolaiDolmer/CyclingZone/pull/3728), **umerget** — derfor ligger beslutningerne her på main og ikke kun i den)

Alle målinger er read-only mod prod (`ghwvkxzhsbbltzfnuhhz`) 15/8. **To af de tre beslutninger endte et andet sted end kritikken anbefalede, fordi præmissen ikke holdt.** Det er noteret ved hver.

---

## Beslutning 1 · Loftet på egen-rytter-udbudspris

**Kritikkens spørgsmål:** skal loftet fjernes og erstattes med 5x-loft plus to-budgiver-krav?
**Kritikkens anbefaling:** ja.
**Ejer-beslutning 15/8:** ⛔ **ikke som stillet.** Et andet design valgt.

### Hvad målingen ændrede

Kritikken målte kun `auctions`. **Der er to markeder.** `POST /api/transfers` (`api.js:5926-5937`) har aldrig haft et prisloft — eneste validering er "positivt heltal".

- **247 af 592** opslag fra menneskehold (41,7 %) er prissat **over** rytterens værdi.
- **21 af 63** menneske-til-menneske-handler blev afregnet over værdi, op til **78×**. Største præmier på billige, unge ryttere.
- Kritikkens ukendt nr. 2 — *"betalingsvilje over modelværdi er aldrig observeret, fordi det er forbudt i kode"* — **er dermed forkert.**
- Men markedet clearer under modellen: solgte opslag har median udbudspris **0,63 × værdi**; åbne usolgte ligger på 1,20.

Den ægte spærring er ikke tilladelse, men **konkurrence**: 16 af 1.698 spillerudbudte auktioner har haft to eller flere budgivere i hele spillets historie, og medianløftet fra start- til slutpris er 1,00 i alle prisbånd.

### Det valgte design

1. **Transferlisten forbliver fri.** Ingen ændring nødvendig — det er allerede adfærden.
2. **Auktioner får et gebyr på høje startpriser**, ikke et loft: udløses over **0,5 × værdi**, betales ved oprettelse, refunderes ikke. Foreslået trappe 5 % / 10 % / 20 % af værdien, minimum 250 CZ$.
3. **Rækkefølge: [#2884](https://github.com/NicolaiDolmer/CyclingZone/issues/2884) auktionsvarighed FØR gebyret.** Så længe 99,1 % af spillerudbudte auktioner har nul eller én budgiver, betyder "start lavt" bare "sælg lavt", og gebyret ville flytte formue fra sælgere til købere.
4. **5x-loftet er valgt fra.** Kollusionsværnet kommer fra to-budgiver-kravet og fra længere auktioner — som to spillere og ejeren selv pegede på 3/8 som modgiften mod aftalte handler.

**Status:** #2884 **merget 15/8** (PR #3742). Gebyret afventer 28-dages-målingen.

---

## Beslutning 2 · Bankens salgspris

**Kritikkens spørgsmål:** skal banken sælge på rigtig auktion med reserve på 25 % af ankerværdien i stedet for gulv lig fuld værdi?
**Kritikkens anbefaling:** ja, med drænvagt.
**Ejer-beslutning 15/8:** ⛔ **ingen handling — præmissen er forkert.**

### Hvad målingen ændrede

Reglen kritikken citerer (`below_value_floor`, `auctionRules.js:110`) sidder på den **spiller-vendte** rute og styrer hvad en *spiller* må udbyde en fri agent til. Den rører ikke bankens egne auktioner.

Bankens auktioner oprettes server-side i `youthMarket.js:101`:

```js
export const YOUTH_AUCTION_START_RATE = 0.25;
```

**Banken sælger allerede til 25 % af værdien.** Median startpris over 1.542 bank-auktioner: **0,25 × værdi**. Kun 186 (12 %) startede på fuld værdi eller derover. Kritikkens forslag ville være en no-op, og dens forsigtige variant (reserve 50 %) ville **hæve** bankens priser.

### Det der er sandt og betyder mere

| Bankens salg | Antal | Andel af kroner | Prisløft over startpris |
|---|---:|---:|---:|
| 0-1 budgiver | 739 | **76,2 %** | **1,000** |
| 2+ budgivere | 298 | 23,8 % | 1,378 |

76 % af pengene skifter hænder til en pris ingen har budt om — sat af en konstant.

**Følgen, som ingen havde set:** `fitMarketValueModelV1.js` træner på completed auctions med bud og vægter 1× for én-buds-auktioner. De 739 mekaniske 25 %-salg indgår dermed som "markedsevidens" og bærer ~55 % af auktions-vægten. **Modellen lærer en konstant og aflæser den som en pris.** Det forklarer strukturelt hvorfor den markedsdrevne model giver lavere værdier end v4 — uden at antage tynde data eller censur.

**Handling:** [#3750](https://github.com/NicolaiDolmer/CyclingZone/issues/3750) — hold ikke-konkurrenceprissatte bank-salg ude af fittet. Skal ske i samme omgang som #3449's refit.

**Drænet er et separat spørgsmål:** bankens salg er 53,3 % af alle pengedræn *selvom* de sælges til en fjerdedel. Det er volumen, ikke pris. `YOUTH_AUCTION_START_RATE` er et ægte pengepolitisk håndtag og hører i [#3732](https://github.com/NicolaiDolmer/CyclingZone/issues/3732).

---

## Beslutning 3 · Hvordan værdien bevæger sig mod markedet

**Kritikkens spørgsmål:** skal den globale 75/25-kalenderblanding erstattes af evidensvægt pr. rytter (`Z = n/(n+12)`)?
**Kritikkens anbefaling:** ja.
**Ejer-beslutning 15/8:** ✅ **ja — men med rettet definition af hvilke handler der tæller.**

### Princippet, i klar tekst

I stedet for én fast blanding for alle ryttere følger **hver enkelt rytters værdi markedet i præcis den grad der findes handler med ryttere som ham.** Mange sammenlignelige handler → værdien følger markedet. Ingen → værdien bliver hvor den er.

Ingen skal beslutte hvornår der skrues op. Det sker af sig selv, rytter for rytter. De to gates fra 14/8 udgår dermed helt, og beslutning 1 fra 14/8 (marked sætter struktur, simulering sætter niveau) er afløst.

**Hvorfor den faste 75/25 faldt:** den giver markedet 25 % at sige om ryttere det aldrig har handlet — og det er netop de dyre. **De dyreste 10 % af rytterne udgør 79 % af al trupværdi.** Planen gav altså markedet mest indflydelse dér hvor det ved mindst, i den ende der betyder mest.

### Rettelsen af evidens-definitionen

Kritikkens definition — spiller-til-spiller, mindst to budgivere, prisen steg — er skrevet til auktioner. Målt over 180 dage:

| Kilde | Antal |
|---|---:|
| Auktioner med 2+ budgivere hvor prisen steg | **16** |
| Forhandlede handler mellem to menneskehold | **63** |

Definitionen ville smide **80 % af evidensen væk** — og netop den del hvor spillerne faktisk handler.

To-budgiver-kravet er et **kollusionsværn**, ikke en erkendelsesregel. Den forhandlede vej kan bære et tilsvarende værn, og målingen er ren:

- 63 handler fordelt på **44 unikke par**; median 1 handel pr. par.
- Kun **2 par** har handlet 3+ gange (ét par 8 gange).
- **Alle 3 handler over 3 × værdi ligger i netop de par.**

**Vedtaget definition af kvalificeret evidens:**

1. Konkurrenceprissatte auktioner (mindst 2 budgivere, prisen steg), **eller**
2. forhandlede handler mellem to menneskehold,
3. **undtagen** handler over 3 × rytterens værdi (kritikkens eget værn, §5.3a),
4. **undtagen** par der har handlet 3+ gange i vinduet.

Det giver **68 kvalificerede observationer** mod 16, med et værn der beviseligt fanger 3 ud af 3 afvigere i de nuværende data.

### Hvad man skal forvente

**Værdierne rykker sig næsten ikke i starten.** 68 handler fordelt på ~3.500 spillerejede ryttere betyder at `n` er nul eller nær nul for de fleste, altså `Z ≈ 0`. Systemet siger ærligt *"der er endnu ikke evidens"* frem for at gætte. Det er den eneste version der kan holde, og den vokser af sig selv nu hvor auktionerne varer længere.

**Hård afhængighed:** når `Z` er pr. rytter, flytter nogle ryttere sig om søndagen og andre ikke. Uden en forklaring på skærmen er det uforståeligt. **[#3733](https://github.com/NicolaiDolmer/CyclingZone/issues/3733) søndags-kvitteringen bygges sammen med det, ikke bagefter.**

**`K = 12` beholdes** (en rytter skal have 12 sammenlignelige handler før markedet vejer halvt). Det er bevidst konservativt givet hvor tynde data er. Det er den dial der skal justeres senere, ikke nu.

---

## Tilbage

Beslutning **4, 5, 6 og 7** i designkritikkens §7 er ikke truffet. 6 (løft D4's indtægt før #3393) er den eneste der er blokerende for noget.
