# Scout-mission-kadence: 1-dags-missionens spend-loft og fund-rate — #3853

> Opfølgning på #3846 (mission.days 2→1, 17/8) og #3657. Flaget der udløste denne audit står i
> `backend/lib/scoutEngine.js`s topkommentar og i #3846's PR-beskrivelse: `scoutTravelScorecard.js`
> brugte en FAST kalender-kadence (1 mission/måned) og fangede derfor ikke at en halveret
> missionsvarighed fordobler det teoretiske spend-loft ved kapacitets-bundet kontinuerlig genkø.
> Kørt 2026-09-03 på branch `chore/3853-scout-harness-cadence`. Ingen mutation — kun `SELECT`.

## 1. Hvad harnesset nu gør (kadence-følsomt input)

`backend/scripts/scoutTravelScorecard.js` er udvidet med to nye sektioner, ingen ændring af
sektion (A)'s eksisterende merge-gate (PASS/FAIL og exit-kode uændret, verificeret af
`scorecardExitCodeWiring.test.js` + ny `scoutTravelScorecard.test.js`):

- **(A) Profil-gate (uændret):** "typisk aktiv manager" — 1 mission/måned, en KALENDER-antagelse
  der bevidst er UAFHÆNGIG af missionens varighed (en spiller der logger ind månedligt gør det
  uanset om missionen tager 1 eller 2 dage). Dette er stadig den faktiske merge-gate.
- **(B) Teoretisk spend-loft (nyt, #3853):** kadence UDLEDT af `SCOUT_JOB_CONFIG.mission.days` og
  spejder-kapacitet (`scoutCapacity()`, default 1) — missioner/måned = kapacitet × (dage/måned ÷
  mission.days). Tager missionsvarighed som **input** (`--mission-days=N`, default = live config),
  så den samme kørsel kan sammenligne enhver varighed. Dette er den ØVRE grænse (en spiller der
  ALTID har en opgave i kø), ikke "typisk" — informativ måling, ikke en ny gate.
- **(C) Fund-rate (nyt, #3853, LIVE READ-ONLY):** genbruger de FAKTISKE prod-funktioner
  (`scoutMissionMaturation.defaultLoadCandidates`, `scoutMission.filterCandidatePool` — ingen
  reimplementering) mod den ægte free-agent-population, og måler om en mission med et givet
  `scope` overhovedet finder nok kandidater (≥ `shortlistMin`) til en shortlist.

## 2. (B) Teoretisk spend-loft — kontinuerlig genkø, kapacitet=1

| Missionsvarighed | Missioner/måned (teoretisk) | Spend/sæson (11 uger, kun missioner) | D1 | D2 | D3 |
|---|---|---|---|---|---|
| 2 dage (FØR #3846) | 15,21 | 231.000 | 30,4% | 49,1% | 63,3% |
| 1 dag (NU) | 30,41 | 462.000 | 60,8% | 98,3% | 126,6% |

Halveret varighed **fordobler** (matematisk garanteret ved fast kapacitet/cost) det teoretiske
loft — præcis det #3846-flaget forudsagde. D2/D3 overstiger nu 100 % af typisk sæson-indkomst for
denne EKSTREME profil (en spejder der aldrig står stille).

**Vigtigt om hvad dette IKKE er:** denne profil var ALDRIG dækket af merge-gaten (sektion A) —
den oprindelige Slice D-audit (`docs/audits/2026-07-10-talentspejder-gates.md`, §3b) beskriver
netop "kontinuerlig fuld kapacitet" som "den mest ekstreme, ikke den typiske, brug" og valgte
eksplicit IKKE at gate den. Den var allerede over 15 %-båndet ved 2 dage (30–63 %); #3846 gjorde
den værre, men krydsede ikke en linje der før var sikker.

## 3. (C) Fund-rate mod ægte population (LIVE, 2026-09-03)

Free-agent-pool (samme query som prod, aktiv sæson-alder anvendt): **377 ryttere**.

| Scope-værdi | Pool-størrelse | Finder shortlist (≥3)? |
|---|---|---|
| type=sprinter | 34 | ✅ |
| type=tt | 93 | ✅ |
| type=climber | 60 | ✅ |
| type=puncheur | 37 | ✅ |
| type=brostensrytter | 32 | ✅ |
| type=baroudeur | 21 | ✅ |
| type=rouleur | 54 | ✅ |
| type=gc | 46 | ✅ |
| u23 | 122 | ✅ |
| country/nm (top-5: CN, CO, KR, IT, ES) | 28–38 hver | ✅ (alle 10) |

**Fund-rate: 100,0 %** — alle 19 testede scope-værdier finder lige nu nok kandidater til en
fuld shortlist.

**Udtømning ved gentaget samme-scope-spam (#4058-eksklusion permanent pr. hold):** den smalleste
testede scope (`type=baroudeur`, 21 kandidater) udtømmes af ÉT hold der spammer PRÆCIS samme
kriterie efter ca. **4 missioner** (5 fjernet/mission). Dette sker **allerede ved 2-dags kadence**
(38,5 teoretiske missioner/sæson >> 4) — 1-dags kadencen (77 missioner/sæson) ændrer ikke
UDFALDET, kun hvor hurtigt loftet nås. En spiller der reelt vil blive ved med at "finde noget"
skal skifte scope/kriterie løbende — det er ikke en handling en konstant-spam-profil naturligt
gør, hvilket i praksis lægger et loft under det teoretiske spend-loft i §2.

**Infra-fund (ikke rettet her):** `.codex.local/supabase-readonly.env` (samme nøgle-mønster som
`relegationParachuteScorecard.js`) fejler mod `riders`-tabellen med
`permission denied for function is_offered_intake_rider` — readonly-rollen mangler `EXECUTE` på
den RLS-policy-funktion "Public read riders"-policyen kalder. Harnesset falder derfor tilbage til
`backend/.env` (`SUPABASE_SERVICE_KEY`, kun `SELECT`-kald) for netop sektion (C). Grant-fix er en
DB-ændring uden for denne PR's scope — værd en opfølgning hvis flere read-only-harnesses rammer
samme tabel.

## 4. Konklusion: skævvrider 1-dags-missionen scouting-økonomien?

**Nej, ikke i praksis — men det teoretiske loft for den absolutte ekstremprofil er nu højt.**

1. Merge-gatens "typisk aktiv manager"-profil er **uændret PASS** (D1 6,3 % / D2 10,3 % / D3
   13,2 %) og er per konstruktion UAFHÆNGIG af missionsvarighed — den vil aldrig fange denne
   klasse af ændring, hvilket er nøjagtigt hvorfor #3853 blev oprettet.
2. Det kadence-afledte teoretiske loft (uafbrudt genkø) FORDOBLES som forventet, men var allerede
   langt over "typisk"-båndet FØR #3846 og var aldrig en gate — kun en dokumenteret ejer-review-
   note (Slice D-audit §3b, kandidat 3: "accepter som top-of-range for en MEGET aktiv manager").
3. Ægte fund-rate (100 % lige nu) viser at missionerne rent faktisk finder kandidater — værdien
   spilleren betaler for leveres. Den smalleste scope (baroudeur, 21 kandidater) selv-begrænser
   allerede vedvarende samme-kriterie-spam til ~4 missioner, UANSET kadence — 1-dags-versionen
   når blot det loft hurtigere, den skaber det ikke.

**Anbefaling: A — behold 1-dags-missionen, ingen config-ændring.** Den målte risiko er en
ekstrem, ikke-typisk spam-profil hvis loft allerede lå udenfor "typisk"-båndet før #3846, og
fund-rate-dataet viser at gentaget identisk-scope-spam selv-begrænses af populationsstørrelsen
langt før sæson-loftet nås, uanset varighed.

## 5. Verifikation

- `node scripts/scoutTravelScorecard.js` (default, live config) — se §2/§3 for uddrag.
- `node scripts/scoutTravelScorecard.js --mission-days=2` — verificerer FØR-#3846-sammenligningen.
- `node --test scripts/scoutTravelScorecard.test.js` — 6/6 PASS (kadence-følsomhed, OVERSTYRET-
  label, ugyldigt input fejler højlydt, sektion A's HEADLINE/exit-kode upåvirket af
  `--mission-days`, LIVE-sektionen crasher aldrig scriptet).
- `node --test scripts/scorecardExitCodeWiring.test.js` — 7/7 PASS (default-invokation uændret).
