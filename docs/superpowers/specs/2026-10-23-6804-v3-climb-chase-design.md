# #6804 v3: jagt på stigningerne, når udbruddets forspring nærmer sig grænsen (kort design)

Status: design 23/10, intet bygget. Ejer-beslutning 23/10 (morgenkort 8, kommentar på #6804). Refs #6804 #6912.
Bygger videre på P2 "realistisk forspring" i PR #7058 (branch `feat/6804-v3-scorecard-p1`) og på
`2026-10-21-6804-udbrud-pr-loebsgruppe-design.md` (P6, G11) og `2026-10-17-6804-hilly-breakaway-design.md` (G2).
SSOT for reglerne: `docs/RACE_ENGINE_RULES.md`, afsnittet "Udbrudspakken trin 2 under `s5_profiles_v3`"
(på #7058). Bygge-commit'en opdaterer reglen dér.
Hard rule 17: ingen tal her. Zonerne, knappernes værdier og alle målinger står privat i
`balance-internals/6804/` (P2-resultatet: `2026-10-23/v3-p2-resultat.md`). Ingen kode i denne PR.

## 1. Problem

P2 lader lad-gå-fasen slutte ved det forspring feltet tolererer, og kun et felt uden jagt-interesse
kan give et forspring i den øvre zone. Men P2 lofter kun lad-gå-fasen. Reglen siger det direkte:
forspring der opstår af terrænet, loftes ikke af P2.

Det er dét hul, der står tilbage. På bjerg og højfjeld klatrer udbruddet ofte hurtigere end feltet,
efter at lad-gå-fasen er slut. Motoren nulstiller tempo-forskellen mellem udbrud og jagtgruppe på
åbent terræn (`neutralizeBreakawayTempoDrift`), men ikke på stigningerne. Her flytter tempoet hullet
direkte, og jagt-modellens lukning (dæmpet før finalestigningen) kan ikke følge med. Under v3 efter
P2 sker det langt sjældnere end under v2, men stadig på nogle etaper, også når hold havde interesse
i at jage. G2 kræver nul etaper over den hårde grænse, medmindre intet hold vil jage.

## 2. Realisme

I moderne cykelsport topper et bjergudbruds forspring typisk midt på etapen. Derefter skrumper det på
de sidste stigninger, fordi klassementsholdene sætter farten op med deres klatrehjælpere. Udbruddet
vinder ofte stadig, men med en mindre margin. Et meget stort forspring på en bjergetape ses kun, når
feltet bevidst lader det gå, fx en overgangsetape hvor intet klassementshold har noget at hente.
Det er netop G2's undtagelse ("intet hold ville jage").

## 3. Mekanik: klatre-jagten (P2.4)

Kun under `s5_profiles_v3`, kun i etapeløb og kun på de profiler hvor P2 gælder (samme betingelse som
P2: `s5V3RealisticLeadApplies`). Endagsløb, mellembjerg, brosten og grus er urørte (de har ikke
etapeinteressen, og endagsløb har deres eget loft, #6428). `s5_profiles_v2` og ældre er byte-identiske.

**Hvornår den starter.** For hvert udbrud (dagens udbrud, ikke et nedkørselsangreb), når alle tre er
opfyldt på et segment:
1. Lad-gå-fasen er slut for udbruddet (P2.1: forspringet har nået det feltet tolererer, eller
   segmentet har ingen lad-gå-km tilbage).
2. Segmentet er en stigning.
3. Forspringet efter segmentets terrænbevægelse ligger over klatre-jagtens snor. Snoren ligger under
   den hårde grænse med margin og er en knap pr. profil (§4).

Hooket kører efter segmentets tempobevægelse og før gruppe-snapshottet (`segmentLoop.ts`: tempo,
derefter `hooks.breakaway`, derefter snapshot). Det ser altså stigningens terrængevinst og kan rette
den, inden G2 måler. Første bygge-trin bekræfter dette i en test (§6).

**Hvem jager.** De hold, der har interesse efter P2's definition (`s5V3InterestedTeamIds`):
etapeinteresse eller et positivt ordre- eller klassementssignal. Et hold med egen mand i udbruddet
har ingen interesse (#6187), og "lad gå" tæller aldrig. Desuden skal holdet have kørende ryttere i
jagtgruppen. Et hold uden ryttere at sætte farten med kan ikke jage. På en stigning er det holdets
klatrere der arbejder. Rytterne vælges som ved en ordret jagt (aldrig kaptajner), sorteret efter
klatreevne, så det er klatrehjælperne der sætter farten, som i virkeligheden.

**Lukkekraften på stigning og på flad.**
- *Flad og rullende (og stigninger under snoren):* uændret. Den almindelige jagt-model lukker efter
  interessen (`computeNetChaseAdvantage`), inklusive jagt-gulvet og P1's dæmpning før finalestigningen.
- *Stigning over snoren:* klatre-jagten er en kontrol, ikke en hentning. Den bringer forspringet ned
  til snoren og aldrig under, samme form som P6.1 (`s5V3ControlledClosing`). Den lægges ikke oven i den
  almindelige lukning, så intet tælles dobbelt (den præcise regel ligger privat i
  `balance-internals/6804/`), og klatre-jagten kan aldrig hente et udbrud alene. Hentning er stadig finalens og den almindelige
  jagts opgave.
- *Prisen:* jagtholdenes klatrere betaler arbejde i forhold til hvor meget der skulle lukkes
  (samme work-mappe som P2.3, `withAutoChaseWork`). Det giver træthed og en mindre jagtgruppe senere
  på etapen, og filmen kan navngive jagtholdene (`chasing_team_ids`). En stor terrængevinst er
  derfor dyr for feltet, ikke gratis.

**Ingen jagt.** Klatre-jagten kræver *effektiv interesse*: et hold med interesse OG ryttere i
jagtgruppen. Uden det sker der ingen klatre-jagt, og forspringet kan vokse på stigningen. Krydser det
snoren, skriver motoren P2's hændelse `breakaway_unchased` med en årsag, højst én gang pr. udbrud pr.
etape:
- `no_interest`: intet hold ville jage (filmen: "intet hold ville jage").
- `no_riders`: et hold ville jage, men havde ingen ryttere tilbage i jagtgruppen (filmen: "jagtholdene
  havde ingen ryttere tilbage").
Dermed kan ethvert forspring over den øvre zone forklares sandt i filmen, som G2 kræver.

**Samspil med P6-snoren.** P6.1 holder en klassementsreaktion på det reagerende hold tolererer for
truslen (snoren fra #5978). Den snor er normalt kortere end klatre-jagtens. Når begge gælder, vinder
den laveste: P6's kontrol står uændret, og klatre-jagten får kun betydning når der ingen reaktion er,
eller når P6's snor er længere end klatre-jagtens. P6's regel "reaktionens ekstra fart bringer
forspringet ned til snoren og ikke under" gælder fortsat for reaktionens del. I finalen (P6's
finalezone), hvor der hentes, er den almindelige jagt normalt stærkere, og klatre-jagten er kun et gulv.

**Samspil med G11 (yo-yo).** Klatre-jagten henter aldrig, den holder kun forspringet på snoren. Den kan
derfor ikke udløse en tidlig indhentning og dermed ikke S5's nye udbrud (#6369) eller et yo-yo-mønster.

**Fravalgt: fysisk tempo.** Klatre-jagten kunne også laves ved at hæve jagtgruppens tempo på stigningen.
Det er fravalgt, fordi det bogfører hullet to steder (tempo-modellen og jagt-modellen, samme fejlklasse
som #5812 rettede). Det ville også ændre bjergselektionen i favoritgruppen (#6084), som ikke er en del
af denne beslutning.

## 4. Knapper (navne; værdier privat)

I `engine/v4/tuning.ts`, `S5_V3_BREAKAWAY_TUNING.p2`, ved siden af P2's eksisterende knapper:
- `climbChaseLeadSecondsByProfile` + `climbChaseLeadSecondsDefault`: klatre-jagtens snor pr. profil.
  Den skal ligge under den hårde grænse og over P2's mellemzone. Hvor tæt på den øvre zone den skal
  ligge, kalibreres mod G2's anden del (over den øvre zone kun med "ingen jagt").
- `climbChaseSegmentKinds`: hvilke segmenttyper der tæller som stigning (som udgangspunkt kun stigning).
- `climbChaseWorkScale`: arbejdets pris pr. lukket sekund, i forhold til en fuld ordre (som
  `autoChaseWorkScale`).

Ingen ny tilfældighed. Alle knapper flytter kun eksisterende led.

## 5. Testport-gates (v2 mod v3, samme input som P2-målingen)

- **G2:** nul vejetaper i etapeløb og Grand Tours over den hårde grænse, når et hold havde *effektiv*
  interesse (interesse og ryttere i jagtgruppen). Enhver etape over den øvre zone har
  `breakaway_unchased` med årsag; andelen med årsagen `no_riders` rapporteres for sig, så et felt der
  løber tør for hjælpere ikke gemmer sig i "ingen jagt". Medianen ligger stadig i mellemzonen.
- **G1':** udbrudssejrene pr. løbsgruppe og terræn falder ikke yderligere i forhold til P2 knap-runde 2
  (særligt etapeløb samlet, etapeløb bjerg og Grand Tour samlet, der i forvejen ligger lavt).
  Falder de, flyttes snoren først op mod den hårde grænse, før noget andet ændres.
- **G11:** ingen ny yo-yo. Andelen af tidlig klassementsindhentning og yo-yo i etapeløb og Grand Tours
  stiger ikke i forhold til P2 knap-runde 2.
- De hårde gates (mærkning, minuttab på 0 km, flad udbrudssejr med minutter, GC-top-10 i udbrud,
  hold der jagter egne, ramt loft) bliver ikke værre end v2. G12 og G15 forbliver grønne.

## 6. Byg-rækkefølge (på #7058, bag den slukkede `s5_profiles_v3`)

1. **Kontrakt-test først:** en bjergetape i et etapeløb, hvor udbruddet klatrer over den hårde grænse
   efter lad-gå-fasen med et interesseret hold. Den fejler i dag. Samme test bekræfter, at hooket ser
   stigningens gevinst før snapshottet. Fil: `mechanics/breakawayV3ClimbChase_6804.test.ts`.
   **Modstykket i samme fil:** samme etape uden effektiv interesse (dels intet interesseret hold, dels
   et interesseret hold uden ryttere i jagtgruppen). Forspringet klemmes IKKE, og
   `breakaway_unchased` skrives med årsagen `no_interest` henholdsvis `no_riders`. Begge tests skal
   fejle eller bestå af de rigtige grunde, så en byg der klemmer alle udbrud ikke kan bestå.
2. **Rene funktioner** i `mechanics/breakawayV3_6804.ts` (gælder-betingelse, snor pr. profil,
   kontrolleret lukning) og knapperne i `tuning.ts`.
3. **Ledningsføring** i `progressChase` (`breakaway.ts`): lukningen er den største af den almindelige
   lukning og klatre-jagtens, arbejdet føres i work-mappen, og `breakaway_unchased` skrives på stigningen.
4. **Regel og testport-tekst:** P2-punkt 4 i `docs/RACE_ENGINE_RULES.md` erstatter sætningen om
   terræn-forspring, og G2-teksten i `docs/MOTOR_TESTPORT.md` får "med interesse".
5. **Testport** v2 mod v3 (og mod P2 knap-runde 2). Højst to knap-runder, som P2. Tal i
   `balance-internals/6804/<dato>/`.
6. Derefter tages det åbne valg om bredere tolerance på flad (G1' i etapeløb lidt for lav), som ejeren
   bad om at tage efter denne måling. Det er ikke en del af dette design.

## 7. Verifikation (TIER FULL)

- `scripts/verify-local.ps1`, hele backend `node --test`, `tsc -p tsconfig.engine.json` og
  `tsc -p tsconfig.routes.json`, s5MotorBench og tourDryRun-tests.
- Byte-identitet for `s5_profiles_v2` og ældre (de eksisterende digest-tests og
  `s5ProfilesV3Revision6804.test.ts`).
- Testporten med gates fra §5. Private før/efter-tal ved siden af P2-resultatet.
- Ingen tænding. Tænd-gaten for v3 (ejer 22/10) gælder uændret.

## 8. Risiko

- **Færre bjergsejre fra udbrud (G1').** Snoren ligger højt, så et udbrud der ville vinde med et stort
  forspring, vinder typisk stadig, bare med mindre margin. Gaten fanger det, hvis ikke.
- **Træthed hos jagtholdene.** Arbejdet kan svække klassementsholdenes hjælpere før finalestigningen.
  Det er realistisk, men det kan flytte bjergselektionen. Det måles i testporten via G5 og bjergets
  tidsgab, som ikke må flytte sig.
- **Ingen interesse = intet loft.** Det er ejerens undtagelse. Filmen forklarer det, og G2's anden del
  måler, hvor ofte det sker.
