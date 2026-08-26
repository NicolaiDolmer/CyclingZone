# Session-prompt: S3-regenereringen — torsdag 27/8

> Skrevet onsdag 26/8 kl. 23. **Sæson 3 starter fredag 28/8 kl. 11.** Du har cirka 36 timer, og hele torsdagen som buffer.
>
> Forrige session (26/8 aften) merged #4277 og slukkede løbsdags-udviklingen for S3. Denne session skal levere **én** kalender-regenerering.

---

## 0 · Læs dette først

**Tjek datoen med `date` før du skriver den nogen steder.** Forrige sessioner har dateret beslutninger forkert to gange og måttet rette SSOT bagefter.

**Køreplanen er SSOT for udførelsen:** [`docs/runbooks/2026-08-27-s3-kalender-regenerering.md`](../runbooks/2026-08-27-s3-kalender-regenerering.md). Elleve skridt, hvert med ejer-GO. Læs den HELT igennem før skridt 0. Denne prompt duplikerer den ikke — den giver dig kun det der er kommet til siden, og det der stadig er uafklaret.

**Ejeren skal være til stede hele vejen.** Skridt 2 til 9 er vinduet hvor sæsonen ikke er `active`. Den 25/8 stod den ikke-aktiv i fire timer (#4229), og alder, rangliste, træning og akademi var nede for alle imens — mens alle fire kalender-invarianter rapporterede grønt. Mål: under ti minutter. Går noget galt, er "sæt tilbage til `active`" ALTID første handling.

**To regenereringer er forbudt.** Alt skal være afgjort før den ene kørsel.

---

## 1 · Det åbne valg der blokerer alt (#4272 D4)

**Dette skal afgøres FØR skridt 1. Det er et spildesign-valg, ikke et teknisk problem.**

Division 4 trækker 5 af 6 `summit_tour`-arketyper, og hver af dem har 2 garanterede højbjergs-etaper. Resultatet:

| | D1 | D4 |
|---|--:|--:|
| Højbjerg | 8 % | **16 %** |
| Samlet opad | — | **41,9 %** |

Værktøjet kan ikke løse det som det står: **reservationer er gulve, ikke lofter.** Der findes ingen mekanisme til at sige "højst N summit_tour i denne division".

To veje, begge kræver arbejde før regenereringen:

- **Arketype-loft.** Ny mekanisme i pakkeren. Mest korrekt, dyrest.
- **Flere flade Class1/Class2-etapeløb i katalogget.** Fortynder summit_tour uden ny mekanisme. Billigere, men ændrer katalogget.

To katalog-lofter er allerede ramt og skal ikke genåbnes: D1's brosten nåede 4,5 % (ikke 6 % — 6 kræver flere brostens-løb, og ved 8 reservationer falder D3 under sit gulv). D4's enkeltstart nåede 8,1 % (kun 3 fritstående ITT-løb i Class1/Class2).

---

## 2 · Fund fra 26/8 aften — begge nye, begge urørte

### 2a · Division 4 — A har 25 hold

Målt direkte mod prod 26/8 kl. 22:55. Alle andre puljer er præcis 24.

| Pulje | Hold | AI | Mennesker | Afvigelse |
|---|--:|--:|--:|--:|
| Division 4 — A | **25** | 18 | 7 | **+1** |

De 18 AI-hold blev alle oprettet i samme batch 24/8 kl. 14:15:28-35 — inden for syv sekunder. Fyldet lagde ét hold for meget. **Ingen af dem har race-entries endnu**, så oprydningen er billig nu og bliver dyrere når løbene kører.

Reparationen er destruktiv (et hold med 20 ryttere) og kræver ejer-GO. Nyeste kandidat er `Vanguard Pro Team` (oprettet sidst, 14:15:35, 20 ryttere, 0 entries). **Overvej at tage den FØR regenereringen** — feltstørrelser og op-/nedrykning regner med 24.

### 2b · `audit`-checken er et dødt værn

`League-size invariant audit` fejler på main og på hver eneste branch, og har gjort det mindst siden 26/8 kl. 04:21. Den er **ikke** en required check, så den blokerer ingenting — men den kører mod live prod ved hver PR, og lige nu kan ingen skelne "divisionsstørrelserne er i stykker" fra "den er altid rød".

Fundet i 2a er præcis hvad den forsøger at fortælle os. Fix 2a, så bliver den grøn af sig selv. Bliver den ikke det, skal den gøres advisory — et værn ingen kan læse er værre end intet værn.

---

## 3 · Hvad der står færdigt (verificeret, ikke påstået)

**#4277 — merged + anvendt (ddf70da62, 26/8 kl. 22:46).** Løbsdags-udviklingen har eget flag. Prod-verificeret efter merge:

| Flag | Værdi | Betydning |
|---|---|---|
| `race_day_development_enabled` | **off** | D1+D2 væk — løb udvikler ikke ryttere i S3 |
| `race_day_engine_enabled` | **on** | D3 recovery (4,5/0,15) + D4 AI-paritet bevaret |

S3 kører sæson 2's løbsdags-regler. Genindførsel planlagt til S4 i en enklere form — se [#4277](https://github.com/NicolaiDolmer/CyclingZone/issues/4277) for spiller-evidensen og designforslaget. Patch note 7.196 og `help.json` (en+da) er opdateret og deployet.

**Rør ikke `race_day_engine_enabled`.** Slukkes den, ryger træthedsmedianen fra 57 tilbage til 67 for hele populationen, og de 137 AI-hold holder op med at udvikle sig. Det var hele pointen med at splitte flaget.

**#4236 + #4272 + #4273 + #4275 — merged 26/8.** Koden er inde. **Men den er ikke anvendt på S3.** Det er præcis det denne session handler om.

---

## 4 · Live tilstand der skal rettes

Målt i prod 26/8 kl. 21:20:

| Problem | Live | Issue |
|---|--:|---|
| Bjergetaper der slutter nedad | **144 af 225 (64 %)** | #4272 |
| Løbsdage over flere kalenderdatoer | **61** (værste spænder 7) | #4236 |
| Løb med hul i løbsdagene | **8** | #4236 |

Løbsdags-fejlen er ikke kosmetisk: **bindingen lyver.** En rytter bindes på dage hvor hans løb ikke kører, felterne kan ikke fyldes lovligt, og det brænder fast i resultater der ikke kan køres om.

---

## 5 · Rækkefølge for dagen

1. **Afgør #4272 D4** (afsnit 1). Uden dette må regenereringen ikke starte.
2. **Ryd overskudsholdet i D4-A** (afsnit 2a), ejer-GO. Billigst før regenereringen.
3. **Kør køreplanen**, skridt 0 til 10. Discord-besked FØRST.
4. **Tænd `stage_scheduler_enabled` + `auto_entry_generator_enabled`** — først når kalenderen er verificeret, og kun med ejer-GO. Gen-tænding af live-systemer er ejer-only.

**Fallback hvis regenereringen ikke kan nås:** in-place `finale_type`-opdatering. Retter de 144 bjergetaper uden wipe, uden statusskifte, uden at koste en eneste af de 1.066 udtagelser. Retter **ikke** løbsdagene. Cirka en times arbejde. Detaljer i køreplanen.

---

## 6 · Prisen, så den ikke overraskes frem

```
Udtagelser i S3    1.066  →  991 spillernes egne (29 hold) · 75 assistentens (3 hold)
Seneste udtagelse  26/8 kl. 20:30
Resultater kørt    0
```

En regenerering sletter alle 1.066. De ryger uanset hvornår vi gør det — hver time vi venter, lægger flere managere arbejde i valg der bliver slettet. **At vente gør prisen større, ikke mindre.** Assistenten udtager automatisk 1 time før hvert løb (#4174), så ingen står uden hold, men de mister deres egne valg. Derfor Discord-besked som skridt 0.
