# Ungdommens regler: akademi, junior, U23 og senior - SSOT

> **Læs denne FØR enhver opgave der rører akademiet, intake, ungdomsauktionen, graduering,
> flyt mellem trupper, aldersgrænser for hold og løb, eller "kommer snart"-flader for
> ungdomsholdene.** Området blev født uden SSOT: reglerne lå i tre design-specs
> (18/6, 11/7, 16/7), i `FEATURE_STATUS.md` og i kodekommentarer. Hard rule 30(d) i
> `AGENTS.md` kræver at et område har sit dokument. Dette er det. Oprettet 2/9 2026 under
> ejer-brainstormen samme dag (spec: `docs/superpowers/specs/2026-09-02-akademi-tre-trupper-design.md`).
>
> **Denne fil beskriver KLUBBENS UNGDOMSSTRUKTUR: hvem der må stå hvor, hvornår en rytter
> skal flyttes, hvad en plads koster i princippet, og hvad spilleren må se før strukturen er
> bygget.** Den beskriver IKKE hvordan unge ryttere skabes (det er
> [`RIDER_GENERATION.md`](RIDER_GENERATION.md)), hvordan de udvikler sig
> ([`PROGRESSION_RULES.md`](PROGRESSION_RULES.md) + [`TRAINING_RULES.md`](TRAINING_RULES.md)),
> eller hvad de er værd ([`ECONOMY_RULES.md`](ECONOMY_RULES.md)). De fire filer må ikke
> duplikere hinanden.
>
> **Præcise beløb, rater og lofter der er balance-følsomme står IKKE i denne fil** (hard rule
> 17, [#3436](https://github.com/NicolaiDolmer/CyclingZone/issues/3436)). Aldersgrænser,
> trupstørrelser og flag-tilstande er strukturregler og står ordret.
>
> Verificeret mod kode på `main` og mod issues **2/9 2026**. Målbilledet (§2) er ejer-låst;
> byggestatus (§4) er hvad der faktisk kører.

---

## 1. Ordene (EN først, DA under; ejer-valgt 2/9)

| EN | DA | Hvad det er |
|---|---|---|
| Academy | Akademi | Klubbens ungdomsafdeling. Paraplyen over intake, Junior team og U23 team. **Siden "Academy" viser intake, Graduation Day og regnskab; trupperne har egne sider** (ejer 2/9, handoff, se §2.6) |
| Intake | Intake-kuld | Kandidater tilbudt klubben (i dag hver søndag). Ikke en trup |
| Class of S{n} | Årgang S{n} | Mærke på alle ryttere der kom ind i samme sæson (`riders.generation_tag`). Ikke en trup |
| Junior team | Juniorhold | Trup med aldersloft. Sæsonalder 16-18. Løbsberettiget fra 17 (UCI junior = U19) |
| U23 team | U23-hold | Trup med aldersloft. Sæsonalder 19-22 (koden: `isU23ForSeason`, "under 23") |
| Senior team | Seniorhold | Truppen uden aldersloft. 30-cap som i dag |
| Graduation Day | Graduation Day | Dagen ved sæsonskifte hvor ryttere der er vokset ud af en trup skal flyttes |

Alder er altid **sæsonalder** fra `backend/lib/riderSeasonAge.js` (referenceår pr. sæson, S3 = 2028), aldrig kalenderalder. Se `PROGRESSION_RULES.md` for aldring.

---

## 2. Målbilledet (ejer-låst 16/7, præciseret 2/9)

Ejer 16/7, ordret: *"Spillet skal have Senior løb, U23 løb og Junior løb. Ligesom i virkeligheden. Hvert hold har et akademi med nye årgange der løbende kommer ind."* (addendum-spec 16/7 §1, epic [#2492](https://github.com/NicolaiDolmer/CyclingZone/issues/2492)). Brainstormen 2/9 svarede på de seks åbne parametre fra addendum §7 og præciserede strukturen:

### 2.1 Tre trupper, ét akademi

```
Intake (tilbud)  →  Junior team 16-18  →  U23 team 19-22  →  Senior team 23+
                    (løb fra 17)          (U23-løb)           (senior-løb)
                    └──── Akademiet = paraplyen over de to ungdomstrupper ────┘
```

| Regel | Beslutning | Kilde |
|---|---|---|
| Akademiet er en paraply, ikke en trup | Der findes ikke en fjerde "akademi-trup". Akademi-siden viser intake, Graduation Day og regnskab; Junior team og U23 team er egne sider i Klubhus-navigationen (§2.6, ejer 2/9 handoff, amenderer svar 1's "én side") | ejer 2/9, svar 1 (A+B) + handoff 2/9 |
| 16-årige | Sidder i Junior team, men er IKKE løbsberettigede før sæsonalder 17. Første år er træning + scouting | ejer 2/9 (A+B) + teknisk valg godkendt 2/9 |
| Junior team | Sæsonalder 16-18. Bliver rytteren 19, skal han ud | ejer 2/9, svar 2 ("junior max 18") |
| U23 team | Sæsonalder 19-22. Bliver rytteren 23, skal han ud | ejer 2/9, svar 2; matcher `isU23ForSeason` |
| Senior team | Ingen aldersgrænse, 30-cap uændret | `GAME_INVARIANTS.md` |
| En rytter tilhører præcis én trup ad gangen | Truppen afgør hvilken kalender han kører (§2.3) | addendum 16/7 §1.1 |
| AI-hold har også Junior team og U23 team | Tynde felter fyldes med AI. Samme maskine som verdens-influx (#2064) | addendum 16/7 §1.1, ejer-låst |

### 2.2 Flyt mellem trupper (ejer 2/9, svar 2)

Ejer, ordret: *"Spilleren skal som udgangspunkt selv vælge hvor rytterne er. [...] Man kan behandle alle sine ryttere ens. Ens kontrakter, lønninger, alle kan sælges på auktioner, alle kan forlænges med, alle kan sælges på transfer mv. Og det skal være muligt selv at flytte rytterne rundt."*

| Regel | Beslutning |
|---|---|
| Opad er altid tilladt | En 17-årig må stå på U23 team, en 20-årig på Senior team. Kræver ledig plads i mål-truppen |
| Nedad kun inden for aldersloftet | En 24-årig kan ikke flyttes til U23 team. En 19-årig kan ikke flyttes til Junior team |
| Alderen tvinger kun opad | Ved sæsonskifte får spilleren listen over ryttere der er vokset ud af deres trup (Graduation Day). Han flytter selv. Gør han intet inden fristen, flytter systemet rytteren én trup op hvis der er plads og råd, ellers sælges han, ellers slippes han (dagens default-kæde, `academyGraduationSweep.js`) |
| **Salget skal terminere** (#4495, 5/9) | Vælges "sælg", oprettes en senior-auktion og rytteren bliver bevidst stående `is_academy=true` (uden for cap) mens auktionen kører. **Ender auktionen uden bud, slippes rytteren: fri agent** (`team_id=NULL`, `is_academy=false`, kontraktfelter nullet) — sidste led i default-kæden, samme udfald som `resolveGraduation`s release-gren. Kæden må aldrig ende i en tilstand hvor rytteren hverken er solgt, promoveret eller sluppet. Kode: `academyGraduation.releaseUnsoldGraduate`, kaldt fra `auctionFinalization.js`s no-bid-gren |
| **Ingen akademirytter over graduerings-alderen** (#4495) | En rytter med `is_academy=true` og sæsonalder ≥ `GRADUATE_AGE` må kun eksistere mens (a) hans override-vindue er åbent, eller (b) han er på en aktiv auktion. Alt andet er et invariant-brud. Vagt: `ownershipInvariantWatch` invariant G (dagligt, read-only, alarmerer kun). Prædikat + grace-vindue: `backend/lib/stuckAcademyGraduates.js`. Reparation: `backend/scripts/repairStuckAcademyGraduates.js` (`--dry-run` default, `--apply --owner-go` ejer-gated) — vælger handling PR. rytter efter hans historie (ejer 5/9): grad-række `sold` uden gennemført salg → slip; `promoted` men stadig `is_academy=true` → fuldfør promoveringen; INGEN grad-række → default-kæden ovenfor (promovér → sælg → slip) |
| Det tvungne valg flytter fra 22 til 23 | I dag: akademi 16-21, `GRADUATE_AGE: 22`. Nyt: ud af U23 ved 23. Bevidst regelændring |
| Flyt er gratis og øjeblikkeligt | Ingen transfervindue, ingen gebyr. Rytteren beholder kontrakt og løn (§2.4). Kan ikke flyttes mens han er i aktiv auktion eller midt i et etapeløb (dagens gates i `academyTransfer.js` bevares) |
| 1 rytter = 1 løb pr. løbsdag | Urørt. Flyt midt på en løbsdag ændrer ikke dagens udtagelse |

### 2.3 Ungdomsløb (ejer 2/9, svar 4 og 5)

| Regel | Beslutning |
|---|---|
| Egen kalender pr. tier | Junior-løb for Junior team, U23-løb for U23 team, på samme race-motor som senior. Vil du have en U23-rytter i et seniorløb, flytter du ham til Senior team |
| Udtagelse | Frivillig som i dag: assistentens auto-udtagelse er standard, manuel udtagelse når spilleren vil (`ASSISTANT_RULES.md`) |
| Taktik | Kan vælges som i seniorløb (Planning Center, `PLANNING_CENTER_RULES.md`). Ingen ny taktikmotor |
| Præmiepenge | Ingen i v1 (ingen ny guldkilde uden økonomi-sim, addendum §7.5). Ejer 2/9: *"Ikke nødvendigvis præmiepenge fra start af"*. Kan komme senere efter sim |
| Divisioner, grupper, ranglister | **Egen pyramide pr. tier** med op- og nedrykning på egne resultater (ejer 2/9, svar 5: B). Startform er seniorpyramidens 1/2/4/8; endeligt antal divisioner afgøres af felt-gaten nedenfor |
| Felt-gate (hård) | Hvert ungdomsløb skal have et køreligt felt via AI-fyld i 100 % af simulerede løbsdage ved nuværende population (addendum Scorecard C1). Fejler den, skæres antal divisioner, aldrig antallet af løb til nul |
| Løbsfrekvens v1 (forslag) | U23 1-2 løb pr. uge, junior 1 pr. uge (addendum §7.3). Kalibreres i kalender-SSOT'en `CALENDAR_RULES.md` når slicen bygges |
| Resultater | Føder rytterens profil, årgangens side (#2493) og krøniken (#2490). Ungdomsranglister vises pr. gruppe og samlet |
| Hvor ungdomsløb vises (ejer 2/9, handoff) | To steder: i truppens egne faner (Calendar · Results · Standings · Development på Junior team- og U23 team-siden) OG på en egen side **"Youth races"** under Results (Select U23 team / Junior team, guld-knap `Set tactics`, faner Calendar · Results · Standings · Rankings). "A race is a race." Amenderer briefens antagelse om én side |

### 2.4 Én kontraktmodel (ejer 2/9, svar 2)

| Regel | Beslutning | Hvad der ændres |
|---|---|---|
| Samme kontrakt for alle | Ungdomsryttere signeres, forlænges, sælges og slippes efter samme regler og formler som seniorer (`TRANSFER_MARKET_RULES.md`, `ECONOMY_RULES.md`) | Dagens ungdomskontrakt, `ACADEMY.SIGNING_FEE_RATE` og akademi-lønsatsen udgår som særregler når tier-modellen bygges |
| Løn frosset ved signering | Uændret (#1309, `GAME_INVARIANTS.md`) | Intet |
| Drift pr. besat ungdomsplads | Bevares som princip: hver besat plads i Junior team og U23 team koster fast drift pr. sæson (guld-dræn). Konstanten hedder i dag `ACADEMY.DRIFT_PER_SEASON` i `backend/lib/academyFlag.js` | Beløbet pr. tier afgøres i økonomi-sim (Scorecard C3), ikke her |
| Loft pr. trup (ejer 2/9, svar 3: A) | Senior 30 (uændret). **Forslag:** U23 12, junior 10. Endelige tal via økonomi-sim i slice 2-spec | Erstatter den flade 8-plads-cap (`academy_full` ved `academy_count >= 8`) |
| Intake og ungdomsauktion | Uændret scope (#2456): tilbud udløber efter `INTAKE_OFFER_EXPIRY_DAYS`, afvist kandidat går på ungdomsauktion uden sælger, usolgt = forlader sporten | Signeret kandidat lander i Junior team i stedet for "akademiet" |

### 2.6 Fladerne (ejer-beslutninger i Claude Design-handoffet 2/9)

Kilde: [`design/youth-tiers/HANDOFF.md`](design/youth-tiers/HANDOFF.md) + hi-fi-artboards 3a-3k i `design/youth-tiers/Youth tiers hi-fi.html`. Disse beslutninger vinder over briefens §4 hvor de afviger.

| Regel | Beslutning |
|---|---|
| Trupperne er selvstændige områder | Klubhus-navigationen får `U23 team` og `Junior team` efter `My Team` (senior). `Academy` bliver: intake, Graduation Day, regnskab. Ingen "squads"-blok på Academy-siden |
| Alle tre trupsider deler My Team-skabelonen | T2: PageHeader med trupnavn, faner, filterbar, DataTable. Ungdoms-faner: Squad · Calendar · Results · Standings · Development. Senior beholder sine faner. `TeamPage.jsx` genbruges med `squad`-param |
| Ét trup-Select i alle rostere | `Squad: Senior team / U23 team / Junior team / All squads`. `All squads` tilføjer en Squad-kolonne. Checkbox pr. trup afvist |
| Trupnavne | Default `[Club] U23` / `[Club] Juniors`, kan omdøbes via stille `Rename` i header-clusteret |
| Flyt mellem trupper i UI | Række-handling `Move up` / `Move down` på trupsiden (sekundær, aldrig guld) OG `Move to squad`-menu i rytterprofilens hero. Begge åbner `AcademyTransferConfirmModal`. `Move down` disabled med tooltip når sæsonalder > 18 |
| Guld, én pr. view | `Sign` (intake-kort på Academy), `Set tactics` (Youth races + truppens Calendar-fane), `Confirm all` (Graduation Day), `Sell / Auction` (rytterprofil som i dag) |
| Graduation Day | T1-side: ét kort pr. overgang; pr. rytter identitet, rating-plade, potentiale-bånd, kontrakt, træner-sætning, segment (`Move up` default; blokeret = disabled + årsag i danger + `Sell` forvalgt). Banner KUN på Academy plus Inbox-notifikation, ikke på Dashboard. Tom tilstand: EmptyState `inbox`, ingen guld |
| Rytterens rejse | Nyt kort i `RiderHistoryTab`, venstre kolonne af 1.55fr/1fr-gridet. Kun ægte hændelser (intake, trupskifte, første sejr, Graduation Day). `Developed by [club]` kun ved klubskifte. Tom: EmptyState `road` |
| "Class of S{n}" | Vises IKKE som linje på Academy (ejer 2/9: ikke forstået, ikke nødvendigt før #2493). Kun som meta-label på rejse-kortet og som hændelse ("Discovered · Class of S3") |
| Mobil | Bundnav uændret; U23 team og Junior team nås via menuen |
| Slice 0 (S1b) | Bygges præcis som artboard 3b: dagens Academy-side + ét kort `Youth squads` under roster-kortet, to rækker med FacilityTrackCard-pillen "Coming soon", én sætning hver, stille handling `Roadmap`. Ingen nye nav-punkter, ingen tomme tabeller, ingen tal |

Trup-lofter vist i artboards (Junior 10, U23 12) er §2.4-forslaget, stadig afventende økonomi-sim.

### 2.5 Hvad der IKKE ændres

- Potentiale er **1-6 internt, spilleren ser et scout-bånd** ("tredje vej", ejer 13/8, `PROGRESSION_RULES.md` §3). Addendum 16/7 §1.1 og §2 siger "eksakt 1-99 i DB": **det er overhalet** og må ikke bygges. Rå potentiale forlader aldrig serveren (#1162).
- Ungdomsryttere træner i den daglige træning som alle andre (`TRAINING_RULES.md` §7: kun `youthMultiplier(alder)` adskiller dem).
- Straf aldrig styrke; balance er struktur (`project_no_punishment_for_strength`). Ingen handicap på store ungdomsafdelinger.
- Fair-premium (#1142): betaling giver aldrig bedre forventet ungdomsoutput.

---

## 3. "Kommer snart" (ejer 2/9, svar 6: A)

Indtil tier-modellen findes, må spillet vise strukturen, men aldrig lade som om den virker.

| Regel | Beslutning |
|---|---|
| Hvor | På Akademi-siden (`frontend/src/pages/AcademyPage.jsx`), inde i sidens eksisterende layout. Ingen nye nav-punkter, ingen tomme sider |
| Hvad | Ét section card "Youth squads" med to rækker: Junior team og U23 team. Hver række har "Coming soon"-pillen (samme komponent-mønster som `frontend/src/components/klub/FacilityTrackCard.jsx`), én sætning om hvad der kommer, og link til roadmappen |
| Dagens akademi-ryttere | Vises som i dag som én samlet trup ("Academy roster") indtil slice 1 flytter dem til Junior/U23 efter alder |
| Aldrig falske data | Ingen mock-ryttere, ingen fiktive ranglister, ingen tomme tabeller med kolonner. En pille + en sætning + et link |
| Fold-disciplin | `PAGE_TEMPLATES.md`: kortet lægger sig UNDER roster-kortet, ikke over. Sidehoved + maks 2 kort før 1000 px |
| Copy | EN først, DA under, ingen em-dash. "Coming soon" bruges KUN om noget der reelt er planlagt (epic #2492), aldrig som fallback ved fejl (#2796-læringen i `AcademyPage.jsx:21`) |

---

## 4. Hvad der er bygget i dag (verificeret 2/9)

**Live** (alt gated bag `academy_enabled` i `app_config`):

| Mekanik | Hvor | Regel i dag |
|---|---|---|
| Aldersvindue for akademiet | `backend/lib/academyFlag.js` `ACADEMY.MIN_AGE`/`MAX_AGE` | 16-21 |
| Søndags-intake | `backend/lib/sundayIntakeTick.js` | 2 kandidater pr. menneske-hold hver søndag (#2064 S0) |
| Tilbudsfrist | `backend/lib/academyIntakeExpirySweep.js` `INTAKE_OFFER_EXPIRY_DAYS` | 7 dage, derefter ungdomsauktion |
| Intake-status-livscyklus (#1756, ejer-SSOT for engangsoprydninger som #4576) | `backend/lib/academyIntakeReconcile.js` | `academy_intake.status`: `offered` → `signed` (RPC finaliserer erhvervelsen), `rejected` (holdet afviste/hentede ikke, ELLER en stale `offered`-raekke opdager at rytteren blev vundet af et ANDET hold, typisk via ungdomsauktionen). En `offered`-raekke med rytter allerede ejet er stale: maal-status afgoeres af HVEM der ejer rytteren nu — ejet af det TILBUDTE hold → `signed` (sign-flippet fuldfoerte aldrig); ejet af et ANDET hold → `rejected`. `team_id IS NULL` (fri rytter) er IKKE stale — legitimt aabent tilbud, roeres aldrig |
| Signing fee | `academyIntake.js:483`, `ACADEMY.SIGNING_FEE_RATE` | andel af markedsværdi (udgår, §2.4) |
| Drift | `ACADEMY.DRIFT_PER_SEASON`, opkræves i `processSeasonStart` | pr. besat plads pr. sæson |
| Plads-loft | `academy_full` ved `academy_count >= 8` | 8 (erstattes af loft pr. trup) |
| Graduering | `backend/lib/academyGraduation.js` `GRADUATE_AGE: 22`, `DEADLINE_DAYS: 7`; sweep i `academyGraduationSweep.js` | pending-række pr. rytter ≥ 22, default-kæde promovér → sælg → slip |
| Usolgt graduate-auktion (#4495, 5/9) | `academyGraduation.releaseUnsoldGraduate`, kaldt fra `auctionFinalization.js` | ingen bud → fri agent (§2.2). Conditional + idempotent; retter samtidig grad-rækkens fejlagtige `sold`-stempling til `released` |
| Vagt: fastlåst akademi-graduate (#4495) | `backend/lib/stuckAcademyGraduates.js` + `ownershipInvariantWatch` invariant G | dagligt read-only tjek, grace `STUCK_GRADUATE_GRACE_HOURS` (48t) så et åbent/nyligt override-vindue ikke alarmerer |
| Flyt op/ned uden for graduering | `backend/lib/academyTransfer.js` `promote()`/`demote()`; RPC `demote_rider_to_academy` i `database/2026-06-25-academy-promote-demote.sql` | ned kræver sæsonalder ≤ 22, ingen aktiv auktion, akademi ikke fuldt |
| U23/U25-grænser | `backend/lib/riderSeasonAge.js` `isU23ForSeason` (< 23), `isU25ForSeason` (≤ 25, UCI-regel #4587, 2/9) | ét sted for alle kopier |
| Årgangsmærke | `riders.generation_tag` ('s<sæson>') | sættes på alle ungdoms-genererede ryttere (#2493-fundament) |
| Akademi-regnskab | `backend/lib/academyPnl.js` (#2485) | P&L pr. akademi, kun realiseret værdi |

**Tabeller:** `academy_intake`, `academy_graduation`, `academy_intake_ticks`, `academy_season_intake_runs`, `auctions.is_youth`, `riders.is_academy`, `riders.is_u25`.

**Findes IKKE:** en trup-/tier-kolonne på `riders` (kun `is_academy` bool), ungdomskalender, ungdomspyramide, `rider_career_events`. `frontend/public/locales/en/help.json:1151` nævner allerede "your club's Senior/U23/Junior squad structure" i træner-forklaringen. Det er et løfte uden feature; ryd op eller lad det pege på "coming soon" i slice 0.

---

## 5. Slices (epic #2492, rækkefølge ejer-godkendt 2/9)

| Slice | Indhold | Gate |
|---|---|---|
| **Wireframes** ([#4617](https://github.com/NicolaiDolmer/CyclingZone/issues/4617), ejer) | **LEVERET 2/9:** hi-fi (artboards 3a-3k), wireframes (runde 1-2) og `HANDOFF.md` ligger i `docs/design/youth-tiers/`. Ejer-beslutningerne er indarbejdet i §2.6 | Handoff gemt i `docs/design/youth-tiers/` ✅ |
| **0 · Kommer snart** ([#4618](https://github.com/NicolaiDolmer/CyclingZone/issues/4618)) | Akademi-siden får den nye ramme (§3). Bygges mod wireframe S1b | Ejer-visuelt go på screenshots før merge (UI-reglen) |
| **1 · Trup-datamodel** ([#4619](https://github.com/NicolaiDolmer/CyclingZone/issues/4619)) | `riders.squad` (senior / u23 / junior) erstatter `is_academy`; migration mapper efter sæsonalder (16-18 → junior, 19-22 → u23, ≥ 23 med `is_academy` → pending flyt); flyt-endpoint generaliseres; Graduation Day for begge overgange; loft pr. trup; én kontraktmodel. **UI pr. handoff (§2.6):** trupsider i Klubhus-nav (ikke tabeller på Academy), trup-Select i alle rostere, `Move to squad` i rytterprofilen, Graduation Day-siden (3g/3h), rejse-kortet (3i/3j) | Idempotent migration + post-verify; snapshot før mutation; ejer ser dry-run-diff (antal ryttere pr. mål-trup pr. hold) |
| **2 · U23 team + U23-kalender + U23-pyramide** ([#4620](https://github.com/NicolaiDolmer/CyclingZone/issues/4620)) | Kalender, AI-fyld, udtagelse via assistent, taktik via Planning Center, ranglister, op/nedrykning | Scorecard C1-C3, C7 (addendum §5); `CALENDAR_RULES.md` opdateres i samme PR |
| **3 · Junior team + junior-kalender + junior-pyramide** ([#4621](https://github.com/NicolaiDolmer/CyclingZone/issues/4621)) | Fuld tre-tier | Samme gates, genmålt mod da-aktuel population |

Hver slice = egen spec der citerer denne fil, egen PR, egen sim hvor markeret. Ingen slice un-gater sig selv.

---

## 6. Åbne parametre (afgøres i slice-specs, ikke gættet i kode)

| # | Parameter | Afgøres af |
|---|---|---|
| 1 | Loft pr. trup (forslag U23 12, junior 10) | økonomi-sim i slice 1/2 + ejer-go |
| 2 | Drift pr. plads pr. tier | økonomi-sim (Scorecard C3) + ejer-go |
| 3 | Antal divisioner i ungdomspyramiderne | felt-gaten (C1) mod population + ejer-go |
| 4 | Løbsfrekvens pr. tier | `CALENDAR_RULES.md`-arbejdet i slice 2 |
| 5 | Frist på Graduation Day (`DEADLINE_DAYS`, i dag 7, "SIM-STARTPUNKT") | stadig ikke ejer-godkendt siden 18/6; afgøres i slice 1 |
| 6 | Tidlig oprykning "wonderkid" (addendum §7.1: fra 21) | bortfalder: opad er altid tilladt (§2.2) |
| 7 | Præmiepenge i ungdomsløb | efter slice 2-økonomidata, egen ejer-beslutning |

---

## 7. Kendte modsigelser der skal rettes når slicen rører dem

| # | Modsigelse | Vinder |
|---|---|---|
| 1 | Addendum 16/7 §1.1/§2: potentiale 1-99 i DB vs. `PROGRESSION_RULES.md` §3: 1-6 internt (ejer 13/8) | `PROGRESSION_RULES.md` |
| 2 | Addendum 16/7 §1.1: "Junior-hold (16-18)" vs. doktrin 8/6: "Junior = U19, normally 17-18" | Denne fil §2.1: trup 16-18, løb fra 17. Begge tilfredsstilles |
| 3 | Addendum §7.1: tidlig oprykning fra 21 som undtagelse | Denne fil §2.2: opad altid tilladt |
| 4 | `GAME_INVARIANTS.md`: "8-plads akademi-cap håndhæves på ENHVER akademi-tilføjelse" | Gælder indtil slice 1. Rettes i samme PR som loft pr. trup (filen er frossen, ejer-godkender) |
| 5 | `help.json:1151` lover en trupstruktur der ikke findes | Slice 0 |
| 6 | Akademi-promotion-spec 18/6: tvunget valg ved 22 | Denne fil §2.2: ved 23 (ud af U23) |
| 7 | `academy_graduation.status='sold'` stemples når auktionen **oprettes**, ikke når den **afgøres** — status siger "listet", ikke "solgt" (#4495 punkt 2) | Indtil videre: `releaseUnsoldGraduate` retter rækken til `released` når salget ikke blev til noget. En egentlig `listed` → `sold`/`unsold`-livscyklus kræver migration + ejer-go og er ikke bygget |

---

## 8. Kildedokumenter

**Ejer-beslutninger (hensigt, dateret):**
- 8/6 doktrin: `docs/superpowers/specs/2026-06-08-living-world-product-doctrine-design.md` §Youth and generations
- 18/6 graduering: `docs/superpowers/specs/2026-06-18-academy-promotion-flow-design.md`
- 11/7 ungdomsbue: `docs/superpowers/specs/2026-07-11-training-youth-depth-design.md` §5
- 16/7 tre-tier: `docs/superpowers/specs/2026-07-16-traening-ungdom-verdensklasse-addendum-design.md` §1-2, §7
- 2/9 brainstorm: `docs/superpowers/specs/2026-09-02-akademi-tre-trupper-design.md`

**Byggestatus:** `docs/FEATURE_STATUS.md` (Academy-afsnittene) · epic [#2492](https://github.com/NicolaiDolmer/CyclingZone/issues/2492) · [#932](https://github.com/NicolaiDolmer/CyclingZone/issues/932) · [#958](https://github.com/NicolaiDolmer/CyclingZone/issues/958) (lukket, superseded)

**Kode (verificér altid mod denne):** `backend/lib/academyFlag.js` · `academyIntake.js` · `academyGraduation.js` · `academyGraduationSweep.js` · `academyTransfer.js` · `stuckAcademyGraduates.js` · `sundayIntakeTick.js` · `academyIntakeExpirySweep.js` · `academyPnl.js` · `riderSeasonAge.js` · `frontend/src/pages/AcademyPage.jsx` · `database/2026-06-25-academy-promote-demote.sql`

**Design:** `docs/design/PAGE_TEMPLATES.md` (bindende) · `docs/design/youth-tiers/` (wireframes + brief)
