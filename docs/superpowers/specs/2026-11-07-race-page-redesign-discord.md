# Løbssiden og taktik: redesign med ejer og spillere (Discord, 7/11)

Status 12/11: trin 1 (Resultater for en kørt etape) er bygget bag kontakten `race_page_v6`, der er slukket (#7778, PR #8062). Den byggede kontrakt står i [`RACE_ENGINE_RULES.md`](../../RACE_ENGINE_RULES.md), afsnittet "Løbssiden v6, trin 1"; ejerens afgjorte valg står i beslutningslisten øverst på #7778, og nyeste wireframe er v6. Resten af dette dokument er designhistorikken fra 7/11: åbne spørgsmål og forslag herunder er ikke afgjort, medmindre beslutningslisten siger det, og de er ikke bygget, medmindre RACE_ENGINE_RULES siger det. Taktik (trin 2) er ikke bygget.

Oprindelig status 7/11: design i gang i #build-a-feature (Discord). Wireframes ligger som PNG i Discord-tråden; kilde-HTML ligger privat i OneDrive `private-handoffs/race-page-2026-11-07/`.

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

## Svar 7/11 eftermiddag (ejer + en spiller)

### Taktik
- **T1:** jagt-valget bruger `ui/Segmented` i første række af planen. Spiller: brug sidens egne farver.
- **T2:** profilen er altid åben, mens taktikken sættes.
- **T3:** skift sker på fire faste punkter (foden, midtvejs, 3 km før toppen, toppen).
- **T4:** prisen vises kun som ord (Let/Middel/Hård/Meget hård).
- **T5:** kolonnen "I aften" er ét ord (Frisk/OK/Træt/Meget træt).
- **T6:** best practice: guld "Bekræft plan" plus en linje om, hvad der sker, hvis man intet gør.
- **T7:** kaptajnen står først.
- **Q2:** form = formen nu.
- Spiller: mindre luft omkring holdets udbrudsvalg.

### Film
- **F1:** én afspiller med kapitler. Ruteprofilen er filmens tidslinje.
- **F2-F4, F6, F7:** A.
- **F5:** afvist i første form. Nyt forslag: "Hvad han gjorde" flytter til Taktik som plan mod det, der skete, pr. etape. Resultater beholder plads, tid og én linje. Afventer svar.

### Resultater og spoiler
- **Q3:** en færdig etape åbner i Resultater. Siden husker det sidste valg; med skjoldet slået til åbner den i Historie.
- **Q5:** skjoldet findes både som indstilling for alle løb og som kontakt pr. løb.

### Startliste (Q4)
- Startliste før løbet efter PCS-mønster: pr. hold med rygnumre, nation og alder.
- Favoritter pr. klassement ud fra synlige resultater. Aldrig form, rutematch eller roller.
- Favoritter til en etape vælges ikke kun ud fra seneste etape, men ud fra resultater på samme slags etape plus stillingen (spiller).
- Afventer: rygnumre ja/nej, og stjerner eller tekstgrund (S5).

### Åbne spørgsmål (S1-S5)
- S1: indbakke uden placering, når skjoldet er slået til
- S2: Discord-botten
- S3: forsidens resultat-chips følger skjoldet
- S4: indsatskortet = plan mod virkelighed i Taktik
- S5: stjerner eller tekst

## Spillergennemgang 7/11 (issues, Discord, roadmap, analyse)

Med i designet:
- #4490: kommentarer kun på etapen.
- #7810: åbn den seneste etape.
- #6514: søgning i resultatarkivet.
- #7701: DNF-grund.
- #6850: holdpoint efter dagens hold.
- #7822: første tryk på mobil.
- #7643: automatisk tjek af, at resultat, film og referat stemmer.
- #7725/#7705: dagsform og tidstab-grund i referatet.
- Enkeltstart mangler en "hvorfor"-grund (intet issue endnu).
- #6513: favorit-stjerner.
- #7715: tidsgrænse-varsel.
- #5573/#5074: trøjejagt som ordre i Taktik, ikke som løbsmål.
- #6365: genbrug StageProfileCard.

Konflikter, der kræver beslutning:
- #7717 Hvorfor-knap (skjules i Historie)
- #4916/#5120/#91 live, 3D og ticker (skal være den samme ene afspiller)
- #6519, #5061, #3950/#2153, #1299 og #3982: spoiler uden for siden
- #5101 indsatskort (ét sted)
- #3529 rytterens løbsoversigt (overlapper Hold-fanens matrix)

Adfærd (analyse C):
- 149 visninger af etapen og 51 af stillingerne efter løb, med 24 hop mellem dem.
- Ca. 63 % af sessionerne er på mobil.

## Feedback på wireframe v2 (7/11 kl. 16:29-17:23, ejer + jeppek) → skal med i v3

Ejer:
- Ruteprofilen skal ligne og tilbyde det bedste, siden har i dag: vejr, stigningsprocenter, stigningernes navne, mellemspurter og bjergspurter (TASTE P19). Profil også under Hold.
- Rigtige nationsflag ved ryttere (ikke landekoder). Rytter- og holdnavne klikbare (TASTE P12).
- Hele holdet vises og kan scrolles. Favoritter til den enkelte etape, og favoritter må huske andre løb i sæsonen eller en periode, ikke kun det igangværende løb.
- Udtagelsen viser form (nuværende form, ikke hvad den kan blive til), træthed, rutematch, rating og ryttertype som på resten af siden.
- Rating i stedet for alder, og U25 synligt (hvid trøje). Ryttertyper vises som andre steder (RiderTypeBadge).
- Løbsfilmen skal kunne klikkes rundt i. Preview først, derefter kun beta.
- Holdets indstillinger skal i en højere standard (to renere forslag).

jeppek:
- "More" (gå i udbrud, sprintertog) kan ikke klikkes og er gemt væk.
- Første hold med rygnumre 1-7.
- Den foreslåede taktik på flade etaper lader kaptajnen angribe på en stigning, der ikke findes: flade etaper skal have en flad standardplan.
- "How tactics work" skal kunne klikkes (TASTE P15).
- Navne på sprinterne, hvis det var der før. Spillets terræn-ikoner ved etaperne.
- Tidspunktet flyttes op over Rider/Role/Rating; svært at se, hvad hver taktik gør for hver rytter og hvornår.
- Ved flere stigninger: hvordan vælger man, hvornår noget skal ske? (se også #7884). Hvad betyder "middle"?
- Ingen favorit til den etape, der skal køres; vejr, afslutning og terræn mangler på de kommende etaper; tidspunkt på dagens øvrige etaper.

Relaterede issues oprettet 7/11 aften: #7880 (taktik for mange etaper), #7884 (angrib efter tidligere stigning), #7885 (taktik-assistenten), #7886 (tabeller på telefonen).
