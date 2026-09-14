# Trin-tragt: hvor stopper de nye i de foerste 7 dage? (#4964, 14/9)

Undersoegelsesspor, 60 min, read-only SELECT mod prod. Anonymiseret (ingen navne/e-mails).
Bygger videre paa `docs/audits/launch-cohort-dropoff-2026-09-07.md` (samme issue, 7/9) — den
svarede *hvornaar* (foerste time), dette dokument svarer *hvilket trin*.

**Konklusion i én linje:** launch-ugen har ikke sit eget hul. Tragten er den samme som for
etablerede spillere paa alle trin **undtagen ét**: onboarding-trin 2, "koer en traening selv",
falder fra 52 % til 34 % af dem der har en trup. Og hele D7-retentionen ligger i om spilleren
naar alle tre spillerhandlinger: **63-66 % D7 hvis ja, 7 % hvis nej.**

---

## 1. Tragten pr. kohorte (antal og procent af tilmeldte)

Univers: `users` uden testkonto-hold, tilmeldt foer 14/9. Alle trin maalt **inden for 7 doegn
efter tilmelding**. D7 = mindst én `session_started` i doegn 6-8.

| Trin | (a) foer 1/8 n=181 | (b) 1-23/8 n=51 | (c) launch 24-30/8 n=20 | (d) 31/8-13/9 n=12 |
|---|---:|---:|---:|---:|
| Konto oprettet | 181 · 100 % | 51 · 100 % | 20 · 100 % | 12 · 100 % |
| Hold oprettet | 172 · 95 % | 43 · 84 % | 19 · 95 % | 12 · 100 % |
| Trup >= 8 ryttere | 109 · 60 % | 37 · 73 % | 19 · 95 % | 12 · 100 % |
| Trin 1: foerste bud i auktion | 86 · 48 % | 32 · 63 % | 11 · 55 % | 6 · 50 % |
| Trin 2: koert traening selv | 70 · 39 % | 16 · 31 % | **4 · 20 %** | 3 · 25 % |
| Trin 3: egen opstilling gemt | 75 · 41 % | 21 · 41 % | 7 · 35 % | 7 · 58 % |
| Alle tre spillerhandlinger | 45 · 25 % | 14 · 27 % | 4 · 20 % | 2 · 17 % |
| Loebsresultat set | 72 · 40 % | 20 · 39 % | 9 · 45 % | 4 · 33 % |
| Dag-2-login | 43 · 24 % | 12 · 24 % | 4 · 20 % | 1 · 8 % |
| Dag-7-login | 35 · 19 % | 12 · 24 % | 3 · 15 % | 0 af 6 berettigede |

Stoerste enkelt-fald i launch-ugen, raa: **trup >= 8 -> foerste bud** (19 -> 11, -8 spillere,
-42 %), derefter **foerste bud -> koert traening** (11 -> 4, -7 spillere, -64 %). Trin 1 ligger
dog paa niveau med de oevrige kohorter; det er trin 2 der er faldet (se §2).

Kolonne (d) har kun 6 brugere med et fuldt 7-doegns-vindue pr. 14/9; de sidste 6 er censureret
og taeller ikke i D7.

Kohorte (a) er delvis ikke-instrumenteret (se §5) — `trup >= 8` og `trin 1` er **gulve**, ikke
facit, for de 83 der meldte sig foer 1/7. Derfor sammenlignes i §2 paa det instrumenterede
univers: alle med trup >= 8.

## 2. Det ene trin med stoerst frafald

Renset for instrumenterings-hullet, betinget af at spilleren faktisk har en trup paa >= 8
ryttere inden for 7 doegn:

| Onboarding-trin | foer 1/8 (n=109) | ny 1/8-13/9 (n=68) | forskel |
|---|---:|---:|---:|
| 1 · foerste bud i auktion | 71 · **65 %** | 48 · **71 %** | +6 pp |
| 2 · koert traening selv | 57 · **52 %** | 23 · **34 %** | **-18 pp** |
| 3 · egen opstilling gemt | 59 · **54 %** | 35 · **51 %** | -3 pp |
| alle tre | 35 · 32 % | 20 · 29 % | -3 pp |

**Trin 2 er det eneste trin der er faldet.** Bud er gaaet op, opstilling staar stille.
Frafaldet er koncentreret hos dem der ER i gang: 27 af de 48 nye der bood (56 %) koerte aldrig
en traening, mod 27 af 71 (38 %) foer 1/8. Og "traening uden bud" er naesten forsvundet:
13 spillere foer 1/8, **2** efter.

## 3. Hvorfor det trin betyder noget: tragten er binaer

D7 opdelt efter hvor langt spilleren naaede (kun brugere med fuldt 7-doegns-vindue):

| Laengst naaede trin (gensidigt udelukkende) | n (berettiget) | D7 | D7-andel |
|---|---:|---:|---:|
| Intet hold | 18 | 0 | **0 %** |
| Hold, men trup < 8 | 69 | 7 | 10 % |
| Trup, men intet bud | 55 | 5 | 9 % |
| Bud, men ingen egen opstilling | 37 | 3 | 8 % |
| Bud + egen opstilling, men **ingen traening** | 25 | 0 | **0 %** |
| **Alle tre spillerhandlinger** | **54** | **35** | **65 %** |

Bemaerk raekke 5: **25 spillere gjorde alt undtagen at koere en traening — 0 af dem var tilbage
paa dag 7.** Det er den eneste gruppe der naaede langt og alligevel forsvandt fuldstaendigt.

Samme billede delt paa alder: alle tre → 66 % D7 (foer 1/8) og 63 % D7 (nye). Ikke alle tre →
6,8 % og 7,0 %. **De nye spillere der kommer igennem, holder praecis lige saa godt som de
etablerede.** Der er intet "launch-kohorten er daarligere"-signal tilbage naar man betinger paa
trinnet — hvilket bekraefter §0 i 7/9-auditten: 28,6 % vs 86,8 % sammenlignede alle nyankomne
mod en overlevende kerne.

## 4. Én konkret aendring, med forventet effekt i tal

**Aendring:** goer onboarding-trin 2 til ét klik. I dag kraever trinnet at manageren saetter
traeningsfokus rytter for rytter paa traeningssiden (`training_focus_set`, 28.252 haendelser
fordelt paa 92 brugere — en flade for de faa). Bulk-varianten findes allerede
(`training_focus_set_bulk`, kun 32 brugere nogensinde). Forslag: onboarding-kortets trin 2
bliver en primaer knap **"Koer ugens traening"** der saetter et anbefalet fokus for hele truppen
og koerer ugen — samme handling, ét klik, uden at spilleren skal finde traeningssiden foerst.

**Regnestykke ved 6 signups/uge (nuvaerende tilstroemning):**

- I dag: 6 → 4,9 med trup (82 %) → 29 % naar alle tre = 1,4 spillere → D7 = 1,4 × 63 % +
  3,5 × 7 % = **1,1 D7-spillere/uge** (svarer til de maalte 16,7 %).
- Trin 2 loeftet 34 % → 55 % (juli-niveauet), alt andet uaendret → alle tre stiger til ~50 % af
  trup-holderne = 2,45 spillere → D7 = 2,45 × 63 % + 2,45 × 7 % = **1,7 D7-spillere/uge**.
- **Effekt: +0,6 D7-spillere/uge, D7-andel fra ~17 % til ~29 %.** Ved en S4-tilstroemning paa
  20/uge (launch-ugens niveau) er det +2,0 D7-spillere/uge.

Loeftet er lille i absolutte tal fordi tilstroemningen er lille — men det er den eneste af de
tre spillerhandlinger der er faldet, og den billigste at flytte (eksisterende bulk-endpoint,
ingen ny motor).

**Maalepunkt foer/efter:** andel af nye med trup >= 8 der har mindst én
`training_run_today`/`training_focus_set*` inden for 7 doegn. Nu: 34 % (23 af 68). Maal: >= 50 %
paa de foerste 15 nye efter aendringen.

## 5. Hvad der IKKE kunne maales

- **Hvor i UI'et de stopper.** Der findes ingen trin-for-trin-onboarding-events — kun
  `onboarding_completed` (89 brugere nogensinde) og
  `onboarding_first_bid_recommendation_shown/clicked`. Trin 1-3 er rekonstrueret fra
  `auction_bids`, traenings-events og `race_entries.is_auto_filled`, ikke fra onboarding-kortet
  selv. Hvilken skaerm der blev lukket, kan ikke afgoeres.
- **Trin 4 (bestyrelsesplan) er udeladt med vilje.** Den flippede til "faerdig" uden
  spillerhandling (#5103, rettet i 941af4bc9 / PR #5208, merged 14/9), saa ethvert 4-af-4-tal
  foer 14/9 overvurderer gennemfoerelsen. Alle tal her bruger de tre spiller-handlinger.
- **Kohorte (a) foer 1/7 er delvis ikke-instrumenteret:** `session_started` foerst fra 11/5,
  `team_drafted` fra 25/6, `first_race_result_shown` fra 4/8. `riders.acquired_at` kan vaere
  tom for tidlige starter-trupper, saa "trup >= 8" er et gulv for den aeldste kohorte. Derfor
  er §2 den gyldige sammenligning, ikke §1's kolonne (a).
- **Effekten af mail-loopet (on 8/9 kl. 18:07, #2853) kan ikke maales endnu** — kun 6
  tilmeldte siden da har et fuldt 7-doegns-vindue. Kohorte (d)'s 0 af 6 er ikke et resultat.
- **Ingen aarsagssammenhaeng.** Alt her er korrelation: den der koerer en traening selv, er
  ogsaa den der i forvejen er engageret. 65 %-tallet i §3 er ikke et loefte om effekten af at
  tvinge trinnet igennem.
- **Stikproevestoerrelse.** Launch-kohorten er 20 brugere, (d) er 12. Alle procenter paa
  enkeltkohorter er retningsgivende. §2 og §3's tal (n=68 og n=54) er de eneste der baerer en
  beslutning.
- **Ingen sammenhaeng med en kendt aendring omkring launch.** Git-log 1/8-14/9 viser ingen
  commit der roerer traeningsflowet eller onboarding-kortets trin 2 foer launch-ugen; det
  eneste onboarding-fund i perioden er #5103 (trin 4, rettet 14/9) og #5159's
  reload-koordination. Faldet i trin 2 begynder i ugen 10/8 — foer launch-ugen — og fortsaetter
  igennem den. **Launch-ugen er ikke et brud; den er en fortsaettelse.**

## 6. Kilder

`users`, `teams`, `riders`, `auction_bids`, `race_entries`, `player_events` (prod, read-only
SELECT via Supabase MCP, 14/9). Kolonnenavne slaaet op i `database/schema-snapshot.json`.
Tidszone: Europe/Copenhagen. Forgaenger: `docs/audits/launch-cohort-dropoff-2026-09-07.md`.
