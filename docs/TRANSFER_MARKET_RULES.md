# Transfermarkedets regler - SSOT

> **Læs denne FØR enhver opgave der rører transfermarkedet: auktioner, bud, autobud,
> annullering, finalisering, frie agenter, trup-lofter, udskudte holdskifter eller de gates
> der forhindrer misbrug.** Ejer-direktiv 25/8 2026
> ([#4221](https://github.com/NicolaiDolmer/CyclingZone/issues/4221)).
>
> Auktioner nævnes i fire andre SSOT'er og havde indtil 30/8 intet eget dokument.
> Denne fil beskriver **hvad koden gør i dag**, ikke hvad der er besluttet.
>
> **Værdi, løn, kontrakter og prisloft-diskussionen bor i
> [`ECONOMY_RULES.md`](ECONOMY_RULES.md).** Gentag dem ikke her - denne fil handler om
> markedsmekanikken: timere, bud, gates, ejerskifte.
>
> Verificeret mod kode og prod **30/8 2026 kl. ca. 22.45 dansk tid** (20.45 UTC).
> Alle tal nedenfor er enten læst i en navngiven kodefil eller målt med den SQL der står
> ved siden af. Intet tal i dette dokument er anslået.

---

## 0. De tre veje ind på markedet

| Vej | Hvem opretter | Kode |
|---|---|---|
| **Auktion** | manager (`POST /api/auctions`) eller et automatisk flow | `backend/routes/api.js:6229-6560`, `backend/lib/youthMarket.js:139`, `backend/lib/academyGraduation.js:227` |
| **Transferliste + tilbud** | manager (`transfer_listings` → `transfer_offers`) | `backend/lib/transferExecution.js` |
| **Byttehandel** | manager (`swap_offers`) | `backend/lib/transferExecution.js` |

**Transfervinduet er afskaffet.** `getTransferWindowOpen()` returnerer hardkodet `true`
(`backend/lib/marketUtils.js:196-198`, ejer-direktiv 22/6 · #1310 punkt 6 · #1996).
Handel er altid åben; der findes ingen vindue-luk længere. Det er rod-årsagen til flere
regler nedenfor: den gamle model "byd frit, ryd op ved vindue-luk" er død, så både bud-gaten
og finalize-gaten håndhæver trup-loftet **hårdt** (§7).

Målt 30/8: `transfer_windows` har 2 rækker, begge `status='closed'` med `closes_at=NULL` -
død data. Ingen kode må ankre noget i den tabel (kostede en fejlklasse, se §12).

---

## 1. Auktionens livscyklus

```
active  ──(bud i sidste 10 min + lederskifte)──►  extended
   │                                                  │
   ├──────────────► cancelled  (kun admin, eller finalize-guard)
   │                                                  │
   └──────────────► completed  ◄──────────────────────┘
```

| Status | Betydning | Hvor |
|---|---|---|
| `active` | kører | `auctionRules.js:39` `ACTIVE_AUCTION_STATUSES` |
| `extended` | forlænget mindst én gang; tæller som aktiv overalt | samme |
| `completed` | afsluttet (med ELLER uden vinder) | `auctionFinalization.js:1500-1513` |
| `cancelled` | annulleret; ingen penge flyttet | `auctionCancellation.js:33` |

**Finaliseringen kører hvert 60. sekund** (`backend/cron.js:1350-1352`, job-slug `auctions`).
Målt 30/8 20.47 UTC: `cron_checkins` viser `auctions` sidst tjekket ind 20:47:20 UTC med
`expected_cadence_seconds = 60`, og **0** auktioner stod udløbet-men-ikke-finaliseret.

Målt bestand 30/8 (`select status, count(*) from auctions group by status`):
**4.314 completed · 110-112 active · 57 cancelled · 0 extended lige nu.**
Historisk har **175 af 4.483** auktioner haft mindst én forlængelse; flest forlængelser på
én auktion: **18**.

---

## 2. Timere - det faktiske tal (svar til [#4177](https://github.com/NicolaiDolmer/CyclingZone/issues/4177))

### 2.1 Den globale config

`auction_timing_config` (én række, `id=1`). **Målt i prod 30/8:**

| Felt | Prod-værdi | Kode-default | Fil |
|---|---|---|---|
| `duration_hours` | **1** | 6 | `auctionEngine.js:41` |
| `weekday_open_hour` | **8** | 16 | `auctionEngine.js:42` |
| `weekday_close_hour` | **24** | 22 | `auctionEngine.js:43` |
| `weekend_open_hour` | **8** | 8 | `auctionEngine.js:44` |
| `weekend_close_hour` | **24** | 23 | `auctionEngine.js:45` |
| `extension_minutes` | **10** | 10 | `auctionEngine.js:46` |
| `market_pause_level` | `none` | - | `marketPause.js:5` |
| `updated_at` | 2026-06-28 11:36 dansk tid (09:36 UTC) | - | - |

Målt med: `select * from auction_timing_config`.

**Prod-vinduet er altså 08.00-24.00 dansk tid, alle ugens dage** (16 aktive timer i døgnet;
døde timer 00.00-08.00 springes helt over), og **standard-varigheden er 1 aktiv time.**
Koden regner altid i `Europe/Copenhagen` og håndterer CET/CEST-skiftet eksplicit
(`auctionEngine.js:38, 62-70`).

`extension_grace_minutes` **findes ikke som kolonne i prod** (verificeret mod
`database/schema-snapshot.json` → `relations.auction_timing_config.columns`), og koden
behandler den som 0. Grace-perioden er en **afvist feature** (ejer 3/7, #1941/#3309/#2150,
dokumenteret i `auctionEngine.js:26-30, 47-51`). Konsekvens: den hårde grænse falder sammen
med lukketid, og et bud der forlænger forbi lukketid ruller over til næste dags åbning med
overskuds-minutterne (`checkBidExtension`, `auctionEngine.js:275-299`).

### 2.2 De tre sluttids-veje

`api.js:6443-6447` - én af tre, i denne rækkefølge:

| Vej | Regel | Kode |
|---|---|---|
| **Flash** | fast **30 minutter** fra oprettelse, vægskur (ingen aktiv-time-model) | `api.js:6444` |
| **Valgt sluttidspunkt** (`ends_at`, #2884) | bruges **som det står**; skal ligge **1-48 timer** frem OG inde i det åbne vindue | `auctionEngine.js:175-176, 198-222` |
| **Default** | `calculateAuctionEnd` akkumulerer `duration_hours` **aktive** timer, med et **12-timers gulv hvis rytteren ikke har et hold** | `api.js:6447`, `auctionEngine.js:119, 131-164` |

`CUSTOM_END_MIN_HOURS = 1` og `CUSTOM_END_MAX_HOURS = 48` (`auctionEngine.js:175-176`,
ejer-beslutning 15/8). Natten gråtones i vælgeren og rulles bevidst **ikke** frem: et valgt
klokkeslæt der ikke er sandt bryder doktrinen om at spilleren kan stole på det han ser
(`auctionEngine.js:166-174`).

**Sæsonskifte-guard:** ingen auktion må slutte på eller efter sæson-transitionen
(`getAuctionSeasonBoundaryIssue`, `auctionEngine.js:246-256`, #4004). Ankeret er
`seasonTransitionBoundary.js` - **ikke** `transfer_windows.closes_at`, som blev målt til at
være død data 21/8 og derfor aldrig ville have fyret.

### 2.3 12-timers-gulvet - hvor det gælder og hvor det ikke gælder

`FREE_AGENT_MIN_DURATION_HOURS = 12` (`auctionEngine.js:119`, ejer-beslutning 21/8, #4004,
shippet i commit `7fd165690` 21/8). Det er et **gulv**, ikke en varighed: en global config
over 12 timer overstyres ikke (`Math.max`, `auctionEngine.js:132`).

| Flow | Får 12t-gulvet? | Kode |
|---|---|---|
| Ungdomsmarkedet | **ja** | `youthMarket.js:139` |
| Akademi-graduering | **ja** | `academyGraduation.js:227` |
| Manager starter auktion på rytter **uden hold**, uden valgt sluttid | **ja** | `api.js:6447` |
| Manager starter auktion på rytter uden hold **med valgt sluttid** | **NEJ** | `api.js:6445-6446` |
| Flash-auktion | **NEJ** (30 min) | `api.js:6444` |

**Det er hullet #4177 beskriver, og det er målt.**

Målt 30/8 for auktioner oprettet **efter** 22/8 der endte som fri-agent-salg
(`seller_team_id` nulstilles ved finalisering af fri-agent-auktioner,
`auctionFinalization.js:551` og `:146`), ikke-ungdom, ikke-flash:

```sql
select count(*) filter (where dur_min < 720)                     as under_12t,
       count(*)                                                  as ialt,
       count(*) filter (where dur_min < 720 and sek0)            as under_12t_med_valgt_sluttid,
       min(dur_min)                                              as korteste_min
from (select round(extract(epoch from (calculated_end - created_at))/60) as dur_min,
             (extract(second from calculated_end) = 0)                    as sek0
      from auctions
      where seller_team_id is null and is_youth = false and is_flash = false
        and created_at >= '2026-08-22') s;
```

**Resultat: 161 i alt · 113 kørte under 12 timer · korteste varighed 60 minutter.**

> **106 er udledt, ikke målt.** Tallet kommer af at `calculated_end` lander på hele sekunder (`extract(second from calculated_end) = 0`), hvilket er en heuristik for et manuelt valgt sluttidspunkt. `auctions` har **ingen kolonne** der registrerer om sælgeren valgte sluttiden. De 113 under 12 timer er derimod hårdt målt. Bærer man §14 punkt 1 (skal `CUSTOM_END_MIN_HOURS` hæves fra 1 til 12?) på de 106, skal forbeholdet med.

**Det rigtige tal at skrive i copy er derfor ikke "45 minutter" og ikke "12 timer".**
Sandheden pr. 30/8:

- Automatiske fri-agent-auktioner (ungdomsmarked, akademi-graduering): **mindst 12 timer.**
  Målt medianvarighed for ungdomsauktioner de sidste 8 dage: **1.920-2.432 minutter**
  (32-40 timer), aldrig under 1.920 minutter.
- En manager-startet auktion på en fri rytter: **1 aktiv time** som default, eller præcis
  det klokkeslæt sælgeren vælger - **helt ned til 1 time frem.**
- Spillerens "45 minutter" var **resttid**, ikke total varighed. Ingen auktion i prod er
  nogensinde oprettet kortere end 60 minutter (flash 30 min er aldrig brugt, se §5).

Patch-noten (`frontend/src/data/patchNotes.js:1533` EN / `:1537` DA) siger *"Free agent
auctions (from the bank or the youth market) now run for at least 12 hours instead of 1"*.
Den **afgrænsning er teknisk korrekt** for de to nævnte flows. Fejlen er at spillerne læser
"fri agent" som *enhver* rytter uden hold, og at koden faktisk **også** giver gulvet til
manager-startede auktioner på holdløse ryttere - bare ikke når sælgeren vælger sluttid.
Copy'en beskriver altså en regel der er både snævrere og bredere end koden.

---

## 3. Hvad en fri agent præcist er

**Der findes ingen `is_free_agent`-kolonne og ingen navngiven konstant.** Den operative
definition i koden er ét udtryk:

```js
rider.team_id ? {} : { minHours: FREE_AGENT_MIN_DURATION_HOURS }   // api.js:6447
```

**En fri agent = en rytter hvis `riders.team_id` er NULL på det tidspunkt auktionen
oprettes.** Alt andet (kontraktudløb, akademi-afvisning, AI-udbud) er *veje til* den
tilstand, ikke selvstændige begreber i koden.

Målt 30/8: **1.016 frie seniorryttere** (`team_id is null and is_academy=false and
is_retired=false`) ud af **7.551** ryttere i alt. **0** frie akademi-ryttere.

De fire veje ejeren spurgte om i #4177, som koden faktisk kender:

| Vej | Findes den? | Varighed | Kode |
|---|---|---|---|
| Spiller starter auktion på en rytter der er fri nu | ja | 12t-gulv **kun** uden valgt sluttid | `api.js:6447` |
| Ungdomsmarkedet udbyder en ung rytter | ja, `is_youth=true` | 12t-gulv altid | `youthMarket.js:139` |
| Akademi-graduering / intake-udløb | ja, `expired_intake_team_id` | 12t-gulv altid | `academyGraduation.js:227` |
| Kontraktudløb → tvangsauktion | **NEJ, ikke bygget** | - | `ECONOMY_RULES.md` §5: live er stadig tavs frigivelse |

Målt: **1.421** auktioner har `is_youth=true`, heraf **1.194** med `expired_intake_team_id`
sat (intake-udløbs-kompensation, #2648).

**IKKE FASTLAGT - kræver ejer-beslutning:** ejerens eget spørgsmål i #4177 08:37 er
stadig ubesvaret. Den ene ting der mangler at blive afgjort: **skal 12-timers-gulvet også
gælde når sælgeren vælger sit eget sluttidspunkt på en holdløs rytter - altså skal
`CUSTOM_END_MIN_HOURS` hæves fra 1 til 12 for netop de auktioner?** I dag er svaret nej, og
106 af de sidste 161 fri-agent-auktioner brugte netop den udvej.

---

## 4. Bud, minimums-step og autobud

### 4.1 Minimumsbud

`getMinimumAuctionBid` (`auctionRules.js:141-144`):

| Situation | Minimum |
|---|---|
| Der er allerede en byder | `current_price + 1` CZ$ |
| Ingen har budt endnu (udbudspris på egen-rytter-salg) | `current_price` (match tilladt) |

**`auctions.min_increment` er dekorativ.** Kolonnen skrives fra request-body med default 1
(`api.js:6229, 6516`), men `getMinimumAuctionBid` bruger et hardkodet `+1` og læser aldrig
kolonnen. Målt 30/8: **alle 4.483 rækker har `min_increment = 1`** - så divergensen har
aldrig gjort skade, men den er reel.

Bud skal være et **positivt heltal** (`api.js:6604`).

### 4.2 Autobud (proxy)

| Regel | Værdi | Kode |
|---|---|---|
| Tabel | `auction_proxy_bids` (`auction_id`, `team_id`, `max_amount`) | schema-snapshot |
| Sæt/opdatér | `PATCH /api/auctions/:id/proxy` | `api.js:6942` |
| Slet | `DELETE /api/auctions/:id/proxy` - **sletningen ER frigivelsen af den reserverede saldo** | `api.js:7207`, `proxyBidding.js:16-41` |
| Maks iterationer pr. cascade | **30** | `proxyBidding.js:43` |
| Loft må aldrig vises | `proxy_max`/`max_amount` er hard-blokeret i bud-timelinen | `riderBidTimeline.js:14-31` |

**Fem regler der bider:**

1. **Et proxy-loft er et reelt autobud.** Sætter du proxy uden at føre, lægges
   minimumsbuddet med det samme (`getProxyOpeningBidAmount`, `auctionRules.js:229-244`).
2. **Uafgjort går til den siddende fører.** Rammer en udfordrer *præcis* førerens loft,
   matcher førerens proxy beløbet og tager føringen tilbage uden prisstigning. En udfordrer
   skal **overgå** loftet, ikke matche det (#1091, `proxyBidding.js:172-219`).
3. **En stale proxy (loft < aktuel pris) behandles som ingen proxy** (#171,
   `proxyBidding.js:88-93`), men tæller stadig `current_price` i din forpligtelse
   (`computeReservedBalance`, `auctionRules.js:250-259`).
4. **Autobud gates mod balancen ved hver eneste iteration** (#44,
   `proxyBidding.js:49-79`) - en proxy sat før en lønudbetaling kan løbe tør midt i en
   cascade og bliver da stoppet med en notifikation, uden at rækken slettes.
5. **Cascaden ejer ALLE "du er overbudt"-beskeder** (#1740, `proxyBidding.js:135-149`), så
   en fører hvis autobud generobrer føringen ikke får en falsk overbudt-besked.

**Forlængelse kræver at føreren faktisk skiftede.** `applyLeaderShiftExtension`
(`auctionEngine.js:340-391`) sammenligner lederen før og efter hele bud+cascade-hændelsen.
Samme leder → ingen forlængelse, uanset timing. Det dræber "spam +1 CZ$ for at trække
auktionen ud"-udnyttelsen (#257).

**Målt bihang 30/8:** `auction_proxy_bids` indeholder **736 rækker**, hvoraf kun **12** hører
til en `active` auktion - **708 hænger på `completed` auktioner og 16 på `cancelled`**
(`select a.status, count(*) from auction_proxy_bids p join auctions a on a.id=p.auction_id
group by a.status`). Alle forpligtelses-beregninger filtrerer på auktions-status
(`api.js:677-686`, `loanEngine.js:22-42`, `proxyBidding.js:57-75`), så pengene er **ikke**
låst. Der findes bare ingen oprydning af rækkerne.

---

## 5. Auktions-typer der findes i skemaet

| Flag | Betydning | Målt antal i prod 30/8 |
|---|---|---|
| `is_youth` | ungdomsauktion, ingen sælger, senior-først-placering | **1.421** |
| `expired_intake_team_id` | intake-udløb; budsummen krediteres den manager (#2648) | **1.194** |
| `is_flash` | fast 30-minutters auktion | **0** |
| `is_guaranteed_sale` | garanteret salg til banken ved 0 bud | **0** |

**To af de fire er død kode i praksis.** `is_flash` sendes fra frontend
(`frontend/src/pages/RiderStatsPage.jsx:1568`) og håndteres i backend, men er aldrig blevet
brugt af nogen. `is_guaranteed_sale` **sættes ingen steder i live kode** - grep over
`backend/` finder kun læsninger (`auctionFinalization.js:1398-1477`, `riderHistory.js:64`,
`teamTransferHistory.js:140`). Hele bank-salgs-grenen i finaliseringen er derfor
uudløselig i dag.

---

## 6. Annullering

**En manager kan ikke selv annullere sin auktion.** Der findes ingen route til det. Kun to
veje:

| Vej | Hvem | Kode |
|---|---|---|
| Admin-annullering | admin | `auctionCancellation.js:7-123` |
| Auto-annullering før rytter-sletning | admin-sletteflow | `auctionCancellation.js:136-164` (#3594) |

Annullerbare statusser: `active`, `extended` (`auctionCancellation.js:5`). Skiftet er
atomart (`.in("status", CANCELLABLE_STATUSES)` i selve UPDATE'et) for at vinde kapløbet mod
den parallelle finalizer; taber admin kapløbet returneres `race_lost`.

Ved annullering: `pending_team_id` ryddes defensivt, **alle** unikke budgivere får en
`auction_cancelled`-notifikation, sælgeren får sin egen, og der skrives til `admin_log`.
**Ingen penge bevæger sig** - bud reserverer aldrig faktisk saldo (§8), de binder kun
disponibel balance logisk.

Finaliseringen kan **også** ende i `cancelled` uden admin, i tre tilfælde (§7).

---

## 7. Finalisering - de otte udfald

`finalizeAuctionRecord` (`auctionFinalization.js:808-1514`). Rækkefølgen er bindende;
guards ligger bevidst før pengeflytning.

| # | Udfald (`code`) | Udløser | Linje |
|---|---|---|---|
| 1 | `already_completed` / `not_finalizable` | status ikke i `["active","extended"]` | `:818-824` |
| 2 | `cancelled_retired` | rytteren blev pensioneret mens auktionen kørte (#2918) | `:852-902` |
| 3 | ungdomsgrenen | `is_youth` → `finalizeYouthAuctionRecord` | `:924-936` |
| 4 | `cancelled_stale_owner` | rytteren skiftede ejer bag om auktionen | `:947-983` |
| 5 | `cancelled_insufficient_balance` | vinderen har ikke råd ved hammerslag | `:996-1030` |
| 6 | `squad_full` | vinderens trup er fuld ved tildeling (hard cap, ingen buffer) | `:1037-1077` |
| 7 | `seller_squad_floor` | salget ville bringe **sælgeren** under løbs-minimum (#2836) | `:1132` |
| 8 | `completed` / `no_bids` / `guaranteed_sale` | normalen | `:1392`, `:1510` |

**Ungdomsgrenen, senior-først (ejer-regel 19/7, #2701):** har vinderen plads på
senior-truppen og råd, lander rytteren dér med senior-kontrakt. Er senior fuldt, falder han
til **akademiet** (8-plads-cap, ungdomskontrakt). Er begge fulde **eller** vinderen mangler
råd → auktionen annulleres og rytteren **slettes** (#2456 "usolgt = væk",
`auctionFinalization.js:514-615`). Uden bud slettes rytteren også, bag en atomar
TOCTOU-claim så et sent bud altid vinder over sletningen (`:548-562`).

**Penge:** køber debiteres, sælger krediteres, begge via
`incrementBalanceWithAudit` med `idempotency_key` pr. auktion
(`:1235-1280`, reason-koder `AUCTION_WINNER_PAYMENT` / `AUCTION_SELLER_PAYOUT`). Er der
ingen menneskelig sælger, forbliver købesummen et sink.

**Ejerskabs-skrivning verificeres.** `expectMutationAffectingRows`
(`marketUtils.js:84-93`, #3580) kræver at rytter-opdateringen faktisk ramte rækker, **før**
nogen pengebevægelse kører. Uden den kunne resten af finaliseringen køre som om handlen var
sket - netop formen på Seojun Choi-hændelsen 9/8.

**Sideeffekter ved salg:** åbne `transfer_listings` sættes til `sold`
(`marketUtils.js:106-114`), åbne `transfer_offers` og `swap_offers` sættes til `withdrawn`
(`marketUtils.js:124-143`), fremtidige `race_entries` ryddes (#1906), og
`rider_ownership_events` skrives (#3582).

**Tabende budgivere får ét post-hammerslag-svar** med vinderens navn og deres eget højeste
**realiserede** bud - aldrig deres proxy-loft (`auctionFinalization.js:46-133`, #3401).

---

## 8. Penge: bud reserverer ikke saldo, de binder den

Der findes **ingen fysisk spærring** af balance ved bud. I stedet regnes en
**worst-case-forpligtelse** ved hver balance-reducerende handling.

`computeWorstCaseCommitment` (`auctionRules.js:271-300`):

| Situation | Bidrag til forpligtelsen |
|---|---|
| Fører uden proxy | `current_price` |
| Fører med proxy | `MAX(current_price, proxy_max)` |
| Ikke fører, men har proxy | `proxy_max` |
| Ikke fører, ingen proxy | 0 |

`computeAvailableBalance = MAX(0, balance − forpligtelse)` (`auctionRules.js:305-309`).

**Hvor gaten sidder:** bud (`getAuctionBidIssue`, `:166-191`), proxy-sæt
(`getProxyMaxIssue`, `:197-225`), og alle faste udgifter - lånebetaling, transfer-køb,
swap-kontant - via `getSpendIssue` (`:314-325`). Fælles fetch-helper:
`api.js:691-707` og `loanEngine.js:22-42`.

**Ved bud med proxy gates `MAX(beløb, proxy_max)`** mod balancen (`:184`), så et 50K-bud
med 600K-loft kun accepteres hvis manageren også har råd til 600K.

Målt 30/8: højeste enkelte proxy-loft i basen er **932.843 CZ$**; 80 hold har på et
tidspunkt sat mindst ét autobud.

---

## 9. Trup-lofter

| Regel | Værdi | Hvor låst | Fil |
|---|---|---|---|
| `MAX_SQUAD_SIZE` (senior, alle divisioner) | **30** | #838 | `marketUtils.js:9-15` |
| Roster-gulv pr. division | **0** | fjernet 5/6 2026 | `marketUtils.js:6-15` |
| `MIN_RIDERS_FOR_RACE` | **8** | #2748 | `marketUtils.js:25` |
| `ACADEMY.SLOTS` | **8** | - | `academyFlag.js:11` |
| `TRANSFER_WINDOW_SOFT_CAP_BUFFER` | **2** | #267 - **dødt**, vinduet findes ikke | `marketUtils.js:23` |

**Pladsreservation pr. auktion man fører (#1694).** `getAuctionBidSquadBlock`
(`auctionRules.js:358-376`) reserverer én plads pr. auktion manageren fører - worst case
vinder han dem alle. Et forsvarsbud på en auktion man **allerede** fører reserverer ikke en
ekstra plads, så et forsvar blokeres aldrig.

**Ungdomsauktioner har en løsere gate.** `getAuctionBidRoomBlock`
(`auctionRules.js:387-415`, #2701) blokerer kun når **både** senior og akademi er fulde.

**Tællegrundlaget er `future_count`** = ejede nu − på-vej-væk + på-vej-ind
(`getTeamMarketState`, `marketUtils.js:200-267`). Akademi- og pensionerede ryttere tæller
ikke mod senior-cap (#1308/#2748). **Samme tæller bruges i bud-gaten og i finalize-gaten** -
det er hele pointen efter divergensen 22/6 (§12).

**Sælger-gulvet (#2748/#2836):** en manager kan ikke auktionere/sælge sig under
`MIN_RIDERS_FOR_RACE = 8`, når kontraktudløb og pensionsrisiko ved næste sæsonskifte er
talt med (`getSquadRiskViolation`, `marketUtils.js:325-335`). Tjekkes både ved oprettelse
(`api.js:6359-6377`) og ved finalisering (`auctionFinalization.js:1132`).

**Restrisiko der bevidst ikke er dækket** (`auctionRules.js:354-357`): fyldes truppen via en
**anden** kanal (akademi-graduering) efter manageren allerede fører en auktion, kan finalize
stadig afvise. Finalize har sin hard-gate som defense-in-depth.

---

## 10. Udskudte holdskifter under etapeløb

**Model B (ejer 29/6 2026, option c, #1995):** handel og betaling sker **straks**, men selve
holdskiftet parkeres hvis rytteren er midt i et aktivt fleretape-løb.

| Element | Regel | Fil |
|---|---|---|
| "Aktivt fleretape-løb" | `race_type='stage_race'` AND `status != 'completed'` AND `stages_completed > 0` | `stageRaceTransferDefer.js:14-17, 41-46` |
| Parkering | `riders.pending_team_id` sættes; `team_id` rører sig ikke | `auctionFinalization.js:1162` |
| Flush | ved løbs-finalisering, fra `raceRunner.js` | `stageRaceTransferDefer.js:159-197` |
| Overlap-guard | rytter i **flere** aktive etapeløb flushes først når det **sidste** finaliseres | `:180-186` |
| TOCTOU-guard | flush kun hvis `pending_team_id` stadig peger hvor kalderen læste | `:100-109` |
| Selv-heling | periodisk sweep hvert **300. sekund** | `deferredTransferHealSweep.js:29-50`, `cron_checkins` job-slug `deferred-transfer-heal` |

Hele det aktive løb krediteres sælgeren; først næste løb tilfalder køberen.

Målt 30/8: **0 ryttere står parkeret** (`select count(*) from riders where pending_team_id
is not null`). Heal-sweepen tjekkede sidst ind 20:46:20 UTC med forventet kadence 300 sek.

Sweepen findes fordi flushen kun kaldes fra ét sted: Vasco Fernandes stod parkeret
22/6→4/8 (over 40 dage) med en betalt, aldrig-leveret handel, og spilleren rapporterede det
selv i Discord (#3330, `deferredTransferHealSweep.js:1-22`).

---

## 11. Gates mod misbrug

### 11.1 "Kun ÉN vej ad gangen"

Fire symmetriske gates deler samme kilde, `getActiveAuctionRiderIds`
(`marketUtils.js:150-160`):

| Gate | Blokerer | Kode |
|---|---|---|
| `getTransferAuctionConflict` | køb/tilbud på rytter med aktiv auktion | `auctionRules.js:71-79` (#1748) |
| `getSwapAuctionConflict` | byttehandel med rytter på aktiv auktion | `:49-62` (#1089) |
| `getReleaseAuctionConflict` | at **fyre** en rytter på aktiv auktion | `:90-98` (#3963) |
| `getAuctionStartSwapIssue` | auktion på rytter du selv har tilbudt i et åbent bytte | `:105-113` |

Sidstnævnte blokerer bevidst **ikke** på "rytteren er ønsket i andres byttetilbud" - ellers
kunne enhver låse andres ryttere ude af markedet ved at sende byttetilbud
(`auctionRules.js:100-104`).

### 11.2 Øvrige start-gates (`getAuctionStartIssue`, `auctionRules.js:12-33`)

- `rider_retired` - pensionerede ryttere kan ikke auktioneres.
- `rider_is_academy` - et **fremmed** akademi-prospekt kan ikke auktioneres; sit **eget**
  kan (ejer-direktiv 17/8, #3650). Salget graduerer atomisk til senior hos køberen.
- `rider_pending_transfer` - en rytter der allerede er på vej til et andet hold.
- Unik DB-constraint `uniq_auctions_one_active_per_rider` fanger dobbeltklik som 409
  (`api.js:6528-6530`).

### 11.3 Rate limits (`backend/lib/rateLimiters.js`)

| Limiter | Grænse | Rammer | Linje |
|---|---|---|---|
| `bidLimiter` | **60 pr. 60 sek.** | `POST /auctions/:id/bid`, `PATCH /proxy` | `:53-59` |
| `marketWriteLimiter` | **30 pr. 60 sek.** | auktions-oprettelse, transfers, swaps, lån, `DELETE /proxy` | `:64-70` |

Nøgle er bruger-id når det findes, ellers IP normaliseret til /64
(`userOrIpKey`, `:22-25`). Lageret er **in-process** - en horisontal skalering af backenden
kræver et delt lager (`:4-6`).

### 11.4 Nykonto-gates (`newAccountGates.js`) - alle SLUKKET i prod

| Nøgle | Prod-værdi 30/8 | Effekt når tændt |
|---|---|---|
| `auction_entry_gate_enabled` | **`false`** | konto oprettet **efter** auktionen startede må ikke byde på netop den (#3134/#2776) |
| `loan_gate_min_race_days` | **0** | lån kræver X kørte løbsdage |
| `loan_gate_min_account_age_days` | **0** | lån kræver X dages konto |
| `transfer_cooldown_hours` | **0** | store udgående overførsler spærres for nye konti |
| `transfer_cooldown_amount_czk` | **0** | beløbsgrænsen for ovenstående |

Målt med `select key, value, updated_at from app_config where key in
('auction_entry_gate_enabled','loan_gate_min_race_days','loan_gate_min_account_age_days',
'transfer_cooldown_hours','transfer_cooldown_amount_czk')`: alle fem rækker findes, alle med
`updated_at` **3/8 2026 17:53 dansk tid** (15:53 UTC), og alle på slukket-værdien.
Kontrakten er "0 på alle en gates nøgler = hele gaten slukket"
(`newAccountGates.js:20-21, 48-54`).

Alle gates er **fail-open** ved infrastruktur-fejl (`newAccountGates.js:28-30, 60-86`) - en
knækket config-læsning må aldrig blokere et lovligt bud. `auction_entry_gate` blev shippet
slukket fordi en dry-run mod prod fandt **422 historiske bud fra 53 ægte hold** der ville
være blokeret, overvejende almindelig onboarding (`newAccountGates.js:20-27`).

### 11.5 Gæld og pause

- **`transfer_frozen`**: et hold hvis gæld overstiger divisionens loft kan ikke handle
  overhovedet (`api.js:903-912`).
- **Markeds-pause** (`marketPause.js`): tre niveauer `none`/`auctions`/`all`. Ved genstart
  skubbes alle auktioners `calculated_end` frem med pausens varighed, så budgivere beholder
  deres resttid (`shiftCalculatedEnd`, `:31-36`). Målt 30/8: `market_pause_level = 'none'`.

### 11.6 Startpris-båndet

`getAuctionStartPriceIssue` (`auctionRules.js:120-137`): **egen rytter maks 1× værdi**;
**fri/AI-rytter mindst 1× værdi**. Detaljer og den åbne designkritik hører til
[`ECONOMY_RULES.md`](ECONOMY_RULES.md) §3.1 - gentag dem ikke her.

---

## 12. Fair play - [#3138](https://github.com/NicolaiDolmer/CyclingZone/issues/3138) er eneste værn

Ejeren fravalgte prisloftet, så der findes i dag **ét** aktivt fair-play-værn på markedet:
det daglige scoring-sweep.

| Element | Værdi | Kilde |
|---|---|---|
| Cron | dagligt, job-slug `fairplay-scoring`, kadence **86.400 sek.** | `cron_checkins`, målt 30/8 20:21 UTC |
| Tabel | `fairplay_flags` (RLS-låst, ejer-only) | `fairplayFlagsCron.js:1-10` |
| Flag-tærskel | **0,35** (`app_config.fairplay_flag_threshold`, sat 6/8) | `fairplayScoring.js:37-39` |
| Værdistrøm-gulv | **50.000 CZ$** | `fairplayScoring.js:33` |
| Værdistrøm-mætning | **250.000 CZ$** | `:36` |
| Tragt-minimum | **100.000 CZ$** | `:47` |
| Kalibreret prisbånd | gulv **10 %**, loft **2,2×** værdi | `:42-43` (#3231, P05/P95) |
| Identitets-vægte | `first_seen_at_match` 0,9 · `ip_exact_low_fanout` 0,7 · `ip_prefix` 0,5 · `signup_proximity` 0,5 · `email_username_similarity` 0,4 | `fairplayScoring.js:54-60` |
| Engangs-mail-styrke | 0,55 (kendt domæne) / 0,30 (regex-match) | `fairplayFlagsCron.js:44-50` |

**Ingen automatisk sanktion.** Systemet flagger; ejeren afgør (#3138 eksplicit ikke-mål).

> **Kommende ændringer (åben PR).** Tallene i tabellen ovenfor er målt mod `main` 30/8. PR [#4473](https://github.com/NicolaiDolmer/CyclingZone/pull/4473) (`#3818`) rører præcis `fairplayScoring.js` og `fairplayFlagsCron.js` og ændrer tre af dem: den tilføjer et retningssignal `directional_value_flow`, giver identitets-komponenten et gulv i værdi-multiplikatoren, og retter et join i `normalizeTransactions` der gjorde at detektoren **aldrig så direkte handler** (141 af 141 accepterede direkte handler i 90-dages-vinduet blev sprunget over). Lander #4473, skal denne tabel måles om i samme PR, jf. hard rule 30 led (c).

**Målt tilstand 30/8:** `fairplay_flags` indeholder **28 flag, heraf 24 med status `new`**;
seneste flag oprettet **28/8 15:49 dansk tid**. Cron'en tjekkede ind samme dag 22:21 dansk
tid, så pausen i flag-produktionen betyder "ingen nye sager over tærsklen", ikke "død cron".

**Prisbåndet ved handel er slukket.** `transferPriceBand.js` (#3133) læser to nøgler; målt
30/8: `transfer_price_floor_pct = 0` og `transfer_price_cap_multiple = null`, hvilket
er **DISABLED** (`transferPriceBand.js:40-67`). Prisbånds-gaten på egen-rytter-startpris
(`api.js:6398-6408`) og på handler er altså en no-op i dag. Læsningen er bevidst fail-safe
mod DISABLED, ikke mod aktiv (`:61-66`).

**Auktions-gebyr ([#2452](https://github.com/NicolaiDolmer/CyclingZone/issues/2452)) er
ikke bygget.** Ejer-ønske 13/7: gratis at auktionere til ≤ 50 % af værdi, gebyr derover.
Issuet er stadig åbent med `needs-decision`. Der findes ingen gebyr-kode i
`api.js`s auktions-oprettelse.

---

## 13. Rytter-udlån findes ikke

`backend/lib/loanEngine.js` handler om **pengelån**, ikke om at leje ryttere ud
(`loanEngine.js:1-8`). Udlåns-featuren er **afviklet**: `loan_agreements`-tabellen er
droppet (#1994, `betaResetService.js:435`, `exportPopulationSnapshot.js:246`). Verificeret
mod prod 30/8: de eneste lån-tabeller er `loans` og `loan_config`.

Pengelånenes eneste kobling til markedet: de fastsætter købekraft, og
`transfer_frozen` (§11.5) spærrer handel når gælden overstiger divisionens loft. Satser og
lofter hører til [`ECONOMY_RULES.md`](ECONOMY_RULES.md); de er læst i `loan_config` og
gentages ikke her.

---

## 14. Hvad der IKKE er fastlagt - kræver ejer-beslutning

Hver post er **én** ting der skal afgøres, med de målte tal indbygget.

1. **Skal 12-timers-gulvet også gælde spiller-valgte sluttidspunkter på holdløse ryttere?**
   I dag er `CUSTOM_END_MIN_HOURS = 1`, og 106 af de 161 fri-agent-auktioner siden 22/8 brugte
   netop den vej til at slutte under 12 timer. (#4177)
2. **Hvad er den kanoniske definition af "fri agent" i spiller-vendt tekst?** Koden kender
   kun `rider.team_id IS NULL`. Ejerens eget spørgsmål fra 24/8 er ubesvaret, og patch-noten
   afgrænser til "banken eller ungdomsmarkedet", hvilket hverken matcher koden eller
   spillernes læsning.
3. **Skal `duration_hours = 1` blive stående?** Prod-configen har stået på 1 time siden
   28/6 mens kode-defaulten er 6. Spilleren egomadsen formulerede valget i #4177: belønne
   konstant tilstedeværelse, eller sikre at alle der er online 1-2 gange dagligt kan nå at
   byde. Ejeren har selv foreslået forum-indlæg + afstemning; det er ikke sket.
4. **Skal auktions-gebyret (#2452) bygges, og efter hvilken kurve?** Ejer-ønsket er 13/7;
   der er ingen gebyr-kode i dag, og designarbejdet (benchmark, kurve, simulering mod ægte
   population) er ikke udført.
5. **Skal prisbåndet ved handel tændes?** Nøglerne findes og er kalibreret (gulv 10 %, loft
   2,2× fra #3231), men står på `0` / `null` i prod. Ét tal-par mangler at blive sat.
6. **Skal `auction_entry_gate_enabled` tændes?** Den er klar og slukket. Dry-run viste 422
   historiske bud fra 53 ægte hold ville være blokeret - ejeren har ikke svaret på om den
   falske-positiv-rate er acceptabel mod #2776-mønsteret.
7. **Skal `is_flash` og `is_guaranteed_sale` slettes?** Begge har 0 rækker i hele basen;
   flash har en frontend-indgang, garanteret salg har ingen skriver overhovedet. Enten
   færdiggøres de, eller også fjernes koden.
8. **Skal `min_increment` respekteres eller fjernes?** Kolonnen skrives men læses aldrig;
   `getMinimumAuctionBid` bruger hardkodet +1.

---

## 15. Fejl området historisk har lavet

Alle med postmortem i `.claude/learnings/`.

| Dato | Fejl | Læring |
|---|---|---|
| 7/5 | Auktions-tider regnet i UTC frem for CET | `2026-05-07-auction-timezone-utc-vs-cet.md`. Al vindue-matematik skal gå gennem `Europe/Copenhagen` |
| 8/5 | **Reserved balance ignorerede proxy-loftet.** En 200K-proxy på en 50K-auktion talte som 50K → over-forpligtelse der først fejlede ved finalisering | `2026-05-08-reserved-balance-proxy-blind-spot.md`. **Ny state-bærende feature kræver audit af ALLE eksisterende validerings-callsites** - grep alle `balance`-gates i samme PR |
| 8/5 | Stale vinder-proxy brød cascade-loopet uden modbud | `2026-05-08-proxy-bidding-stale-winner-proxy.md` |
| 12/6 | **No-bid-auktioner lignede "salg til ingen".** `current_price` nulstilles aldrig ved 0 bud, så to historik-byggere sendte events med køber=null og den umødte startpris | `2026-06-12-no-bid-auction-phantom-sale.md`. `completed` betyder **ikke** "handlet" |
| 22/6 | **Bud-gaten og finalize-gaten divergerede** efter transfervinduet blev afskaffet. UI lod dig byde (warning), finalize afviste hårdt. Spillere kunne tabe auktioner de førte | `2026-06-22-auction-gate-divergence-after-window-removal.md`. Rettet i #1694: nu deler begge `future_count` og reserverer én plads pr. ført auktion |
| 3/7 | **To accessorer til samme afskaffede state.** `getTransferWindowOpen()` blev pinnet til `true`, men `getTransferWindowStatus()` læste stadig tabellen → lån/købsoptioner ville sætte sig fast for evigt | `2026-07-03-transfer-window-two-source-divergence.md`. Afskaf aldrig en feature ved at pinne **én** læser |
| 17/7 | Solgt rytter kunne stadig udtages (pending transfer) | `2026-07-17-sold-rider-still-selectable-pending-transfer.md` |
| 18/7 | **Intake-udløb satte 16 HOLD-EJEDE ryttere på auktion.** Sweepen stolede på `academy_intake.status='offered'` som bevis for at rytteren var fri | `2026-07-18-intake-expiry-auctioned-owned-riders.md`. **Status-felt ≠ virkelighed** - verificér mod `riders.team_id` |
| 21/7 | Ungdomsauktion annulleret ved fuldt akademi | `2026-07-21-youth-auction-cancelled-on-full-academy.md`. Førte til senior-først-reglen (#2701) |
| 9/8 | Betalt auktion hvor `riders.team_id` aldrig flyttede (Seojun Choi, 40.000 CZ$). Rod-årsagen er ikke endeligt fastslået (#3582), men hullet var reelt: `expectMutation` opdager ikke en UPDATE der rammer 0 rækker | `marketUtils.js:66-93`. Lukket med `expectMutationAffectingRows` |
| 9/8 | Fire akademi-ryttere slettet med rå SQL mens de havde aktive auktioner - cascade fjernede auktionerne, ingen budgiver fik besked. Auktionen forsvandt "uden en lyd" | `auctionCancellation.js:125-135` (#3594). Lukket med `cancelActiveAuctionsForRider` |
| 22/6→4/8 | **Vasco Fernandes stod parkeret over 40 dage** med en betalt, aldrig-leveret handel; spilleren opdagede det selv | `deferredTransferHealSweep.js:1-22` (#3330). Lukket med den periodiske heal-sweep |

**Det gennemgående mønster:** markedet fejler når **to kilder til samme sandhed** driver fra
hinanden - bud-gate vs. finalize-gate, vindue-accessor vs. vindue-tabel, intake-status vs.
rytter-ejerskab, patch-note vs. varigheds-kode. Enhver ny regel her skal have præcis én
kilde, og de steder der læser den skal tælles op i samme PR.

---

## 16. Kildedokumenter

- [`ECONOMY_RULES.md`](ECONOMY_RULES.md) - værdi, løn, kontrakter, startpris-loftets
  designkritik, lånesatser. **Al pengefastsættelse hører dertil, ikke hertil.**
- [`BOARD_RULES.md`](BOARD_RULES.md) §4 - bestyrelsens lag 2-3 (lønloft, signerings-
  restriktion over 300.000 CZ$) håndhæves i transfer- og auktions-routes via
  `assertSigningAllowed`.
- `.claude/learnings/` - de 12 postmortems i §15.
- [#4177](https://github.com/NicolaiDolmer/CyclingZone/issues/4177) (åben, `priority:high`)
  · [#3138](https://github.com/NicolaiDolmer/CyclingZone/issues/3138) (lukket, `claude:done`)
  · [#2452](https://github.com/NicolaiDolmer/CyclingZone/issues/2452) (åben, `needs-decision`).

**Ikke dækket af denne fil** (kendte huller, skrevet ærligt frem for gættet):
transferliste- og byttehandels-flowets egen livscyklus (`transferExecution.js`, 
`transfer_offers.round`/`expires_at`, modbud-runder), `youthMarket.js`s udbuds-kadence og
udvælgelse, `academyIntake.js`s tilbuds-udløb, samt `squadEnforcement.js`s bøder
(`SQUAD_FINE_AMOUNT`, `SQUAD_PENALTY_POINTS`) - sidstnævnte refereres i
`getAuctionBidWarnings` men er ikke verificeret mod prod her.
