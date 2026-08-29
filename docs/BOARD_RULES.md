# Bestyrelses-reglerne — SSOT

> **Læs denne FØR enhver opgave der rører bestyrelsen: tilfredshed, mål, planer, forhandling,
> konsekvenser, bonustilbud eller bestyrelsens kobling til sponsorøkonomien.** Hard rule 30
> ([#4221](https://github.com/NicolaiDolmer/CyclingZone/issues/4221)) · områdedokument oprettet under
> [#4266](https://github.com/NicolaiDolmer/CyclingZone/issues/4266).
>
> Bestyrelsen er en af ejerens 10 kernefunktioner og havde indtil 29/8 intet SSOT-dokument.
> Denne fil beskriver **hvad der kører i dag**, ikke hvad der er besluttet. De to er ikke det samme:
> Mandat-modellen (#3514) er ejer-godkendt 7/8, migreret 23/8 og **slukket** — se §6.
>
> Sponsorsiden bor i [`SPONSOR_RULES.md`](SPONSOR_RULES.md). Grænsen mellem de to er §5, og den er
> selve grunden til at begge filer findes. Økonomiens øvrige regler: [`ECONOMY_RULES.md`](ECONOMY_RULES.md).
>
> Verificeret mod kode og prod 29/8. Beslutnings-arkæologi:
> [`audits/2026-08-29-sponsor-board-decision-inventory.md`](audits/2026-08-29-sponsor-board-decision-inventory.md).

---

## 1. Modellen der kører i dag

Et hold har **op til tre parallelle bestyrelsesplaner** (`board_profiles`): 1-årig, 3-årig og 5-årig.
Hver har sit eget `satisfaction`-tal (0-100), sine egne mål og sin egen `budget_modifier`.

Målt i prod 29/8: 680 profiler, heraf 618 `completed`. For S3: 176 × 1yr, 39 × 3yr, 21 × 5yr.

**Det er rod-årsagen til en hel fejlklasse.** Tre tal for samme relation har givet mindst otte
forekomster af kontekst-drift og tæller-mismatch siden maj (#2469 → #2592 → #2596, #3095, #3141,
#3144, #3494, #4377). Mandat-modellen (§6) blev designet for at afskaffe det.

**Grundregler der aldrig har ændret sig:**
- **Bestyrelsen fyrer aldrig.** Ingen game-over-tilstand (ejer 7/7, #2237).
- **Blød kalibrering.** Konsekvenser strammer, de dræber ikke.
- **Manager-only.** AI-hold har ingen bestyrelsesrelation.
- **Sæson 1 er observationsår.** Ingen konsekvenser, kun referat.
- **Styrke straffes aldrig** — gælder også her.

---

## 2. Tilfredshed → penge

```
satisfaction ≥ 80  →  modifier 1,20
             ≥ 60  →           1,10
             ≥ 40  →           1,00
             ≥ 20  →           0,90
             ellers →          0,80
```

`boardEvaluation.satisfactionToModifier`. Den **effektive** modifier for et hold er
**gennemsnittet af alle `completed` planers `budget_modifier`** (`economyEngine.js:288-292`) — ikke
den højeste, ikke den 1-årige. Et hold med tre planer på 1,20 / 1,10 / 1,00 kører på 1,10.

Målt fordeling 29/8: **D1 1,188 · D2 1,171 · D3 1,099 · D4 1,022** (laveste i spillet: 0,83).
Fordelingen er ikke tilfældig — et hold der lige er rykket op har pr. definition haft en god sæson.

**Hvor modifieren rammer:** kun den garanterede sponsor-base ved sæsonstart, og (fra
implementeringen af §3 i SPONSOR_RULES) divisions-tillægget. Løbsdags-indtægt, resultat-bonusser og
signing-bonus er **rå**.

Tilfredsheds-bevægelsen: `satisfactionDelta = round((adjustedOverallScore − expectation) × 55)`,
hvor `expectation` afhænger af bestyrelsens personlighed.

Bevægelser logges i `board_satisfaction_events` — 1.313 events for 217 hold på transitionsdagen
23/8, og løbende derefter (270 events for 94 hold 29/8). **At HVER bevægelse producerer et event er
ikke verificeret:** `boardWeekendFinalization.js` skriver dem, men hverken `boardEvaluation.js` eller
`economyEngine.js` indeholder tabelnavnet, så sæson-slut-stien er ikke bekræftet som logget.
"Kvittering for alt" er et bindende designprincip fra Mandat-spec'en — ikke en verificeret egenskab
ved den model der kører i dag.

---

## 3. Mål

15 måltyper findes i `boardGoals.js`:

`top_n_finish` · `relative_rank` · `stage_wins` · `gc_wins` · `jersey_wins` · `monument_podium` ·
`min_riders` · `min_u25_riders` · `min_national_riders` · `u25_development_delta` ·
`signature_rider` · `no_outstanding_debt` · `profitable_transfers` · `sponsor_growth` ·
`domestic_dominance`

Mål genereres af `generateBoardGoals` ud fra fokus × klub-DNA × dynamisk kalibrering.
`sponsor_growth` filtreres bort for 1-årige planer (#1267: sponsorindkomst kan ikke flyttes inden
for én sæson).

**To måltyper er i praksis defekte:**

- **`sponsor_growth` kan matematisk aldrig opfyldes.** Målet regner
  `(currentSponsorIncome − planStartSponsorIncome) / planStartSponsorIncome`, og begge sider læser
  `teams.sponsor_income`. Målt 29/8: **kolonnen er 240.000 for alle 230 hold**, og
  `plan_start_sponsor_income` er 240.000 for alle 680 profiler. Resultatet er 0 % vækst, for alle,
  altid. Ejeren besluttede 7/8 (#3494) at målet skal pege på `sponsor_contracts`-udbetalinger og
  **aldrig** det døde felt. **Det er ikke bygget.** 135 profiler har båret målet (112 i S1, 23 i S2);
  ingen i S3, men måltypen kan stadig genereres til flerårige planer.
- **`domestic_dominance`** er et skelet uden implementering. Mandat-spec'en §3.6 siger det skal
  afsluttes eller slettes.

---

## 4. De seks konsekvens-lag

Lag 1 lever i `board_profiles.budget_modifier`. Lag 2-6 lever i `board_consequences` og evalueres
ved sæson-slut.

| Lag | Konsekvens | Udløser | Detalje |
|---|---|---|---|
| 1 | Sponsor-modifier | løbende | ±20 %, §2 |
| 2 | Lønloft | tilfredshed < 40 | Loft = lønsum × 1,5, gulv 5.000. **Strammes aldrig** under en tidligere sat cap. 30 dages grace for nye managere |
| 3 | Signerings-restriktion | < 30 | Køb over **300.000 CZ$** kræver bestyrelsens godkendelse |
| 4 | Tvangslistning | < 15 | Beskytter ryttere med popularitet ≥ 70 eller stjerne-værdi |
| 5 | Sponsor-pullout | < 10 **eller** 2× planudløb i træk under 30 % | Faktor **0,90**, stacker multiplikativt med lag 1. Varer én sæson |
| 6 | Bonustilbud | ≥ 75 **og** mindst 75 % af mål nået | **200.000 CZ$**. Bestyrelsens eneste egne penge |

Lag 2-3 håndhæves i transfer- og auktions-routes via `assertSigningAllowed`. Lag 5 hookes ind i
`processSeasonStart`s modifier-stak og udløber automatisk ved sæsonskifte.

---

## 5. Adskillelsen — kontrakten mellem de to systemer

> Ejer-direktiv 25/8 ([#4265](https://github.com/NicolaiDolmer/CyclingZone/issues/4265)):
> *"I sæson 3 skal bestyrelsen og sponsorere adskilles i ui."*
>
> **UI kan ikke adskille det der ikke er adskilt i modellen.** Dette afsnit er forudsætningen.

### 5.1 Sætningen

**EN:** *Your sponsor decides the size of the deal. Your board decides whether you get more or less
of it than agreed — up to 20 % either way.*

**DA:** *Sponsoren bestemmer aftalens størrelse. Bestyrelsen bestemmer om du får mere eller mindre
end aftalt — op til 20 % hver vej.*

Den tidligere formulering, *"sponsor = penge, bestyrelse = tillid"*, er **ikke sand** og har aldrig
været det. `MAX_BOARD_MODIFIER = 1,20` betyder at bestyrelsens tillid ganger sponsorens penge, og
ejer-beslutningen 29/8 om at lade divisions-tillægget gå gennem samme modifier styrker koblingen.
Valget var derfor mellem at fjerne koblingen eller lave sætningen om. **Koblingen bliver; sætningen
er lavet om.** Begrundelse: modifieren er den eneste mekanisme der gør bestyrelsens tilfredshed
mærkbar uden at indføre en ny pengestrøm, og ejer-valg 4 af 7/8 forbød netop nye pengestrømme.

### 5.2 Hvem ejer hvilket håndtag

| Håndtag | Ejer | Manageren påvirker det ved |
|---|---|---|
| Aftalens størrelse (`renownTarget`) | **Sponsor** | at vinde løb — division + resultat-historik |
| Split mellem garanti og løbsdage | **Sponsor** | at vælge arketype |
| Kontraktlængde og klausuler | **Sponsor** | at vælge arketype |
| Divisions-tillægget | **Sponsor** | at rykke op |
| Løbsdags-indtægt | **Sponsor** | at stille til start |
| Resultat- og målbonusser på kontrakten | **Sponsor** | at vinde etaper og nå sæsonmålet |
| **Budget-modifier ±20 %** | **Bestyrelse** | at nå bestyrelsens mål |
| **Sponsor-pullout −10 %** | **Bestyrelse** | at undgå at falde under 10 % tilfredshed |
| **Bonustilbud 200.000** | **Bestyrelse** | at nå ≥ 75 % af målene med ≥ 75 % tilfredshed |
| Lønloft, signerings-restriktion, tvangslistning | **Bestyrelse** | tilfredshed |

**Læseregel:** sponsoren betaler for hvad klubben **er** og hvad den **gør**. Bestyrelsen justerer
udbetalingen efter om den **stoler på manageren**. Sponsoren kender ikke dine bestyrelsesmål;
bestyrelsen kan ikke ændre din kontrakt.

### 5.3 De koblinger der skal væk før UI kan adskilles

| # | Kobling | Skal blive eller gå | Hvorfor |
|---|---|---|---|
| 1 | Budget-modifier ganger sponsorpengene | **Blive** | Ejer 29/8. Sætningen i §5.1 forklarer den |
| 2 | Loftet defineres af `MAX_BOARD_MODIFIER` | **Blive**, men omdøbes i kode og tekst | Det er et *sponsor*-loft; at det er kalibreret mod bestyrelsens maksimum er en implementationsdetalje, ikke en regel spilleren skal læse |
| 3 | Sponsor-pullout er en bestyrelses-konsekvens på sponsor-penge | **Blive** | Den er den hårde ende af samme modifier-akse |
| 4 | Bestyrelsen har et **sponsor-vækstmål** | **GÅ** — eller bygges færdig | I dag umuligt at opfylde (§3). Så længe det findes, blander det de to systemer på den værst tænkelige måde: et bestyrelsesmål der måler sponsoren og altid siger 0 |
| 5 | **Sponsorforhandlingen bor på `/board`** (`BoardPage.jsx:2822` CTA + `:3152` modal) | **GÅ** | Den direkte, mekaniske årsag til at spillerne blander systemerne sammen. Designet 21/6 kaldte det "hybrid"; i praksis betyder det at sponsoren ikke har nogen egen flade |
| 6 | Bestyrelsessidens tilfredshedsmåler forklarer sig selv med **sponsor-modifieren** (`BoardPage.jsx:655`) | **BLIVE, men vendes om** | Det er den rigtige forklaring på det forkerte sted. Den hører hjemme som "hvad din tillid gør ved sponsorudbetalingen", ikke som målerens undertekst |

**Rækkefølgen er bindende:** #4 og #5 skal løses før UI-adskillelsen (#4265) kan bygges. #4 er en
korrekthedsfejl; #5 er en flytning der kræver at sponsoren får sin egen flade at flytte til.

---

## 6. Mandat-modellen (#3514) — godkendt, migreret, slukket

Ejer-godkendt 7/8 med 10 låste beslutninger. Erstatter tre planer med **én relation** (`confidence`
0-100), **ét årligt mandat** (3-5 mål) og en **vision** af milepæle med målsæson.

**Faktisk tilstand, målt 29/8:**

| | Status |
|---|---|
| `board_mandate_model_enabled` | **`off`** siden 17/8 12:35 |
| `board_relations` | 217 rækker, oprettet 23/8 18:38, **ikke opdateret siden** |
| `board_mandates` | 217, alle `season_number = 3`, status `active` |
| `board_vision_milestones` | 2.059 |
| `team_board_members` | 1.085 (5 pr. hold) |
| Backup | `backup_board_profiles_3514_20260823`, 649 rækker |
| Fase 2 (Boardroom-side, årsmøde) | **Findes ikke.** `BoardPage.jsx` er stadig monolitten |
| Issue-label | `claude:done` — med tomme fase-checkbokse |

**Konsekvensen af at flippe flaget i dag:** `boardMandateEngine.js` er den eneste runtime-skriver af
`board_relations`, og den er flag-gated. Skyggemodellen har derfor stået stille i seks dage mens
`board_profiles` er kørt videre. Et flip nu ville vise spillerne et tillidstal fra 23/8 og et mandat
uden S3-fremgang. **Flaget kan ikke flippes uden at skyggedata først genopbygges.**

Ejer-valg 4 af 7/8 er stadig bindende uanset flagets tilstand: **mål-bonusser og -straffe udbetales
kun i tillid.** Penge forbliver i lag 6 og modifieren.

---

## 7. Kendte åbne modsigelser

| # | Modsigelse | Bevis |
|---|---|---|
| 1 | **`sponsor_growth` er umuligt at opfylde** og har været det for alle 135 profiler der bar det. Ejer-beslutning 7/8 om at rette det er ikke bygget | §3, målt 29/8 |
| 2 | **#3514 bærer `claude:done`** mens fase 2 ikke findes og flaget er slukket. Label-tilstanden lyver om leverancen | `gh issue view 3514` |
| 3 | **Skyggemodellen er frosset siden 23/8** og driver længere fra `board_profiles` for hver dag. Ingen vagt måler afstanden | §6 |
| 4 | **Hvorfor flaget blev sat `off` 17/8 kan ikke findes** — hverken i commits eller issue-tekst. Fem dage før den migration det gater | inventaret §5 |
| 5 | **Tre satisfaction-tal, ét gennemsnit.** Spillerne ser tre tal på bestyrelsessiden og ét i økonomien. Rod-årsag til mindst 8 rapporterede fejl | §1 |
| 6 | **`domestic_dominance` er et dødt skelet** der stadig kan genereres | §3 |
| 7 | **#4377 er ubesvaret:** flerårsmåls-tællere ignorerer historik (trøjer 0/2, sponsor 0/8 → 0/12). Formodet fælles rod-årsag med #1, men ikke verificeret for trøje-delen | #4377 |
| 8 | **#4382:** 3- og 5-årsplanens regler for udsættelse, genforhandling og antal bonustilbud er udokumenterede. Tre erfarne spillere kunne ikke svare hinanden 28/8. Denne fil dækker mekanikken, men ikke plan-livscyklussen — det hul står stadig åbent | #4382 |

---

## Kildedokumenter

- `superpowers/specs/2026-08-07-board-mandate-rework-design.md` — de 10 ejer-beslutninger er gyldige;
  §3-5 beskriver en model der er migreret men slukket. Læs den som plan, ikke som tilstand.
- `slices/09-board-mandate-rework-MASTER.md` — faseplanen. Fase 0's #3494 er ikke leveret.
- `slices/02-board-redesign-MASTER.md` — konsekvens-lagenes oprindelse (Appendix C).
- `audits/2026-06-20-board-mechanics.md`, `audits/2026-06-14-board-goal-calibration-findings.md` —
  kalibrerings-grundlaget for mål og tærskler.
- `ECONOMY_RULES.md` §6 — bestyrelsens økonomiske dele, nu udfoldet her.
