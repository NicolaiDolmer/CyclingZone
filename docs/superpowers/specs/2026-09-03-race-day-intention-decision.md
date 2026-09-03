# Løbsdagens valg: intention pr. rytter — beslutningsoplæg

> Svarer på [#4632](https://github.com/NicolaiDolmer/CyclingZone/issues/4632) og `docs/TRAINING_RULES.md` §8 punkt 1: *"Hvad skal bestemme en rytters udbytte på en løbsdag, når planen ikke længere må være input?"* Skal afgøres FØR `race_day_development_enabled` (D1/D2) tændes igen til S4. Beslutningsoplæg, ikke byg — intet flag flippes, ingen prod-data røres. Refs #3459, #4192, #4277, #4613, #4246, #4615.

## 1. Ejerens skitse, gengivet ordret

Kilde: Discord #dansk-strategi, @bobby2106 (ejeren), 2026-09-02 kl. 12:20-13:20 dansk tid.

> "Nu er der 4 typer, men flere intensiteter kommer også underforstået af, at man kan bestemme hvor dybt i løbene man også går. Så opfatter bliver der 5+ muligheder fremadrettet."

> "Du kan nok komme til at vælge noget i denne stil:
> Gør ingenting - Komplet hvile
> Træning: aktiv restitution / Let træning/teknisk træning / Mellem træning / Hård træning
> Løb: Grupetto / Kør 'stille og roligt' / Mellem/default/normal dag / Arbejd/angrib/udbrud / Voldsom aggressivitet/angreb?"

> "Og det f.eks er jo så 10 muligheder, kan man i og for sig sige. Men dagligt er det nok nemt inddelt mere 'simpelt'. Fordi du vælger jo træning eller løb. Det er 1 valg. Og inde i løbet tror jeg det giver sig selv - Jeg har bjergdag og vil gerne angribe .. Eller 'jeg har flad etape idag og vil slappe af med min kaptajn'."

Læst sammen med princip D (`TRAINING_RULES.md` §12.1): **dagens ene valg er "hvile / træning / løb"; INDE i løbsvalget vælger spilleren en intention** — de fem trin denne opgave dækker (grupetto → stille og roligt → normal → hårdt → all-out). Ejerens sidste sætning ("inde i løbet tror jeg det giver sig selv") er selve pointen med afsnit 2: intentionen skal mærkes i løbet, ikke kun som en trætheds-bogføring bagefter.

## 2. Hvad intention SKAL og IKKE MÅ påvirke i motoren

### SKAL påvirke

| Led | Hvor det allerede findes (genbrug, ikke opfindelse) | Retning |
|---|---|---|
| **Trætheds-omkostning efter etapen** | `effortFatigueMultiplier(effort)`, `backend/lib/raceRoles.js:275-279` — LIVE i v3, forbruges af `stageEnteringFatigues`/`applyRaceFatigue` (`raceFatigue.js:52,98`) | Grupetto sparer mest (under dagens `save`=0.7×), all-out koster mest (over dagens `protect`=1.2×) |
| **Indsats-budget/kraftkrav i selve etapen** | `effortDemandMultiplier(effort)`, `backend/lib/engine/v4/mechanics/effortCost.ts:59-72` — skrevet, IKKE wiret ind i `segmentLoop.ts` endnu (samme fil, kommentar "WIRING-BEHOV") | All-out øger effekt-kravet (mere W'-forbrug, større risiko for at "krakke" sent i etapen); grupetto sænker det markant |
| **Formudbytte (når D2 tændes)** | `applyRaceDevelopmentTick`, `backend/lib/dailyTraining.js:260-300` — `devTotal = replacedTotal × devMult`, i dag uafhængig af effort | Grupetto bør give lavere `devTotal`, all-out højere — ellers er intentionen ligegyldig for progression, i modstrid med princip B (§12.1: valget skal være vigtigt, ikke gøres ligegyldigt af en fallback) |
| **Risiko for kollaps/incident ved høj træthed** | Mønsteret findes allerede i `riderCondition.js:88-91` (skaderisiko kræver hård intensitet OG træthed over `injuryFatigueFloor`) — samme struktur kan genbruges for en løbsdags-analog | All-out ved høj indgangs-træthed skal øge risikoen for et dårligt resultat (ikke en skade nødvendigvis, men en synlig konsekvens), grupetto ved høj træthed skal ALDRIG straffes yderligere — det er netop den sikre vej |
| **Work-cost for roller der har en pris** (helper/hunter/captain/sprint_captain på bestemte profiler) | `workCost(role, profileType, effort)`, `backend/lib/raceRoles.js:250-263` — LIVE, `save` halverer prisen i dag (`EFFORT_COST_MULTIPLIER_SAVE = 0.5`) | Se model C, afsnit 4 |

### IKKE MÅ påvirke

- **Ingen "gratis" all-out.** All-out skal ALTID koste mere træthed (og, når v4 er live, mere W'/kollaps-risiko) end normal. Findes der en vej hvor all-out giver strengt bedre resultat OG strengt lavere eller lig omkostning end normal, er det en fejl, ikke en feature — det gør resten af skalaen meningsløs (spillerne vælger altid all-out).
- **Ingen straf af stærke ryttere.** Intention er en multiplikator PÅ TOP af rytterens evne, aldrig et fortegns-skift. Invariant 3 i `RACE_ENGINE_RULES.md` §3 ("inden for samme gruppe kan lavere testet evne aldrig give bedre tid") skal holde med intention aktiveret præcis som uden — en svag rytter der vælger all-out må ALDRIG kunne slå en stærk rytter der også vælger all-out, kun forbedre sin egen relative position mod sig selv på normal. Samme disciplin som doktrinen i `RACE_ENGINE_RULES.md` §4: *"Styrke straffes aldrig. Den bedste skal kunne vinde. Balance sikres via fordeling og struktur, ikke via handicap."*
- **Grupetto må ikke blive en dominant strategi.** Nul risiko + fuldt formudbytte + fri for work-cost ville gøre grupetto til "gratis frikort" hver dag man ikke er relevant for resultatet. Det skal koste noget synligt (lavere formudbytte, ingen chance for placering) mod den lavere træthed — en reel afvejning, ikke kun en fordel.
- **Ingen skjult sekundær akse.** Intention må ikke duplikere `race_stage_roles.race_role` (hvad er din opgave) — se afsnit 3.

## 3. Forhold til eksisterende taktik/roller/TeamOrders — er intention en ny akse?

**Nej — intention er en udvidelse af det allerede eksisterende `effort`-felt, ikke en ny akse.**

Cycling Zone har allerede tre `effort`-niveauer, LIVE i v3, sat pr. rytter pr. etape på taktik-siden (`race_stage_roles.effort`, `database/2026-07-12-race-v3-s1-work-cost.sql:40`):

```
VALID_EFFORTS = ["protect", "normal", "save"]   -- backend/lib/raceRoles.js:216
```

Det er PRÆCIS samme spørgsmål ejerens skitse stiller ("hvor hårdt går du efter det i dag") — bare med tre trin i stedet for fem, og sat i dag kun via taktik-kortet, ikke på et dagligt overblik. Engine v4's `EffortLevel`-type (`types.ts`) er en **bevidst genimplementering af samme tre værdier** (`effortCost.ts`-kommentaren: *"raceRoles.js's effortFatigueMultiplier(effort) returnerer... v4-genimplementeringen ANKRER på DE SAMME tre startværdier"*) — så en udvidelse til fem værdier skal ske ét sted og arves af begge motorer, ikke opfindes to gange.

**Rolle vs. effort er allerede adskilt, og det mønster skal intention følge:**

| Akse | Spørgsmål | Kolonne | Sat hvor |
|---|---|---|---|
| **Rolle** | Hvad er din opgave i løbet? (captain/sprint_captain/helper/hunter/free_role) | `race_entries.race_role` (sæson) / `race_stage_roles.race_role` (etape-override) | Holdudtagelse / taktik-kort |
| **Effort → intention** | Hvor hårdt går du efter opgaven i dag? (protect/normal/save → 5 trin) | `race_stage_roles.effort` | Taktik-kort i dag; foreslås udvidet til også Today-tabet (§5) |

`RACE_ENGINE_RULES.md` §7 modsigelse 1 løste PRÆCIS samme type spørgsmål for rolle-vs-ordre 27/8+2/9 (`docs/superpowers/specs/2026-09-03-role-vs-teamorder-decision.md`): *"rollen er standardordren for hele løbet, taktik-kortet vinder for den enkelte etape, rollen skrives aldrig om af kortet."* Samme løsning foreslås her for **dobbelt-styring mellem Today-tabets hurtigvalg og taktik-kortet**: Today-tabets intention er **dagens standardværdi** (routine); besøger spilleren taktik-kortet og sætter effort eksplicit for den etape, **vinder taktik-kortet** for netop den etape. Det er samme princip som postmortem'et fra 16/7 (`TRAINING_RULES.md` §10): *"Individuel indstilling vinder over rutine."* Der er ét lager (`race_stage_roles.effort`), to indgange (Today-tab, taktik-kort) — ingen dobbelt-skrivning, ingen ny tabel.

## 4. Tre modeller

### Model A — kun trætheds-/formhandel, ingen resultat-effekt

Intention driver KUN `effortFatigueMultiplier` (trætheds-omkostning) og, når D2 tændes, `devTotal`-skaleringen. Selve placeringen i løbet er uændret af intention — evner, roller og ordrer afgør resultatet som i dag.

- **Fordel:** enkel, lav risiko, kræver ingen v4-wiring — kan shippes mod v3 (den kørende motor) med minimal ny kode, fordi mekanismen allerede er LIVE.
- **Omkostning:** indfrier ikke ejerens egne ord ("inde i løbet tror jeg det giver sig selv"). All-out ville betyde "du bliver mere træt bagefter, men kører identisk med normal i dag" — ingen mærkbar taktisk dybde i selve løbet.
- **Balance-risiko:** LAV.

### Model B — intention skalerer indsats-budgettet i motoren (v4 M12)

Intention → `effortDemandMultiplier` (v4, `effortCost.ts`) ganges direkte på rytterens effekt-krav i segment-loopet. All-out øger W'-forbruget (større risiko for at krakke sent i en hård etape), grupetto sænker det markant (rytteren "kører med", ingen forsøg, lavere risiko men ude af selektionerne).

- **Fordel:** matcher ejerens forventning direkte, giver reel konsekvens i selve løbet, genbruger den allerede skrevne M12-mekanik næsten 1:1 — mindst ny motor-kode.
- **Omkostning:** kræver v4 live. v4 er stadig F3 "delvis" (`RACE_ENGINE_RULES.md` §5) og v3 er **låst fallback indtil F6**, som er ejer-gated uden dato. At binde #4632 til v4 betyder enten dobbelt-vedligehold (byg samme ting i v3-stien også) eller at spillerne ikke mærker intention i selve resultatet før et flip der ikke har en dato — hvilket modsiger at §8 punkt 1 skal afgøres FØR D1/D2 (S3, altså mens v3 stadig kører).
- **Balance-risiko:** HØJ uden kalibrering. Direkte resultatpåvirkning kræver samme "simulér-før-ship"-disciplin som M5/M6-wiringen 3/9 viste (`RACE_ENGINE_RULES.md` §7 modsigelse 10/11): at aktivere en hvilende mekanik flyttede feltfavoritters vinderrate fra 53,7 % til 83,2 % og tog flere målerunder at forstå.

### Model C — hybrid med loft: udvid det LIVE effort-felt, resultat-effekt kun via work-cost

Udvid `race_stage_roles.effort` fra tre til fem værdier. De to nye yderpunkter (grupetto, all-out) sætter mere ekstreme, men **loftede**, multiplikatorer på de to mekanismer der allerede er LIVE i v3:

1. `effortFatigueMultiplier` — trætheds-belastning (grupetto < dagens `save`, all-out > dagens `protect`).
2. `workCost`-multiplikatoren — resultat-siden, men KUN for roller med en defineret pris (helper/hunter/captain/sprint_captain på bestemte profiler; `free_role` er upåvirket, som i dag). All-out reducerer/fjerner work-cost-straffen (rytteren "går efter det for sig selv" i stedet for at arbejde for holdet) — **loftet til maks 0**, aldrig en positiv bonus oveni egen evne. Grupetto giver ingen resultat-fordel, kun den største trætheds-besparelse (og laveste formudbytte, når D2 tændes).

v4's M12 (`effortDemandMultiplier`) forbliver den dybere, fremtidige resultat-mekanik — samme 5-værdi-enum genbruges 1:1 når v4 en dag flippes (F6), så arbejdet her ikke smides væk.

- **Fordel:** kan shippes mod v3 NU, genbruger to allerede test-dækkede, allerede kalibrerede mekanismer i stedet for at opfinde en tredje. Loftet forhindrer per konstruktion "gratis all-out" og "straf af styrke" — work-cost kan aldrig blive positivt, kun nå 0.
- **Omkostning:** for en `free_role`-rytter (256 af 103.304 tilmeldinger, §2-tal fra `role-vs-teamorder-decision.md`) — og reelt for enhver rytter uden en defineret work-cost-pris — mærkes intentions resultat-side slet ikke, kun trætheds-/formsiden. Det skal kommunikeres ærligt (§5), ikke skjules.
- **Balance-risiko:** MELLEM. To nye multiplikator-konstanter (grupetto/all-out) skal kalibreres med dry-run, akkurat som D3 gjorde for restitutionskonstanterne — men de bygger oven på et allerede afprøvet fundament, ikke fra bunden.

### Anbefaling: Model C

Shipbar mod den motor der faktisk kører i S3 (v3) uden at vente på et v4-flip uden dato. Genbruger to LIVE mekanismer i stedet for at introducere en tredje, hvilket holder scope inde for `RACE_ENGINE_RULES.md` §2's lukkede mekanik-katalog. Loftet gør "styrke straffes aldrig" og "ingen gratis all-out" til en KONSTRUKTIONS-egenskab, ikke kun et testkrav. Enum'et (fem værdier) er fremadkompatibelt med v4's M12-kontrakt, så investeringen ikke går tabt når v4 en dag overtager — model B bliver den naturlige NÆSTE udvidelse dengang, ikke en modstrid.

## 5. Hvad spilleren ser på løbsdage (jf. #4613: overblik først, kort på fladen)

Wireframe findes allerede: `docs/design/wireframes-training-2026-09-02/wireframe-2-race-day-choice.html` (Today-tab). Mønster:

- Ryttere der kører løb i dag viser et **intentions-hurtigvalg** i stedet for trænings-sessionen: fem trin fra Grupetto til All-out, ét klik, default **Normal**. Kort tekst på selve kortet ("Grupetto · spar kræfter"), ikke en manual — prosa/forklaring af hvad hvert trin faktisk koster hører i `help.json`, ikke på kortet (memory-regel "kort på fladen, manualer i hjælp").
- Ryttere der træner i dag viser fortsat deres planlagte session fra programmet (princip C, §12.1) — uændret af denne opgave.
- Assistent-knap (samme mønster som #4522: foreslå/acceptér alle/udvalgte) kan foreslå en rolle-baseret default (fx kaptajn → Hårdt, hjælper → Normal, en rytter tæt på skadesgulvet → Grupetto foreslået, aldrig tvunget).
- Vælger spilleren efterfølgende noget andet på taktik-kortet for samme etape, vinder taktik-kortets værdi (§3) — Today-tabet opdateres til at vise den vundne værdi, ikke to modstridende tal.
- Ingen ny container, radius eller ikon-stil — følger T1/T2/T3 (`PAGE_TEMPLATES.md`) og `TASTE.md` som resten af Today-tabet.

## 6. Migrations-/data-behov

Ingen ny tabel. `race_stage_roles.effort` findes allerede (`database/2026-07-12-race-v3-s1-work-cost.sql:40`).

1. **Udvid CHECK-constraint'en** fra `('protect','normal','save')` til fem værdier. Forslag til DB-tokens (engelske, matcher `VALID_EFFORTS`-mønsteret): `'grupetto'`, `'conserve'`, `'normal'`, `'committed'`, `'all_out'` — hvor `'conserve'` og `'committed'` er de nye navne for dagens `save`/`protect` (semantisk uændrede, kun omdøbt til at passe ind i den 5-trins skala), så eksisterende rækker (`save`→`conserve`, `protect`→`committed`, `normal`→`normal`) migreres med et simpelt `UPDATE ... SET effort = CASE ...` i samme fil som constraint-ændringen. Idempotent (kør igen = no-op når værdierne allerede er migreret), post-verify tæller rækker pr. ny værdi mod de gamle tal.
2. **`VALID_EFFORTS`** (`backend/lib/raceRoles.js:216`) og v4's `EffortLevel`-type (`types.ts`) udvides til de samme fem værdier i samme PR-familie som constraint-migrationen — kode og DB skal aldrig kunne diverge (forward-guard-test, se §7).
3. **Ingen ændring** til `race_entries` (holdudtagelsens rolle-felt er upåvirket) eller `TeamOrder`-konvolutten (§4 modsigelse 1-2 i `RACE_ENGINE_RULES.md` er stadig ejer-gated og rørt ikke af denne opgave).
4. **Frontend:** ingen ny tabel/localStorage — Today-tabets hurtigvalg skriver til samme endpoint der i dag sætter `race_stage_roles.effort` fra taktik-kortet (findes allerede, genbruges).

## 7. Test-/simuleringsplan FØR ship

Doktrin: *"Simulér før ship. Intet balance-følsomt shippes uden dry-run-harness mod ægte population plus scorecard med ejer-go"* (`RACE_ENGINE_RULES.md` §4).

1. **Forward-guard-vagt** på de fem `VALID_EFFORTS`-værdier, samme mønster som #4686's `raceRoles.test.js`-lås af `VALID_RACE_ROLES` (3/9) — låser vokabularet, afviser et sjette ord.
2. **Monotoni-regression** (`RACE_ENGINE_RULES.md` §3 invariant 3): udvid den eksisterende property-test-sweep til at inkludere alle fem intentions-niveauer og bekræfte at en lavere evne aldrig giver bedre tid, uanset intention — kør over samme evne-niveauer (5/11/30/60/99) som `fieldIntegrity.test.ts` allerede bruger.
3. **"Styrke straffes aldrig"-regressionstest:** samme rytter, samme ydre forhold, all-out vs. normal → all-out må ALDRIG give et strengt bedre resultat for en rytter end den samme rytter selv ville fået under normal ved lavere risiko (dvs. all-out's eneste vej til et bedre resultat er gennem den ekstra indsats, aldrig gratis).
4. **Dry-run scorecard mod realistisk feltstørrelse**, 5-seed-metodologien fra §7 modsigelse 8 i `RACE_ENGINE_RULES.md` (aggregér over seeds, mål på låst/realistisk feltstørrelse — lærdommen fra modsigelse 11: fuld population giver et forvrænget tal). Mål: fordeling af intentions-valg pr. rolle, og om work-cost-loftet reelt forhindrer en resultat-fordel for all-out ud over den forventede.
5. **Trætheds-fordeling shadow-check** mod `TRAINING_RULES.md` §5.3-baseline (median 38/41, målt 30/8) — bekræft at intention ikke pludselig skubber bestanden mod trætheds-loftet 100 igen (samme fejlklasse som 3/8-postmortem'et om AI-rytternes trætheds-loft).
6. **Owner-gate:** ingen flag-flip der lader intention påvirke rigtige spillere før scorecardet fra punkt 4 er vist ejeren og der er givet et eksplicit go (doktrin: *"Merge-gaten er FORUDGÅENDE enighed"* + *"styrke straffes aldrig"*-princippet er ejerens egen, ikke til forhandling).
7. **Ship-rækkefølge:** UI + data-model (§5-6) bag et nyt flag `race_day_intention_enabled` (off) først; fatigue/work-cost-multiplikatorerne wires bag SAMME flag; dry-run (punkt 4); ejer-go; flip. Ingen sammenhæng krævet til D1/D2 (`race_day_development_enabled`) — intention kan shippes og afprøves UAFHÆNGIGT af udviklings-gaten, og skal netop være afgjort FØR den tændes igen (§8 punkt 1 i `TRAINING_RULES.md`).

## 8. Tre ejer-beslutninger

**Beslutning 1 — hvilken model?**
- A: kun trætheds-/formhandel, ingen resultat-effekt i selve løbet.
- B: fuld resultat-effekt via v4's indsats-budget (M12), kræver v4 live.
- **Anbefaling: C** — hybrid, udvider LIVE work-cost/fatigue-mekanikker med et loft, shipbar mod v3 nu, fremadkompatibel med v4.

**Beslutning 2 — samme felt eller nyt felt?**
- A: udvid det eksisterende `race_stage_roles.effort` (3→5 værdier), ingen ny kolonne.
- B: nyt separat felt/tabel for "intention", hold `effort` uændret ved siden af.
- **Anbefaling: A** — samme spørgsmål, samme sted, ingen dobbelt-styring eller synkroniseringsrisiko mellem to felter der begge betyder "hvor hårdt går du efter det".

**Beslutning 3 — hvornår ift. D1/D2 (`race_day_development_enabled`)?**
- A: ship intention (UI + fatigue/work-cost) NU, uafhængigt af D1/D2, bag sit eget flag.
- B: vent og bundl intention sammen med D1/D2-flippet til S4.
- **Anbefaling: A** — issuet og `TRAINING_RULES.md` §8 punkt 1 kræver eksplicit at spørgsmålet afgøres FØR D1/D2 tændes igen; at vente ville modsige den rækkefølge.
