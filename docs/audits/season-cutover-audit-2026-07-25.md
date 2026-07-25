> **Om dette dokument.** Resultatet af en multi-agent audit 25/7 (16 agenter, 7 spor,
> 127 fund hvoraf 119 overlevede adversariel verifikation). Agent-fund er ikke sandhed i sig selv.
>
> **Jeg har selv efterprøvet, direkte i kode og prod:**
> - `loadHumanSeasonEndTeams` henter ryttere uden paginering (economyEngine.js, `.in("team_id", teamIds)` uden `.range()`) — mens `fetchAllRows` er importeret i samme fil (linje 72) og bruges 6 andre steder i den.
> - `supabasePagination.js:3-15` dokumenterer selv loftet: "PostgREST returnerer maks 1000 rækker pr. select uden eksplicit .range() ... Brug denne helper til ALLE loads der kan overstige 1000 rækker."
> - Prod i dag: **2.652 ryttere på 156 menneskehold**. 43 S1-løb mangler stadig at blive afviklet. 0 hold under 8 ryttere i dag.
> - `SeasonEndPage.jsx:413` renderer `[1, 2, 3].map(...)` — division 4 vises ikke. Linje 255 grupperer på holdets **nuværende** division.
> - `sponsorContractsService.js:21`: `DEFAULT_RENEW_VARIANT = "long"` (3 sæsoners binding).
> - `en/seasonEnd.json:34`: "Bottom 2 relegated" mod motorens `RELEGATION_SLOTS = 4` (economyEngine.js:98).
> - #2851 er uændret siden 23/7 18:45: ingen branch, ingen commit, ingen PR.
> - PR #2844 (#2843 bytte-fortegn), PR #2878 (#2877 timeout-retry) og PR #2904 (recap-perf) ER merged i dag.
>
> **Ikke efterprøvet af mig:** de øvrige ~110 fund, herunder alle beløb i afsnit 3.4 og tallene i afsnit 5, 7 og 8.
> De kommer fra agenter der målte mod prod, men jeg har ikke gentaget hver måling. Behandl dem som stærke indikationer, ikke facit.

---

# Sæsonskifte S1→S2 — handlingsplan

**Skrevet lørdag 25/7 formiddag. Cutover om ~32 timer. Alle tal er målt i prod i dag, ikke hentet fra docs.**

---

## 1. Hovedbudskab

Ja, vi kan køre søndag — men ikke med koden som den står nu.

Der er **ét fund der skal rettes i dag**: `loadHumanSeasonEndTeams` (backend/lib/economyEngine.js:127) henter dine holds ryttere uden paginering. PostgREST returnerer maks 1.000 rækker. Der ligger **2.652 ryttere på menneskehold**. Motoren vil altså kun kunne se ~38 % af dem, når den trækker den første løn nogensinde — og et hold hvis ryttere falder uden for første side får `totalSalary = 0` og dermed **ingen lønpostering overhovedet**. Ikke en fejl, ikke en 0-række: ingenting. Samme funktion fodrer bestyrelses-evalueringen, så de hold får også en bestyrelsesdom på en afkortet trup. Lønnen kan efterbetales bagefter (unique-index pr. hold/sæson). **Bestyrelsesdommen kan ikke** — den skriver `budget_modifier`, som styrer sponsorindtægt i op til 3 sæsoner.

Det værste ved fundet er ikke fejlen, det er at ingen af vores kontroller ville fange den: drejebogens slutkontrol tæller *antal* lønposteringer, ikke beløb, og antallet af hold ville se rigtigt ud.

Alt andet på listen er enten billigt (rettelser i drejebogen), udskydeligt (UI, recap, e-mail) eller allerede løst (recap-perf blev fikset i går, #2843 og #2877 er merged).

Den anden ting du skal afgøre i dag er #2851 — og svaret er nej. Se afsnit 4.

---

## 2. Tidslinje med beslutninger

Alle tidspunkter i **dansk tid**. Sidste S1-etape søndag 19:00, første S2-etape mandag 11:00.

| Tidspunkt | Hvad | Hvem | Hvorfor lige dér |
|---|---|---|---|
| **Lør 25/7 12-14** | Én PR: pagineringsfix + sæsonsidens D4-fejl. Merge + deploy. | Claude | Sidste vindue hvor et deploy kan nå at blive verificeret i ro |
| **Lør 25/7 ~14** | 🚦 **GATE: #2851 — byg eller fallback?** | **Ejer** | Senest i dag. Alt nedenfor afhænger af svaret: promotionslisten, patch noten, Discord-teksten |
| **Lør 25/7 ~14** | 🚦 **GATE: Er PITR slået til på Supabase?** (Settings → Database → Backups) | **Ejer** | 5 min. Afgør om "rul tilbage" overhovedet findes som mulighed søndag |
| **Lør 25/7 15-17** | Drejebogen rettes: re-run-fælden, den fulde regning, snapshots, force-gate, abort-boks | Claude | Skal være færdig før du er træt |
| **Lør 25/7 ~17** | 🚦 **GATE: go til #2700-varslet `--live`** (66 hold med ryttere på 36+) | **Ejer** | **Kan ikke flyttes.** Scriptet dedup'er 24 t — kører det søndag, kolliderer det med skiftets egne beskeder, og et varsel 2 timer før er ikke et varsel |
| **Lør 25/7 ~18** | Ét samlet varsel til alle 153 hold (in-app) + Discord-post | Ejer godkender teksten ordret, Claude sender | Samme aften som #2700, ikke to beskeder — to indbakke-beskeder på én aften læses som spam |
| **Lør 25/7 20:00** | 🔒 **Kode- OG docs-freeze på main** indtil mandag 12:00 | Ejer + Claude | Hver push til main redeployer Railway. Det skete to gange 24/7 midt i en 22-etapers bølge |
| **Søn 26/7 11:00-19:00** | 49 S1-etaper afvikles. Spidser: 12:00 (14 etaper) og 18:00 (22 etaper) | Automatik | 18:00-bølgen tager målt 19-24 min → færdig 18:25 |
| **Søn 26/7 18:35** | Tjek: uafviklede S1-løb ≤ 2 | Claude | Fastsat grænse **på forhånd**, så beslutningen ikke træffes i stress kl. 19:20 |
| **Søn 26/7 19:15** | Markedet sættes på pause (`POST /admin/market/pause`, level `all`) | Claude | 15 auktioner udløber 19:23 — inde i cutover-vinduet |
| **Søn 26/7 ~19:30** | Snapshots tages: teams, season_standings, team_global_rank_points, riders | Claude | **Eneste reelle recovery-vej.** Se afsnit 3 |
| **Søn 26/7 ~19:30** | Op/nedrykningslisten genereres og vises | Claude | Kun når alle tre nul-tjek er 0 — ikke på et klokkeslæt |
| **Søn 26/7 ~19:40** | 🚦 **GATE: godkend listen** (både plads 44-52 og 140-150 med pointafstande) | **Ejer** | Cutlinen ved plads 144 afgøres af 4 point. Den flytter sig helt frem til sidste etape |
| **Søn 26/7 ~19:45** | Skridt 3: "Afslut sæson". **Ét klik. Aldrig to.** | Ejer klikker, Claude overvåger logstrøm | Forvent minutter, ikke sekunder |
| **Søn 26/7 ~19:50** | Window-wrap-SQL — **som ÉN sætning** | Claude | Splittes den, kan squad-enforcement nå at tvangshandle på 153 hold |
| **Søn 26/7 ~20:15** | Skridt 5: transitionen. **Point of no return** | Ejer klikker, Claude overvåger | Hold mellemrummet fra skridt 3 kort — der er ingen aktiv sæson imens |
| **Søn 26/7 ~20:30** | Slutkontrol: finance_transactions pr. type, notifikationer, entries | Claude | |
| **Søn 26/7 ~20:45** | Markedet genåbnes + Discord-post med de faktiske tal | Ejer godkender, Claude poster | Resume skubber auktionernes sluttid frem, så budgivere ikke mister tid |
| **Man 27/7 10:45-11:30** | 🚦 **Morgenvagt.** Er der aftalt nogen? | **Ejer — beslut i dag** | Det er en mandag formiddag. Se afsnit 7 |

**De beslutninger du skal træffe i dag: fire.** #2851, PITR-status, go til #2700, og hvem der har mandagsvagten.

---

## 3. Blokerende før cutover

Kun det der reelt skal være på plads.

### 3.1 Pagineringsfixet + sæsonsiden — én PR, i dag (~2 t, Claude)

**Backend.** `loadHumanSeasonEndTeams` henter ryttere uden `.range()`. Verificeret i dag: 2.652 ryttere på 156 hold mod et loft på 1.000. Fire kaldsteder rammes — payroll (:498), season-end/bestyrelse (:1088), reparationsvejen (:1197) og admin-previewet (api.js:9645). Fixet er mekanisk: wrap i `fetchAllRows(...)` med `.order("id")`. Helperen er allerede importeret i samme fil (linje 72) og bruges seks andre steder i den. Repoet har en commit fra netop denne fejlklasse: *"paginér race_results i updateStandings (1000-row-loft tabte 38% point)"*.

**Frontend, samme PR.** Sæsonsiden viser kun division 1-3 (`SeasonEndPage.jsx:413`), og den grupperer hold på deres **nuværende** division (`:255`), som skiftet lige har ændret. 57 af 153 ægte hold ligger i D4 og kan ikke finde sig selv. Det er præcis den side `season_ended`-notifikationen sender alle managere til søndag ~19:50. Perf-problemet på siden blev løst i går (PR #2904, 9,5 min → 295 ms), så det er ren korrekthed der mangler.

**Hvorfor det blokerer:** lønnen kan efterbetales, bestyrelsesdommen kan ikke. Og notifikationen kan ikke un-sendes.

### 3.2 #2851-beslutningen (15 min, ejer)

Se afsnit 4. Uden den kan hverken promotionslisten, patch noten eller Discord-teksten skrives.

### 3.3 #2700-varslet `--live` (30 min, ejer-go)

93 ryttere på 36+ ligger på 66 menneskehold. Målt i dag: **0 varsler sendt nogensinde**. Vores egen hjælpe-FAQ lover ordret at man får et varsel. Deadline er reel — scriptet dedup'er på 24 timer, så det skal ud i aften, ikke søndag.

Bemærk en fælde i teksten: markedets viste alder er indeværende sæsons (2026 − fødselsår), mens pensionsmotoren regner på næste sæsons. En rytter der står som **39** i markedet er 40 ved skiftet og pensioneres **garanteret**. Skriv "lagt et år til" ind i varslet.

### 3.4 Snapshots + fire rettelser i drejebogen (1 t, Claude)

**Snapshots før skridt 3** — `teams(id, name, is_ai, division, league_division_id, balance)`, `season_standings` for S1, `team_global_rank_points`, `riders(id, team_id, contract_end_season, salary)`. Gemt som filer.

**Rettelse 1 — den farligste linje i hele drejebogen.** Linje 125 siger *"Flytningerne er idempotente (samme destination)"*. Det er forkert for den sti knappen faktisk bruger. Ruten kører `updateStandings` → `processSeasonEnd`, og standings-genberegningen læser divisionen fra `teams`-tabellen, som allerede er muteret. Et re-run rykker altså de samme hold op **igen**. Og det er ikke en teoretisk risiko: D3-puljernes topscorere har 12.600-15.937 point, mens D2-puljernes maksimum er 4.636. Et hold der lige er rykket til D2, vil med matematisk sikkerhed ligge nr. 1-2 dér og rykke videre til D1. Ny hård regel: **efter en fejlet season-end genkøres ruten aldrig — snapshots gendannes først.**

**Rettelse 2 — regningen.** Drejebogen siger 2,62 mio. Målt i dag:

| Post | Beløb | Bemærkning |
|---|---:|---|
| Rytterløn | 3.220.441 | heraf ~203.000 akademiryttere |
| Divisions-upkeep | ~3.840.000 → ~4,5 mio. | nævnes slet ikke i drejebogen; genmåles efter oprykning |
| Akademi-drift | 1.610.000 | 322 akademiryttere |
| Facilitets-upkeep | 733.000 | 57 hold |
| Staff-løn | 45.261 | 47 hold |
| **Kontant i alt** | **~10,1 mio.** | mod drejebogens 2,62 mio. |
| Lånerente | 1.155.511 | **kapitaliseres på lånet — rører ikke balancen** |

Alle otte transaktionstyper (sponsor, salary, upkeep, academy_drift, facility_upkeep, staff_salary, bonus, parachute) har **0 rækker i prod, nogensinde**. Verificeret i dag. Det her er ikke "utestet i denne skala" — det er kodestiens allerførste kørsel med penge.

**Rettelse 3 — den positive sikkerhed.** Alle ni penge-typer er dækket af unique-indices eller `uniq_finance_idempotency_key`. **Penge kan ikke dobbeltbetales.** Det skal stå eksplicit, så du tør genkøre transitionen i stedet for at gætte. Undtagelsen er `global_rank_decay`, som halverer igen ved et re-run — men netop ved dette skifte er alle 339 `banked_points` = 0, så et dobbeltrun er ordens-neutralt. Drejebogen modsiger i øvrigt sig selv om præcis det (linje 157 siger "STOP HELT", linje 224 siger "kør igen") — begge skal rettes.

**Rettelse 4 — force-gaten.** `force=true` slår **alle** readiness-checks fra på én gang; der er ingen per-check-override. To af dem beskytter mod den eneste virkelig irreversible fejl: kører man transitionen på en stadig-aktiv sæson, springes bestyrelses-evaluering, divisionsbonus og op/nedrykning helt over — og season-end afviser bagefter en allerede completed sæson. Før force sendes, køres denne som SQL (ikke aflæst i preview-UI'et, som kan være stale):

```sql
select (select status from seasons where number=1) as s1_status,
       (select count(*) from races
        where season_id='00000000-0000-0000-0000-000000000001'
          and status<>'completed') as unfinished;
```
Kræv `completed` og `0`. Ellers stop.

### 3.5 Backup-sandheden (5 min, ejer)

Drejebogen kalder en frisk backup *"det eneste ægte sikkerhedsnet under skridt 3-5"*. Organisationen kører Supabase **Pro**, hvor standard-backup er **daglig** — punkt-i-tid-gendannelse er et betalt tilvalg. Er PITR ikke aktiv, er nærmeste gendannelsespunkt natten til søndag, og en gendannelse ville kaste **hele søndagens 49 etaper og alle søndagens handler** væk for at fortryde et 30-minutters skridt. Og selv med PITR gendanner Supabase hele projektet, ikke en tabel.

Tjek det i dag. Er PITR ikke slået til, skal drejebogens skridt 0 omskrives til sandheden: *der findes ingen brugbar rollback; sikkerheden ligger i snapshots og abort-disciplin* — og så bliver snapshots i 3.4 obligatoriske, ikke anbefalede.

### 3.6 Deploy-freeze fra i aften kl. 20 (15 min at aftale)

Railway redeployer ved hver push til main — også rene docs-commits. Det er bevist: den aktive deployment lige nu er en NOW.md-commit. To deploys landede 24/7 direkte inde i en 22-etapers bølge på 23,5 minutter, mod 30 sekunders nedlukningsnåde. Skaden er permanent tabt etape-berigelse (runs, passager, hændelser) — **ikke** en blokeret cutover; recovery-stien finaliserer hængende løb inden for 5-10 min. Men det gælder også dine egne close-out-commits på NOW.md.

---

## 4. #2851-beslutningen

**Hvad det er:** planen om at komprimere pyramiden ved dette ene skifte — de bedste 48 hold fra sæson 1 rykker direkte i 2. division, i stedet for at motorens normale regel (top 2 op, bund 4 ned pr. pulje) får lov at gælde. Du annoncerede det offentligt i Discord 23/7 kl. 18:22, og igen kl. 18:37 med: *"whatever amount that goes into 1. division — I will give 2. division an equal amount up."*

**Status, verificeret i dag:** ingen branch, ingen commit, ingen PR, ingen kode nogen steder i repoet. Issuet er ikke rørt siden 23/7 kl. 18:45. Mandatet havde en hård fallback-deadline: *bevist lørdag aften, ellers motorens regler.*

### A — byg det i nat
- **Fordel:** løftet holdes. 48 hold rykker op, D2 fyldes, pyramiden ligner noget.
- **Omkostning:** 8-12 timers arbejde i op/nedrykningsmotoren, uden økonomi-simulering, 30 timer før en irreversibel operation. Det ændrer også regningen markant: divisions-upkeep springer fra ~4,5 mio. til **10,56 mio.** fordi 48 hold pludselig betaler D2-sats. Det er en balancebeslutning i sig selv, som du ikke har set tal på. Og det er den eneste vej der **ikke** er generalprøvet.
- **Alternativ inden for A:** en ren SQL-omfordeling efter season-end i stedet for kode. Frister, men den kolliderer med motorens egen flytning (hold bliver flyttet to gange) og med standings-snapshottet. Frarådes.

### B — kør motorens regler (fallback)
- **Fordel:** den eneste vej der er gennemprøvet. Ingen ny kode i den irreversible sti. Alle de andre rettelser på listen kan nå at blive lavet ordentligt.
- **Omkostning:** ~8 ægte hold rykker D3→D2 i stedet for 48. Du skal skrive en besked om et løfte du ikke holdt.
- **Alternativ:** byg komprimeringen som en selvstændig, simuleret operation i mellemsæsonen S2→S3, hvor den kan testes uden et ur der tikker.

### 👍 Min anbefaling: **B**

Ikke fordi A er umuligt, men fordi A kræver at du shipper en balance-følsom motorændring uden simulering, ind i en operation der ikke kan rulles tilbage, samtidig med at det kritiske fund i afsnit 3.1 også skal rettes. Det er to ubeviste ting i samme irreversible kørsel.

Løftet koster dig en besked. Fejler komprimeringen, koster den dine 153 holds sæsonstart.

**Skriv fallback-beskeden FØR du træffer beslutningen** — så et nej ikke også koster dig en tekst kl. 23. Skelettet: hvad jeg lovede (begge udsagn) · hvad jeg ikke nåede · hvad der sker i stedet (top-2 op, bund-4 ned, ~8 hold op fra D3) · hvornår de 48 så rykker · hvorfor jeg hellere udskyder end kører noget ubevist mod jeres hold. Kort, ingen forsvarstale.

Bekræft samtidig fallbacken skriftligt på #2851 og fjern den dobbelte plan i drejebogens linje 3 — søndagens operatør skal ikke stå og fortolke et "ændres når #2851 er bygget".

---

## 5. Bør nås før cutover hvis der er tid

Rangeret. Alt sammen kan droppes uden at cutoveren fejler.

1. **Sponsor-defaulten (5 min).** 80 af 153 hold har ikke valgt sponsorkontrakt til S2. De får automatisk varianten `long` = **3 sæsoner bundet**, 73 % garanteret base. Af de 73 hold der faktisk valgte, valgte **47 én sæson og kun 7 valgte tre**. Defaulten er altså det modsatte af hvad flertallet vil have. Ét konstant-swap i `sponsorContractsService.js:21` fra `"long"` til `"predictable"` halverer skaden: et ikke-valg binder så én sæson i stedet for tre. Der findes unit-tests. Kombinér med én linje i varslet: *"vælger du ikke, vælger klubben for dig"*.

2. **Sponsor-spørgsmålet i Discord (30 min).** Der er stillet et konkret spørgsmål i #questions-and-answers, som stadig er ubesvaret — og i morges begyndte en spiller at anbefale hele communitiet at vælge sponsor 2 fordi ingen har svaret. Men **svar det ikke før du har afgjort én ting**: raten beregnes som `(target − garanti) / 28 kalenderdage`, men udbetales pr. **etape** — og S2 har 140 etaper i D1, 112 i D2, 84 i D3, 56 i D4. Den variable del udbetaler altså 2-5× det raten er regnet til, afhængigt af division. Mekanikken har **0 udbetalinger nogensinde** og tændes første gang søndag med 73 kontrakter. Afgør om det er den tilsigtede model, og post så tallene.

3. **Akademi-graduering (20 min).** Endnu en fase der fyrer for første gang: **21 akademiryttere på 16 hold** fylder 22 og får en 7-dages frist. Sker der intet, vælger motoren selv — og reglen er *promovér hvis der er plads og balancen er ≥ 0, ellers **sælg***. Lønnen trækkes få minutter før. Et hold der lander i minus får sit talent sat på auktion. Skriv fasen ind i drejebogen og læg én linje i varslet.

4. **Gældsloftet efter renten (30 min).** Renten lægges oven på lånet **før** gældsloftet måles. Målt i dag: 29 hold har gæld, og **11 af dem bryder loftet i deres nuværende division efter renten**. De får `transfer_frozen = true` skrevet **uden nogen besked** — modsat nødlåns-grenen, som notificerer. De opdager det først når de prøver at handle i S2's første uge, hvor 195 frigivne ryttere rammer markedet. Genmål søndag når divisionerne er kendt, og send en besked til dem der rammes.

5. **Peak-planer (20 min).** 64 S2-peak-planer på 13 hold peger allerede på løb i den pulje holdet ligger i nu. Rykker holdet op, findes målløbet ikke i deres nye kalender — og de får ingen fejl. Drejebogen har et skridt for de 34 manuelle S2-udtagelser, men ikke for peak-planerne. Det er de mest engagerede managere i spillet.

6. **De to hold med manuelle S2-udtagelser (10 min).** Bacon Fræsers (28 entries) og RMF Pro Athletic (6). Under motorens regler skal de kun ryddes hvis holdet flytter — tjek det søndag. Skriv til dem uanset: de er de eneste to der har gidet udtage manuelt.

7. **Hjælpetekster der siger noget forkert (1 t).** `seasonEnd.json` siger *"Bottom 2 relegated"* i begge sprog — motoren tager **bund 4**, og det er forkert allerede i dag. Samme fil-runde: `help.json` siger at admin lukker transfervinduet og starter sæsonen (markedet er altid åbent), og at standings opdateres ved resultat-upload (findes ikke længere). Én PR, samme to filer i begge sprog.

---

## 6. Under selve kørslen — det drejebogen mangler

Konkrete tilføjelser til `docs/SEASON_TRANSITION_CHECKLIST.md`:

**Skridt 1 (afvikling).** Faktiske spidser søndag: 12:00 dansk = 14 etaper, 18:00 dansk = 22 etaper. Målt varighed for en 22-etapers bølge: 19-24 min. To hårde tjekpunkter: kl. 18:35 skal uafviklede S1-løb være ≤ 2; kl. 19:15 skal de være 0. Er de ikke 0 kl. 19:20: vent maks to scheduler-ticks (10 min), eskalér derefter til manuel simulering. **Sæt grænsen nu, ikke kl. 19:20.**

**Nyt skridt 1b (19:15).** `POST /api/admin/market/pause` med level `all`. 15 auktioner udløber 19:23 — inde i vinduet. Genåbn efter skridt 6; systemet skubber selv sluttiderne frem.

**Skridt 2 (godkendelse).** Tilføj `and pool_size >= 24` til `pool_all_real`-betingelsen — koden kræver det, SQL'en gør ikke, så listen kan i dag vise nedrykningskandidater som motoren tavst springer over. Tilføj kolonner for aktiv gæld og det nye gældsloft. Og kør denne først:

```sql
select (select sum(total_points) from season_standings
        where season_id='00000000-0000-0000-0000-000000000001'),
       (select sum(points_earned) from race_results rr
        join races r on r.id=rr.race_id
        where r.season_id='00000000-0000-0000-0000-000000000001'
          and rr.team_id is not null);
```
De to skal være lige. Er de ikke, kører der stadig et løb, og listen du er ved at godkende er ikke færdig.

**Skridt 3 ("Afslut sæson").** Fire tilføjelser:
- *Forvent minutter, ikke sekunder.* Ud over bestyrelses-loopet (438 planer × ~4 databasekald) rekonciliérer motoren AI-hold i alle 15 puljer i samme request: ~20 AI-hold oprettes/slettes, ~160 rytterrækker berøres, og hvert nyt AI-hold får allokeret en trup.
- *Klik ÉN gang.* Sæsonens status sættes til `completed` **til allersidst**, så et andet samtidigt POST passerer guarden i flere minutter. Der er ingen advisory lock (#2847).
- *En browser-timeout betyder ikke at det fejlede.* Railways proxy lukker forbindelsen efter 5 minutter uden datatransfer, mens serveren arbejder videre. Ser du en fejl: verificér i SQL (`seasons.status`, antal `bonus`-transaktioner, divisionsfordelingen) — klik aldrig igen.
- *Fejler klikket med "statement timeout" (57014): intet er skrevet endnu, og retry-laget fra PR #2878 håndterer det.*

**Skridt 3, rollback-afsnittet.** Skriv sandheden: ægte holds placering kan gendannes fra snapshottet — **AI-laget kan ikke**. Rekonciliationen har oprettet nye AI-hold med trupper fra fri-agent-poolen og hard-slettet overskydende. De slettede kan ikke genskabes.

**Skridt 4 (window-wrap).** *Denne UPDATE skal køres som ÉN sætning.* Sættes `closed_at` uden samtidig at sætte `squad_enforcement_completed_at` og `final_whistle_sent_at`, opstår der et op til 5 minutter langt vindue hvor squad-enforcement kan tvangshandle på tværs af 153 hold. Verificér bagefter at alle tre felter er udfyldt. Tilføj samtidig `board_negotiation_state` til den SELECT der allerede står i skridt 7.

**Skridt 5 (transitionen).** Kald det fra terminalen, ikke fra browseren:
```
curl -sS -X POST -H "Authorization: Bearer $TOKEN" ... | tee transition-log.json
```
Åbn Railway-logstrømmen **før** klikket — motoren logger pr. hold, så logstrømmen *er* fremdriftsvisningen. Der findes ingen anden. Og et 500-svar fra denne rute når aldrig Sentry (ruten fanger fejlen selv).

**Skridt 5, ny beslutningsboks.** Ved fejl **eller manglende svar**:
```sql
select count(*), max(created_at) from admin_log
 where action_type='season_transition' and created_at > now()-interval '1 h';
select banked_points, updated_at from team_global_rank_points
 order by updated_at desc limit 5;
select number, status from seasons order by number;
```
Er `updated_at` fra de sidste minutter, **er** global rank-halveringen kørt, og en genkørsel skal springe den fase over — det kan kun gøres via script, ikke via knappen.

**Skridt 5a, forventet fase-log.** Skriv tallene ind, så en afvigelse er synlig med det samme: sponsor_payout ~153 · season_payroll ~3,2 mio. · contract_expiry_release 195 (0 på menneskehold) · rider_progression med ~87 pensioneringer (30 menneske / 44 AI / 13 uden hold) · academy_graduation 21. Og: *sponsor_payout, season_payroll og season_parachute er ÉN blok uden delvis genoptagelse. rider_progression er derimod isoleret og kan køres igen alene.*

**Skridt 5b (force).** Erstat auktions-queryen. Den nuværende måler `contract_end_season <= 1 or is_retired` — begge er strukturelt 0 før transitionen, så den returnerer altid 0 og giver falsk tryghed. Den mængde der betyder noget er ryttere på 36+:
```sql
select a.id, r.firstname, r.lastname,
       (2027 - extract(year from r.birthdate)::int) as alder_s2, a.calculated_end
from auctions a join riders r on r.id=a.rider_id
where a.status in ('active','extended')
  and (2027 - extract(year from r.birthdate)::int) >= 36;
```
Er der rækker: annullér auktionerne før transitionen. Der er ingen pensions-guard i finaliseringen, og pensionsfrigivelsen rører ikke auktioner — køberen ville betale for en rytter der aldrig kan starte.

**Abort-tabellen.** Tilføj: *"Scheduleren kaster hvert tick efter transitionen → kør først `select count(*) from seasons where status='active'`. Er den 2, er det #2743 og ikke en motorfejl — markér den forkerte sæson completed manuelt."* Det er den billigste linje i hele dokumentet.

**Skridt 7.** Kald admin-endpointet der synkroniserer Discord-divisionsroller. Ellers er ~35 holds roller forkerte i op til et døgn — præcis i det døgn hvor oprykning er det eneste folk taler om.

**Slutkontrollen (skridt 5).** Tæl transaktioner **pr. type**, ikke bare sponsor og salary:
```sql
select type, count(*), sum(amount) from finance_transactions
where season_id='00000000-0000-0000-0000-000000000002'
group by type order by type;
```
Forventede typer: sponsor, salary, upkeep, academy_drift, facility_upkeep, staff_salary, parachute. Mangler `academy_drift` eller `facility_upkeep` helt, er noget galt. Og tæl `select count(*) from teams where transfer_frozen=true` — den er 0 i dag.

---

## 7. Straks efter (mandag/ugen)

**Mandag før 11:00 — beviser sig første gang ved dette skifte:**

| Hvad | Verifikation | Forventet |
|---|---|---|
| Payroll ramte alle hold | `select count(*), sum(amount) from finance_transactions where type='salary' and season_id=<S2>` | 153 hold, ~3,2 mio. — **dette er pagineringsfixets bevis** |
| Pension | `select count(*) from riders where is_retired=true` | ~87 nye, 0 hold under 8 ryttere |
| Akademi-graduering | `select status, count(*) from academy_graduation group by 1` | 21 pending |
| Notifikationer | `season_started` og `season_ended` | begge ~150. Under 100 → undersøg fase-loggens delivered/deduped/failed **før** mandag morgen |
| Global rank | `select count(*) from team_global_rank_points where banked_points > 0` | > 0 |
| Frosne hold | `select count(*) from teams where transfer_frozen=true` | 0 i dag → forventet ~6-11 |
| Hold oprettet i det døde vindue | `season_1_identity_basis` på hold oprettet mellem skridt 3 og 5 | der oprettes 3-4 hold i døgnet — ret manuelt hvis der er nogen |
| Træthed | `select round(avg(fatigue),1) from rider_condition` | **86,7 i dag** — se afsnit 8 |

**Mandagsvagten.** Drejebogens skridt 8 kræver en åben session 10:45-11:30 dansk. Det er en mandag formiddag. Kan du ikke være der, så sæt en simpel selvkontrol op i stedet: en besked kl. 11:30 med antal completede S2-løb (≥ 1) og antal S2-resultatrækker (> 0). Belastningen er lav — mandag topper med 14 etaper mod S1's 22 — så risikoen er ikke kapacitet, den er at ingen ser efter. **Og 26 af 27 Sentry cron-monitorer har været slået fra siden 16/7 (#2892).** Det er fem minutters klik i Sentry-UI'et og gen-tænder alarmen på præcis de to jobs der skal overleve mandag. Tag det i weekenden.

**I løbet af ugen:**
- Træningsplaner: 1.966 planer på 91 hold bliver ugyldige. Motoren **stopper ikke** — den skifter tavst alle ryttere til auto-programmer valgt ud fra rytterens type. Manageres bevidste valg bliver altså ikke sat på pause, det bliver overskrevet, hver dag. "Kopiér sidste sæsons plan" bør lande mandag formiddag.
- Bestyrelsesplaner: 133 hold får deres 1-års plan sat til pending og får en notifikation. Men dashboardets "Næste træk" viser den ikke, fordi gaten aggregerer på tværs af alle tre plantyper.
- Flip `email_loop_enabled` til `dry_run` (#2853) — **ikke** samme døgn som cutoveren. Loopet er bygget, cron-kørt og Sentry-overvåget; det er mørkt fordi app_config-nøglen ikke findes. `dry_run` kører fuld targeting og logger uden at sende. `email_log` har 0 rækker nogensinde, så første række er også beviset på at det lever.
- Label-hygiejne: #2843 og #2877 er merged men stadig `claude:todo`. NOW.md linje 35 lister stadig #2843 som næste kritiske session.
- Ryd de 24 forældreløse S1-race_entries.

---

## 8. Uplanlagt — det vi slet ikke har på listen

**1. Feltet starter sæson 2 med en gennemsnitstræthed på 86,7 af 100.** Målt i dag: 6.076 ryttere har træthed > 0, gennemsnit 86,7, maks 100. Træthed nulstilles **ingen steder** i transitionen. Sidste S1-etape er søndag 19:00, første S2-etape mandag 11:00 — 16 timer. Sæson 2's første uge afgøres altså delvist af hvem der tilfældigvis ikke var udtaget søndag aften, ikke af holdets kvalitet. → **Issue.** Det er en balancebeslutning (skal et sæsonskifte give feltet en hviledag?) der hører under simulér-før-ship — men den kan ikke træffes af nogen der ikke ved at tallet er 87.

**2. Akademiet har ingen sæson-optagelse.** 21 ryttere forlader akademiet ved dette skifte. Der kommer **nul ind**. `runAcademyIntake` kaldes tre steder — relaunch, signup og en heal-sweep — og aldrig fra transitionen. Kodens egen fejltekst siger *"run after season transition"*, men ingen gør det. Med den nuværende aldersfordeling (68 er 17 år, 64 er 18, 87 er 19, 67 er 20) tømmes akademiet over 4-5 sæsoner uden at nogen opdager hvornår det gik galt. → **Issue.** Det er en spildesign-beslutning, ikke en bug: enten er akademiet en engangs-beholdning (og så skal det stå i hjælpen), eller også skal optagelsen wires ind. Simulér før ship.

**3. Nødlåns-frysning ophæves af gældstjekket i samme kørsel.** Ægte kode-bug: de to eskaleringsmekanismer deler kolonnen `transfer_frozen` uden at kende hinanden, og gældstjekket læser et forældet in-memory-objekt og overskriver nødlåns-frysningen. Kan bevisligt ikke fyre 27/7 (0 hold har nødlåns-streak). → **Issue efter cutover.** Rør den ikke nu.

**4. Sponsor-fornyelsen taber renown-multiplikatoren for hold der skifter division.** Fornyelsen slår holdets S1-placering op *filtreret på holdets nye division* — og finder derfor ingenting for et hold der lige er flyttet. Multiplikatoren falder til 1,0, og det propagerer hele vejen til udbetalingen. For et top-D3-hold der rykker op: 400.000 i stedet for op til 560.000, **låst i 3 sæsoner**. Det rammer kun de hold der ikke selv har valgt (de 73 der valgte, låste deres base før flytningen). Det er ikke en cutover-artefakt — det er en permanent motorfejl der rammer hver eneste sæson med op/nedrykning. → **Issue, høj prioritet.** Fixet er lille: brug S1-rækken uden divisionsfilter, præcis som udbetalingsstien allerede gør. Men bindingen er 3 sæsoner, så tag stilling til om det skal med i dag.

**5. Dry-runnet overvurderer sponsor systematisk med ~20 mio.** Previewet modellerer den kontraktfri "variable" tilstand, men udbetalingen sker **efter** at fornyelsen har oprettet aktive kontrakter — og så udbetales den garanterede base i stedet. Drejebogens 66,03 mio. er altså ikke det der udbetales; det reelle tal er ~45 mio. → **Notér forbeholdet i drejebogen i dag; fix previewet senere.**

**6. Nettoinjektionen er +30 mio. i en økonomi på 57,5 mio.** Sponsor ~45 mio. ind, ~10 mio. i drift ud, mod en samlet menneskehold-balance på 57.463.357 målt i dag. Det er over 50 % af pengemængden på én transaktion. Det er en **balancebeslutning**, ikke en driftsbeslutning — og du bør se tallet før du trykker, ikke efter.

**7. Der er ingen fælles mekanik for "manageren tager sin opsætning med over".** Fem ting som manageren selv har konfigureret forsvinder eller bliver ugyldige: træningsplaner (1.966 på 91 hold), peak-planer (135), manuelle udtagelser (34), sponsorvalg (80 uden valg) og bestyrelsesplaner (133). Fire af de fem har **ingen plads i drejebogen overhovedet**, og ingen af dem har en fælles mekanik. → Hører under #2752, se næste afsnit.

---

## 9. Verdensklasse: hvordan sæsonskiftet bliver det bedste i genren

Retention-tallet er blevet korrigeret siden 23/7: **~62 %, ikke 73 %** (samtykke-gaten skjuler 35 % af trafikken; rodårsag på #2041). Det ændrer intet ved konklusionen. 62 % af 134 nye brugere på 30 dage kommer aldrig igen, og du har 41 aktive om ugen. Sæsonskiftet er den eneste begivenhed i spillet der rammer alle på én gang — og det er derfor det dyreste sted at spilde folks opmærksomhed.

### (a) Kan nås inden søndag uden at true cutoveren

**Sæsonsiden skal virke for alle.** Den ligger allerede i den blokerende PR. 57 af 153 hold kan i dag ikke finde sig selv, og siden grupperer på den division skiftet lige har ændret. Det er ikke en luksus — det er den ene side skiftets eneste push-besked sender folk til.

**Ét varsel der siger hvad der sker, med tidspunkter.** In-app til alle 153 hold + Discord. Fakta jeg kan levere, du skriver stemmen: sidste S1-etape søndag 19:00 · skiftet køres manuelt søndag aften · første S2-etape mandag 11:00 · ved skiftet betales sponsor, trækkes løn **for første gang**, kan ryttere på 36+ stoppe karrieren, forlader 21 akademiryttere akademiet, og global rank halveres. Der findes i dag **ingen kanal der når alle 153** — Discord dækker 17 % af brugerne, e-mail har aldrig sendt en besked. In-app-indbakken er det eneste der virker.

**Sponsor-defaulten fra `long` til `predictable`.** Fem minutter. 47 af 73 valgte én sæson; defaulten binder tre. Det er den billigste rettelse med størst effekt på hvor bittert et ikke-valg føles.

Det er alt. Alt andet søndag er falsk hastværk.

### (b) Ugen efter — så det står klar til S2→S3

**Personlig sæson-besked, ikke en generisk.** Skiftets ene push-besked er i dag identisk for alle 150 managere: *"Season 1 has ended"*. Kaldet er allerede fejl-isoleret, og alle data findes. Send i stedet: din placering i din pulje (`rank_in_division` findes på alle 367 rækker), dine point, dine samlede præmiepenge, din bedste rytter, og hvilken division du starter S2 i. Det er 2-3 timer. Det er forskellen på "spillet kørte en batch-operation" og "spillet så mig".

**"Sæson 2 — kom i gang"-kort.** Fire beslutninger venter mandag morgen, spredt over fire sider uden nogen guide: udtag din trup, læg træningsplanen om (den blev nulstillet), forhandl bestyrelsen, tag stilling til akademi-graduates. Gennemsnitstruppen er 15 ryttere og kun 32 af 153 hold har 18+, så "byg din trup" er reelt den vigtigste. Ét dashboardkort med 3-5 konkrete handlinger og deep-links.

**"Kopiér sidste sæsons plan"** på træning og peak. Og gør det til en fase i transitionen bagefter, så listen bliver kortere for hvert skifte i stedet for at gentage sig. Det er 20 linjer kode og fjerner problemet permanent.

**Kåringen af sæsonens bedste ryttere (#2863).** Du lovede den i Discord. Halvdelen lander allerede automatisk — sæsonsiden har et "Stage king"-kort. Men beslut definitionen først, for den skifter vinderen: tæller en "sejr" kun etapesejre, eller alle førstepladser inklusive dagstrøjer? På etapesejre topper Cristian Marini (menneskehold) og Walid Toumi (AI) med 11 hver. På den brede definition topper en AI-rytter med 58 "sejre" — hvoraf kun 9 er etapesejre; resten er dage i ungdomstrøjen. **Min anbefaling: etapesejre, global kåring (56,8 % af sæsonens point er AI-ejede — det er cykel-realistisk), plus en separat "bedste manager-ejede rytter".**

**De 13 sæson-achievements der aldrig kan tildeles.** `season_top10`, `season_winner`, `team_promotion`, `team_relegation` og ni andre er defineret, synlige for spilleren og har **nul tildelinger** — der findes ingen kode der kan give dem. Kontrolgruppen beviser at mekanismen virker når den wires: `season_first_result` har 93 tildelinger. Alle 13 kan backfilles retrospektivt fra `season_standings`, så intet går tabt ved at bygge det efter cutoveren.

**Aktivér e-mail-loopet.** Det er bygget, cron-kørt og Sentry-overvåget — og mørkt bag én manglende konfigurationsrække. 110 af 153 managere logger ikke ind i en typisk uge. Uden e-mail hører de aldrig at sæsonen sluttede.

### (c) Den større satsning

**Sæson-recap'en (#2752) som spillets tilbagevendende højdepunkt.** Ikke en side med tabeller — en fortælling om *dit* hold: hvad du vandt, hvad du betalte, hvem der udviklede sig mest, hvem der stoppede, hvor du endte og hvad der venter. Delbar. Det er den mekanik hele genren bruger til at gøre en sæsonafslutning til noget folk ser frem til, og det er den ene ting der kan gøre "sæsonen slutter" til en grund til at logge ind i stedet for en grund til at holde op.

Argumentet er ikke stemning, det er struktur: du har 41 aktive spillere og et spil der kører af sig selv 27 dage ud af 28. Sæsonskiftet er den eneste dag hvor der sker noget alle mærker samtidig. Lige nu bruger vi den dag på en batch-operation. Genrens bedste bruger den på at give hver spiller en historie han vil fortælle videre — og et sted at klikke hen dagen efter.

Byg den under #2752 med issuets eget krav respekteret: mockup til godkendelse før kode. Og læg "din opsætning ved sæsonskiftet" ind i samme flade — hvad blev båret over, hvad udløb, hvad venter på et valg. Så holder vi op med at bede de mest engagerede managere om at lave det samme arbejde forfra hver måned.

---

## 10. Foreslåede nye issues

Opret dem ikke nu — de er her så de ikke går tabt.

| Titel | Hvorfor | Hvornår |
|---|---|---|
| `loadHumanSeasonEndTeams` mangler paginering — 2.652 ryttere mod 1.000-loft | Løn og bestyrelsesdom bliver forkerte for over halvdelen af holdene | **I dag** (i den blokerende PR) |
| Sponsor-fornyelse taber renown-multiplikator ved divisionsskifte | Permanent motorfejl; op til −29 % sponsorindtægt låst i 3 sæsoner | I dag som beslutning, fix efter 27/7 |
| Sæsonskiftet nulstiller ikke træthed — feltet starter S2 på 86,7/100 | Første uge afgøres af hvem der ikke kørte søndag | Efter 27/7, med simulering |
| Akademiet har ingen sæson-optagelse: 21 ud, 0 ind | Akademiet tømmes over 4-5 sæsoner uden at nogen opdager det | Efter 27/7, med simulering |
| `transfer_frozen` overskrives mellem nødlåns- og gældsgren | #2301's eskalering er virkningsløs for de fleste hold | Efter 27/7 |
| Gældsloftet måles efter rentekapitalisering — hold fryses uden besked | 11 hold rammes ved dette skifte; ingen af dem har gjort noget forkert | Efter 27/7 |
| Auktions-finalisering mangler pensions-guard | Køber betaler for en rytter der aldrig kan starte | Efter 27/7 |
| Sponsor-rate divideres med 28 dage men udbetales pr. etape (56-140) | Den variable del udbetaler 2-5× det beregnede, division-afhængigt | I dag som beslutning |
| `forced_debt_sale` mangler idempotency-nøgle | Eneste penge-callsite uden beskyttelse mod dobbeltkørsel | Efter 27/7 |
| Advisory lock på season-end + transition (#2847 findes) | Ingen DB-garanti mod dobbelt-POST i dag | Efter 27/7 |
| `season_transition_started` i admin_log som første fase | En halvt gennemført transition er i dag maskinelt usynlig | Efter 27/7 |
| Cutoveren som ét orkestreret script med snapshots og assertions | Halvdelen af risikoen på denne liste findes kun fordi et menneske klikker og fortolker under tidspres | Til S2→S3 |
| Auto-kopiering af trænings- og peak-planer ved sæsonskifte | Fjerner permanent den dyreste genopsætningsopgave | Efter 27/7 |
| 13 sæson-achievements uden unlock-logik | Defineret, synlige, kan aldrig tildeles. Backfillbare | Til S2→S3 |
| Marked-/auktionsfrys som app_config-flag | Bygges én gang, bruges ved hvert skifte og ved incidents | Til S2→S3 |

---

### Hvad jeg ville gøre nu, i rækkefølge

1. Sig ja eller nej til #2851 (jeg anbefaler nej) — så kan resten skrives.
2. Tjek om PITR er slået til. Fem minutter, og det ændrer hvad "abort" betyder.
3. Lad mig lave den ene PR: paginering + sæsonsiden. Merge og deploy inden kl. 16.
4. Godkend teksten til #2700-varslet og det generelle varsel. Kør dem i aften.
5. Freeze main kl. 20.

Så er der ro søndag til at gøre det ordentligt.