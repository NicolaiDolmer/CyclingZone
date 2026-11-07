# Løbssiden og taktik: redesign med ejer og spillere (Discord, 7/11)

Status: design i gang i #build-a-feature (Discord). Intet bygget. Wireframes ligger som PNG i Discord-tråden; kilde-HTML ligger privat i OneDrive `private-handoffs/race-page-2026-11-07/`.

Mål (ejer): ingen hoppen mellem faner, alt om én ting ét sted, intet modsigende, intet der bruges i dag forsvinder. Desktop først, mobil bagefter i separate billeder. Wireframes skal være "levende" med ægte løbsdata (se memory `feedback_living_wireframes`).

## Låst / aftalt indtil nu

- **Spoiler:** referatet følger kun filmen så langt, man har set, og vinderen står ingen steder i Historie-tilstand (spoiler-wireframe v2, ejer: "rigtig godt", 7/11).
- **Fuldt resultat bevares** (ejer 7/11): spillerne kan lide det, men det er for rodet. Ryddes op, så der ikke ligger film, referat eller hvorfor-panel inde i resultatlisten. Hele resultatet skal være nemt at se uden at læse et referat.
- **Resultater skal have** (ejer + spiller 7/11):
  - en tydelig "Mit hold"-knap
  - en søgning, der er nem at finde
  - dagens ruteprofil synlig
  - hele listen kan scrolles, så søgning ikke er eneste vej
  - "Dine ryttere" øverst med plads, tid og en kort grund
  - mellemspurter og bjergspurter samlet ét sted
- **Bevar dagens funktioner:**
  - filter på andres hold
  - klassementsvælger (Etape/Samlet/Point/Bjerg/Ungdom/Hold)
  - "Vis alle"
  - DNF-rækker med grund
  - trøjer efter etapen
  - "YOU"-markering
  - passager med point og bonussekunder
  - mellemtider
  - holdklassement
  - Inventar: se afsnittet nedenfor.
- **Taktik** (ejer 7/11):
  - Ingen "løbsmål"-opfindelse. Alle handlinger under løbet samles i Taktik.
  - Ingen ny UI, men bedre og mere forståelig UX.
  - Rutematch, træthed, form og rating skal være synlige i Taktik.
  - Den forventede træthed ud fra de valgte ordrer skal være gennemskuelig.
- **Træthed:** tal med bjælke, ikke et "Tired"-mærke (arbejdsbænk-design 2/11). Ordrens pris vises med graderede ord eller en visualisering, ikke formler (#7638, ejer 5/11). "Træthed nu" skal tælle dagens tidligere etaper (#7801).
- **Angrib/Alt ud** (ejer 6/11, #7707/#7803): kun Angrib, og det er det hårdeste trin. Intet Alt ud-trin. "Kør i mål" hedder "Kør roligt i mål".
- **Profil i Taktik:** brug Etape-fanens profil (`StageProfileCard`, farvet efter stigning, klikbare stigninger), ikke en ny.
- **Designsystem:** holdets jagt-valg skal bruge `ui/Segmented`, ikke håndbyggede knapper (ejer: "grimme").

## Åbne spørgsmål (stillet i Discord 7/11, venter på svar)

Faner:
- A: Etape, Startliste, Taktik, Hold (anbefalet)
- B: Overblik, Resultater, Startliste, Taktik

Spoiler-default: skal en færdig etape åbne i Resultater eller Historie?

Taktik:
- T1 Segmented + én linje forklaring
- T2 fuld profil altid åben
- T3 skift på stigning: fire faste punkter
- T4 pris: ord (Let/Middel/Hård/Meget hård)
- T5 "efter etapen" som kolonne
- T6 guld "Bekræft plan"
- T7 sortering: rolle, så rutematch
- Prisvisning: A ord, B farve, C bjælke nu→i aften. Anbefaling: A i tabellen, C i editoren.

Løbsfilm (i dag 3 steder, næsten samme indhold):
- F1 én afspiller
- F2 sidste km som kapitel
- F3 ét referat med klikbare km
- F4 kapitler
- F5 mellemtider, passager, hvorfor og "hvad han gjorde" flyttes til Resultater
- F6 spoiler i filmen
- F7 "følg min rytter"

## Inventar: løbssiden i dag (7/11, kode-gennemgang)

Hero: navn, klasse, status, nedtælling til lås, fasebaserede tal.

Etape-fanen:
- strip med "din bedste"
- profilkort med stigningskort km for km
- "dagen kræver"
- din trup med rutematch
- favoritter med grund
- guld "Sæt taktik"-knap
- efter etapen:
  - YourDayCard (Etape/Samlet, top 5, dine ryttere, "Fuldt resultat")
  - Hvorfor-knap (flag `rider_why_button`)
  - RaceStoryCard med afspiller, km-skyder, "Sådan gik det", mellemtider og referat
  - FinaleView

Stillinger:
- holdfilter (Alle / Mit hold / ethvert hold)
- klassementer
- ResultTable med top 10 og "Vis alle", flag, hold, tid, trøjepoint, præmiepoint, udbruds-mærker og dagsform for egne ryttere
- DNF
- PassageList (top 3 pr. punkt)
- StoryOfTheStage med en modal TimelineFilmPlayer
- FinalKilometrePlayback
- RaceReportPanel
- StageSplitTimes
- StageOrdersRecap (også på Etape-fanen)
- WhyPanel
- trøjer
- profil foldet sammen under resultatet

Hold-fanen:
- før start: udtagelse med sorterbare kolonner (inkl. træthed)
- under løbet: trup og resultatmatrix

Taktik:
- roller med scope
- indsats
- tidsgrænse-mærke
- rutematch-sortering
- ordrer eller etapeplan
- kopiér til næste etape
- gem med status

Findes ikke i dag:
- søgning
- sorterbare resultatkolonner
- eksport
- UCI-kolonne
- startliste-fane
- "hop til mit hold"

Refs #7778, #7716, #7638, #7801, #7417, #7373, #3455.
