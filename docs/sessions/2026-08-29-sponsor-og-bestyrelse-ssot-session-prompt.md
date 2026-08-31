# Session-prompt: sponsorens og bestyrelsens SSOT — og adskillelsen mellem dem

Kopiér blokken nedenfor ind som første besked i den nye session.

---

```
Læs docs/NOW.md, docs/MASTERPLAN.md, docs/ECONOMY_RULES.md og AGENTS.md hard rule 30 FØRST.
Denne session skriver to SSOT-dokumenter der ikke findes i dag, og bruger dem til at
adskille sponsoren fra bestyrelsen. Den bygger ikke balance-ændringer.

## Hvorfor sessionen findes

Ejer-direktiv 25/8 (#4266): SSOT-dokument for alle 10 kernefunktioner, frist 1/9.
Bestyrelsen er en af de 10. Hard rule 30's områdeliste har INGEN bestyrelses-SSOT, og
sponsoren har heller ingen — ECONOMY_RULES.md §3 er tre linjer der peger videre til
GAME_INVARIANTS.md. Sponsoren er dermed det mest spiller-vendte økonomi-område med
det tyndeste skriftlige grundlag.

Prisen blev betalt 29/8. #4376: `guaranteed_base` rebases ikke når et hold rykker op.
21 af 24 D1-hold kører på en lavere divisions sponsor-base, 16 af dem på kontrakter
tegnet FOR sæson 3. Fejlen er ikke eksotisk — designet fra 21/6 (§4.3) siger ordret at
basen er låst i kontraktens løbetid, men det tog aldrig stilling til hvad der sker når
divisions-ankeret under basen flytter sig. Ingen SSOT fangede hullet, fordi der ikke var
nogen. Det er præcis den fejlklasse hard rule 30 blev skrevet for.

Ejer-direktiv 25/8 (#4265), ordret: "I sæson 3 skal bestyrelsen og sponsorere adskilles i ui".

## Rammen du arbejder inden for — læs den, den afgør hvad du må

MASTERPLAN (ejer 28/8): S3 kører 28/8-27/9, og "Gør den kørende sæson god" er valgt.
Grundreglerne — herunder spor B2 "Værdi og løn" — er UDSKUDT til efter 27/9, fordi de
ellers måler spillerne efter andre regler end dem de planlagde efter. Undtagelsen står
ordret: "en ren FEJL i en grundregel må rettes; en forbedring må ikke."

Oversat til denne session:
- SSOT-dokumenterne = ren dokumentation, på kritisk vej via #4266's 1/9-frist. TILLADT.
- #4376 (basen rebases ikke) = ren fejl. TILLADT at rette, men først efter spørgsmål 2.
- #3987, #3595, #3147, arketype-justeringer = forbedringer. DESIGNES nu, shippes efter 27/9.
- #4265 (UI-adskillelsen) står på MASTERPLAN'ens UDSKUDT-liste sammen med #4266-#4268.
  Det er en direkte konflikt mellem to ejer-direktiver. Se spørgsmål 1. Byg intet UI
  før det er afklaret.

Du må altså skrive, måle, dokumentere og designe frit. Du må rette #4376. Alt andet der
flytter et tal for en spiller i S3 kræver et eksplicit GO på netop det skridt.

## Hvad der allerede er verificeret 29/8 — lav det ikke om

Fra undersøgelsen i #4376 (kode + prod-SELECTs, ingen data ændret):

- `sponsorEngine.js:95-105` — en aktiv kontrakt kortslutter hele den division-skalerede
  sti. `SPONSOR_INCOME_BY_DIVISION[team.division]` (linje 117-119) nås aldrig.
- `sponsorContractsService.acceptOffer:463` — `guaranteed_base` skrives på VALG-tidspunktet
  mod `teams.division` som den er DA. Manageren vælger midt i sæsonen, altså før
  op-/nedrykningen er skrevet.
- `expireAndRenewContracts:738-753` — ved aktivering genberegnes KUN `per_race_day_rate`
  (mod ny etape-divisor, #2913). Basen bæres uændret med.
- `expireAndRenewContracts:723-725` — flersæson-kontrakter beholder basen hele løbetiden.
- Prod: D1 24 aktive kontrakter, 21 under D1-gulvet (600.000). Gyldigt D1-interval er
  600.000-840.000 (base × renown-multiplier 1,00-1,40). De implicitte targets rammer
  eksakte multipla af GAMLE divisioners baser: 340.000, 400.000, 476.000, 560.000.
- Tidsskellet er skarpt: 23/8 mellem 17:35 og 18:22 UTC. De tre hold med korrekt D1-base
  blev tegnet inden for 19 sekunder — det er transitionens egen auto-fornyelse, som kører
  EFTER komprimeringen. Motoren gør det rigtige præcis når manageren IKKE vælger selv.
- `board_mandate_model_enabled = off` i app_config siden 17/8. Mandatet (#3514) er bygget
  men mørkt. #3514 bærer alligevel `claude:done` med tomme fase-checkbokse.
- `market_value_sweep_enabled = off`. `transfer_price_floor_pct = 0`, cap = null.

Verificér gerne noget af det igen hvis du er uenig — men mål, gæt ikke, og skriv hvad du målte.

## LEVERANCE 1 (først, og intet bygges før den er godkendt) — beslutnings-inventaret

Samme øvelse som træningens SSOT (#4192), og den øvelse virkede: den fandt tre regler der
kun eksisterede som hensigter, og én af dem var brudt i live-data.

Lav ÉN tabel over hver eneste beslutning der nogensinde er truffet om sponsor og bestyrelse,
med fire kolonner: dato · hvad den siger · hvor den står · ER DEN FAKTISK BYGGET (verificeret
i kode/prod, ikke i issue-tekst). Ejeren markerer selv hvilke der skal genåbnes.

Kilder du SKAL igennem — listen er ikke udtømmende, find selv resten:
- docs/superpowers/specs/2026-06-21-renown-sponsor-fase2-design.md (§2's 8 ejer-låste
  beslutninger, §4.3 kontrakt-livscyklus, §9 out of scope, §10 åbne spørgsmål)
- docs/audits/2026-06-21-renown-sponsor-calibration.md (W_RESULTS=0,45, MAX_MULTIPLIER=1,40)
- docs/audits/2026-08-03-sponsor-archetype-ev-3192.md (5 arketyper, EV-tabeller)
- docs/superpowers/specs/2026-06-21-economy-coherence-design.md
- docs/superpowers/specs/2026-06-17-okonomi-redesign-1441-design.md
- docs/superpowers/specs/2026-07-05-economy-fase3-empire-design.md
- docs/superpowers/specs/2026-08-07-board-mandate-rework-design.md
- docs/ECONOMY_RULES.md §3 og §6 · docs/GAME_INVARIANTS.md
- docs/slices/09-board-mandate-rework-MASTER.md · docs/slices/02-board-redesign-MASTER.md
- Issues: #1663 #2948 #2913 #2914 #3316 #3192 #3020 #2889 #2926 #3494 #3514

En kendt afvigelse at starte fra, så du ved hvad du leder efter: audit'en fra 3/8 foreslog
at hæve "results"-arketypens garanti til 72 %. Koden står i dag på 0,60. Hverken den gamle
værdi (0,55) eller den foreslåede (0,72). Find ud af hvad der faktisk blev besluttet og af
hvem — og hvis det ikke kan findes, så skriv at det ikke kan findes. Det er et legitimt
resultat; et gæt er ikke.

## LEVERANCE 2 — docs/SPONSOR_RULES.md

Ny SSOT. Følg ECONOMY_RULES.md's form: den DUPLIKERER ikke konstanter, den peger på dem og
siger hvad der er sket siden. Den skal som minimum kunne svare på:

- Hvad er de tre tal i sponsor-økonomien, og hvornår flytter hvert af dem sig?
  (renownTarget · guaranteed_base · per_race_day_rate — mindst ét af dem er frosset
  på et andet tidspunkt end folk tror, jf. #4376)
- Hvornår låses en kontrakt, hvad låses, og hvad rebases ved aktivering? Skriv det som
  en tilstandsmaskine, ikke som prosa.
- Hvad sker der ved oprykning, nedrykning, nyt hold, hold uden kontrakt, midt-sæson-hold
  (#3316), og hold hvis kontrakt udløber. Seks tilfælde, seks svar.
- De 5 arketyper med faktiske tal fra koden, ikke fra audit'en.
- Hvad bestyrelsen må røre ved sponsorpengene (MAX_BOARD_MODIFIER, pullout, bonustilbud)
  — og hvad den IKKE må.
- En "kendte åbne modsigelser"-sektion som ECONOMY_RULES §8. Den skal være ærlig.
  Hvis du ikke kunne verificere noget, står det dér, ikke som en påstand.

Registrér den i AGENTS.md hard rule 30's områdeliste i SAMME PR. En SSOT der ikke står
på listen bliver ikke læst.

## LEVERANCE 3 — docs/BOARD_RULES.md + adskillelses-kontrakten

Samme form. Dertil det der er sessionens egentlige pointe:

Sponsoren og bestyrelsen kan ikke adskilles i UI før de kan adskilles på papir. Skriv
kontrakten: hvilket system ejer hvilket håndtag, og hvad er den ene sætning der forklarer
forskellen for en spiller.

Udgangspunktet (ejer 7/8, ECONOMY_RULES §6): bestyrelsens mål betaler KUN i tillid, ingen
ny pengestrøm. Penge-effekten bliver i bonustilbud + MAX_BOARD_MODIFIER = 1,20 på
sponsor-loftet.

Vær kritisk over for netop den grænse. MAX_BOARD_MODIFIER betyder at bestyrelsens tillid
stadig ganger sponsorens penge — den rene linje "sponsor = penge, bestyrelse = tillid"
er altså ikke sand i dag. Enten skal grænsen flyttes, eller også skal sætningen laves om.
Foreslå ikke bare det ene; skriv begge muligheder op med deres konsekvens og spørg.

Kendte koblinger der skal med i kontrakten: bestyrelsens sponsor-vækstmål (#3494, #4377),
sponsor-pullout, bonustilbud (lag 6), og at forhandlingen i dag er en modal udløst FRA
bestyrelsen ved sæsonskifte (designet 21/6 §2, "UI-placering: Hybrid"). Den sidste er
formentlig den direkte årsag til at spillerne blander systemerne sammen.

## LEVERANCE 4 — den fremadrettede kø

Alt herunder er kendt og må IKKE opfindes forfra. Placér hvert punkt i en rækkefølge med
begrundelse, og markér hvad der er blokeret af 27/9-grænsen:

Åbne sponsor-opgaver: #4376 (fejl, må rettes) · #3595 (sponsormål udbetales up front og
kan ignoreres — ejeren har selv bekræftet det i tråden) · #3987 (base + race-day bør skalere
med global ranking/løbsdage) · #3147 (race-day som klumpsum ved sæsonslut i stedet for
løbende) · #2753 (transition-preview viser gross, ikke faktisk payout) · #4345 (kontraktens
"Løbsdage"-række: beløbet passer ikke) · #4125 (upkeep for andre divisioner kan ikke ses,
så oprykning kan ikke prissættes) · #3542 (D2 opleves som økonomisk straf).

Åbne bestyrelses-opgaver: #3494 · #4377 · #4382 · #3574 · #3575 · #2022 · #3152 · #3335 ·
#1237 · #103 · #2261 · #3511 · #3515 · #1141.

Planlagt til SENERE som designet skal kunne bære uden at blive lavet om:
- #1099/#1112/#844 fuld omdømme-motor. Sponsoren kører i dag på "proxy v1" (division +
  resultat-historik), eksplicit markeret som midlertidig i designet fra 21/6 §9.
  Hvad sker der med kontrakterne den dag den rigtige motor lander?
- #1113 fans → #2222 merchandise. Endnu en indtægtskilde skalet af omdømme.
- #930/#2217/#2218 staff som lønudgift og karrierevej.
- #2492/#958 tre-tier klubstruktur (Senior/U23/Junior med egne kalendere). Får de egne
  sponsorer, egne løbsdage, eget upkeep?
- Kontraktudløb → tvangsauktion (designet 23/8, ECONOMY_RULES §5, ikke bygget).
- #1441's gold sinks og "rigtige sponsorer".
- #3050 venskabsløb — tæller de som løbsdage i sponsorens race-day-pulje?
- #3514's resterende faser, med flaget slukket.

## Sådan skal der arbejdes

- Stol ikke på kommentarer, issue-tekst eller `claude:done`. #3514 bærer done med tomme
  faser og et slukket flag. Verificér i kode og mod prod, og skriv hvad du målte.
- Mål ALTID med season_id-filter.
- Ingen prod-mutation uden konkret GO på netop dét skridt. Dry-run → tal → GO → apply →
  post-verify.
- Ét spørgsmål ad gangen, med tallene inde i selve spørgsmålet. Ejeren ser ikke altid
  prosaen over spørgsmålskortet.
- Vis visuelt når noget kan tegnes. To systemers håndtag og hvem der ejer dem er en
  tegning, ikke en tekstblok.
- Skær aldrig scope pga. tid.

## Vær kritisk over for dit eget arbejde — dette er et krav, ikke en opfordring

Når de tre dokumenter står færdige, angrib dem selv, FØR du beder om godkendelse:

1. Find mindst tre steder hvor du skrev en regel du ikke faktisk kunne verificere. Ryk dem
   til "åbne modsigelser". Kunne du ikke finde tre, har du ikke ledt godt nok — hele
   præmissen for sessionen er at området er underdokumenteret.
2. Tag adskillelses-kontrakten og spørg: hvis en spiller læser den ene sætning, kan han
   så forudsige hvor pengene kommer fra? Hvis nej, er sætningen forkert, ikke spilleren.
3. Tag hver af de fire "planlagt til senere"-punkter og spørg: bryder mit design når det
   lander? Skriv svaret ned. Et design der kun holder til næste feature er ikke et design.
4. Skriv eksplicit hvad du IKKE nåede at verificere. En ærlig hvid plet er brugbar; en
   udokumenteret antagelse er den fejl der skabte #4376.

## Spørg mig om mindst dette, ét ad gangen

1. #4265 (adskil bestyrelse og sponsor i UI) er dit direktiv fra 25/8 og bundet til
   sæson 3, som startede 28/8. MASTERPLAN'en fra 28/8 har lagt #4265-#4268 på UDSKUDT.
   Hvad gælder: skal UI-adskillelsen bygges i S3-vinduet, eller er direktivet overhalet
   af "gør den kørende sæson god"?
2. #4376 rammer 21 af 24 D1-hold, som lige nu betaler D1-upkeep (220.000) på en base
   fra D2 (400.000) eller D3 (340.000). Tre hold rykkede D3→D1 og kører på 340.000, mens
   et korrekt baseret D1-hold får op til 840.000. Skal de rettes med tilbagevirkende
   kraft i S3, eller skal fejlen kun lukkes fremadrettet fra S4? Sæsonen er 1 dag gammel.
3. Flersæson-kontrakter: designet fra 21/6 §4.3 siger at basen er låst hele løbetiden,
   "det er hele pointen med længde (sikkerhed vs. upside)". Skal den låsning også gælde
   når holdet skifter DIVISION, eller skal divisions-ankeret følge med mens renown-delen
   forbliver låst? De to ting er blevet behandlet som én beslutning, og det er de ikke.
4. MAX_BOARD_MODIFIER = 1,20: bestyrelsens tillid ganger stadig sponsorens penge. Skal
   den kobling væk for at gøre adskillelsen ærlig, eller skal den blive og adskillelsen
   forklares anderledes?
5. #3595: sponsormålet udbetales up front og kan ignoreres uden konsekvens — du bekræftede
   det selv i tråden 9/8. Skal et sponsormål kunne mislykkes, og hvad koster det i så fald?
6. Mandatet (#3514) er bygget men `board_mandate_model_enabled = off` siden 17/8.
   Skal flaget tændes i S3, vente til S4, eller skal modellen revurderes før den tændes?
7. Sponsoren kører på omdømme-proxy v1 indtil #1099 lander. Skal SPONSOR_RULES beskrive
   proxy'en som den permanente model, eller som et midlertidigt lag med en aftalt udgang?
```

---

## Baggrund — hvorfor sessionen ser sådan ud (læs ikke op for modellen)

### De tre huller sessionen lukker

| Hul | Bevis |
|---|---|
| Sponsoren har ingen SSOT | `ECONOMY_RULES.md` §3 er tre linjer der peger på GAME_INVARIANTS. Ingen `SPONSOR_RULES.md`. |
| Bestyrelsen har ingen SSOT | Hard rule 30's områdeliste i `AGENTS.md:88` nævner ikke bestyrelsen. Den er en af ejerens 10 kernefunktioner (#4266), frist 1/9. |
| Adskillelsen er ikke defineret | #4265 er et UI-direktiv, men koblingen er mekanisk (MAX_BOARD_MODIFIER, sponsor-vækstmål, forhandlings-modal udløst fra bestyrelsen). UI kan ikke skille det der ikke er skilt i modellen. |

### Rækkefølgen er bevidst

Beslutnings-inventaret først, fordi træningens SSOT-session (#4192) beviste at listen er
det der afslører hensigter-uden-implementering. SSOT-dokumenterne før adskillelsen, fordi
adskillelsen er en beslutning man ikke kan træffe uden at vide hvad de to systemer faktisk
ejer i dag. Køen sidst, fordi den er værdiløs før de tre foregående ligger fast.

### Det der bevidst IKKE er i sessionen

Balance-ændringer. #3987, #3147, #3595 og arketype-justeringerne er alle forbedringer, og
MASTERPLAN'ens S3-ramme forbyder forbedringer i grundreglerne indtil 27/9. De designes,
de shippes ikke. #4376 er undtagelsen fordi den er en ren fejl.

### Kilder brugt til at bygge prompten

`docs/NOW.md` · `docs/MASTERPLAN.md` · `docs/ECONOMY_RULES.md` · `AGENTS.md` hard rule 30 ·
`backend/lib/sponsorEngine.js` · `backend/lib/sponsorContractsService.js` ·
`backend/lib/sponsorOffers.js` · `backend/lib/renownEngine.js` · `backend/lib/economyConstants.js` ·
specs fra 21/6, 3/8 og 7/8 · prod-SELECTs mod `ghwvkxzhsbbltzfnuhhz` 29/8 (read-only) ·
issues #4376 #4377 #4382 #4265 #4266 #3514 #3494 #3595 #3987 #3147 #2753 #4345 #4125 #3542.
