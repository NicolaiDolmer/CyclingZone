# Følg til dørs: afslutnings-setup og byggestop (design)

> Status: **udkast til ejer-godkendelse**, 29/10-2026. Intet bygges før ejeren har godkendt dette dokument.
> Kilde: brainstorm med ejeren 29/10 + read-only måling af de sidste 90 dage (31/7–29/10).

## 1. Intention og hvorfor

Spillerne skal opleve et **færdigt spil**, ikke en open beta hvor alt er en test. I dag skriver spillerne om fejl og mistillid til race engine; målet er at de skriver nye idéer, anbefaler spillet til venner og stoler på motoren. Når noget nyt kommer ud, skal det være en bonus der virker fra dag ét, ikke et nyt problem.

Problemet er ikke at der bygges for lidt. Problemet er at ting **ikke følges til dørs** efter koden er skrevet, og at nyt startes hurtigere end gammelt afsluttes.

### Målt grundlag (90 dage)

| Område | Fund |
|---|---|
| Backlog | 455 → 942 åbne issues (+487). Ca. 156 åbnet/uge mod 119 lukket. Kun 2 af 13 uger faldt. |
| Merge | 2.051 PR'er merget (~160/uge). Merge er ikke flaskehalsen. 14 åbne PR'er, 6 med konflikt. |
| Design-planer | 72 byggbare specs: 28 helt færdige (39 %), 35 halvt (49 %), 9 aldrig (12 %). |
| Gen-planlægning | Udbrud: 6 specs på 17 dage. Udvikling: 7. Træning, taktik, form: 5–6 hver. |
| Mockups | ~11 mockup-sæt næsten intet afleveret (fx dashboard-board, indbakke, kommandopalet, mobil). |
| Slukket men færdigt | ~14 features + ~7 motor-underkontakter + 5 hårdkodede `*_ENABLED=false`. Flere med overskredet `decide_by`. |
| Gammelt ved siden af nyt | `stage_page_v2` live for alle, men gammel `StageProfileGraph` bruges stadig 6 steder (Dashboard, Resultater, Taktik-, Hold-fane, kalender-glyffer). |
| Usynligt | Vejr kørte i motoren ~2 måneder før det kunne ses i UI. Udbrudsevents og medicinsk bonus har stadig ingen visning. |
| Race engine #7260 | De 19 punkter: 4 færdige, 6 halve/åben PR, 9 ikke lavet. ~11 motor-issues `claude:done` men åbne. |
| Venter på ejeren | ~120 ting: 63 `claude:done` (verifikation), 40 `needs-decision`, 15 `needs-user-action`, + slukkede flag. |
| Modstridende status | `RACE_ENGINE_RULES.md` og `FEATURE_REGISTRY.yml` er uenige om bl.a. `stage_plan_v1` og intention. |

### Diagnose

1. **Det er billigt at starte og dyrt at blive færdig.** Kode skrives i 4–6 parallelle spor, men de sidste skridt (tænd, verificér, godkend, luk) kræver alle ejeren og hober sig op.
2. **"Færdig" betyder i dag "merget".** Ingen tjekker tændt, synligt, gammelt fjernet, issue lukket.
3. **Flere statuskilder modsiger hinanden**, så ingen (heller ikke ejeren) kan se status for kerneproduktet.
4. **Nye issues oprettes frit** af audits, agenter, Discord-løfter og idéer, uden en port.

## 2. Mål, ikke-mål, anti-mål

**Mål**
- Det halvfærdige gøres færdigt og kommer ud til spillerne, før noget nyt startes.
- Én sand status pr. område, som ejeren kan læse på under et minut (først race engine).
- Backloggen falder uge for uge, indtil der er ro, og holder sig derefter stabil.
- Værn i kode/CI der gør de målte fejltyper umulige at gentage, uden at de afhænger af hukommelse.
- Et valg af hvad der laves nu, og hvad der parkeres til 2027.

**Ikke-mål**
- Mere proces før bygning. Problemet er afslutningen.
- At bremse brand-rettelser.

**Anti-mål (fejl selv hvis det teknisk virker)**
- Endnu et dokument eller script der også bliver glemt. Løsningen skal **samle eller skære**, ikke lægge et lag mere oven på NOW / MASTERPLAN / FEATURE_REGISTRY / STATUS_BOARD.
- At "brand" bliver en bagdør for nyt arbejde.
- At ejeren får flere beslutninger, ikke færre.

## 3. Beslutninger (ejer-godkendt 29/10)

### 3.1 Fuldt byggestop for nyt
Indtil det halvfærdige er ude hos spillerne, må der **kun** laves:
- færdiggørelse af noget der allerede er startet (åben PR, slukket flag, halvt bygget spec, gammel-ved-siden-af-nyt), og
- **brand**.

### 3.2 Definition af brand
> **Brand = noget der allerede er live hos spillerne og virker forkert, ødelægger tillid eller giver forkerte tal.** Rettelsen må gerne være stor, men den gør den *eksisterende* funktion rigtig; den tilføjer ikke en ny.
>
> **Ikke brand:** nye idéer, forbedringer af noget der virker, Discord-ønsker om nyt, "når vi alligevel er i gang".

Eksempler der er brand nu: fejlene i træning og udvikling (nye ting der ramte forkert første gang), Wander Riders-fejlen 28/10, auto-fyld der satte for få ryttere på.

**Hvem afgør brand (ejer 29/10):** Claude klassificerer ud fra definitionen og viser hvert brand-valg på det daglige afslutningskort med en linje begrundelse. Ejeren kan nedlægge veto med ét ord; et veto flytter opgaven til indbakken (`triage:new`).

### 3.2b Omfang af fase 1 (ejer 29/10)
Fase 1 er **en prioriteret liste, ikke "alt"**. Claude laver én liste over de halvfærdige ting grupperet i områder; ejeren rangerer. For hvert punkt vælges ét af tre udfald:
- **Gør færdigt nu** (alle seks trin, §3.4)
- **Parkeret til 2027** (label/milestone `2027`, lukket for arbejde nu; slettes ikke)
- **Bevidst lukket/fjernet** (koden og flaget fjernes, issuet lukkes med begrundelse)

Alle tre tæller som "fulgt til dørs". Slukkede features får samme behandling: tænd (med kriterie), parkér eller fjern. Valgene præsenteres for ejeren i områder, ikke enkeltvis.

### 3.3 Loft over hvad der er i gang (løsning 1)
- Et fast antal områder må være "i gang" samtidig. Noget nyt optages først når ét område er helt færdigt (alle seks trin, §3.4).
- Loftet håndhæves af bølge-admission (`.claude/workflows/wave.js` / `scripts/wave-policy.mjs`) og Codex-pendanten (`scripts/codex-wave.mjs`), ikke af hukommelse.
- **Ejerens go flyttes til starten:** når ejeren godkender en plan, godkender ejeren samtidig *tændingskriteriet* (fx "tændes når test X er grøn og ejeren har set preview"). Er kriteriet opfyldt, må Claude tænde. **Undtaget:** genstart af race engine/stage scheduler/auto prize og destruktive prod-indgreb forbliver ejer-only, som i dag.
- **Ét dagligt afslutningskort** i morgenblokken: kun det der venter på ejeren, højst 5 punkter, vigtigste først.

### 3.4 "Færdig" = spilleren har det (løsning 2)
Et issue må ikke stå som færdigt (`claude:done` eller lukket som completed) før alle seks trin er tjekket af:
1. Bygget (alt i spec'en, eller resten eksplicit flyttet til nyt issue med ejer-ok)
2. Merget
3. Tændt i prod (eller bevidst `dormant` med ejer-dato)
4. Synligt for spilleren dér hvor det påvirker dem
5. Det gamle fjernet (0 brug af erstattet komponent/kode)
6. Hjælp + patch note opdateret

- Trinene sættes i issue-skabelonerne, og et script/CI-tjek blokerer done-markering hvis et trin mangler.
- **Alle flag får en udløbsdato** (`decide_by` findes allerede i registret). CI fejler når den er overskredet uden ny ejer-dato.

### 3.5 Værn så fejltyperne ikke gentages (løsning 3)
- **Én sandhed pr. område:** `docs/FEATURE_REGISTRY.yml` er eneste kilde til status. CI fejler når et andet dokument (fx `RACE_ENGINE_RULES.md`) siger noget andet om en tilstand.
- **Gammelt skal væk:** når en ny komponent erstatter en gammel, forbyder en lint-regel nye imports af den gamle, og den nye tæller først som færdig når den gamle er brugt 0 steder.
- **Synlig-krav:** hver motormekanik/backend-output for spillere skal i registret angive hvor spilleren ser den. Uden det kan den ikke markeres færdig.

### 3.6 Port mod scope creep (løsning 4)
- Nye idéer, audit-fund og Discord-ønsker lander i indbakken (`triage:new`), ikke som `claude:todo`. Agenter og audits må ikke oprette `claude:todo` direkte.
- Én gang om ugen sorteres indbakken i **Nu / 2027 / Nej**.
- **Én plan pr. område:** en ny spec for et område kræver at den forrige lukkes eller erstattes eksplicit.
- **Engangsoprydning:** de 942 åbne issues sorteres én gang i Nu / 2027 / Luk.

## 4. Rækkefølge

| Fase | Indhold | Færdig når |
|---|---|---|
| 0. Stop | Byggestop træder i kraft; admission stopper nye spor uden for færdiggørelse/brand. | Ingen nye ikke-brand-spor optages. |
| 1. Gør det halvfærdige færdigt | Rangeret liste (§3.2b): de 14 åbne PR'er, slukkede flag, gammel-vs-ny (etapeprofil/glyffer), race engine #7260 de 9 + 6, halvbyggede specs, `claude:done`-køen. Brand løbende. | Hvert punkt er færdigt, parkeret til 2027 eller bevidst lukket. |
| 2. Værn | §3.3–3.6 bygges som scripts/CI/skabeloner. | Hvert værn har en test der viser det fanger den målte fejltype. |
| 3. 2027 | Oprydning af backloggen og valg af hvad der laves nu vs. 2027. | Ejer-godkendt liste. |

Fase 2 må gerne startes parallelt med fase 1, fordi værnene er færdiggørelse af processen og ikke ny spil-funktionalitet.

## 5. Begrænsninger der gælder uændret
- Repoets eksisterende gates består: design-go, merge-gate (forudgående enighed), UI-før/efter-billede, migrationer post-merge, ejer-go til race engine-genstart og destruktive indgreb.
- Én beslutning ad gangen til ejeren, med anbefaling.
- Ingen nye løbende udgifter.

## 6. Claudes valg (ikke ejer-besluttet; ejeren tjekker ved læsning)
1. **"Område" for loftet** = én post i `FEATURE_REGISTRY.yml` eller ét epic (ikke en hel registry-`area`). Loftet er **3** samtidige områder. Brand tæller ikke mod loftet.
2. **Byggestoppet gælder alle kanaler:** bølger, solo-sessioner og Codex. Porten sidder når en opgave tages (label-/claim-guard), ikke kun i bølge-admission.
3. **Byggestoppet slutter** når den rangerede fase 1-liste er afsluttet (alle punkter har et af de tre udfald). Ejeren erklærer det. Derefter bliver stoppet til det permanente loft (§3.3).
4. **De seks trin bevises automatisk hvor muligt** (registry-state, flagværdi i prod, 0 imports af erstattet komponent, patch note-dækning), ellers med afkrydsning. Trin der ikke giver mening for typen (bug, ops, investigation) markeres N/A med en linje begrundelse.
5. **Gælder fremad.** De 63 eksisterende `claude:done` og ~11 motor-issues behandles som en del af fase 1-listen, ikke som en separat migrering.
6. **Agent vs. ejer på GitHub:** agenter bruger samme token som ejeren, så værnene er reaktive (en guard fjerner forkert label/genåbner med kommentar) plus en wrapper som agenter skal bruge. Det er acceptabelt, fordi målet er at fange fejl, ikke at mistro ejeren.
7. **Én sandhed:** statuslinjer i `RACE_ENGINE_RULES.md`, NOW, MASTERPLAN og STATUS_BOARD *genereres fra* eller *henviser til* registret i stedet for at gentage det. Ingen dokumenter slettes; regelbeskrivelser bliver, kun tilstands-påstande flyttes.
8. **Tænding efter kriterie:** at tænde et spillervendt flag er ikke "destruktivt", når et ejer-godkendt kriterie er opfyldt. Kriteriet gemmes som felt i registret, og et script tjekker det før tænding. Eksisterende slukkede features får kriterie via fase 1-listen (§3.2b).
9. **Engangssortering af de 942:** Claude foreslår i bunker pr. kategori/område; ejeren godkender pr. bunke, ikke pr. issue.
10. **Issue-skabeloner:** issues oprettet af agenter/audits/Discord-triage får `triage:new`. Issues ejeren selv opretter må fortsat gå direkte til `claude:todo`, fordi ejeren selv er porten.

## 7. Overladt til den der bygger
- Teknisk form på hvert værn (script vs. CI-job vs. lint-regel), så længe det fejler hårdt og har en test.
- Hvordan registret udvides med felter for "synlig hvor" og "erstatter".
- Format på det daglige afslutningskort, så længe det er ≤5 punkter og kun ejer-handlinger.
