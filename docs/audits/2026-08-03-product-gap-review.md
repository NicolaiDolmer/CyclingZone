# Produkt-gap-review: Cycling Zone vs "verdens bedste cykelmanagerspil" (2026-08-03)

**Metode:** 11-agent workflow: 5 evidens-agenter (internt feature-/kvalitetskort, PCM-benchmark, Hattrick/Trophy Manager/Velogames-benchmark, FM/præsentations-benchmark, spillerstemmer fra Discord + issues) -> 3 linse-proposere (daglig loop / simulationsdybde / social mening) -> 3 adversarial skeptikere med kode-, issue- og doktrin-verifikation. 9 forslag genereret, 5 skudt ned, 4 overlevede med justeringer. Fable-syntese herunder.

**Ejer-læsning: start med konklusionen, tabellen til sidst er dokumentation.**

## Konklusionen først (det ærlige meta-fund)

Cycling Zone mangler ikke idéer. 5 af 9 "nye" forslag fra benchmark-analysen viste sig allerede at findes: som live kode (race-recap, board-mål + season-honours-dom, CompareDrawer-H2H, NotificationsPage med 25+ event-typer), som fuldt speccede issues (#1147 Living-World-feed, rivaliserings-skemaet i narrative-systems-design.md), eller som ejer-scopede planer der KUN venter på et ejer-valg (#481 brand Phase 1, #3050 venskabsløb scope A). Gabet til verdensklasse ligger tre andre steder:

---

## Gab 1: Simulationen er dyb, men beviser aldrig årsag->virkning for spilleren (legibility)

**Problem.** Motoren er reel og live (cross-stage-træthed med effort-multiplikatorer, peak-planner, 22.839 narrativ-momenter over 342 løb, alt verificeret i prod). Alligevel har selv de mest engagerede testere en FORKERT model af spillet: to spillere troede uafhængigt at udbrud koster noget (#3115, det gør det ikke), en tredje tvivler på om "spar kræfter" virker, en ny spiller siger direkte "I think I have good riders but don't succeed... maybe I miss something". Nyt drift-fund samme retning: favoritterne UNDERpræsterer nu (favoritePodiumRate 0,51 < bånd-min 0,55) uden at nogen spiller kan se hvorfor. Når spillerne ikke kan aflæse kausalitet, føles selv en korrekt simulation uretfærdig, og "uretfærdigt" er en churn-årsag ingen balance-tuning fixer.

**Løsning (v1, uden ny simulation).**
1. To nye moment-typer i det EKSISTERENDE raceNarrative-system: "aggression uden omkostning" (viser eksplicit at udbrudsforsøget var gratis, lukker #3115 in-product) og en BANDED indsats-forklaring ("sparede tydeligt kræfter denne etape", aldrig rå tal, fog-gate-konform jf. #1791-reglen).
2. Vis taktik/aggressivitet/typematch-drivere på udtagelsesfladen (ejerens eget forslag i #3115-kommentaren 3/8), så mekanikken opdages i spillet og ikke i Discord.
3. Eskalér de to allerede-klare issues: #3115 (help-tekst) + #2356 (recap v2).

**Indsats:** S (templating oven på eksisterende system). **Effekt:** tillid til kernen; færre "usynlig sim"-churns; mindre support-last i Discord. **Risiko:** lav; eneste faldgrube er fog-gaten (løst med bånd i stedet for tal).

## Gab 2: Tilbagevendelses-loopet er et DÆKNINGSHUL, ikke et manglende produkt

**Problem.** Benchmark-facit på tværs af Hattrick/FM/Velogames: den billigste retention-mekanik i genren er "hvad skete der med MIT hold siden sidst". Cycling Zone HAR infrastrukturen (NotificationsPage med 25+ typer, ActivityPage, NextActionsCard) - men 13 pct af nye brugere modtog ALDRIG en eneste notifikation (23/7-måling), det højest prioriterede varsel (#2180 "manglende holdudtagelse", 36t + one-click) er stadig ubygget, og fladerne konvergerer ikke til ét "siden sidst"-overblik (#62 kræver netop konvergens, ikke en ny flade). 83 pct D1-churn er ikke bevis for at loopet mangler, men for at det aldrig NÅR spillerne.

**Løsning.**
1. Root-cause 13-pct-dækningsbuggen (trigger-betingelser/opt-in/RLS for nye konti) - det er en bug-jagt, ikke et produkt.
2. Byg #2180 som allerede scoped (højeste enkelt-værdi varsel).
3. Derefter en TYND "siden sidst"-sammenstilling af eksisterende Notifications/Activity-data under #62-paraplyen.

**Indsats:** S + S + M. **Effekt:** D1/D7 direkte (rammer 83-pct-problemet), WAU sekundært. **Risiko:** lav; alt er genbrug.

## Gab 3: Beslutnings-sult: høj-effekt-arbejde står stille og venter KUN på ejer-valg

**Problem.** Tre høj-effekt-spor er allerede analyseret, scopet og delvist bygget, men fryser fordi et enkelt ejer-valg aldrig blev taget: (a) #481 brand/logo Phase 1 står i "awaiting choice, åbn logo-explorations.html og vælg" og har stået der længe, trods priority:high og et erklæret mål om levebrød/troværdighed; (b) #3050 venskabsløb har ejerens EGET scope-A-forslag liggende urørt siden 26/7, og inter-sæson-hullet efter 23/8 er præcis dets vindue; (c) #1147 Living-World-feed er fuldt speccet men parkeret i "post-launch polish" uden aktiv timing-beslutning. Flaskehalsen for verdensklasse er lige nu ejerens beslutnings-throughput, ikke byggekapacitet.

**Løsning.** Gør beslutnings-batchen til fast ritual (som denne sessions runde). Konkret i NÆSTE runde: (1) vælg logo-retning i #481 Phase 1 (15 min), (2) ja/nej til #3050 scope A målrettet inter-sæson-hullet efter 23/8 (bemærk skeptiker-forbeholdet: isolations-audit af alle "løb afsluttet"-forbrugere skal med, reelt L hvis den skal være vandtæt), (3) aktiv timing-beslutning på #1147 (forbliver den post-launch, eller løftes den når #3199/#3200 alligevel bygger socialt lag?).

**Indsats:** ejer-minutter + eksisterende planer. **Effekt:** frigør allerede-godkendt arbejde; brand-låsen understøtter betalings-tragten (1 betalende / WAU 32). **Risiko:** ingen teknisk; kun kalender-disciplin.

---

## Skudt ned af skeptikerne (byg IKKE disse som nye ting)

| Forslag | Verdikt | Hvorfor |
|---|---|---|
| "Byg Manager Inbox-feed" | SVAG | NotificationsPage m. 25+ typer + gruppering findes; reelt arbejde = dækningsbug + #2180 + #62-konvergens (= Gab 2) |
| "Raceday recap + hvorfor-forklaring" | SKYD_NED (delvist) | raceRecap.js live (S4), v2 = #2356, help-tekst = #3115; per-rytter-årsag kolliderer med ejer-sekventeret #2410. Overlevende kerne = Gab 1 |
| "Sæsonmål + milepæle + rivalisering" | SKYD_NED | Board-mål (11 typer) + season-honours-dom LIVE; rivalisering fuldt speccet (narrative-systems-design B2/B3); evt. fremrykning er en reprioritering, ikke ny build |
| "Taktisk risky/cautious-indsats" | SVAG | Ægte hul (incidentProbability tager ingen effort-parameter), men reelt L, og skal vente til #2731/#2557 er lukket + Gab 1 har bevist de EKSISTERENDE håndtag |
| "Venskabsløb" | SVAG | Ejeren har selv scopet A i #3050; ny viden = timing (23/8-hullet) + krav om isolations-audit (= Gab 3b) |
| "Mini-ligaer/private grupper" | SKYD_NED | Doktrin: alliances = research-before-commitment; billigere v1 findes (#2153 Discord-kanaler); CompareDrawer-H2H findes |
| "Narrativ feed" | SKYD_NED | #1147 er ord-for-ord samme epic (= Gab 3c) |
| "Brand-lås v1" | SKYD_NED som NYT forslag | ER #481 Phase 1, som kun venter på ejer-valget (= Gab 3a) |

## Anbefaling (A/B)

**A (anbefalet):** Gab 1 + Gab 2 bygges som næste kvalitets-spor efter denne batch (begge S/S-M, ingen konflikt med balance-arbejdet), og Gab 3's tre ejer-valg sættes på NÆSTE beslutningsrunde med 15 min timeboks. 👍 hurtigst målbare effekt på tillid + D1, nul nyt scope. 👎 ingen "stor ny feature" at annoncere.

**B:** Løft i stedet ét stort spor (#3050 venskabsløb) frem mod 23/8-hullet og lad Gab 1/2 vente. 👍 synlig nyhed i inter-sæson-perioden. 👎 L-indsats med isolations-risiko midt i sæsonskifte-ugerne, og løser hverken tillids- eller dæknings-hullet.

Refs: #2822 (benchmark-epic, hermed reelt besvaret), #3115, #2356, #2180, #62, #481, #3050, #1147, #2153, #2410, narrative-systems-design.md, living-world-product-doctrine-design.md.
