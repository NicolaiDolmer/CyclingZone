# Taktik: plan, pris og dokumenteret forløb

Dato: 5/11/2026. Refs #7638 og #5101. Status: samlet designudkast til ejerens vurdering, **ikke godkendt til build**. Produktbyg, spillertekst, merge og release ejes fortsat af Claude efter gældende mandat. Denne leverance ændrer kun designmateriale.

## Formål og succes

En manager efter de første uger skal kunne sammenligne taktiske opgavers kvalitative træthedspris før sit valg og efter etapen forstå, hvad der er dokumenteret om egen plan. Det skal give grundlag for næste valg uden at love et bestemt resultat. Fastholdelse er hypotesen; forbedret forståelse er det første produktmål.

Ejerens valgte mål for staging: Spilleren kan uden hjælp sammenligne opgavernes pris og skelne mellem gemt plan, dokumenteret forløb og ukendte oplysninger. En aktiv ordre er ikke bevis for udført arbejde eller opnået effekt. En god placering beviser ikke, at en bestemt ordre virkede.

## Kilder og ejerskab

- SSOT: [RACE_ENGINE_RULES](../../RACE_ENGINE_RULES.md), afsnittene Løbshistorien, indsatstrappen og Etapeplan langs ruten. [PLANNING_CENTER_RULES](../../PLANNING_CENTER_RULES.md) ejer roller, udtagelse og assistentens grænser. [PAGE_TEMPLATES](../../design/PAGE_TEMPLATES.md) og [TASTE](../../design/TASTE.md) ejer fladerne.
- [#7638, ejer 4/11](https://github.com/NicolaiDolmer/CyclingZone/issues/7638#issuecomment-6629666510): kvalitativ træthedspris på taktiksiden, ikke på indsatskortet; mockup før byg.
- [#5101, ejer 4/11](https://github.com/NicolaiDolmer/CyclingZone/issues/5101#issuecomment-6629666157): ordre, faktisk forløb og årsag til planskift på sande data efter #7635/#7636; kort tekst, resten i Hjælp.
- Ejerens valg i designsamtalen 5/11 er registreret nedenfor. Samtalen ændrer ikke NOW/MASTERPLAN eller Claudes aktive produktclaims. #7652 og #7661 er researchgrundlag, ikke nye implementeringsspor.
- Kodegennemgangen er bundet til main `97cbd5e4e11b77abfa12e11bdbc8ed535e3d6a1f`. Den er ikke en ny produktions-, flag- eller browserverifikation.

## Valgte tilgange og fravalg

Ejerens valg 5/11, i rækkefølge:

1. Kvalitativ pris ved hvert planled plus en kort fælles forklaring af afregningen. Samlet træthedsprognose er fravalgt.
2. Efter etapen vises den samme gemte opgavekæde først. Dokumenterede hændelser og skiftårsager foldes ud ved leddet. Hændelser eller en generel konklusion som første visning er fravalgt.
3. Eftervisningen bor i Hold-fanen ved egne ryttere; etapesidens eksisterende holdopsamling giver adgang. En ny kortstak under filmen og en særskilt evalueringsside er fravalgt.
4. Første version giver ingen samlet præstationsdom eller karakter. Spilleren vurderer selv planen ud fra beviserne; den ældre dom-retning i #5101 genindføres ikke her.
5. Pris står ved alle gyldige valgmuligheder i opgavevælgeren og ved det valgte led bagefter. Separat sammenligningsdialog og pris kun efter valg er fravalgt.
6. Ejeren gennemgår mobil/desktop, derefter staging med 3–5 etablerede spillere før bred udgivelse.
7. Ejeren valgte den viste struktur med detaljer ved hvert led og bad om datakrav og samlet design. Dette er en godkendt strukturretning, ikke et build-go eller releasebevis.
8. Ejeren valgte tre relative niveauer for basisbelastning sammenlignet med normal indsats i samme etape, plus en kort situationsnote, hvor faktisk arbejde kan ændre belastningen. Ukendt vises separat. Fem niveauer og kun fritekstbeskrivelser er fravalgt.

## Omfang og afgrænsning

Visning i eksisterende Taktik- og Hold-faner; genbrug gemmeveje, gyldige opgaver, roller og etapelås. Ingen ny taktik, automatisk plan, anbefaling, samlet træthedsprognose, præstationsdom eller AI-genereret forklaring. #7581s ændring af belastningsmodellen, #5573/#5574s nye mekanikker og #7535s Workbench er separate ejerbeslutninger. Ingen ændring af resultater, historiske ordrer, fysik eller træthedsafregning.

#3455 handler om rytterens aktuelle træthed ved valget; det er beslægtet, men ikke godkendt som ekstra scope her. #7465s anerkendelse af mislykkede angreb kan genbruge faktiske hændelser, men en ny opgørelse over dagens arbejde følger ikke automatisk med.

## Før etapen: #7638

- Genbrug den eksisterende etapevælger, ruteprofil og ryttereditor i `RaceTacticsTab`/`StagePlanBoard`. Ingen ny topboks og ingen ekstra gemmeknap.
- Hver gyldig mulighed i opgavevælgeren bærer et kort kvalitativt prismærke, der er synligt før valg, også på mobil. Det valgte led bevarer mærket i kæden. Samme model bruges i vælger og kæde.
- Pris betyder **opgavens relative bidrag til træthedsbelastning under denne etapes regler**. Det er ikke rytterens aktuelle træthed, samlet etapepris eller en prognose for benene efter etapen. Aktuelt løbsarbejde og øvrige belastningsfaktorer må ikke foregives kendt før løbet.
- Prisgrundlaget følger faktisk regelrevision, condition-model, etapetype, opgave og eventuelle særskilte ordrer. `TASK_EFFORT` alene er utilstrækkeligt: tidskørsel, grupetto og alt ud har revision-/profilafhængige regler, og faktiske arbejdsbidrag er særskilte.
- For en plan er fælles forklaring den gældende regel: det hårdeste planled, som motoren medregner som kørt, styrer efterafregningens indsatsinput. I den nuværende runtime medregnes et led ved aktivering, også ved `at_finish`; det kræver ikke et særskilt angrebsevent eller en målt effekt. Et aldrig aktiveret/sprunget-over led medregnes ikke. Det er ikke et tidsvægtet gennemsnit og beskriver ikke alene alle faktorer i den endelige træthed. Spilleren må derfor ikke få indtryk af, at fravær af et angrebsevent betyder fravær af træthedspris.
- Opgaver uden for kæden, eksempelvis gyldige holdordrer, må ikke få pris ud fra en vilkårlig rytteropgaves trin. Før byg laves en dækningsliste over alle synlige indstillinger/ordrer på taktiksiden, så #7638s bredere scope ikke skjules af den kædefokuserede skitse.
- Ukendt eller ikke-understøttet pris vises som ukendt, aldrig som normal eller gratis. Kendte opgaver skal fortsat kunne vælges og gemmes efter de eksisterende regler.
- Standardordrer, assistentforslag og egen gemt plan bevarer deres forskellige ophav. Prismærker accepterer eller gemmer intet. Et forslag må ikke blive en plan, blot fordi prisen vises.

### Prisdata: foreslået afledt kontrakt

Builderens tekniske valg: en ren, typet kvalifikationsfunktion omkring eksisterende regelkilder, ikke et nyt numerisk balancesystem i frontend. Den kan placeres ved serverens eksisterende kontekstprojektion, hvis private regler ellers ville blive eksponeret. Ingen ny database eller migration er forudsat.

| Oplysning | Krav |
|---|---|
| Kontekst | Løb, etape, regelrevision, relevant condition-tilstand, profil og gyldig rolle/opgave eller ordre. Manglende kontekst er eksplicit. |
| Relativ pris | En kvalitativ kategori eller `unknown`; ingen multiplikator, procent, formel eller intern tærskel i klientpayload. |
| Begrundelse | Stabil semantisk nøgle til kort label/Hjælp, ikke genereret prosa. |
| Begrænsning | Fx ikke-understøttet revision eller ikke-kendt arbejdsbidrag; bruges til korrekt ukendt-visning. |
| Identitet | Samme kontekst i vælger, valgt led og gemt kladde; sene svar fra en anden etape må ikke genbruges. |

Skitsernes niveauer i kantede parenteser er illustrative pladsholdere. **Tre relative niveauer med situationsnote er ejer-valgt; kategorinavne og den konkrete kvalitative opgave-/ordreinddeling er endnu ikke valideret eller copy-godkendt.** Builderen fremlægger inddelingen med private regelkontroller før den kan godkendes. Ordlyden skrives af Claude, EN først og DA derefter. Ingen tal fra kontrollen kopieres til offentlig dokumentation.

**Valgt informationsniveau:** tre relative kategorier for opgavens basisbelastning mod normal indsats i samme etape-/regel-/condition-kontekst, suppleret med en kort betingelsesnote om faktisk arbejde, hvor relevant. Ukendt er en særskilt datatilstand, ikke et fjerde belastningsniveau. Inddelingen beskriver ikke alle opgaver som endeligt lige dyre, blot fordi deres indsatsinput er ens.

En lokal ren funktionsprobe 5/11 kaldte `stageLoadV2` under `s5_profiles_v3` med fast kontekst, condition v2 og uden arbejds-eksponering på flad, kuperet, bjerg, begge individuelle tidskørsler og holdtidskørsel. Kun retninger blev udskrevet: de udvalgte vejprofiler delte indsatstrinnenes relative placering omkring normal, mens beskyt lå lavere end normal på de individuelle tidskørsler og på normalniveau i holdtidskørslen. Dette understøtter kontekstafhængig klassifikation, **ikke** en fuldt valideret prisliste, aktuel flagstatus eller en produktionsmåling. Arbejds-eksponering, andre revisioner og legacy-condition er ikke dækket af proben.

## Efter etapen: #5101

Hold-fanen viser egne historiske deltagere med plan i samme rækkefølge som før etapen. En kompakt kæde er oversigten; detaljer åbner ved det relevante led under rytteren. Kæden er historisk og skrivebeskyttet. Der er ingen pris-/træthedsmærker eller præstationsdom på kortet.

Hvert led skelner mellem:

- **Plan:** hvad der blev givet som ordre, inklusive trigger og gyldigt ophav.
- **Aktivitet:** hvilke planled loggen faktisk dokumenterer aktive eller passeret over.
- **Hændelse:** en navngiven observation om rytteren/gruppen fra den samme etapes tidslinje.
- **Årsag:** hvorfor et planskift skete, kun når både skiftevent og relevant faktuel kontrol holder.

Et `stage_plan_leg` med opgaven angreb beviser aktivering, ikke at rytteren foretog et særskilt registreret angreb eller vandt tid. En hjælperordre dokumenterer ikke hjælperens effekt på kaptajnen. Resultatliste og orden i mål erstatter ingen af disse beviser.

### Nuværende byggesten og konkrete huller

| Kilde | Observeret i kode | Designkonsekvens |
|---|---|---|
| `StagePlanBoard.tsx`, `PlanRecap` | Taktik har allerede en ryttervis kæde og planskift efter etapen. | Genbrug og forbedr projektionen; byg ikke en konkurrerende fortolkning i Hold. |
| `StagePlanModel.stagePlanRecap` | Første led indsættes fra start; tom eventliste kan ende som `to_finish`. | Tom/manglende log må ikke blive et dokumenteret forløb i den nye visning. Indfør eksplicit kilde-/dækningsstatus foran denne antagelse. |
| `stagePlanEngine.ts` | Logger skift og særskilt `at_finish`, og skelner runtime mellem kørt indsats til load og sidste indsats til jury. | Hold skift, faktisk aktivitet, målafgørelse og afregning adskilt. En opgave aktiveret i finalen har ikke automatisk været aktiv i det foregående segment. |
| `StageOrdersRecap` | Læser egne etapeordrer, stage-rolle og defaults med historiske forrangsregler. | Udvid/genbrug kildemodellen; en rekonstrueret default er ikke automatisk en historisk gemt plan. |
| `raceTeamOrdersApi.loadTeamOrderContext` | Egne ordrer med låse-/opdateringsmetadata; aktuelle entries og defaults. | Verificér historisk sammenhæng med den konkrete afvikling. `locked_at` alene beviser ikke fuld inputidentitet. |
| `raceRunner.persistRuns` | `entrant_snapshot` er en liste af deltagende rytter-id'er; checksum er et fingerprint. | Ingen af felterne er alene et fuldt snapshot af den effektive plan/rolle. Der må ikke loves en frossen plan ud fra dem alene. |
| `engineInputSnapshot1857.js` og `raceRunner` | Optager motorens fulde argumenter, herunder `teamOrderRows`, med input-/outputhash og build. Gemning er best-effort og upsert pr. løb/etape. | Foretrukken kandidat til historisk input på serveren, når den findes og kan bindes til det viste forløb. Det er ikke i sig selv en garanti for dækning eller uforanderlig identitet ved rerun. |
| `raceStory` og `stageSplitTimes` | Har eksisterende projektioner af grupper og hændelser. #7636 krydstjekker bestemte sat-påstande. | Genbrug logfortolkningen. Den specifikke kontrol er ikke et generelt bevis for komplet log eller samtlige skiftårsager. |

### Forløbsdata: foreslået afledt kontrakt

Builderen holder projektionen ren og typet. Dette er en viewmodel, ikke en ordre om at oprette nye tabeller eller at ændre motorens output.

| Feltgruppe | Indhold og krav |
|---|---|
| Identitet | `raceId`, `stageNumber`, historisk `teamId`, `riderId` og identitet/version for den læste afvikling og log. Ingen sammenblanding ved rerun, etapeskift eller et parallelt fetch. |
| Historisk plan | Kilde, planled, rolle, triggere og relation til afviklingen. Egen gemt, effektiv default og ukendt holdes adskilt. Dagens nye kladde må aldrig blive gårsdagens ordre. |
| Datatilstand | Loading, læsefejl, ikke understøttet, manglende log, delvis log og tilstrækkeligt dokumenteret log er forskellige tilstande. En tom liste er ikke en implicit komplet log. |
| Planled | Stabilt indeks, oprindelig opgave/trigger, afledt tilstand og kildehenvisninger. Planens rækkefølge ændres ikke efter udfaldet. |
| Aktivitet | `active`, `skipped`, `not_reached`, `unknown` eller dokumenteret afbrudt/udgået. Navnene er kontraktforslag, ikke færdig spillertekst. |
| Kilometer | Kun loggens dokumenterede km/præcision; samme-km-events følger stabil kildeorden. Ingen interpoleret aktivitet ved et ellers manglende skift. |
| Hændelser | Semantisk type, kun relevante egne ryttere/grupper og stabil reference til logposten, fx logversion plus eventindeks. Brug eksisterende `exact_km`- og `at_finish`-semantik. |
| Skiftårsag | Separat `verified`, `unverified` eller `conflicting`, med evidensreferencer. Ubekræftet eller modstridende årsag bliver ikke en kausal spillerpåstand. |

Regler for tilstande:

1. **Aktiv:** kræver bevis for, at dette led var den effektive opgave. Et dokumenteret efterfølgende skift kan understøtte et forudgående led, når historisk plan og logkontrakt matcher. Første led ved start udledes kun med eksplicit, afviklingsbundet dækning; aldrig af tom log alene.
2. **Sprunget over:** et pålideligt skift for samme rytter og afvikling springer over netop leddet, og plan/log matcher. En udebleven angrebshændelse er ikke tilstrækkelig.
3. **Ikke nået:** komplet, relevant dækning viser, at en senere opgave aldrig blev aktiveret. Det gælder ikke en delvis log.
4. **Ukendt:** utilstrækkelig historisk plan, logdækning eller identitet. Bevar de dele der vides, og undlad ukendte tider/årsager.
5. **Afbrudt kontra målstatus:** et dokumenteret incident med `outcome: abandoned` afbryder senere aktivitet. Et incident med kun tidstab gør ikke. OTL afgøres ved mål og må ikke slette dokumenteret aktivitet frem til mål; vis OTL som resultatstatus adskilt fra planforløbet. Eventuelle andre dokumenterede tilbagetrækninger bruger deres faktiske tidspunkt. DNS er ikke en udført plan.
6. **Konflikt:** modstridende grupper, skift eller plan bevarer sikker observation, men ingen sikker skiftårsag. #7635/#7636 kan ikke erstattes af kosmetisk omskrivning i kortet.

Hændelser udvælges deterministisk efter relevans for leddet: dokumenteret aktivering/skift, direkte rytterhændelse og relevant gruppeændring. Begrænset oversigt, resten i den eksisterende film; den konkrete prioritering er et buildervalg med fixtures. Ingen ekstra point-/præstationsmodel.

### Historik, adgang og fejl

- Genbrug de eksisterende authenticated API'er til eget holds ordrer og tidslinje/resultat. Team-id kommer fra serverens autoriserede kontekst, ikke et frit klientvalg.
- Rettighedstjek følger den historiske klubs private ordredata. Et senere rytterkøb giver ikke adgang til sælgerholdets ordrer. Offentlige hændelser gør ikke private planer offentlige.
- Defaults må kun vises som historisk effektive, når de kan bindes til den afvikling og dens rolle-/regelrevision. Ellers er de en ukendt plan, også selv om dagens default kan beregnes.
- Undersøg først den eksisterende private inputoptagelse fra #1857. Udtræk kun den autoriserede historiske klubs effektive plan/rolle, og kontroller relationen til den viste afvikling, tidslinje og efterbehandling. Input-/outputhash gælder motorens optagne objekt; den må ikke naivt sammenlignes med en anden serialisering af den senere tidslinje. Et snapshot, der er overskrevet ved rerun, må ikke bruges sammen med den gamle log. Manglende eller tvetydigt match giver ukendt historik. Hele snapshot, seeds og andre holds inputs må aldrig udleveres til klienten.
- Ældre revisioner eller løb uden kæde får kun deres dokumenterede rolle/ordre og understøttede hændelser. Ingen fabrikeret treledsplan. Tidskørsler får ikke vejordrer eller udbruds-/gruppehistorier, som kontrakten ikke understøtter.
- Etapeordrer, log og resultater hentes samlet/pr. etape gennem eksisterende dataejerskab, ikke ét nyt netværkskald pr. rytter eller planled. Projektionen er read-only. Private runtime-snapshots, seeds og balanceværdier sendes ikke til klienten.
- Læsefejl bevarer sidens chrome, viser retry og adskilles fra ukendt historik. Etape-/kontoskift invaliderer den gamle projektion; gamle async-svar ignoreres.

Hvis eksisterende kilder ikke kan dokumentere den historiske plan eller logdækning, bliver historikken ukendt. En eventuel ny afviklingsattestation eller persisted snapshot kræver separat teknisk design og mandat; der er ingen skjult migration eller motorændring i dette design. Nye data må ikke tilbagefyldes som historisk sandhed.

## Visuel retning og spillertekst

[Den gennemgåede skitse](../../design/7638-5101/plan-flow.html) bevarer desktop/mobil og tre eksempler: alle led aktiveret, dokumenteret spring før næste led og manglende log. Data og prismærker er fiktive. Et aktiveret led er ikke en vurdering af, om opgaven lykkedes.

Eksisterende sidetemplate, faner, hairlines, én gold primary og ryttervis fold bevares. På mobil skal hele kæden og dens status være tilgængelig uden vandret scroll; detaljer ligger ved leddet, ikke nederst under hele truppen. Ingen nye stablede topkort.

Claude skriver endelig spillertekst og Hjælp, EN først/DA derefter, efter ejerens visuelle vurdering. Skitsens danske designannoteringer og niveaupladsholdere er ikke copy-go. Skitsen er syntaks-/fragmentkontrolleret; automatisk browseråbning af den lokale fil blev afvist af browserens URL-politik. Der påstås ingen screenshot- eller autentificeret browserverifikation. Ejerens valg angår strukturretningen.

## Accepttest og verifikation

### Før byg

- Fastlæg og forelæg ejerens kvalitative priskategorier og kort forklaring med regelforankring for alle synlige indstillinger/ordrer. Separate indsatser og arbejdseffekter må ikke fejlagtigt få samme forklaring.
- Dokumentér hvilke kilder der beviser historisk plan/default, afviklingsidentitet og komplet/delvis log. Kan noget ikke bevises, fastlægges den konkrete ukendt-visning.
- Afstem #7635/#7636s aktuelle korrekthed og de gældende regelrevisioner. Kode til en slukket rettelse er ikke releasebevis.
- Endeligt samlet design med datakrav, kvalitative kategorier, tekster og testplan forelægges til eksplicit build-go på de eksisterende issues. Denne kladde giver ikke det go.

### Teknisk tier ved senere implementering

Kontrakten berører delte frontend/backend-projektioner og historisk datalæsning: planlæg **TIER FULL**, foreground preflight, backend-tests, frontend lint/node-tests/typecheck/build og fuld frontend-e2e efter repoets gældende tier. Tunge kørsler gennem verify-lock Max 2, e2e ejes af orkestrator. Nye database-læsninger/joins eller ydelsesændringer kræver teknisk design og lokal PG17-baseline efter regel 36 før første produkt-PR. Ingen runtime-tests kræves for denne docs-only-leverance ud over dokument-/link-/diffkontrol og foreskrevet preflight.

Meningsfulde fixtures ved produktbyg:

1. Samme etape/regel/opgave giver samme prismærke i vælger, kladde og kæde; profil-/revision-/condition-undtagelser rammer faktisk regelkilde. Ukendt kontekst giver ukendt pris. Ingen private tal i serialiseret payload.
2. Uændret plan lagres gennem eksisterende gemmevej; prisvisning giver ingen nye writes, accept af assistentforslag eller ændret efterafregning. Delvis gemning og konflikt følger #7327.
3. Afviklingsbundet log med alle led; aktivt angrebsled uden angrebsevent må ikke blive et lykkedes-angreb-udsagn.
4. Dokumenteret spring over angrebsled; ukendt log; tom log; delvis log; læsefejl; ubekendt revision. Ingen af de sidste bliver stiltiende `to_finish`.
5. Modstrid mellem sat-event og gruppe; flere skift ved samme km; `at_finish`; abandon, tidstab uden abandon, DNS og OTL. Ingen omordnet historik eller aktivitet efter faktisk afbrud; OTL bevarer dokumenteret arbejde til mål. Et aktiveret angrebsled uden angrebsevent kan stadig være medregnet i efterafregningen.
6. Gemte ordrer kontra defaults, ingen gemt plan, senere ændret rolle/default, ryttertransfer og anden managers konto. Ingen læk af private planer eller brug af aktuel trup som historisk facit.
7. Skift mellem etaper/rerun-identiteter mens svar kommer i forkert rækkefølge; siden viser kun den valgte konsistente kontekst.
8. Desktop og mobil: pris i alle valgmuligheder, hele kæden tilgængelig, fold ved leddet, ingen ekstra gold primary eller vandret scroll. Tastatur/fokus, skærmlæsernavne og loading/error-retry verificeres.

### Ejer og staging

Først ejerens reelle mobil-/desktop-preview, inklusive ovenstående cases. Derefter 3–5 etablerede spillere på staging med repræsentative egne testhold og både almindeligt forløb, planspring og ukendt historik.

Uden forklaring fra testleder skal hver spiller: (a) sammenligne to opgavers pris, (b) forklare forskellen mellem aktiveret ordre og dokumenteret hændelse, (c) forklare et dokumenteret planspring og (d) genkende ukendt forløb uden at læse det som en mislykket ordre. Notér konkrete misforståelser og ret/retest de berørte dele før bred udgivelse. Ingen procentgrænse eller retentionmål er opfundet; ejeren vurderer målopfyldelsen ud fra de navngivne opgaver og observationer. En lille kvalitativ runde er ikke målt fastholdelseseffekt.

Ingen spillerinvitation eller udsendelse er autoriseret af denne testplan. Ejeren/Claude arrangerer runden efter konkret mandat. Udrulning, flagvalg, merge og post-deploy-verifikation følger eksisterende gates. Ved produktbyg opdateres områdets SSOT, Hjælp, patch notes og relevant feature-registry i samme leverance/autoriserede close-out.

## Åbne punkter og næste handling

Ejerens strukturelle valg og informationsniveau er samlet her. Tre ting mangler før et komplet buildgrundlag: den konkrete opgave-/ordreinddeling i de tre valgte prisniveauer med regelbevis, kildernes konkrete historik-/dækningsgaranti samt Claudes endelige spillertekst. Builderen undersøger de tekniske huller og forelægger kun reelle produktvalg.

Næste handling er ejerens vurdering af denne samlede designretning og de eksplicitte begrænsninger. Efter færdigt design og eksplicit build-go laves implementeringsplan; ingen produktkode bygges som del af denne docs-leverance.
