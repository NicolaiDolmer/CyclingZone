# Grand Tour-realisme — måling før og efter (#4288)

**Dato:** 3. september 2026 · **Metode:** read-only SELECT mod prod (før) + simulering i
hukommelsen med migrationens tal og de nye bånd (efter). **Ingen writes.**

Ejer-beslutning 3/9, som denne måling er holdt op mod:

| Mål | Bånd |
|---|---|
| Samlet snit pr. etape, **inkl.** enkeltstart | 155-170 km |
| Landevejsetaper, snit | 165-185 km |
| Prolog | 8-14 km |
| Rigtig enkeltstart | 25-40 km |
| Etaper i kataloget | Giro 17 · Vuelta 17 · Tour 18 |

Båndet gøres til en gate af `GRAND_TOUR_DISTANCE_RULES` i `raceRouteRealismMetrics.js`
(regel-sporet, PR #4709). Denne måling er katalog-/generator-siden: rammer løbene båndet,
når gaten tændes?

---

## 1. Før — målt mod prod 3/9

Kilde: `race_stage_profiles` for de tre GT'ers instanser i sæson 3 (`active`), division 1.
Alle tre løb findes kun i D1, og alle puljer i en division deler parcours, så tabellen er
sæsonens fulde GT-billede.

| Løb | Etaper | Samlet snit | Landevejssnit | Prolog | Enkeltstart | I bånd? |
|---|--:|--:|--:|--:|--:|---|
| Giro della Penisola | 18 | 162,6 km | 171,8 km | 6 km | — | prolog ✗ |
| Tour de l'Hexagone | 17 | **153,0 km** | 171,3 km | 5 km | 26 km | samlet ✗ · prolog ✗ |
| Vuelta Ibérica | 17 | 155,6 km | 173,0 km | — | 24 + 27 km | enkeltstart ✗ (24) |

Tre fund:

1. **Touren lå under gulvet.** 153,0 km mod 155. Ikke marginalt: 34 km mangler i alt.
2. **Alle prologer lå under 8 km** (5 og 6 km) — det gamle bånd var 5-8 km for enhver
   prolog i spillet, uanset løbets størrelse.
3. **Landevejssnittene lå i båndet, men i den nederste tredjedel** (171-173 mod midten
   175). Det er dét der efterlod for lidt luft til at de to korte tempoetaper kunne
   trækkes fra uden at det samlede snit faldt ud.

Rodårsagen er den samme i alle tre: en Grand Tour arvede distance-båndene fra et
gennemsnitsløb. `DISTANCE_BANDS` dækker hele kataloget — fra en firedages Class2-tur til
spillets største løb — og der fandtes intet sted at sige at en GT-etape er længere.
Præcis samme mangel som #4104 fandt for monumenterne.

---

## 2. Hvor bredt gælder fundet? 1.800 trækninger

Fundet ovenfor er tre løb i én sæson. For at afgøre om det er tilfældet eller reglen er
hver GT genereret over 600 sæson-seeds med det etapeantal kataloget har i dag (18/17/17)
og målt mod alle fire tal i båndet.

| Løb | Etaper | Gate-pass | Samlet snit (min/snit/max) | Landevejssnit | Hyppigste fejl |
|---|--:|--:|---|---|---|
| Giro della Penisola | 18 | **16,5 %** | 145,1 / 155,8 / 172,6 | 171,5 | enkeltstart <25 km (52,8 %) · prolog <8 km (48,5 %) · samlet <155 (46,3 %) |
| Tour de l'Hexagone | 17 | **16,8 %** | 145,8 / 155,4 / 174,0 | 172,0 | samlet <155 (53,5 %) · enkeltstart <25 km (53,8 %) |
| Vuelta Ibérica | 17 | **16,8 %** | 143,0 / 155,3 / 170,6 | 171,9 | enkeltstart <25 km (56,8 %) · samlet <155 (51,2 %) |

**Samlet: 16,7 % (200 af 1.800).** Sæson 3 var altså ikke uheldig — den var typisk. Havde
gaten været tændt i S3, ville den have været rød fem gange ud af seks.

---

## 3. Hvad der er ændret

| Hvad | Hvor | Fra | Til |
|---|---|---|---|
| Giro: etaper | `race_pool.stages` (migration) | 18 | **17** |
| Tour: etaper | `race_pool.stages` (migration) | 17 | **18** |
| Vuelta: etaper | — | 17 | 17 (uændret) |
| GT-prolog | `GRAND_TOUR_PROLOGUE_DISTANCE_BAND` | 5-8 km | **8-14 km** |
| GT-enkeltstart (`itt`) | `GRAND_TOUR_DISTANCE_BANDS` | 15-40 km | **25-40 km** |
| GT-enkeltstart (`itt_hilly`) | `GRAND_TOUR_DISTANCE_BANDS` | 15-30 km | **25-35 km** |
| GT flad / rullende / kuperet | `GRAND_TOUR_DISTANCE_BANDS` | 150-200 / 150-190 / 160-210 | **170-190 / 165-190 / 170-195** |
| GT bjerg / højbjerg | `GRAND_TOUR_DISTANCE_BANDS` | 150-190 / 140-180 | **165-185 / 160-180** |

Etapeantallet er katalogdata og hører i migrationen. Længderne er generator-regler og hører
i koden — en etaperute genereres deterministisk pr. sæson-instans, den ligger ikke i
kataloget. Båndet slår terræn-båndet, men **kun** for etapeløb med `grand_tour`-arketypen,
så resten af kataloget er bit-identisk (bånd-valget koster ingen rng-trækning).

**Ingen etape er slettet for at få Giroen ned på 17.** Generatoren bygger hele sekvensen om
fra `stages`, så 17 etaper er en ny, komplet plan der overholder §7's etaperækkefølge og
§7b's finale-fordeling. At slette en række i en genereret sekvens ville netop brække de to
regler. Samme mekanik giver Touren sin 18. etape.

---

## 4. Efter — simuleret på sæson 3's egen identitet

Samme seed-nøgle som S3 (løbenes `external_id` + sæson-aksen), men med migrationens
etapeantal og de nye bånd. Det er altså det parcours S3 ville have haft, hvis ændringen
havde været der fra starten — direkte sammenligneligt med tabellen i afsnit 1.

| Løb | Etaper | Samlet snit | Landevejssnit | Prolog | Enkeltstart | I bånd? |
|---|--:|--:|--:|--:|--:|---|
| Giro della Penisola | 17 | 167,4 km | 177,2 km | 10 km | — | ✔ |
| Tour de l'Hexagone | 18 | 160,1 km | 177,5 km | 8 km | 33 km | ✔ |
| Vuelta Ibérica | 17 | 161,1 km | 178,3 km | — | 30 + 33 km | ✔ |

Alle fire tal i båndet for alle tre løb. Touren går fra 153,0 til 160,1 km i snit og fra
2.601 til 2.881 km i alt.

### Fordelingen over 600 trækninger pr. løb

| Løb | Etaper | Gate-pass | Samlet snit (min/snit/max) | Landevejssnit | Rest-fejl |
|---|--:|--:|---|---|---|
| Giro della Penisola | 17 | **97,2 %** | 152,9 / 160,6 / 172,8 | 176,9 | samlet >170 (2,2 %) · <155 (0,7 %) |
| Tour de l'Hexagone | 18 | **98,7 %** | 155,5 / 161,2 / 172,6 | 177,1 | samlet >170 (1,3 %) |
| Vuelta Ibérica | 17 | **97,0 %** | 154,2 / 160,6 / 172,5 | 177,0 | samlet <155 (1,3 %) · >170 (1,7 %) |

**Samlet: 97,6 % (1.757 af 1.800), fra 16,7 %.** Prologen og enkeltstarterne rammer i
100 % af trækningerne — de er hårde gulve i båndet. Landevejssnittet ligger i 165-185 i
100 % af trækningerne.

### Hvorfor ikke 100 %

Det samlede snit afhænger af to ting generatoren afgør pr. trækning: **hvor mange**
tempoetaper filleren giver (1 eller 2, aldrig flere — `DEFAULT_TT_CAP`), og om åbningen
bliver en prolog (8-14 km) eller en rigtig enkeltstart (25-40 km). De fire kombinationer
har hver deres vindue for landevejssnittet:

| Tilfælde | Andel | Landevejssnit der giver samlet 155-170 |
|---|--:|---|
| 2 tempoetaper, åbning = prolog | ~50 % | 173-185 km |
| 2 tempoetaper, åbning = enkeltstart | ~34 % | 171-185 km |
| 1 tempoetape, prolog | ~10 % | 164-180 km |
| 1 tempoetape, enkeltstart | ~6 % | 163-179 km |

Et enkelt bånd kan ikke ramme alle fire 100 %: 2-tempo-tilfældenes gulv (173) og
1-tempo-tilfældenes loft (179) efterlader kun 6 km overlap. Båndene er kalibreret til at
lande midt i overlappet (177), og de resterende 2,4 % er trækninger hvor terræn-multisættet
skubber snittet ud i den ene ende. Vil man have 100 %, skal antallet af tempoetaper i en GT
gøres fast — det er en ændring af `ARCHETYPE_PROFILES.grand_tour`'s filler-vægte, og den
flytter kalenderens ITT-dækning (§6b), så den hører i regel-sporet, ikke her.

---

## 5. Hvad der IKKE er rørt

- **Sæson 3.** Migrationens etape-opdateringer er afgrænset til sæsoner med status
  `upcoming` og `is_manual = false`. S3 er `active`; GT'erne er kørt eller kører, og
  resultater og præmier er bogført. Mod prod i dag rammer de opdateringer **0 rækker** —
  S4 findes endnu ikke. Samme WHERE-mønster som `2026-09-03-4105-terre-di-toscana-gravel.sql`.
- **Resten af kataloget.** GT-båndet er arketype-scopet. En prolog i en almindelig
  etapeuge er stadig 5-8 km, og `DISTANCE_BANDS` er uændret for alle andre løb.
- **`date_text`.** Kalenderens kronologi læses af datoen (#3469), og begge vinduer rummer
  det nye etapeantal (Giro 8/5-28/5 = 21 dage, Tour 4/7-22/7 = 19 dage, mod etaper + 2
  hviledage jf. CALENDAR_RULES §3).
- **Reglerne selv.** `CALENDAR_RULES.md` og gate-filerne ejes af PR #4709.
- **`backend/lib/__fixtures__/racePoolCatalog.prod.json`.** Katalog-snapshottet (hentet
  23/8) står stadig med 18/17/17. Det er bevidst: opdateres det, skal det gyldne
  S3-kalender-snapshot og scorecard-gaten regenereres i samme ombæring, og de to filer
  ejes af #4709. Fixturen er i forvejen forud-uaktuel over for #4270's 45 nye løb, så den
  skal refreshes samlet med `scripts/dev/dumpRacePoolFixture.mjs` når S4-kæden er kørt.
  Ingen test måler GT-realisme gennem fixturen — den nye test genererer sit eget input.

---

## 6. Sådan er tallene reproduceret

- **Før (prod):** `race_stage_profiles` join `races` join `seasons` join `race_pool`,
  filtreret på de tre GT'ers `external_id`. Read-only SELECT, ingen writes.
- **Efter (simuleret):** `generateRaceStageProfiles()` med `terrain_archetype:
  'grand_tour'`, migrationens `stages` og løbenes rigtige `external_id` som seed-nøgle.
- **Fordelingerne:** 600 deterministiske sæson-nøgler pr. løb, samme sæt før og efter.
- **Fastholdt i CI:** `backend/lib/grandTourDistanceRealism.test.js` læser etapeantallet ud
  af selve migrationen og genererer 200 trækninger pr. løb. Ændrer nogen migrationen uden at
  ændre båndene (eller omvendt), fejler testen.
