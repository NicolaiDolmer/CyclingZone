# Rytterhistorier og egen avl

**Status:** Koncept samlet 10/9 2026 fra ejerens R-001 og D-010–017.
De nævnte retninger er valgt; kapitlet som helhed, layout og implementation
er **ikke godkendt til build**. [GDD](../../GAME_DESIGN_DOCUMENT.md) ·
[Ordrette svar](SESSION_LOG.md) · [Beslutninger](DECISIONS.md).

**Områdernes SSOT:** [YOUTH_RULES](../../YOUTH_RULES.md) ejer oprindelse og
udviklingstilknytning; [SOCIAL_RULES](../../SOCIAL_RULES.md) ejer offentlighed
og opfølgning; [TRAINING_RULES](../../TRAINING_RULES.md) §13 afgrænser privat
træningsinformation. [RACE_ENGINE_RULES](../../RACE_ENGINE_RULES.md) ejer
faktisk holdarbejde. Dette kapitel binder oplevelsen sammen; det er ikke en ny
motorregel eller en parallel bonusmodel.

## Oplevelsen

En klub skal kunne se sit bidrag til cykelverdenen, også når rytterne er solgt.
Talentfabrikken kan lykkes gennem andres sejre, og en god hjælperkarriere kan
være værd at følge. Historien bygger på dokumenterede ophold og bedrifter.
Ejerens inspiration er Football Manager; ingen bestemt funktion derfra er
undersøgt eller kopieret i dette koncept.

Manageren vender tilbage og opdager et personligt gennembrud hos en tidligere
rytter. Han kan følge forbindelsen fra dagens begivenhed til rytterens karriere
og videre til klubbens bidrag. Besøgende managers kan se det samme faktiske
udviklingsarbejde på klubprofilen. Private træningsdata hos den nye klub følger
ikke med relationen.

## Tre relationer med hver sit formål

| Relation | Grundlag valgt af ejeren | Formål |
|---|---|---|
| Fra vores akademi | Faktisk akademioprindelse; præcis accept-/oprindelsesregel skal færdiggøres | Bevar oprindelsen ved senere handler |
| Udviklet hos os | Mindst tre sæsoners samlet ungdomstid frem til og med U23-perioden | Anerkend længere udviklingsophold, også efter køb |
| Følg karrieren | Managerens manuelle valg, eksempelvis en tidligere veteran | Bevar personlige favoritter uden offentligt uddannelseskrav |

Flere klubber kan opfylde udviklingskriteriet. De vises med opholdsperioder,
uden at en senere klub overtager akademioprindelsen. Opfølgning er ikke i sig
selv bevis for udvikling, og opholdstid er ikke en rangering af trænerkvalitet.
En langsomt udviklende rytter må ikke miste tilknytningen alene på grund af
lav evnevækst. Der er ikke valgt penge, point eller sportslige bonusser for mærkerne.

## Offentlig historie og personligt overblik

Den offentlige klubprofil får udviklingshistorikken med tydelig forskel på
akademioprindelse og udvikling hos klubben. Navn, nuværende klub, udvalgte
bedrifter og link til rytterprofil blev foreslået som indhold; det præcise
layout og kolonnevalg er åbent.

Managerens eget overblik giver **Siden sidst** med udvalgte milepæle og adgang
til flere detaljer. Det er valgt frem for alle løbsresultater i en strøm eller
kun en liste uden opsummering. Personlige gennembrud vægter højt: hjælperens
første mindre sejr prioriteres over stjernens endnu en almindelig WorldTour-etape
i det forelagte eksempel. Store hovedbedrifter kan fortsat få særlig prioritet.

Første sejr, store karriereresultater, klubskifte og pension er foreslåede
milepæle. Den præcise liste og rangering er ikke låst. Der er ikke valgt nye
eksterne beskeder eller bestemt push-/mail-/Discord-kadence.

## Eksempler som designet skal kunne forklare

1. **To udviklingsklubber:** A har rytteren 16–19, B har ham 19–22. Hvis de faktiske
   ophold hver opfylder tre-sæsonerskravet, får begge relationen. Akademioprindelsen
   bliver hos den oprindelige akademiklub. Ingen fordeling af belønning er besluttet.
2. **Den solgte veteran:** en populær rytter efter ét seniorår kan følges manuelt,
   men opholdet giver ikke "udviklet hos os". Hans milepæle kan stadig betyde noget.
3. **Det personlige gennembrud:** hjælperens første mindre sejr er en stor historie
   for en klub, selv om en tidligere stjerne samtidig vinder endnu en større etape.
4. **Kort gennemhandel:** at købe og hurtigt sælge en ung rytter skaber ikke en
   udviklingstilknytning. At kandidaten engang blev tilbudt klubben er heller ikke
   i sig selv dokumentation for, at klubben faktisk udviklede ham.

## Åbne detaljer før konkret design-go

- Opgør tre sæsoners faktisk ungdomstid: delvise sæsoner, flere ophold,
  sæsonalderens skæring og alder kontra Junior/U23/Senior-trup. At passere tre
  sæsonskifter er ikke aftalt som det samme som at opholde sig der i tre sæsoner.
- Fastlæg akademioprindelse: tilbud, accepteret kandidat og senere akademikøb
  skal skilles; undgå automatisk oprindelse alene fra en tilbudsrække.
- Afklar historisk dækning. Årgangsmærke, handelshistorik og nyere ejerskabslog
  er forskellige kilder (E-005). Ukendte historiske ophold må ikke opfindes.
- Vælg en kort milepælsliste og afgræns gennembrud, prestige og deduplikering.
  Hjælperbidragets synlighed kræver særskilt undersøgelse; en lav placering må
  ikke uden bevis omtales som en dokumenteret holdindsats.
- Afklar "siden sidst", læst-status, store mængder, filtrering, manuel afmelding
  og om man må følge andre end egne tidligere ryttere.
- Afklar pensionerede/slettede ryttere, navne-/klubændringer og privat information
  efter salg. De valgte principper giver ikke adgang til ny privat træningsdata.
- Lav konkrete desktop-/mobilskitser efter PAGE_TEMPLATES/TASTE og aftal
  integration med eksisterende rytterprofil, klubprofil og følgerfunktioner.

## Foreslået verifikationsplan

Planen skal godkendes med det konkrete design. Et indholdsrigt kapitel er ikke
build-go, og en algoritmetest er ikke bevis for oplevet stolthed.

| Niveau | Hvad skal efterprøves |
|---|---|
| Domæneregler | Opholdsgrænser, flere klubber, oprindelse og manuel følge uden ufortjent mærke |
| Integration | Historikkilder, autorisation efter salg, dobbelte hændelser og stor population |
| E2E/visuelt | Klubprofil som besøgende; eget overblik; følg/åbn rytter; desktop og mobil |
| Spillerrunde | Talentmanager og købeklub kan forstå tilknytning og udpege den vigtigste historie efter fravær |

Test-tier fastlægges efter konkret ændringsscope og repoets gældende krav.
Den større samlede feature skal have staging-runde og ejerens visuelle review
før release. Ingen af disse featureprøver er udført i GDD-samtalen.
