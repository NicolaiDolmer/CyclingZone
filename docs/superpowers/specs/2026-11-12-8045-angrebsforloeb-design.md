# #8045: angrebets forløb i motoren og løbsfilmen (design + målt baseline)

Dato: 12/11/2026. Status: design og måling, **ikke godkendt til build**. Ingen produktkode, ingen migration, intet flag er ændret. Kilde: ejerens ord 12/11 på #8045 ("kun fortælle ting, der rent faktisk er sket", "ingen tekst som interval"). Refs #8045 #6350 #7965 #7884 #7280 #6641, PR #8033, PR #8014.

Private kalibreringstal (tuning, tærskler, knæk-risiko) står ikke her. Alle tal nedenfor er offentlige løbsdata fra gemte tidslinjer (km, løbstid, huller).

## Kort konklusion

1. Motoren afgør i dag den afgørende stigning **i ét stykke, ved toppen**. En delt stigning (#7383) får én selektion på halen for hele stigningen (`segmentLoop.ts:1174-1184`, `adapters/finalKmBoundary7383.ts:13-24`). Der findes derfor ingen motor-tilstand "midt på stigningen efter angrebet", og dermed intet sandt "15 s foran ... nu 45 s foran" at fortælle i dag.
2. På alle 7 målte topankomster har den sidste stigning højst ét tjekpunkt inden i sig (10-km-grænsen), og selektionen sker først ved toppen. **Efter angrebets start er der 0 tjekpunkter med ny motor-tilstand før målstregen**, på alle 10 målte etaper (tabel i afsnit 3).
3. `all_out_gain` betyder "tabte mindre end han ellers ville", ikke "vandt tid på gruppen". På Tour de l'Hexagone etape 10 og 11 kom kun 5 af 14 `all_out_gain`-ryttere i mål foran den gruppe, de angreb fra; 6 kom i mål bag den. Dagens film-tekst "vinder tid" er altså forkert for et flertal. Det er bekræftet i prod-data.
4. Angrebets start i motoren er etapeplanens skift (`stage_plan_leg`, fx km 155 / 160), ikke stigningens fod. PR #8033 sætter angrebet ved foden (fx km 157,2 på etape 11), hvor rytteren endnu kørte sin forrige opgave. Det fortæller noget, der ikke skete dér.
5. Knæk-punktet i filmen (fx km 160,05) er lånt fra det split, rytterens gruppe lå i (`raceTimeline.js:797-803`), ikke motorens knæk. Motoren ruller knækket én gang pr. segment og stempler det ved segmentets slut (`climbSelection.ts:819-821`).

Anbefaling: to trin. **Trin A (ren stempling, bit-identisk):** angreb, synligt forspring, knæk, indhentning og udfald ved de grænser motoren faktisk har, med ægte km og løbstid og relativt til en navngiven gruppe. **Trin B (motorændring bag egen kontakt, ejer-beslutning):** den afgørende stigning afgøres i flere trin, så der findes ægte tjekpunkter op ad stigningen. Kun trin B kan give "nu 45 sekunder foran" midt på stigningen uden at opfinde tal.

## 1. Hvad motoren ved pr. segment om en rytter på Alt ud

| Spørgsmål | Hvad motoren gør i dag | Bevis |
|---|---|---|
| Hvornår starter indsatsen | Etapeplanen skifter opgave ved segmentets start ud fra forrige segments udgang; `attack` bliver indsatsen `all_out` for segmentet. Skiftet stemples som `stage_plan_leg` på segmentets start-km, uden `exact_time`. | `segmentLoop.ts:893-898`, `stagePlanEngine.ts` hoved (punkt 3-5) |
| Hvor Alt ud virker | Kun på etapens sidste stigningsblok (topankomst eller sidste stigning), ikke i grupetto, ikke i morgenudbruddet. Før blokken koster `all_out` kun kræfter. | `climbSelection.ts:672-673`, `isLastClimbBlock7280` `climbSelection.ts:784-790` |
| Delt stigning | 10-km-grænsen deler stigningen i hoved og hale. Selektionen (inkl. Alt ud-gevinst og knæk) køres **én gang ved halen på hele stigningen**, med indsatsen fra den længste del. Tempo og kræfter skifter præcist ved grænsen. | `segmentLoop.ts:1174-1184`, `adapters/finalKmBoundary7383.ts:13-24` |
| Afstand til gruppen pr. segment | Gevinsten lægges som en ændring af rytterens eget hul; den bedste kan splitte frem (negativt hul) fra sin gruppe. Den akkumulerede gevinst ligger i `RiderState.all_out_7280.gained`, men emitteres ikke. Gruppers huller ligger i state og i `groupSnapshots` pr. segment, men snapshots gemmes ikke i prod (kun `events`). | `climbSelection.ts:678-683`, `720-721`, `900-925`, `types.ts:661`, `segmentLoop.ts:1382`, `raceRunner.js:2544-2572` |
| Forspring som event | `gap_update` pr. gruppe ved segmentgrænsen, kun når hullet til fronten har flyttet sig over en tærskel; en gruppe med hul 0 (fronten selv) får intet. Forspringet for en angriber forrest kan derfor kun aflæses som næste gruppes hul. | `segmentLoop.ts:1324-1345` (1339) |
| Splittet fremad | `peloton_splits` med negativt `gap_seconds` og `source_group_id`. Årsagen er `climb_deficit`, fordi `split_attack_cause_7640` er slukket. | `climbSelection.ts:747-757`, `570` |
| Knæk-punkt | Seedet rul pr. rytter og segment; event `all_out_cracked` ved `segment.to_km` (ved delt stigning: stigningens top). Også alene på stigningen. | `climbSelection.ts:800-827` (819-821), `834-856` |
| Knækkets sted i filmen | Ikke separations-type i `exactPlace.ts`, så motoren giver tjekpunktet. Visningslaget låner stedet fra det split, rytteren lå i. | `exactPlace.ts:50-52`, `raceTimeline.js:797-803` |
| Gevinst-linjen | `all_out_gain` ved stigningsblokkens sidste segment for hver rytter med `gained >= 1`, uden sekunder (bevidst: summen pr. segment er ikke den samlede gevinst). | `climbSelection.ts:927-940` |
| Indhentning | Ingen Alt ud-specifik hændelse. Kun generisk `group_merged` (kontakt via gruppeklokke, `exact_km` ved kontaktpunktet). På en topankomst er stigningens sidste segment også finalesegmentet, så finalen omfordeler grupper i samme segment. | `segmentLoop.ts:1253-1268`, `1314-1322`, `groups.ts:242`, `exactPlace.ts:71-76` |
| Sted inden i et segment | Hver linje kører med konstant fart mellem segmentets ind- og udgang; separation/kontakt placeres der, hvor linjerne skilles/mødes. | `exactPlace.ts:1-27`, `178-218`, `segmentLoop.ts:1369-1379` |
| Tilfældighed | RNG er nøglet pr. segmentindeks. Flere segmenter giver andre strømme. | `segmentLoop.ts:1116-1117`, `rng.ts` |

Følge: inden for den afgørende stigning kender motoren to tidspunkter for en angriber: hvor indsatsen skiftede (segmentgrænse), og stigningens top/mål. Alt imellem er linje-interpolation.

## 2. Hændelseskontrakt (fælles for Alt ud og langt angreb)

Ét event-type, `attack_story`, med en fase. Hver hændelse har sit eget ægte punkt og sin egen løbstid; findes tiden ikke, emitteres hændelsen ikke.

```
type: "attack_story"
km: number            // motorens ordensnøgle = segmentgrænsen hvor det blev kendt
params: {
  phase: "started" | "checkpoint" | "bridged" | "caught" | "dropped" | "held"
  attack_id: string   // `${rider_id}:${source}:${climb_index}:${leg}`; samme id gennem hele forløbet
  source: "all_out_7280" | "long_attack_7884"
  rider_id: string
  climb_index: number // råt index i rutens climbs (samme som #7884/#7980)
  exact_km: number    // stedet det skete (aldrig efter km)
  exact_time: number  // løbstid i sekunder fra start for rytteren på stedet (påkrævet)
  reference_group_id: string        // den navngivne gruppe forspringet måles mod
  reference_label: "peloton" | "favourites" | "chasers" | "breakaway" | "group"
  reference_rider_count: number
  gap_seconds?: number   // kun checkpoint/held/dropped: + = foran referencen, - = bagved; målt ved en ægte grænse
  trend?: "growing" | "shrinking" | "steady"  // kun checkpoint, mod forrige checkpoint af samme attack_id
  cause?: "cracked" | "out_of_strength" | "outpaced"  // kun dropped
}
```

Regler:
- **started**: km = den grænse hvor rytterens indsats blev angreb **og** angrebet kan virke (Alt ud: senere af etapeplanens skift og stigningsblokkens start; langt angreb: den deterministiske split ved stigningens start, PR #8014). `exact_time` = rytterens tid ved grænsen (entry-front + gruppens hul), som motoren har i hånden. Ingen fod-placering uden skift dér.
- **checkpoint**: kun ved en ægte segmentgrænse efter `started` og før udfaldet, og kun når rytteren stadig er adskilt fra referencen. Aldrig interpoleret.
- **reference_group_id**: gruppen rytteren angreb fra (kilde ved `started`), fulgt gennem merges til den gruppe, der indeholder flest af dens oprindelige ryttere. Navnet afledes af gruppens art og størrelse, ikke af id.
- **caught**: fysisk kontakt med referencen (eller en gruppe bagfra) via gruppeklokken; `exact_km` = kontaktpunktet fra `contactFraction`, som `group_merged` i dag. At nå en gruppe foran er `bridged`, ikke `caught`.
- **dropped**: referencen kører fra ham. `cause=cracked` når Alt ud-knækket ramte (rul i `allOutSelections7280`/`allOutSoloCrack7280`), `out_of_strength` når splittet er `wprime_depleted`, ellers `outpaced`. Stedet: separationspunktet for hans eget split, ellers grænsen.
- **held**: ved stigningens top eller målstregen (det der kommer først af blokkens slut og mål), kun hvis han stadig ligger **foran** referencen; `gap_seconds` er den målte afstand. Ligger han bag referencen, er udfaldet `dropped`, aldrig `held`. `all_out_gain` alene er aldrig bevis.
- Kronologi: `exact_time` stiger strengt inden for samme `attack_id`; filmen sorterer på `exact_time`, ellers `exact_km`.
- Ingen intervaller: et event er et punkt. Teksten bruger aldrig "mellem km X og Y".
- Én hændelse pr. fysisk ting: et split med en angriber emitterer ét `started`/`dropped`, selv hvis flere mekanikker rørte ham.

### Hvor #8045 og #7884 mødes, og hvad Codex skal vide

- Codex' tilstande (`attempting`, `away`, `failed`, `caught`, `superseded`, `retired`, `finished`) kortlægges til faserne: `attempting→away` = `started` (ved første synlige adskillelse), `caught` = `caught`, `failed` = `dropped` (`outpaced`/`out_of_strength`), bridge = `bridged`, `finished` = `held` eller `dropped` efter afstanden ved toppen/mål. `superseded`/`retired` giver ingen spillerlinje ud over de eksisterende (nyt planled, udgået).
- Samme `attack_id`-format med `source: "long_attack_7884"`, og samme `climb_index` som #7980-resolveren.
- Langt angreb ejer tidsgevinsten via egen traversal (PR #8014). Stemplingen er kun en læser af gruppeklokken og må ikke tilføje gevinst eller split.
- Codex' deterministiske split ved stigningens start giver en ægte grænse til `started`. Det er samme mekanisme, trin B her skal bruge til flere tjekpunkter op ad stigningen; byg det én gang i adapteren.
- `peloton_splits.cause` er i dag `climb_deficit` for et angreb fremad; kontrakten må ikke læse årsagen derfra.
- Ét renderer-sæt: film, historie, referat og tidstabsliste læser `attack_story`, ikke `all_out_gain`/`all_out_cracked`/`stage_plan_leg`, når de findes.

## 3. Målt baseline (prod, kun SELECT, 12/11)

Kilde: `race_stage_timelines.events` (version 2) + `race_stage_profiles`. 10 afviklede etaper med Alt ud-hændelser: 7 topankomster, 2 nedkørselsfinaler, 1 flad kontrol.

Kolonnen "grænser med ny selektion" tæller segmentgrænser efter angrebets virkningsstart (senere af skiftet og stigningens start), hvor motoren har afgjort noget nyt om stigningen før toppen/mål. Hovedet af en delt stigning tæller ikke: selektionen sker først ved halen (afsnit 1), så fx Brivio (skift km 119, virkning fra km 150) ligger stadig i feltet ved grænsen km 155.

| Etape | Finale | Sidste stigning (motorgrænser) | Angrebsskift km | Grænser med ny selektion før mål/top | Alt ud-events |
|---|---|---|---|---|---|
| Tour de l'Hexagone 11 | topankomst | 157,2 · 160 · 170 | 160 | 0 | 5 gain @170, 1 knæk (vist 160,05) |
| Tour de l'Hexagone 10 | topankomst | 150 · 155 · 165 | 155 (2 ryttere fra 119) | 0 | 9 gain @165 |
| Tour des Grandes Alpes 6 | topankomst | 156,8 · 165 · 175 | 165 | 0 | 3 gain @175 |
| Tour des Grandes Alpes 5 | topankomst | 128,3 · 130 · 140 | 130 | 0 | 1 gain @140 |
| Giro delle Alpi Orientali 2 | topankomst | 164,9 · 165 · 175 | 165 | 0 | 3 gain @175, 1 knæk (vist 165,07) |
| Vuelta Burgalesa 4 | topankomst | 166,6 · 175 | 165 (før stigningen) | 0 | 1 gain @175 |
| Vuelta a Navarra Nueva 3 | topankomst | 137 · 140 · 150 | 140 | 0 | 1 knæk (vist 140,12) |
| Tour de l'Hexagone 8 | nedkørsel | 139,1 · 149 | 126 | 0 | 1 gain @149 |
| Tour de l'Hexagone 6 | nedkørsel | 185,4 · 188 | 185 | 0 | 2 gain @188 |
| Étoile de Bessèges Mineure 3 | flad (kontrol) | 159,5 · 162 | 75 | 0 | 1 gain @162 |

Etape 10 og 11 rytter for rytter (mål ved toppen):
- Etape 10: 9 `all_out_gain`. Foran kildegruppen (feltet) i mål: Carlos Lozano (vinder, feltet +205,61 s), Federico Brivio, George Whitfield, Quentin Roussel og Ren Watanabe (5). Samme tid som feltet: Hélder Pereira (1). Bag feltet: Mario S. Iglesias, Tiago Ferreira, Mehdi Slimani (3).
- Etape 11: 5 `all_out_gain`. Samme tid som kildegruppen: 2. Bag kildegruppen: 3 (op til 86 s). Ingen foran.

Hvad kan udledes sandt af de gemte tidslinjer i dag:

| Hændelse | I dag | Kræver |
|---|---|---|
| started (km) | Ja: `stage_plan_leg.task=attack` km, kombineret med stigningsblokkens start fra profilen. | Rytterens løbstid ved skiftet mangler (`stage_plan_leg` har ingen `exact_time`). Kan kun regnes baglæns fra andre gruppers `gap_update` + rekonstruktion af hans gruppe; skrøbeligt. **Ny stempling.** |
| Synlig adskillelse | Ja for angribere der splitter frem: `peloton_splits` med negativt hul, `exact_km`/`exact_time`, `source_group_id` (fx Lozano km 155,10, 16131,83 s, fra feltet). | Intet nyt; men årsagsfeltet kan ikke bruges. |
| checkpoint op ad stigningen | Nej: 0 grænser efter skiftet på alle 10 etaper. | **Trin B** (motorændring). Trin A giver kun grænser der findes (fx ved et langt angreb over flere stigninger). |
| caught | Delvist: `group_merged` med kontaktpunkt, men ingen kobling til angrebet, og på topankomster sker kontakt og finale i samme segment. | **Ny stempling** (kobling via `attack_id`). |
| dropped (med årsag) | Delvist: knæk-eventet findes, men stedet er lånt og årsagen "træt efter angrebet" er kun sand for knæk. Ryttere der blev sat uden knæk har ingen linje. | **Ny stempling** (årsag fra motoren, sted fra eget split). |
| held | Nej: `all_out_gain` er forkert proxy (9 af 14 på etape 10-11). Afstanden til kildegruppen kan regnes af `gap_update` ved mål, når gruppe-id'er kan følges. | **Ny stempling** (reference fulgt gennem merges). |

Ydelse i dag: ikke målt pr. etape i denne undersøgelse (ingen lokal motor-kørsel). Måles i PR 1 (afsnit 4).

## 4. Bevisplan

- **Kontakt:** `attack_story_8045` (slukket), løbsbundet som de øvrige regel-kontakter. Slukket = ingen nye events, ingen ekstra arbejde.
- **Bit-identisk (trin A, tændt og slukket):** frys en golden pr. løbsgruppe før første PR (endagsløb, kort etapeløb, GT-etape, monument, U23, junior; flad, kuperet, bjerg-topankomst, nedkørselsfinale, holdtidskørsel, enkeltstart). Bevis at `results`, `groupSnapshots`, alle rytter-states og hver eksisterende tidslinje-hændelse er byte-identiske med kontakten tændt; den eneste forskel er tilføjede `attack_story`-events. Genbrug mønstret fra `oldRevisionDigests6199.test.ts` / `officialTimesV2Frozen6200.test.ts`. Ingen nyt `rngFor`-kald (afvises af en test, der tæller RNG-træk).
- **Korrekthed pr. fase:** `held` kun foran referencen; `dropped` når bag; `caught` kun ved kontakt; strengt stigende `exact_time` pr. `attack_id`; intet event uden `exact_time`; intet event før `started`; replay af Hexagone 10/11-input giver Lozano `held` og Slimani `dropped`.
- **Ydelse:** mål motor-tid pr. etape (median og p95) på golden-sættet før/efter, bag `verify-lock`. Stemplingen er O(angribere x grænser).
- **Trin B** kan ikke være bit-identisk (flere segmenter flytter RNG-strømme og selektionen). Den kræver egen målt baseline, kalibrering mod virkelig cykelsport og alle løbsgrupper, dommer-review og ejerens go, som enhver motorændring (AGENTS regel 36).

## 5. Spillertekst (udkast til ejerens godkendelse, EN først, DA under)

Km og løbstid vises af filmens egen ramme ved linjen, ikke i teksten. {group} er "the peloton/feltet", "the favourites/favoritgruppen", "the chasers/forfølgerne" osv.

- started
  - EN: {rider} attacks on {climb}!
  - DA: {rider} angriber på {climb}!
- checkpoint (første)
  - EN: {rider} has {seconds} seconds on {group}.
  - DA: {rider} har {seconds} sekunder ned til {group}.
- checkpoint (growing)
  - EN: {rider} is now {seconds} seconds clear of {group} and still pulling away.
  - DA: {rider} er nu {seconds} sekunder foran {group} og vinder stadig tid.
- checkpoint (shrinking)
  - EN: {group} is closing in. {rider} has only {seconds} seconds left.
  - DA: {group} kommer nærmere. {rider} har kun {seconds} sekunder tilbage.
- bridged
  - EN: {rider} has bridged across to {group}.
  - DA: {rider} er kørt op til {group}.
- caught
  - EN: It's over for {rider}. {group} has caught him.
  - DA: Det er slut for {rider}. Han er hentet af {group} igen.
- dropped, cause cracked
  - EN: {rider} pays for the attack. He is empty and {group} rides away from him.
  - DA: {rider} betaler for angrebet. Han er træt og bliver sat af {group}.
- dropped, cause out_of_strength
  - EN: {rider} has nothing left and loses contact with {group}.
  - DA: {rider} har ikke mere at give og mister {group}.
- dropped, cause outpaced
  - EN: {rider} cannot follow the pace of {group}.
  - DA: {rider} kan ikke følge tempoet i {group}.
- held
  - EN: {rider} holds on all the way to the top, {seconds} seconds ahead of {group}!
  - DA: {rider} holder hele vejen til toppen, {seconds} sekunder foran {group}!

Også fr, es, nl ved byg. Ingen ejefald efter navn (PR #8033-fundet).

### Levende wireframe (til hovedsessionen)

Etape: **Tour de l'Hexagone etape 10**, Côte de Granier (kat. 1, 15 km, 7,4 %, topankomst km 165). Kun trin A-data (ingen opfundne tjekpunkter). Linjer i rækkefølge med km og løbstid fra prod:

1. km 151,07 · 4:15:46 · Feltet henter morgenudbruddet (seks ryttere) på stigningens første kilometer (eksisterende `breakaway_caught`).
2. km 155,00 · (ny stempling) · Carlos Lozano angriber på Côte de Granier! Samme punkt: Federico Brivio, George Whitfield, Quentin Roussel, Ren Watanabe, Mehdi Slimani, Tiago Ferreira, Mario S. Iglesias, Hélder Pereira skifter til angreb.
3. km 155,10 · 4:28:52 · Lozano er kørt fra feltet (synlig adskillelse fra prod).
4. km 155,18 · 4:29:07 · Brivio er kørt fra feltet; km 155,29 Whitfield; km 155,54 Roussel og Watanabe sammen.
5. km 155,13 · 4:29:02 · Slimani kan ikke følge tempoet i feltet (dropped, outpaced; ligger i en gruppe på tre bag feltet). Tilsvarende Ferreira km 155,32 og Iglesias km 155,49.
6. km 165,00 · 4:57:35 · Lozano holder hele vejen til toppen, 205 sekunder foran feltet! (held; vinder)
7. km 165,00 · Brivio holder, 110 sekunder foran feltet; Whitfield 69 s; Roussel og Watanabe 37 s.
8. km 165,00 · Pereira kommer i mål med feltet (intet `held`; ingen linje om tidsgevinst).

Vis samme etape i to kolonner: "i dag" (ni ens "angriber og vinder tid"-linjer på målstregen eller ved foden) og "trin A". Trin B tilføjer linjer mellem 3 og 6, men kun efter motorændringen; tegn dem ikke med tal.

## 6. Byggeplan i små PR'er

1. **PR 1, golden + måling (ingen adfærd):** frys golden pr. løbsgruppe, RNG-træk-tæller, ydelsesmåling pr. etape. Ren test-PR.
2. **PR 2, motor-stempling bag `attack_story_8045` (slukket):** ren funktion `attackStory8045.ts` der læser state ved hver grænse (entry/exit-tider, grupper, `all_out_7280`, splits/merges i segmentet) og emitterer faserne. Kaldes efter `annotateExactPlaces` i `segmentLoop.ts`. Bit-identisk-test tændt/slukket. Ingen ny RNG.
3. **PR 3, renderer bag samme kontakt:** film, historie, referat, tidstabsliste læser `attack_story`; falder tilbage til #8033-visningen når events mangler (gamle etaper). `races.json` i fem sprog efter ejerens godkendte tekst.
4. **PR 4, tænd-kort:** dommer-review, preview med Hexagone 10-replay, ejerens ordrette go. Ret samtidig #8033's fod-placering: angrebet står ved `started`-grænsen.
5. **Trin B (eget design-issue, ejer-beslutning):** afgør den afgørende stigning i flere trin (adapter-split som Codex' stigningsstart-split). Ikke bit-identisk: egen baseline, kalibrering, alle løbsgrupper, ejerens go før byg.

Risiko: lav for PR 1-3 (kun nye events bag slukket kontakt, bevist bit-identisk). Høj for trin B (ændrer resultater). #7884 skal bruge kontrakten fra PR 2; aftales med Codex før hans feature-build.
