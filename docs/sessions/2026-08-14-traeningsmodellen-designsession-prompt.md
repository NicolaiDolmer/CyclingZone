# Session-prompt: træningsmodellen + er #3741 klar til merge?

**Model:** Opus 5 · **Indsats:** high · **Form:** vurdér først, beslut derefter, byg til sidst
**Skrevet:** 14/8 aften af #3721-sessionen, efter at fokus-panelet blev merget
**Erstatter** den udgave der blev skrevet tidligere samme dag — den var skrevet før panelet landede, og før tre af fundene nedenfor fandtes.

> Kør `date` som noget af det første. Denne prompt er skrevet 14/8. Repoet er selv misdateret flere steder (commits skrevet 14/8 hedder "session 15/8"), så udled aldrig dagen af filnavne eller dokumenttekst. Det kostede den forrige session en forkert dato i en patch note der var på vej ud til spillerne.

---

## Prompt (kopiér ind som første besked)

> Du skal to ting, i denne rækkefølge:
>
> **1. Vurdér om [#3741](https://github.com/NicolaiDolmer/CyclingZone/pull/3741) (trin 4+5) kan merges sikkert nu.** Læs afsnittet "#3741" nedenfor først — der er to fund som PR-beskrivelsen selv ikke kender. Vær kritisk. Konkludér med en anbefaling, ikke en liste af forbehold.
>
> **2. Kør beslutningen i [#3762](https://github.com/NicolaiDolmer/CyclingZone/issues/3762)** — dagstype før session. Den blokerer #3759, #3760, trin 2 og #3747. Stil beslutningerne ÉN ad gangen med en anbefaling, ikke som et dossier.
>
> Læs i denne rækkefølge: `#3762` (inkl. kommentaren med prod-målingen) · dette dokument · `#3741`s beskrivelse · specens §8.1 **inklusive rettelsen nederst** i `docs/superpowers/specs/2026-08-14-3659-rytterudvikling-og-traening-design.md`.
>
> Arbejd i en worktree. Vis visuelt før du beder om godkendelse. Sig det når du gætter.

---

## #3741: hvad der skal vurderes

PR'en er stacked på trin 3, som **er merget**. Koden er separerbar: 31 filer, men kun ~400 linjer rigtig ændring i `backend/lib/`. Resten er fixtures og scripts. 38 checks var grønne på den gamle base.

### Fund 1: PR-beskrivelsens hovedindvending er tilbagekaldt

PR-beskrivelsen åbner med **"⛔ TRE TING KRÆVER EN BESLUTNING FØR MERGE"**, og punkt 1 er at ankeret vender den forkerte vej: 29 → 27, altså ~2 ratingpoint lavere for alle.

**Det tal er trukket tilbage.** Specens §8.1 har en rettelse skrevet samme aften: gaten sammenlignede `spids` mod `spids`, men `spids` er ikke det bedste spil. Med bedste opnåelige pr. rytter går det **27 → 30**, og **595 af 600 ryttere stiger**. Afvejningen ejeren accepterede ("lidt dårligere i snit mod indflydelse") findes ikke — han får indflydelsen uden prisen.

PR-beskrivelsen er aldrig blevet opdateret. Læser man den i dag, træffer man beslutningen på et grundlag der er ophævet. **Ret PR-beskrivelsen før nogen vurderer den.**

### Fund 2: merget ER mutationen. Der er ingen kill-switch

NOW.md har hele vejen sagt "prod-mutationen er stadig ejer-gated", som om merge og mutation var to skridt. Det er de ikke:

- `dailyTrainingEngine.js` genberegner `ability_caps` **pr. tick** via `buildCapsForRider` og skriver når de er ændret (`sameCaps`-tjek). Ikke lazy-initeret — det var netop fejlen #2471 rettede.
- #3741 ændrer de fire faktorer: `naturalPrimaryFactor` 1,0 → 1,30 · `naturalSecondaryFactor` 0,82 → 1,10 · `neutralFactor` 0,45 → 0,70 · `oppositeFactor` 0,12 → 0,20.
- Jeg har grepped diffen for et flag eller en kill-switch. **Der er ingen.** (`academyFlag.js`-hits i diffen er et eksisterende modul, ikke et nyt flag.)

**Følge: i det øjeblik PR'en er merget og deployet, flytter hver eneste rytters lofter ved næste daglige tick.** Ingen separat migration at holde tilbage, intet at rulle tilbage med et flag.

Det er ikke et argument mod at merge — lofterne skal jo flytte sig. Det er et argument for at merget selv er den ejer-gatede handling, og at der skal være et snapshot før.

### Min anbefaling

**Merge den, men først efter fem skridt.** Ikke fordi modellen er tvivlsom — den er målt bedre end specen lovede — men fordi merget er uigenkaldeligt uden et flag.

1. **Rebase på nuværende main.** Konflikterne er kun `docs/MASTERPLAN.md`, `docs/NOW.md` og `frontend/src/data/patchNotes.js`. Den sidste er en versionskollision: main står på **7.128**, så #3741's note skal renummereres til 7.129.
2. **Ret PR-beskrivelsen** så den bærer §8.1-rettelsen i stedet for det tilbagekaldte 29 → 27.
3. **Kør alle fem gates igen på den rebasede branch**, ikke på den gamle base. `backend/scripts/rytterudviklingScorecard.js` mod samme snapshot. **Reproducerer tallene i PR-beskrivelsen sig?** Gør de ikke, er dét signalet — ikke en grund til at justere gaten indtil den passer.
4. **Snapshot `ability_caps` for hele populationen før merge.** Read-only. Uden det kan effekten hverken måles eller rulles tilbage.
5. **Dry-run-diff:** beregn `buildCapsForRider` for hele populationen med gamle og nye konstanter uden at skrive, og vis ejeren fordelingen af hvor meget lofterne flytter sig. Det er tallet han skal godkende, ikke et scorecard-gennemsnit.

### Hvordan det bedst dobbelttjekkes

Den skarpeste test er ikke at køre gaten igen — det er at **prøve at modbevise den**:

- **Reproducér mod et kendt punkt.** Kør den GAMLE konfiguration gennem den NYE harness. Rammer den dagens målte niveau? Gør den ikke, måler harnessen sig selv, ikke modellen. Det var præcis fejlen i §8.1's første udgave.
- **Negativ-testen skal stadig fejle.** Specen §4.4 kræver at gaten beviseligt fejler på en defekt konfiguration (`offFocusMult` uændret). Kør den. En gate der består alt beviser ingenting.
- **Spot-tjek på ægte ryttere, ikke på medianer.** Vælg 5 navngivne ryttere fra snapshottet med forskelligt potentiale og forskellige typepar, og vis før/efter loft pr. evne. En median kan skjule at én rolle bliver ødelagt.
- **Tjek de fem der IKKE stiger.** §8.1 siger 595 af 600 stiger. Hvem er de sidste 5, og hvorfor? Hvis det er pot 5-6 (73 → 69), skal ejeren vide at spillets bedste ryttere er dem der taber.
- **Fladen efter trin 4.** `focusTrainability` skifter output: `technique` går fra 64 af 64 `strength` til 55 af 64. Fokus-panelet (merget i dag) oversætter `limited` til **ingen påstand**, så det degraderer sikkert — men verificér det visuelt i stedet for at tro på mig.

---

## Systemet: fem issues er én model

```
#3762  dagstype først, session derefter        ← BESLUT DENNE
   ├── #3759  hvile som fokus                  ← overstyres af #3762
   ├── #3760  aktiv restitution                ← trin 1-valg i #3762, koblet til #2650
   ├── #3709 trin 2  løbslære                  ← en række under "færdighedsdag"
   ├── #3747  trænbarheds-signalet             ← venter på #3741's rate til fladen
   └── #1895  ugerytmen                        ← gemmer #3762's trin 1-valg pr. ugedag
```

Målt grundlag: **622 planer (13,6 %)** står på fokus + hvile, hvor `abilityMult` returnerer 0 for alle evner. Yderligere ~5 % står på fysiologiske modsigelser. Se kommentaren på #3762.

**Bygges #3759 før #3762, migreres `training_week_plans` to gange.** Bygges trin 2 først, lander `løbslære` på en akse der er ved at blive lavet om.

## Beslutninger til ejeren, én ad gangen

1. **Hvad koster en færdighedsdag?** Uden en pris træner alle færdigheder hver dag. Hypotese der skal måles, ikke antages: håndværks-raten (0,22) er selvbegrænsende nok.
2. **Hvordan oversættes de 179 `endurance` + hård-planer?** Forslag: Mellem/Tempo, ikke Hård.
3. **Skal aktiv restitution med i første version?** Koblet til #2650: træthed er allerede mættet (AI-median 100, human-median 90).
4. **Hvor langt mod periodisering?** #2337 findes.

## Det lange spil

Ikke til denne omgang — retningen at bygge #3762 så den ikke spærrer for:

- **Programmer frem for daglige klik.** 30 ryttere × et dagligt valg er en pligt, ikke et spil.
- **Periodisering (#2337).** Base, opbygning, form, nedtrapning. #3762's dagstyper er byggeklodserne.
- **Belastning frem for to tal.** Form som resultat af belastningshistorik i stedet for et selvstændigt felt.
- **Træneren som karakter (#3743).** Han foreslår ugens program i stedet for at være en usynlig fallback.

## Hvad #3721-sessionen efterlod

**Merget 14/8:** fokus-panelet ([PR #3764](https://github.com/NicolaiDolmer/CyclingZone/pull/3764)) på begge flader, med datastyrede kolonner. `blocked`-chippen slettet (målt uopnåelig, 0 af 384), `limited`-chippen fjernet (tvetydig per #3747). To dublerede fokus→evne-tabeller væk. Patch note v7.128.

**Målt og dokumenteret:** setback har aldrig ramt en rytter (#3758, kæden ligger på issuet) · `/training` viser 1 af 8 badges (#3761) · form pr. dag ligger allerede i rapport-payloaden, så en formkurve er frontend-only (#3763).

**Designet men ikke bygget:** strukturen — blok-rækkefølgen, filterbjælken, kolonnerne 10 → 6, rapport-tabellen ind i en Today-kolonne, mobil-rækkelisten. Ligger i `docs/design/3721-traeningssidens-struktur/mockup.html` med målingerne. **Vent på #3762** før den bygges.

## Groundwork

| | |
|---|---|
| `backend/lib/dailyTraining.js` | `abilityMult` (rest → 0 for ALLE evner), `fatigueLoad` (rest −14, easy +4, normal +9, hard +16) |
| `backend/lib/dailyTrainingEngine.js` | genberegner `ability_caps` pr. tick — derfor er merge = mutation |
| `backend/lib/training.js` | `TRAINING_FOCUSES`, `focusTrainability`, `resolveTrainingModifier` (setback bor her, og kun her) |
| `frontend/src/components/training/FocusPanel.jsx` | merget 14/8. Kolonnerne er datastyrede |
| `frontend/src/lib/trainingFocus.js` + `.test.js` | 11 tests. `focusSignal('limited') === 'none'` er pinnet med begrundelse — trin 4 skal ændre den bevidst |
| `frontend/tests/e2e/3721-*.shots.mjs` | måle- og screenshot-scripts, ikke i CI |

## Hvad der ikke må ske

- **`smartDefaultFocus` må ikke ændres som sideeffekt.** Verificeret bit-identisk gennem trin 3 og 4, pinnet i test.
- **Ingen migration af `training_plans` (4.587 rækker) uden dry-run-diff + ejer-godkendelse.**
- **Ejer-go visuelt før merge af UI.**
- **Mobil er ikke en efterfølgende tilpasning.** Alle tre playwright-projekter.
- **TIER FULL ved i18n eller delte komponenter:** `node scripts/verify-affected.mjs` klassificerer, og fuld e2e lokalt før push. Kør kun ÉN e2e-suite ad gangen — to samtidige kørsler deler preview-server-port og slår hinanden ihjel med fejl der ligner ægte regressioner.

## Kilder

`#3762` (+ prod-målingen i kommentaren) · `#3741` · `#3758` · `#3759` · `#3760` · `#3761` · `#3763` · `#3721` · `#3747` · `#3709` · `#2650` · `#2337` · `#1895` · `#3743` · specens §5, §6 og §8.1 med rettelsen
