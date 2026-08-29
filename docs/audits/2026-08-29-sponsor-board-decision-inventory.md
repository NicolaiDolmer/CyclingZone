# Sponsor + bestyrelse — beslutnings-inventar (2026-08-29)

> **Leverance 1** i sponsor/bestyrelses-SSOT-sessionen. Forarbejde til `docs/SPONSOR_RULES.md` +
> `docs/BOARD_RULES.md` (hard rule 30, ejer-direktiv [#4266](https://github.com/NicolaiDolmer/CyclingZone/issues/4266), frist 1/9).
> **Metode:** hver række er verificeret i kode og/eller mod prod (`ghwvkxzhsbbltzfnuhhz`, read-only SELECT, 29/8).
> Issue-tekst, `claude:done`-labels og spec-status er IKKE brugt som bevis. Hvor jeg ikke kunne
> verificere noget, står det som "ikke verificeret" — ikke som en påstand.
> **Ingen data eller kode ændret af dette dokument.**

---

## 0. Læsenøgle

| Kolonne | Betyder |
|---|---|
| **Bygget?** | ✅ = verificeret i kode OG virker på live-data · ⚠️ = bygget, men virker ikke som beslutningen siger · 🚫 = besluttet, ikke bygget · 🕯️ = bygget, men slukket/ulæst |

Divisions-basen (`SPONSOR_INCOME_BY_DIVISION`, `economyConstants.js:28`) er ankeret under alt herunder:
**D1 600.000 · D2 400.000 · D3 340.000 · D4 315.000.** Renown-multiplieren ligger i [1,00 ; 1,40].
Et holds `renownTarget` skal derfor altid ligge i `[base[div] ; base[div] × 1,40]`.

---

## 1. Sponsor — beslutningerne

| Dato | Beslutningen | Hvor den står | Bygget? |
|---|---|---|---|
| 15/6 | Sponsor-basen skaleres med division i stedet for flad 240k (`strict_fair_v1`) | `economyConstants.js:11-28`; spec 15/6 | ✅ `SPONSOR_INCOME_BY_DIVISION` |
| 17/6 (#1439) | Den flade 2,5M-base fra open-beta-lønkrisen fjernes; intet hold modtager 2,5M | `sponsorEngine.js:5-10` | ✅ |
| 17/6 (#1441 A6) | D3 hævet 260k → 340k mod frossen fresh-lønbyrde ≈316k | `economyConstants.js:20-27` | ✅ |
| 21/6 (#1608) | **Form-frys, "granit":** tier 4 = bunden, base 315k, upkeep 0. Må ikke ændres | `economyConstants.js:24-28,53-55` | ✅ |
| 21/6, ejer-låst | **Renown-input = resultat-historik + division.** Aktivitet er IKKE en multiplier-faktor | spec 21/6 §2; `renownEngine.js` | ✅ |
| 21/6, ejer-låst | **Aktivitet betales per løbsdag**, ikke som binære mål. Ingen clawback | spec 21/6 §2, §4.1 | ✅ `sponsorRaceDayIncome.js` |
| 21/6, ejer-låst | **Forhandling v1 = vælg blandt genererede tilbud. Intet modbud** | spec 21/6 §2 | ✅ |
| 21/6, ejer-låst | **UI-placering: hybrid** — forhandling = modal fra Board; løbende kontrakt = read-only i Finance | spec 21/6 §2 | ✅ `BoardPage.jsx:3152` + `FinancePage.jsx:944-948` — se §4 |
| 21/6, ejer-låst | Sponsor-navne: ~50 fiktive, kuraterede | `sponsorOffers.js` NAME_POOLS (~50) | ✅ |
| 21/6 (kalibrering) | `W_RESULTS = 0,45`, `MAX_MULTIPLIER = 1,40` — harness-kalibreret, ikke gættet | audit 21/6; `renownEngine.js:13-16` | ✅ |
| 21/6 §4.3 | **Mens kontrakten løber er `guaranteed_base` OG `per_race_day_rate` låst.** "Det er hele pointen med længde" | spec 21/6 §4.3 | ⚠️ Basen er låst. Raten er det **ikke** — den genberegnes ved aktivering (#2913). Se §3, fund A |
| 21/6 §4.3 | Board-modifier × pullout × loft anvendes på `guaranteed_base` ved hver sæsonstart; per-løbsdag er RÅ | spec §4.3 | ✅ `economyEngine.js:294-311`, `sponsorRaceDayIncome.js:14` |
| 21/6 §6 | Loftet gøres kontrakt-bevidst: `ceiling = guaranteed_base × MAX_BOARD_MODIFIER (1,20)` | spec §6; `economyConstants.js:67` | ✅ `economyEngine.js:311` |
| 21/6 §9 | **Sponsoren kører på omdømme-PROXY v1** (division + resultat-historik) indtil #1099 lander | spec §9 | ✅ som proxy — men ingen aftalt udgang. Se §5 |
| 5/7 (#1980, ejer-låst) | Nedryknings-faldskærm: `0,5 × (base[gammel] − base[ny])`, 1 sæson, kun D1→D2 og D2→D3 | `economyConstants.js:30-38` | ⚠️ Udbetales, men til hold hvis base ikke faldt. Se §3, fund C |
| 5/7 (fase 3-spec) | **"Oprykning er en investering": højere upkeep straks, højere sponsor-base er opsiden** | spec 5/7 §"Faldskærm" | 🚫 **Basen følger ikke med op.** Dette er #4376's designgrundlag |
| 25/7 (#2913, ejer) | Enheden er **pr. etape**, ikke pr. kalenderdag. Raten sættes ved AKTIVERING mod divisionens faktiske etapetal | `sponsorContractsService.js:92-176` | ✅ |
| 25/7 (#2914, ejer) | Ikke-valg → default **`safe`, 1 sæson** (47 af 73 valgte 1 sæson). Ikke 3 | `sponsorContractsService.js:71-73` | ✅ |
| 25/7 (#2948) | 5 arketyper med frosne andele + bonusklausuler; tilbud deterministiske pr. `team+season` | `sponsorOffers.js` | ✅ |
| 25/7 (#2589/#2926) | Klausuler fryses i kroner ved pick; preview og udførelse deler ÉN regelkilde | `sponsorOffers.freezeClauses`, `resolveContractForNewSeason` | ✅ |
| 3/8 (#3192, ejer merged) | Risiko/afkast-trappe: `results` 55→**60 %** garanti, race-day 10→12 %, klausuler ca. fordoblet; `ambition` klausul 18→38 % + betingelse top-halvdel→**top-40 %** | audit 3/8 §4; commit `0d594ea2c` | ✅ — se §2 om "72 %" |
| 3/8 (#3192) | Eksisterende kontrakter røres ikke; `top_half` og `top_40pct` lever side om side | audit §6 | ✅ `OBJECTIVE_THRESHOLD_FRACTION` |
| 4/8 (#3316, ejer) | Hold uden aktiv kontrakt forhandler for **indeværende** sæson og aktiverer straks; ingen bagudbetaling | `sponsorContractsService.acceptOfferImmediately` | ✅ |
| 4/8 (#3315, ejer) | Notifikation til holdejeren ved sponsor-bonusudbetaling | `notifySponsorBonusPaidSafe` | ✅ |
| 14/8 (#3730) | Hold oprettet midt i sæsonen får kontrakt ved oprettelse + **forholdsmæssig** base efter resterende løbsdage | `midSeasonSponsor.js` | ✅ |
| 23/8 (ejer, cutover) | Upkeep halveret 440/140/40k → **220/70/20k**, netop fordi nyoprykkede D1-hold ville starte i minus på gamle sponsoraftaler | `economyConstants.js:47-56` | ✅ — begrundelsen navngiver #4376's symptom uden at rette årsagen |

---

## 2. Den kendte afvigelse: "results 72 %"

**Opklaret — der er ingen uforklaret værdi.**

- Audit'ens **§4-tabel** (den operative) foreslår: garanti **60 %**, race-day **12 %**, floor **72 %**.
- Audit'ens **TL;DR-prosa** skriver "hæv results' **garanti** fra 65 % til 72 %". Det er tabellens
  **floor**-kolonne (60 + 12 = 72), ikke garantien. TL;DR'en bruger det forkerte ord.
- Koden står på `guaranteedFraction: 0.6` — **præcis §4-tabellen**.
- Landede i commit `0d594ea2c` (PR #3237), forfatter + merger: **NicolaiDolmer, 3/8 19:24**.
  Commit-beskeden siger ordret "garanti 55 % -> 60 %".

Konklusion: 0,60 er den ejer-mergede beslutning. 0,72 er floor'en. Ingen tredje værdi, intet gæt.
Rettelsen hører hjemme i audit-dokumentets TL;DR, ikke i koden.

---

## 3. Fund: beslutninger der ikke gør det de siger

### Fund A — per-løbsdags-raten er ikke låst, selvom §4.3 siger det
`expireAndRenewContracts:738-753` genberegner `per_race_day_rate` ved hver aktivering mod
divisionens etapetal (#2913). Det er en bevidst, senere beslutning — men spec §4.3 er aldrig
opdateret, så to dokumenter siger to ting. **Ikke en fejl. SSOT-gæld.**

### Fund B — `guaranteed_base` rebases aldrig (#4376). Målt 29/8

Invariant: et holds kontrakt-target skal ligge i `[base[div] ; base[div] × 1,40]`.

| Division | Hold | Under gulvet | Over loftet | Inden for båndet |
|---|---|---|---|---|
| D1 | 24 | **21** | 0 | 3 |
| D2 | 48 | **8** | 0 | 40 |
| D3 | 94 | **7** | 0 | 87 |
| D4 | 64 | 0 | 0 | 64 |
| **I alt** | **230** | **36** | **0** | **194** |

- **Underbetaling målt til divisions-GULVET** (multiplier 1,00 — det mest konservative tal):
  **2.194.692 CZ$** (D1 1.672.668 · D2 381.024 · D3 141.000).
- **Underbetaling målt til det KORREKTE target** (gulv × faktisk renown-multiplier): **≈ 8,97 mio CZ$**.
  Forskellen mellem de to tal er renown-låsningen, som §4.3 siger ER tilsigtet. Kun division-ankeret
  er uafklaret. Det er præcis derfor spørgsmål 3 til ejeren findes.
- **S3 er den første sæson med en division 1.** Alle 24 D1-hold kom fra D2/D3, alle har
  `resultsScore` = 1,0 → multiplier 1,40 → korrekt S3-target = **840.000 for samtlige 24**.
  Tre har det. De tre blev oprettet 23/8 kl. 18:22:19-18:22:38 UTC af transitionens egen
  auto-fornyelse — 19 sekunder. Sidste "forkerte" kontrakt blev tegnet 23/8 kl. 17:35.
  **Motoren rammer rigtigt præcis når manageren ikke vælger selv.**
- Én D1-kontrakt er forankret i **D4**-basen (315.000, `long`, løber til og med S4).
- **Basen er allerede udbetalt:** `finance_transactions.type='sponsor'`, 232 rækker,
  **89.420.302 CZ$**, bogført 23/8 kl. 18:27 — fem dage før sæsonen startede.

### Fund C — faldskærmen betaler for et fald der ikke skete
14 hold fik `parachute` i S3 (420.000 CZ$ i alt, alle D2→D3 à 30.000). **4 af dem** har en
flersæsons-kontrakt tegnet i S2 med target 441.000-476.000 — altså en base der aldrig faldt.
De kompenseres for et tab de ikke led. 120.000 CZ$. Lille beløb, men det er samme rod-årsag
som fund B, set fra den anden side.

### Fund D — `sponsor_growth`-bestyrelsesmålet kan matematisk aldrig opfyldes
Beslutning 7/8 (spec §3.1, #3494): sponsor-vækstmålet re-pointes til `sponsor_contracts`-udbetalinger,
**"aldrig `teams.sponsor_income` (dødt felt)"**. Verificeret 29/8:
- `boardGoals.js:1026` læser stadig `context.currentSponsorIncome ?? team.sponsor_income`.
- Alle 6 kaldesteder (`economyEngine.js:1568,1706`, `boardWeekendFinalization.js:394`,
  `api.js:14690,15428`, harness) sender `team.sponsor_income`.
- **Prod: `teams.sponsor_income` = 240.000 for alle 230 hold.** `plan_start_sponsor_income` = 240.000
  for alle 680 board-profiler. Målet regner altså `(240.000 − 240.000) / 240.000 = 0 %` — for alle, altid.
- 135 board-profiler har båret målet (112 i S1, 23 i S2). **Ingen i S3.** Måltypen kan stadig
  genereres til flerårige planer, så den er latent, ikke afviklet.

**Status: 🚫 besluttet 7/8, ikke bygget.** Det er hele forklaringen på spillerklagen "0/8" (#3494/#4377).

### Fund E — Mandatet (#3514) er migreret, men mørkt OG frosset
- `board_mandate_model_enabled = 'off'` siden **17/8 12:35**.
- Migrationen KØRTE alligevel: `board_relations` 217 · `board_mandates` 217 (alle `season_number=3`,
  status `active`) · `board_vision_milestones` 2.059 · `team_board_members` 1.085 ·
  backup-tabel `backup_board_profiles_3514_20260823` med 649 rækker.
- **`board_relations` er ikke opdateret siden 23/8 18:38.** `boardMandateEngine.js` er den eneste
  runtime-skriver og er flag-gated, så skyggemodellen har stået stille i 6 dage mens
  `board_profiles` er kørt videre. **Et flag-flip i dag ville vise spillerne et tillidstal fra 23/8.**
- Fase 2 (Boardroom-siden, årsmødet) findes ikke: ingen `Boardroom*.jsx`, `BoardPage.jsx` er stadig
  monolitten. **#3514 bærer `claude:done` med tomme fase-checkbokse.**

### Fund F — `/rules` og `/help` lover spillerne et sponsor-loft der ikke findes
`FINAL_SPONSOR_PAYOUT_CEILING = { S1: 720.000, S2_PLUS: 900.000 }` har **intet kaldested i backend**
(verificeret: kun deklarationen i `economyConstants.js:61` + en test-kommentar). Loftet blev afløst
af det kontrakt-bevidste `guaranteed_base × 1,20` i #1663.

Men konstanten er duplikeret i `frontend/src/lib/rulesNumbers.js:31-32` og vises som prosa på
`/rules` i BEGGE sprog: *"Den endelige udbetaling er loftet til 720.000 CZ$ i sæson 1 og
900.000 CZ$ fra sæson 2 og frem (efter bestyrelses-modifikatorer)."*
`docs/GAME_INVARIANTS.md:30` gentager den som en levende regel: *"Gælder uanset division eller modifier."*

Reelt: loftet er `guaranteed_base × 1,20`. For S3's tre korrekt-baserede D1-hold er det
772.800 × 1,20 = **927.360** — over det annoncerede loft. For alle andre ligger det langt under.
**Samme fejlklasse som `academySalaryPct` (ECONOMY_RULES §8, fund 2): et player-facing tal der
driver fra den formel der faktisk kører, uden nogen gate der fanger det.**

### Fund G — tilbuds-modalen viser en per-etape-rate der er 2,6× for høj (#4345)
Fra forum-tråden "Financial Punishment?" 28/8: *"I had to pick my sponsor in the beginning of div 3.
Gave me 1.406 pr race. Picking today in div 1 it is 5.800 for same type. Explain this."*

Begge tal er reproduceret eksakt:
- **1.406** ≈ hans nuværende `racing`-kontrakt: target 340.000 (D3-anker), pulje 0,58 × 340.000 =
  197.200, divisor 140 → **1.409**.
- **5.800** = et FRISKT `racing`-tilbud for S4: target 600.000 (D1-anker × 1,00), pulje 348.000,
  divisor **60** → **5.800**. Eksakt.

Divisoren 60 er `FULL_CALENDAR_DAYS`-fallbacken. `loadSeasonStageCounts` finder ingen `seasons`-række
for sæson 4 (den findes ikke endnu), returnerer `byTier = {}` og `fallbackDays = 60`, og modalen
falder tilbage på 60. D1 kører reelt **155 etaper**. Ved aktivering genberegnes raten til
348.000 / 155 = **2.245**.

**Spilleren bliver altså vist 5.800 pr. etape og får 2.245.** Totalen (`certain` = base + pulje)
er korrekt hele vejen — kun rate-linjen er forkert, og det er præcis den linje #4345 handler om.
Modalen selv er i orden (#2862 fikserede den til at projicere mod divisionens etapetal); fejlen er
at der ikke findes etapetal for en sæson hvis kalender ikke er genereret endnu.

### Fund H — den aktiverede rate er sat mod et etapetal der ikke længere gælder
Implicit divisor pr. aktiv kontrakt tegnet til S3, mod sæsonens faktiske etapetal:

| Division | Divisor brugt | Faktisk etapetal | Afvigelse | Hold |
|---|---|---|---|---|
| D1 | 140 | 155 | **+10,7 %** | 19 |
| D2 | 112 | 124 | **+10,7 %** | 36 |
| D3 | 84 | 85 | +1,2 % | 85 |
| D4 | 56 | 62 | **+10,7 %** | 47 |
| D4 | 62 | 62 | 0 % | 14 |

Ved fuld deltagelse tjener 102 hold ca. 10,7 % mere i race-day-penge end `race_day_share × target`.
Kalibrerings-invarianten i spec §4.1 (*"ved fuld kalender gælder base + rate × dage ≈ target"*)
holder altså ikke. Retningen er til spillernes fordel, så det haster ikke — men det er en
uafhængig regel-drift der skal stå i SSOT'en.

---

## 4. Bestyrelse — beslutningerne

| Dato | Beslutningen | Hvor | Bygget? |
|---|---|---|---|
| — | `satisfaction ≥80 → 1,20 · ≥60 → 1,10 · ≥40 → 1,00 · ≥20 → 0,90 · ellers 0,80` | `boardEvaluation.js:108-114` | ✅ |
| — | Modifieren = **gennemsnit** af alle `completed` planers `budget_modifier` | `economyEngine.js:288-292` | ✅ |
| — | Lag 5 sponsor-pullout: `0,90` ved satisfaction <10 ELLER 2× planudløb under 30 %. Stacker **multiplikativt** | `boardConsequences.js:23,33,574-601` | ✅ |
| 7/7 (#2237, ejer) | Blød kalibrering; **bestyrelsen fyrer aldrig** | spec 7/8 §2.5 | ✅ |
| 7/8, ejer-valg 4 | **Belønningsvaluta = kun tillid.** Penge forbliver i lag 6-bonustilbud + budget-modifier | spec 7/8 §3.1, §6 | 🕯️ Bygget bag flag; gamle model kører |
| 7/8, ejer-valg 1 | Én relation, ét tillidstal, ét årsmøde, vision som tidslinje | spec 7/8 §3 | 🕯️ Fase 1 ✅ · Fase 2 🚫 |
| 7/8, ejer-valg 7 | Migrations-vægte 1yr 50 % / 3yr 30 % / 5yr 20 % | `boardMandate.js:26-30` | ✅ (kørt 23/8) |
| 7/8, ejer-valg 9 | Fase 1 lander ved S2→S3-cutover 23/8 | spec §6 | ✅ data · 🕯️ flag off siden 17/8 |
| 7/8 §3.1 | Sponsor-vækstmål re-pointes til `sponsor_contracts` | spec §3.1 | 🚫 **Fund D** |
| 7/8 §2.6 | Stroke-ikoner, T1, ingen emoji-portrætter, én gold-knap | spec §2.6 | 🚫 (fase 2) |
| 25/8 (#4265, ejer) | **"I sæson 3 skal bestyrelsen og sponsorere adskilles i ui"** | #4265 | 🚫 — og står på MASTERPLAN'ens UDSKUDT-liste (28/8). **Spørgsmål 1** |

### Koblingerne mellem de to systemer (verificeret)

| # | Kobling | Hvor |
|---|---|---|
| 1 | Bestyrelsens tillid ganger sponsorens garanterede base (0,80-1,20) | `economyEngine.js:294-311` |
| 2 | Loftet er defineret af `MAX_BOARD_MODIFIER` — sponsorens loft er et bestyrelses-tal | `economyConstants.js:67` |
| 3 | Sponsor-pullout er en **bestyrelses**-konsekvens der rammer **sponsor**-pengene | `boardConsequences.js` lag 5 |
| 4 | Bestyrelsen har et **sponsor-vækstmål** (i dag umuligt, fund D) | `boardGoals.js:233` |
| 5 | **Sponsorforhandlingen bor fysisk på `/board`** — CTA + modal | `BoardPage.jsx:2822,3152` |
| 6 | Bestyrelsessidens tilfredshedsmåler forklarer sig selv med **sponsor-modifieren** | `BoardPage.jsx:655` |
| 7 | Lag 6-bonustilbud er bestyrelsens eneste rene pengestrøm | `boardConsequences.js` lag 6 |

Punkt 5 og 6 er den direkte, mekaniske årsag til at spillerne blander systemerne sammen:
sponsoren har ingen egen flade, og bestyrelsen forklarer sig selv i sponsor-valuta.

---

## 4b. Hvad spillerne selv foreslår (forum-tråden "Financial Punishment?", 28/8)

Kilde: `scripts/discord/.sweep-daily-2026-08-29.md` linje 538-720 (forum-relay i #ops) +
#staff-chat 28/8. Mindst fem spillere.

| Udsagn | Min vurdering |
|---|---|
| *"Your sponsor should be according to the division you're in, not the division you're from."* | **Det er A1.** Formuleret af en spiller der ikke selv er ramt, uimodsagt i tråden. |
| *"I got Div 1 expenses and Div 3 income. The division upkeep is 150k more in Div 1 than Div 3. So the sponsor payout barely covers that difference."* | Korrekt regnet. Upkeep-springet D3→D1 er 200.000 (20k → 220k), og hans sponsor-total er 367.200. |
| *"You basically earn the same in division 1 as division 4"* · *"the sponsors pay the same"* | **Forkert — men de læser data korrekt.** 36 hold bærer et anker fra en anden division, så den observerbare spredning mellem divisionerne er kollapset. Fejlen har lært spillerne en forkert regel. |
| *"I find it unreasonable that we get the same amount from sponsors across all divisions. I don't remember seeing a reply."* | Samme misforståelse, men det er et ubesvaret spørgsmål fra en tidligere lejlighed. Det er fejlen der har skabt indtrykket. |
| *"It is the same CZ$ in total, the reason for the difference is a higher amount of stages"* | Forklaringen er rigtig i princippet (#2913) men dækker ikke tallene her — 1.406 mod 5.800 er 4,1×, og etapeforskellen D3→D1 er 1,8×. Se fund G. |
| *"Hvis der ikke er forskel på basen mellem divisionerne på sponsorer, så få det fjernet fra hjælp"* (#staff-chat) | Hjælpen har ret, koden har uret. Rettelsen hører i koden, ikke i hjælpen. |

**Konklusion:** der er ingen konkurrerende spiller-forslag at vælge imellem. Det eneste forslag der
er formuleret som en regel er A1, og de øvrige udsagn er beskrivelser af symptomet — flere af dem
forkerte på en måde der er direkte forårsaget af fejlen.

---

## 4c. Den fremadrettede kø (leverance 4 — forslag, ejeren ejer rækkefølgen)

MASTERPLAN'ens S3-ramme (ejer 28/8): *"en ren FEJL i en grundregel må rettes; en forbedring må ikke"*
indtil 27/9. Kolonnen "S3?" er den test, ikke en prioritering.

### Nu — korrekthed, tilladt i S3

| # | Hvad | S3? | Hvorfor her |
|---|---|---|---|
| 1 | **#3494** sponsor-vækstmålet peger på det døde felt | ✅ ren fejl | Målet kan matematisk aldrig opfyldes (fund D). Det er også kobling #4 i adskillelses-kontrakten, så #4265 er blokeret bag den. Billigst af alt på listen |
| 2 | **#4376 → divisions-tillægget** | ✅ ejer-undtagelse 29/8 | Formelt en ny mekanik, ikke en fejlrettelse. Ejeren gav undtagelsen eksplicit: opad i S3, nedad fra S4 |
| 3 | **#4345** + fund G | ✅ ren fejl | Tilbuds-modalen viser en rate op til 2,6× for høj når næste sæsons kalender ikke findes. Rammer enhver der forhandler nu |
| 4 | **Fund F** `/rules` lover et loft der ikke findes | ✅ ren fejl | Player-facing tekst der beskriver en regel koden ikke har. Ren tekst- eller konstant-rettelse |
| 5 | **Fund B-invariant som CI-gate** | ✅ værn | `base[div] ≤ renownTarget ≤ base[div] × 1,40`. Fejlen levede seks dage og blev fundet af en spiller, ikke af os. Uden gaten sker det igen |
| 6 | **#4377** flerårsmåls-tællere ignorerer historik | ✅ ren fejl | Trøje-delen er ikke verificeret endnu; sponsor-delen er #3494 |
| 7 | **Fund H** raten sat mod forkert etapetal | ⚠️ rettes ved næste aktivering | 102 hold tjener 10,7 % for meget. Til spillernes fordel, så ingen hast — men rettes ikke midt i sæsonen, det ville tage penge |

### Nu — dokumentation, uden for balance-forbuddet

| # | Hvad | S3? | Hvorfor her |
|---|---|---|---|
| 8 | **#4382** 3- og 5-årsplanens livscyklus er udokumenteret | ✅ docs | Tre erfarne spillere kunne ikke svare hinanden 28/8. `BOARD_RULES.md` dækker mekanikken, ikke plan-livscyklussen |
| 9 | **#4125** upkeep for andre divisioner kan ikke ses | ✅ ux | Oprykning kan ikke prissættes. Ændrer form når **#4385** lander, så byg den enkleste version nu |

### Efter 27/9 — designes nu, shippes senere

| # | Hvad | Hvorfor blokeret |
|---|---|---|
| 10 | **#4385** upkeep → løbende rejse-/personaleudgift pr. løbsdag | Ejer-direktiv 29/8. Grundregel, balance-følsom. Ændrer forudsætningen for divisions-tillæggets form (§3.1 valg 3) |
| 11 | **#3987** base + race-day skalerer med global ranking/løbsdage | Forbedring af en grundregel |
| 12 | **#3595** sponsormål kan ignoreres uden konsekvens | Forbedring. Kræver først en beslutning om hvad et mislykket mål koster |
| 13 | **#3147** race-day som klumpsum ved sæsonslut | Forbedring, og direkte i modstrid med #4385's retning (mere løbende, ikke mindre). Genbesøg efter #4385 |
| 14 | **#3542** D2 opleves som økonomisk straf | Kan ikke måles rent før divisions-tillægget er live — det er formentlig samme rod-årsag |
| 15 | **#2753** transition-preview viser gross, ikke faktisk payout | Lav prioritet, men den skal med i samme runde som divisions-tillægget, ellers viser previewet igen et forkert tal |
| 16 | **#3514 fase 2** Boardroom + årsmøde | Skyggemodellen er frosset siden 23/8. Skal genopbygges før flaget kan flippes. Ejer-beslutning påkrævet |
| 17 | **#4265** UI-adskillelsen | Blokeret bag #3494 (kobling 4) og sponsorens egen flade (kobling 5) |

### Bestyrelses-gæld uden for de to spor

**#3574** (bonus-tilbuddets ekstra-mål er auto-opfyldt i samme sekund det tilføjes) er en ren fejl og
hører i gruppe 1. **#3575** · **#2022** · **#3335** · **#2261** · **#1237** · **#103** er UX og
korrekthed omkring plan-livscyklussen — de bør samles i ét spor sammen med #4382, fordi de alle er
symptomer på at planernes regler aldrig er skrevet ned. **#3152** (tilfredshed opleves som
humør-dræber) og **#1141** (instrumentering) er designspor der forudsætter Mandat-modellen.
**#3511** (perf) og **#3515** (kode-arkæologi) er fase 0b og bør ligge foran fase 2, ikke bagved.

### Planlagt til senere, som designet skal kunne bære

| Landing | Hvad det gør ved sponsor-kontrakten | Svar |
|---|---|---|
| **#1099** fuld omdømme-motor | Erstatter proxy v1. `renownMultiplier` får en ny, bredere kilde | Kontrakter er frosne i kroner, så **ingen løbende aftale flytter sig**. Kun nye tilbud rammes. Divisions-tillægget rører kun `SPONSOR_INCOME_BY_DIVISION`, som #1099 ikke ændrer. **Designet holder** |
| **#1113 → #2222** fans og merchandise | Ny indtægtskilde skaleret af omdømme | Ligger uden for sponsorkontrakten. Risiko er inflation, ikke kontraktbrud. **Holder**, men pengemængde-invarianten skal måles igen |
| **#930/#2217/#2218** staff som lønudgift | Ny fast udgift | Rammer break-even-kalibreringen, ikke sponsor-reglerne. **Holder**, men upkeep-kurven (#3720) og #4385 skal regnes sammen med den |
| **#2492** tre-tier klubstruktur | Egne kalendere pr. tier | **Bryder.** Divisions-tillægget antager ét `division`-felt pr. hold. Har et hold tre hold med hver sin division, er "den division du skrev under i" ikke længere veldefineret. Skal afklares før #2492 designes færdig |
| Kontraktudløb → tvangsauktion | Rytterkontrakter, ikke sponsor | Ingen berøring. **Holder** |
| **#3050** venskabsløb | Tæller de som løbsdage i sponsorens pulje? | **Uafklaret og vigtigt.** Gør de det, kan et hold selv generere sponsor-indtægt ved at oprette løb. Svaret bør være nej, men det skal stå i #3050 før den bygges |
| **#1441** gold sinks og "rigtige sponsorer" | Epic-niveau | For løst defineret til at vurdere |

---

## 5. Hvad jeg IKKE kunne verificere

1. **Hvornår omdømme-proxy v1 skal afløses.** Spec 21/6 §9 kalder den midlertidig. Der findes
   ingen aftalt udgang, ingen dato, intet issue der ejer overgangen for kontrakterne. Ikke fundet.
2. **Om `sponsor_growth`-måltypen skal genoplives eller pensioneres.** #3494's slice siger
   "re-pointes"; spec'en siger det samme; ingen af dem siger hvad der sker med de 135 historiske
   profiler. Ikke fundet.
3. **Hvorfor `board_mandate_model_enabled` blev sat til `off` 17/8 12:35**, fem dage før den
   migration den gater. Ikke fundet i commits eller issue-tekst.
4. **Om nogen ejer-beslutning nogensinde har taget stilling til divisions-ankeret ved
   op-/nedrykning.** Jeg har læst alle 6 økonomi-specs, begge sponsor-audits og
   `ECONOMY_RULES.md`. Den nærmeste udtalelse er fase 3-spec'ens "højere sponsor-base er opsiden"
   ved oprykning (5/7) — men den handler om upkeep-balancen, ikke om kontrakt-låsningen, og de to
   blev aldrig holdt op mod hinanden. **Det er hullet #4376 faldt igennem.**
5. **Om de 36 hold i fund B har oplevet et konkret tab de kan mærke.** Jeg har målt kontrakt-basen
   mod invarianten, ikke holdenes samlede sæson-økonomi (præmier, transfers, lån trækker også).
   At et hold er underbetalt på sponsoren er ikke det samme som at det er i knibe.
6. **Om nogen relegerede hold nogensinde HAR båret en for høj base.** Målingen 29/8 finder nul over
   loftet, men S3 er den eneste sæson med fire tiers. Jeg har ikke rullet målingen tilbage over S2.

---

## 6. Kritik af mit eget arbejde

Jeg gennemgik de to SSOT-filer efter de var skrevet og ledte efter regler jeg havde formuleret uden
faktisk at have verificeret dem. Fem fund. To viste sig at holde, tre gjorde ikke.

**Holdt ved efterprøvning:**
- *"Højst én `active` og én `pending` pr. hold, håndhævet af to delvise UNIQUE-indekser."* Jeg havde
  taget den fra en kodekommentar. Verificeret mod `pg_indexes`: `idx_sponsor_contracts_team_active`
  og `idx_sponsor_contracts_team_pending` findes begge som partielle UNIQUE-indekser.
- *"Sæson-1-sponsor springes over ved uberørt startkapital."* Verificeret:
  `SEASON1_SKIP_SPONSOR_IF_STARTING_CAPITAL = true`.

**Rettet, fordi de ikke holdt:**

1. **"Alle bevægelser logges i `board_satisfaction_events`."** Jeg skrev et designprincip fra
   Mandat-spec'en som om det var en egenskab ved den kørende model. Tabellen skrives af
   `boardWeekendFinalization.js`, men hverken `boardEvaluation.js` eller `economyEngine.js` nævner
   den — sæson-slut-stien er ikke bekræftet som logget. Nedgraderet til det målte:
   1.313 events for 217 hold 23/8, 270 for 94 hold 29/8.

2. **Divisions-tillæggets prissætnings-division var udefineret for 23 hold.** Jeg definerede den som
   "holdets division i sæsonen før `start_season`" — den rekonstruktion jeg selv havde brugt i SQL.
   Målt: **23 af 230 hold har ingen standing i den sæson**, alle oprettet efter 27/7. For dem er
   reglen ikke bare upræcis, den er ubegregnelig. Reglen er skrevet om: divisionen **lagres på
   kontrakten** ved signering, backfilles hvor den kan udledes, og falder ellers til holdets
   nuværende division — hvilket giver tillæg 0, som er det rigtige svar for et hold der ikke har
   nået at flytte sig.

3. **"Simulér-før-ship-harness" stod som håndhævelses-niveau.** `sponsorChoiceScorecard.js` er en
   manuel praksis, ikke en gate. Intet i CI kræver at den er kørt. Rettet til at sige det.

**Adskillelses-sætningen, testet mod spørgsmålet "kan en spiller forudsige hvor pengene kommer fra?"**

Den gamle formulering — *"sponsor = penge, bestyrelse = tillid"* — fejler testen. En spiller der tror
på den, kan ikke forklare hvorfor to hold med identisk kontrakt får forskellige beløb udbetalt.
Præcis den forvirring står i forum-tråden 28/8, hvor en spiller med to hold spørger hvorfor
*"identical schemes"* gav 240.000 og 195.000.

Den nye — *"Sponsoren bestemmer aftalens størrelse. Bestyrelsen bestemmer om du får mere eller mindre
end aftalt, op til 20 % hver vej"* — består testen: den forudsiger både forskellen mellem to
identiske kontrakter og retningen. Prisen er at den opgiver den rene, smukke opdeling. Den var
alligevel ikke sand.

**Hvad jeg ikke nåede at verificere** — ud over §5's seks punkter:
- Hverken `SPONSOR_RULES.md` eller `BOARD_RULES.md` er testet mod en frisk læser. De er skrevet af
  den samme der lavede målingerne, så de kan indeholde antagelser jeg ikke selv kan se.
- Trøje-tælleren i #4377 er ikke undersøgt. Jeg har kun verificeret sponsor-delen af det issue og
  antaget fælles rod-årsag uden bevis.
- Jeg har ikke målt om `board_relations`' frosne værdier faktisk afviger mærkbart fra
  `board_profiles` i dag — kun at de ikke er blevet opdateret. Afstanden kan være nul.
