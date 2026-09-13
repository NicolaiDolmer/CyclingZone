# Ryttertype, potentiale og vist rating — analyse + 3 modeller til afstemning

> Kilde: Discord #dansk-snak 3/9–11/9 (kernen 11/9 09:56–13:35 UTC), sweeps
> `scripts/discord/.sweep-daily-2026-09-04..11.md` + live-hent 11/9 15:38 CPH.
> Måling: read-only SELECT mod prod 11/9 via den faktiske `ratingForRole`
> (`backend/lib/weights/displayRecipes.js`). Kun aggregater her (hard rule 17).
> Refs #3813, #5030, #4704, #3592, #3631, #3664.

## 1. Hvad fylder hos managerne (rangeret)

1. **Rating-tallet undersælger rytteren.** Kortet viser rating i den viste type,
   ikke i den rolle han er bedst i nu. Spillereksempel: type Rouleur/Bjergrytter,
   vist rating 43, men 54 som bjergrytter og 50 som bakkerytter. "Han er reelt 54."
   (valverde4ever, thelamba pkt. 2, egomadsen.)
2. **Typen føles låst og forkert når man har trænet anderledes.** Forslag fra
   spillerne: revurdér typen i sæsonpausen (egomadsen), eller vis først en ny type
   når rytteren er over en tærskel i den (valverde4ever). thelamba er IMOD at
   typen kan skifte.
3. **Puncheur-potentialet er top-3 hos "alle"** (thelamba; #4704/#5030). Målt 6/9:
   hos climber-ryttere ligger puncheur på loft-rang 1-2 hos 100 %.
4. **Sekundærtypen matcher ikke det næsthøjeste loft** (#3813). Spillereksempel
   11/9: type GC/Rouleur, men rouleur er kun 4.-højeste loft. Ejeren kaldte det
   "noget der er i stykker" — det er det ikke, det er anlægs-sekundæren (#3634).
5. **Begrebsforvirring: prognose ≠ potentiale ≠ loft.** En spiller vidste ikke
   hvor potentialet ses; scouting-fanens "prognose" blev læst som potentiale.
6. Ejeren afviser eksplicit både "type = bedst potentiale" og "type = bedst
   rating" som for simple, vil have 2-4 modeller til afstemning og "sætte det i
   sten". Han overvejede en Vman-lignende rollestraf; spillerne afviste den.

## 2. Hvorfor det er som det er i dag (kort)

| Dato | Hvad | Hvorfor |
|---|---|---|
| jun–jul | Vist type = den rolle rytteren havde bedst rating i | — |
| jul/aug | Spillere købte "brostensrytter" med loft 25 i brosten og 75 i bjerg → bombardement af klager | Typen sagde intet om hvad han kunne blive |
| 4/8 (#3325) | Klassifikator kollapset (climber+tt = 94 % af U22) → type klassificeres på lofter, "type = potentiale, stabil hele karrieren" | Cirkularitet: lofter var formet af den gamle type |
| 6/8 (v2-spec, #3458) | Nye ryttere fødes med trukket anlæg (`archetype_draw`) → typen | Rå argmax-rolle kollapsede 92 % til to typer |
| 13/8 (v3, #3664) | Rating = simpelt vægtet snit af LIVE-evner i den viste types opskrift, skala 1-99 | "13 i alt = rating 13, ikke det komplicerede lort" |
| 11-16/8 (#3634) | Sekundærtype = anlæggets sekundær, ikke klassifikatorens næstbedste | Ellers driftede den |
| 20/8 (#3746, trin 7) | Potentiale = FART, ikke højde; loft sættes fladt af rolleklasse | Samme rolle skal have samme loft for alle |

Mekanik i dag: `riderOverallRating = ratingForRole(liveEvner, primary_type)`
(`frontend/src/lib/riderRating.js:71-73`); `primary_type`/`secondary_type` kommer
fra `archetype_draw` (`backend/lib/riderTypes.js:176-218`); loft = samme opskrift
på `ability_caps`; markedsværdi bruger en tredje, frossen `valuation_type` (#3345).

## 3. Måling 11/9 (menneske-hold, n=4.170 aktive ryttere)

| Spørgsmål | Andel |
|---|---|
| Vist type er IKKE den rolle rytteren er bedst i lige nu | **63,1 %** |
| Gab mellem bedste rolle nu og vist rating ≥ 3 / ≥ 5 / ≥ 10 point | 37,8 % / 13,5 % / 1,6 % |
| Vist type er kun 4.-8.-bedste rolle lige nu | 27,3 % |
| Vist type er IKKE den rolle med højeste loft | **33,8 %** |
| Sekundærtype ligger i top-2 af lofterne | 56,0 % |

Konklusion: "typen er den han har bedst potentiale i" holder kun for 2 ud af 3
ryttere, fordi typen kommer fra anlægget (z-kontrast på lofter), mens loft-ratingen
bruger visningsopskrifter der overlapper stærkt (#3592: rouleur i top-3 af loft hos
69 %). Og rating-tallet er "for lavt" for 63 % — i snit 3,3 point, for 1 ud af 7
mindst 5 point. Det er derfor det bliver ved med at komme op.

## 4. Tre modeller (ejerens ønske: skudt ud til afstemning)

**Model A — "Anlæg + Rating nu" (anbefalet).** Typen forbliver anlægget (født, låst,
styrer loft/potentiale). Rating-tallet på kort/tabeller/marked bliver *bedste rolle
lige nu* med rollenavnet ved siden af ("54 · Bjergrytter"). Typen står som badge
("Anlæg: Rouleur / Bjergrytter"). Loft vises i anlægsrollen.
- Fordel: rating lyver aldrig om hvor god han er nu; typen lyver aldrig om hvad han
  bliver. Ingen ny ordbog for spillerne, ingen motor-/økonomiændring
  (`valuation_type` urørt). Det er FM-opdelingen ejeren selv nævnte.
- Ulempe: sortering efter rating sammenligner på tværs af roller (det gør spillerne
  allerede i hovedet). Kræver "Rolle nu"-kolonne + filter i Ryttere/Transfers.

**Model B — "Anlæg + Rolle (to felter)".** Som A, men rollen er et rigtigt felt der
kun genberegnes i sæsonpausen med tærskel (ny rolle skal være ≥ 3 point bedre).
Søgning/filtre får både "Anlæg" og "Rolle".
- Fordel: opfylder egomadsens/valverdes ønske ordret; stabil i sæsonen.
- Ulempe: to labels pr. rytter, mere UI, og en ny "type flipper"-klasse af spørgsmål
  ved hvert sæsonskifte.

**Model C — Status quo + datafix.** Behold "rating i anlægsrollen". Ret puncheur-
opskriften (#5030) og gør sekundæren til næsthøjeste loft (#3813).
- Fordel: billigst, ingen ny forklaring.
- Ulempe: løser ikke punkt 1 (63 %-tallet) — samtalen kommer igen.

**Frarådet: Vman-rollestraf.** 63 % af rytterne er "uden for" deres anlæg lige nu;
en straf ville nerfe de fleste trupper og er en motor-ændring, ikke en visning.

## 5. Uafhængigt af modelvalget (bør ske uanset)

- Ordliste ét sted på rytterprofilen: **Anlæg** (født, låst) · **Loft** (max i rollen)
  · **Potentiale** (hvor hurtigt han når loftet) · **Prognose** (hvor du er på vej hen
  med din nuværende træning). Spillerne blander dem i dag.
- #5030 (puncheur-opskrift) og #3813 (sekundær vs. næsthøjeste loft) er datakvalitet
  og bør lukkes før afstemningen, ellers stemmes der på støj.
- Hjælp/help.json: forklar at træning "forkert" er et aktivt valg med lavere loft.
