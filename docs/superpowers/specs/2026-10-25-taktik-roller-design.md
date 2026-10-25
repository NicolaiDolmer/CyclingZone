# Taktik og roller: samlet design (delt kaptajn, modsatte ordrer, mål-ordrer, sprint-leder)

> Status: **designforslag til ejeren, 25/10.** Ingen kode. Byg starter først efter ejerens svar på de åbne valg i §8. Refs #7003 #5981 #6321 #6299 #6940 #6641. Mockups: [`pr-screens/7003/`](../../../pr-screens/7003/).
>
> Forhold til SSOT: [`RACE_ENGINE_RULES.md`](../../RACE_ENGINE_RULES.md) ejer roller, ordre-kontrakten, indsats og revisionerne. Denne fil er forslaget; byggets PR'er opdaterer RACE_ENGINE_RULES, help.json og patch notes. Ingen tal fra motoren står her (hard rule 17); kalibrering og målinger lægges i `balance-internals/7003/`.

## 0. Hvad er allerede besluttet (genåbnes ikke)

| Beslutning | Kilde | Hvad det betyder her |
|---|---|---|
| Delt kaptajn er en **ny synlig rolle** (valg A), ikke en skjult ordre | ejer 5/10 på #5981 | Rolle-vokabularet udvides fra fem til seks med ejer-go. Spørgsmålet er kun hvordan rollen virker, ikke om den findes |
| "Design nu, byg efter motor-pakken" | ejer 20/10 på #5981 | Rollen hører til motorens næste revision, ikke til en hotfix |
| Fri rolle ændres ikke midlertidigt | ejer 1/10 | Fri rolle beholder sin adfærd (kan selv forsøge udbrud på normal) |
| Rollen er standard for hele løbet, ordren er dagens overlay | ejer 2/9, spec 2026-09-03 | Ingen ny model; "Standard: X. I dag: Y" bevares |
| Taktik-fanen: én etape-vælger, intention + ordrer pr. rytter, én guldknap | ejer 6/9, RULES §9 punkt 11 | Mockups ændrer kun indholdet af rækken, ikke fanens skelet |
| Fem indsatstrin (grupetto, spar, normal, beskyt, alt ud) i ét felt | ejer 6/9 + kalibreret 25/10 (#6641, under `s5_profiles_v3`) | Ingen ny indsats-akse. `protect` beholder sit enum, kun teksten ændres |
| Grupetto forsøger aldrig udbrud | ejer 30/9 + 1/10 (#6940) | Grupetto og "Forsøg udbrud" kan ikke vælges samtidig |
| "Spar" + udbrudsordre er tilladt (forsøget koster normal pris) | ejer 30/9 (RULES "Morgenudbrud") | Spar og udbrud er **ikke** modsætninger i dette design |
| En hjælper i udbruddet kan ikke hjælpe kaptajnen i en anden gruppe | ejer 30/9 | Arbejd og udbrud er reelt modsætninger: kombinationen koster uden at give noget |
| Kun det rigtige morgenudbrud hedder udbrud; egen ordre vises efter etapen | ejer 24/10 + 25/10 (#6299, PR #7161) | Den låste ordre efter etapen viser også rolle og opgave fra dette design |
| Fog of war: ingen procenter eller multiplikatorer på skærmen | ejer 6/9 | Alle regler forklares i ord |
| Ingen ordrer der kun virker for mennesker; AI bruger samme type | spec 2026-08-21 T4, #5573 | AI-hold kan få en delt kaptajn |

## 1. Problemet i klar tekst

1. **"Arbejd eller angrib" er to modsatte ting i én knap.** Trinnet `protect` betyder "arbejd for kaptajnen" for en hjælper og "følg angrebene" for en kaptajn. Spilleren ser det samme ord på begge og kan samtidig slå "Forsøg udbrud" og "Sprinttog" til. Testere har ikke kunnet forstå hvad deres rytter gjorde (#6299, staff 6/10).
2. **Modsatte ordrer kan vælges samtidig.** I dag kan én rytter stå på grupetto + forsøg udbrud + sprinttog. Motoren løser det stille (grupetto forsøger aldrig, en udbryder er ikke i toget), men spilleren får ingen besked.
3. **Der mangler en rolle mellem kaptajn og hjælper.** En rytter med egen klassementschance skal i dag enten være hjælper (ofrer sig) eller fri rolle (går selv i udbrud). Ejeren har lovet delt kaptajn offentligt (1/10).
4. **Et sprinterhold kan ikke stille op med sprinteren som eneste leder** (#6321). Man skal sætte en "falsk" kaptajn for at kunne bruge sprinttoget.

## 2. Hvad spilleren oplever

- **På Hold-fanen** vælger han som før kaptajn, spurtkaptajn og jæger. Nyt: **Delt kaptajn** som sjette rolle, højst én pr. hold. Han kan stille op med **kun en spurtkaptajn** som leder.
- **På Taktik-fanen** har hver rytter én række. Rækken kan aldrig vise to modsatte ordrer: et valg der modsiger et andet, kan ikke trykkes, og en kort linje siger hvorfor (variant A) eller valget findes slet ikke (variant B, "Dagens opgave").
- **Holdplanen** øverst siger hvem holdet kører for: "Ada Pedersen leads. Théo Journal is shared captain." eller "Ruben Halvorsen leads. The team rides for the sprint."
- **Efter etapen** viser kortet "Dine ordrer" (#6299) rytterens rolle og opgave, så han kan se hvad han bad om.
- **I løbsfilmen** sker intet nyt: holdspillet er en tilstand, ikke en hændelse (RULES §2e). Resultatet viser effekten.
- **Hjælp** (en+da, og fr/es/nl) får ét afsnit om delt kaptajn og opdateret tekst om de fem trin. Fladen har kun én linje pr. ting.

## 3. Regler: hvilke ordrer udelukker hinanden

Felterne er uændrede: `effort` (fem trin), `try_break`, `leadout` pr. rytter pr. etape. Reglerne nedenfor håndhæves i fladen og i API'et (`PUT team-orders`), ikke i motoren, fordi motoren allerede opfører sig sådan i dag.

| Kombination | Regel | Hvorfor (virkelig cykelsport) |
|---|---|---|
| Grupetto + Forsøg udbrud | **Udelukket** | Gruppettoen er de ryttere der sparer sig hjem bagerst. Låst 30/9 |
| Grupetto + Sprinttog | **Udelukket** | En lead-out-mand kører ikke i gruppettoen |
| Arbejd (`protect` for hjælper/jæger) + Forsøg udbrud | **Udelukket** | En hjælper i udbruddet kan ikke trække for kaptajnen i feltet. Han betaler for arbejde han ikke kan levere |
| Sprinttog + Forsøg udbrud | **Udelukket** | Lead-out-folk sidder i feltet til finalen. Ingen hold sender toget i morgenudbrud |
| Togets mål (spurtkaptajnen) i sit eget tog | **Udelukket** | Han er den der bliver trukket frem |
| Spar + Forsøg udbrud | Tilladt | Låst 30/9: forsøget koster normal pris |
| Alt ud + Forsøg udbrud | Tilladt | Klassisk "alt eller intet"-dag |
| Følg angrebene (`protect` for leder) + Forsøg udbrud | Tilladt | En kaptajn kan gå med i et langt angreb |
| Alt ud for en hjælper | Tilladt, men teksten siger det | Han kører for sig selv og hjælper ikke lederen (RULES §2e) |

**Gemte ordrer der allerede bryder en regel** (fx fra før dette design): fladen viser rækken med et mærke "Vælg én" og gemmer ikke etapen før spilleren har valgt. Ingen migration, ingen stille omskrivning, og motoren kører den låste ordre som før, hvis etapen starter uden ændring.

**"Arbejd eller angrib" deles op efter rolle.** Enum'et `protect` bliver; ordet på skærmen følger rollen:

| Rolle | Trinnets navn (EN / DA) | Én linje |
|---|---|---|
| Hjælper, jæger | Work / Arbejd | Rides for the leader. Real fatigue. / Kører for lederen. Rigtig træthed. |
| Kaptajn, delt kaptajn, spurtkaptajn | Follow the moves / Følg angrebene | Answers every attack. Costs more legs. / Svarer på hvert angreb. Koster flere kræfter. |
| Fri rolle | Ride aggressively / Kør offensivt | Presses on the climbs and in the finale. / Presser på stigningerne og i finalen. |

## 4. Mål-ordrer: "Dagens opgave"

En mål-ordre siger **hvad** rytteren skal i dag; indsatsen siger **hvor hårdt**. Variant B (§7) samler udbrud, tog og grupetto i ét valg pr. rytter, så modsætninger ikke kan opstå. Valget oversættes 1:1 til de eksisterende felter; ingen ny kontrakt.

| Opgave (EN / DA) | Hvem kan vælge den | Felterne |
|---|---|---|
| Ride for the leader / Kør for lederen | hjælper, jæger | `try_break=false`, `leadout=false` |
| Sprint train / Sprinttog | hjælper, jæger, fri rolle (ikke togets mål) | `leadout=true`, `try_break=false` |
| Try the break / Forsøg udbrud | alle | `try_break=true`, `leadout=false` |
| Ride for a result / Kør for resultat | kaptajn, delt kaptajn, spurtkaptajn | `try_break=false`, `leadout=false` |
| Free race / Frit løb | fri rolle | `try_break=false`, `leadout=false` (fri rolle kan stadig selv forsøge på normal, låst) |
| Grupetto / Grupetto | alle undtagen kaptajn | `effort=grupetto`, `try_break=false`, `leadout=false` |

Indsatsen vælges ved siden af (spar, normal, hårdt, alt ud) og er låst når opgaven er Grupetto. Senere opgaver fra Holdmødet (#5573, trøjejagt, angrebspunkt) kan lægges ind som nye punkter i samme liste uden at fladen skifter form. Trøjejagt er **ikke** med nu: motoren har den ikke (P11, intet opdigtet).

## 5. Delt kaptajn i motoren

Ny rolle `co_captain` (EN "Shared captain", DA "Delt kaptajn", navnet ejeren allerede har brugt offentligt). Højst én pr. hold pr. løb, og kun på et hold der også har en kaptajn.

| Del af motoren | Hvad delt kaptajn gør | Kode-sted (ved byg) |
|---|---|---|
| Holdspil (M16) | Er **beskyttet**, betaler ingen hjælperpris, arbejder aldrig. Hjælpen deles fra de hjælpere der allerede kører; ingen gratis ekstra støtte (bevarelses-garantien i §2e gælder uændret). Fordelingen når begge ledere er i samme gruppe: ejer-valg 1 | `mechanics/teamPlay.ts` (`protectedRoleOrder`, `buildGroupTeamContexts`) |
| Vejen afgør | Sidder kaptajnen og den delte kaptajn i hver sin gruppe, hjælper hjælperne i hver gruppe den leder der sidder i deres gruppe. Er kaptajnen ude (styrt, udgået, sat af), får den delte kaptajn hele hjælpen i sin gruppe | samme |
| Morgenudbrud | Som kaptajnen: forsøger kun med "Forsøg udbrud" | `mechanics/breakawayPermission.ts` |
| `protect` | Som kaptajnen: følger angreb (lederens lille plus) | `mechanics/breakaway.ts` (`LEADER_ROLES`) |
| Jagt | Bruges aldrig som jagt-arbejder, ligesom kaptajner | `mechanics/breakaway.ts`, `teamChaseReaction.ts` |
| Klassementsreaktion | Uændret regel: holdet forsvarer sin bedst placerede rytter før etapen, uanset rolle. Den delte kaptajn er altså automatisk med, når han står bedst | `mechanics/gcThreat.ts` (`protectedRiderForTeam`) |
| Endagsløb | Holdets beskyttede rytter er den af de to ledere der passer bedst til dagens rute | `gcThreat.ts` (`oneDayProtectedRider`) |
| Bjergpoint i favoritgruppen (#6937) | Ruller over toppen som en kaptajn | `bonusSeconds.ts` (`KOM_FAVOURITE_ROLL_OVER_ROLES`) |
| Gammel motor (v3, kill-switch) | Køres som fri rolle uden spontane udbrud: hverken pris eller beskyttelse | v3-broen |
| AI-hold | Får en delt kaptajn i etapeløb når holdets næstbedste klassementsrytter er tæt på den bedste. Samme type, ingen side-kanal | `ai/aiTactics.ts` |

**Hvilke løb.** Rollen virker kun i løb bundet til en revision der kender den (ejer-valg 4). I ældre løb tilbydes rollen ikke på fladen, og API'et afviser den. En stray række i et ældre løb køres som fri rolle uden spontane udbrud.

**Garantier (property-tests ved byg):** et hold uden delt kaptajn er byte-identisk med i dag; ældre revisioner er byte-identiske; kaptajnens og den delte kaptajns samlede bonus overstiger aldrig det holdet betalte; svag slår aldrig stærk i samme rolle.

## 6. Sprintkaptajn som eneste leder (#6321)

Holdudtagelsen kræver i dag en kaptajn. Forslaget: den kræver **en leder**, dvs. kaptajn **eller** spurtkaptajn. Uden kaptajn er spurtkaptajnen beskyttet på alle etaper; det gør motoren allerede i dag (faldet tilbage i `protectedRoleOrder`), så ingen motor-ændring. Delt kaptajn kræver stadig en kaptajn. Holdplanen siger "X leads. The team rides for the sprint."

## 7. Fladen: to varianter af rytter-rækken (mockups)

Begge bruger fanens skelet fra 6/9 (T3-side, Taktik-fanen, én guldknap "Save stage N", hairlines, 5 px radius, ingen tal). De adskiller sig kun i rytter-rækken.

- **Variant A, "Samme række, spærrede modsætninger":** intentions-chippen og pillerne "Try the break" og "Sprint train" bliver. Trinnet `protect` hedder Arbejd/Følg angrebene/Kør offensivt efter rollen. En pille der modsiger et andet valg er grå med en låse-ikon-linje ("Not with Work"). Mindst at bygge.
- **Variant B, "Dagens opgave":** én vælger "Task" pr. rytter (tabellen i §4) + indsats ved siden af (spar, normal, hårdt, alt ud). Modsætninger kan ikke opstå. Lidt mere at bygge, men samme felter bag, og den kan bære Holdmødets opgaver senere.

Filer: `pr-screens/7003/a-desktop-1440.png`, `a-mobile-390.png`, `b-desktop-1440.png`, `b-mobile-390.png`, og `oversigt.png` (begge side om side til telefonen). Tegnede mockups med opdigtede navne, ikke skærmbilleder af spillet. Den rigtige flade skal godkendes på preview før merge.

## 8. Åbne ejer-valg (ét valg pr. punkt)

1. **Hvem får hjælpen, når kaptajnen og den delte kaptajn kører i samme gruppe?**
   A: Kaptajnen først, og det hjælperne har tilovers går til den delte kaptajn. B: Hjælpen deles lige.
   **Anbefaling A.** Det er det egomadsen og ejeren beskrev: en mellemting mellem kaptajn og hjælper. Et stort hold med mange hjælpere kan beskytte to, et lille kan ikke, ligesom i virkeligheden. Med B bliver rollen bare "to kaptajner", og kaptajnen mister værdi.
2. **Hvordan skal arbejd og angrib deles op på fladen?**
   A: Samme række som i dag, ordet følger rollen, og modsatte knapper bliver grå. B: "Dagens opgave": ét valg pr. rytter for hvad han skal, og indsatsen ved siden af.
   **Anbefaling B.** Modsætninger kan slet ikke vælges, rækken bliver kortere på mobil, og det er samme felter bag, så motoren røres ikke. Holdmødets kommende opgaver får plads uden ny flade. A er kun bedre hvis det skal være live i morgen.
3. **Må et hold stille op med kun en spurtkaptajn som leder (ingen kaptajn)?**
   A: Ja. B: Nej, kaptajn kræves stadig.
   **Anbefaling A.** Et sprinterhold i et fladt endagsløb har i virkeligheden kun sprinteren som leder. I dag må spillerne sætte en falsk kaptajn for at få toget til at virke. Motoren kan det allerede.
4. **Skal delt kaptajn med i samme motor-tænding som udbrudspakken (`s5_profiles_v3`, slukket)?**
   A: Ja, med i v3, og testporten måler med den før tænd. B: Egen revision bagefter.
   **Anbefaling A.** Én tænding ved sæsonstart i stedet for to, og v3 er ikke tændt endnu. Et hold uden delt kaptajn kører uændret, så risikoen er lille. Halter rollen, kan den tages ud af v3 uden at stoppe resten.
5. **Hvor mange delte kaptajner må et hold have?**
   A: Højst én. B: To (en "trident").
   **Anbefaling A.** Én er nok til de rigtige tilfælde (to klassementsryttere), og hjælpen bliver ellers så tynd at ingen af dem får noget. Kan udvides senere uden ny rolle.

## 9. Byggeplan (små PR'er, hver bag flag eller revision)

| Rk. | PR | Hvad | Gate |
|---|---|---|---|
| 1 | `feat/6321-sprint-leader` | Holdudtagelsen kræver kaptajn eller spurtkaptajn; holdplan-tekst; Hjælp | Ejer-go på billede. Ingen motor |
| 2 | `feat/7003-opposite-orders` | Modsætnings-reglerne i `tacticsPlan.js` + API-validering i `raceTeamOrdersApi.js`; rolle-bevidst `protect`-tekst; "Vælg én" for gamle rækker. Variant efter ejer-valg 2. Bag stadie-flaget `tactics_roles_v1` (beta → on) | Ejer-go på preview. AI-ordrer testet mod validatoren |
| 3 | `feat/5981-co-captain-contract` | Sjette rolle i `RiderRole`, `VALID_RACE_ROLES`, DB-check + partielt unikt index (additiv migration), låse-testen i `raceRoles.test.js` opdateret, RULES §1 | Ejer-go på kontrakten (§0: rolle-udvidelse). Migration post-merge |
| 4 | `feat/5981-co-captain-engine` | §5 i motoren bag revisionens hook-flag; v3-broens fallback | Property-tests + tvillinger; byte-identitet for ældre revisioner |
| 5 | `feat/5981-co-captain-ai` | AI vælger delt kaptajn efter §5 | Målt i testporten |
| 6 | `feat/5981-co-captain-ui` | Rollevælgeren på Hold- og Taktik-fanen, holdplan, "Dine ordrer", help.json (en/da/fr/es/nl) | Ejer-go på preview, bag `tactics_roles_v1` |
| 7 | Testport + tænd | Målingen i §10 kørt, ejeren ser billedet, ejerens "tænd" | Ejer-only |

PR 1 og 2 rører ikke motoren og kan bygges med det samme efter ejerens svar. PR 3-6 følger motor-pakkens rækkefølge (#5981, ejer 20/10). Ingen patch notes i PR'erne; samlet note ved close-out.

## 10. Testplan mod virkelig cykelsport

Målt i harnesset på samme population og seeds som testporten (`docs/MOTOR_TESTPORT.md`), tal kun i `balance-internals/7003/`.

| Scenarie | Virkeligheden | Forventet i motoren |
|---|---|---|
| Grand tour, hold med to klassementsryttere og fuld hjælperstab | Jumbo-Visma 2022 (Vingegaard + Roglič), Movistar 2015 (Quintana + Valverde begge på podiet) | Den delte kaptajn ligger bedre end som hjælper og dårligere end som kaptajn. Kaptajnen taber kun lidt mod i dag (valg 1 A) |
| Samme, men lille hold med få hjælpere | Små hold kan ikke beskytte to | Den delte kaptajn får næsten intet ekstra; kaptajnen er uændret |
| Kaptajnen styrter eller mister tid | Tour 2022: Roglič ud, holdet kører for Vingegaard | Hjælperne i den delte kaptajns gruppe kører for ham resten af etapen |
| De to i hver sin gruppe på en bjergetape | Vejen afgør | Hver gruppes hjælpere kører for lederen i deres gruppe; ingen hjælper tælles to steder |
| Fladt endagsløb med kun en sprinter som leder | Scheldeprijs, Milano-Torino: sprinteren er eneste leder | Toget kører for ham og han beskyttes; resultatet som i dag med en falsk kaptajn |
| Hjælper på "Arbejd" kan ikke sendes i udbrud | En domestique der trækker kan ikke samtidig ligge i udbruddet | API afviser; fladen spærrer |
| AI-paritet | Rigtige hold med to ledere | AI-hold med to tætte klassementsryttere bruger rollen; ingen menneske-only fordel |

**Målinger:** beskyttelses-gabet pr. rolle (`headToHeadTeamPlay`) med den delte kaptajn som egen kolonne; holdets samlede bonus mod det betalte (bevarelse); andel holdkammerater i top 10 (holddominans må ikke stige mærkbart); udbrudsforsøg pr. rolle (delt kaptajn uden ordre = nul). Ejeren ser billedet før tænd.

**Hvad testen ikke dækker:** at spillerne forstår rollen. Det måles efter beta via Discord og "Dine ordrer"-kortet.
