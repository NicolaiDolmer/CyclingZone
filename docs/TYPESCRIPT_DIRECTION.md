# TypeScript-retning: strict kerne, ingen omskrivning

**Beslutning (ejeren, 11/9-2026, [#5158](https://github.com/NicolaiDolmer/CyclingZone/issues/5158)): retning A+.**
Slut-tilstanden er **strict TypeScript for kernen**. Vejen derhen er **ikke** en
omskrivning, men en skralde-gate der goer det umuligt at gaa baglaens.

Denne fil er SSOT for retningen. Mekanikken bor i tre filer:

| Fil | Rolle |
|---|---|
| [`scripts/ts-core-ratchet-baseline.json`](../scripts/ts-core-ratchet-baseline.json) | Kerne-listen som **data** (omraade -> globs) + baseline-tallene |
| [`backend/tsconfig.core.json`](../backend/tsconfig.core.json) | `strict` + `allowJs`/`checkJs` over praecis de samme globs |
| [`scripts/check-ts-core-ratchet.mjs`](../scripts/check-ts-core-ratchet.mjs) | Gaten. Koerer i [`.github/workflows/ts-core-ratchet.yml`](../.github/workflows/ts-core-ratchet.yml) |

---

## 1. Hvorfor A+ og ikke "vi skriver det om"

En omskrivning af backenden til TypeScript er maaneder hvor spillet ikke bliver
bedre. Samtidig er alternativet — "vi skriver bare TS i nye filer" — en hensigt,
ikke en mekanik: den holder praecis indtil den foerste travle fredag.

A+ er begge dele: **slut-tilstanden er defineret**, og **retningen er haandhaevet
af CI**, men tempoet er frit. Der er ingen deadline paa konverteringen.

## 2. Slut-tilstanden pr. omraade

| Omraade | Filer i dag | Slut-tilstand |
|---|---|---|
| **Race engine v4** (`backend/lib/engine/v4/`) | 29 `.ts` + 37 `.test.ts`, 0 `.js` | **Naaet.** Strict, 0 fejl, egen gate (`npx tsc -p tsconfig.engine.json` i `ci.yml`) |
| **Oekonomi** (`economy*`, `financeForecast`, `salaryDecoupling`) | `.js` | Strict `.ts` |
| **Auktion** (`auction*`) | `.js` | Strict `.ts` |
| **Akademi** (`academy*`) | `.js` | Strict `.ts` |
| **Ejerskab** (`ownership*`, `riderOwnershipAudit`, `transferExecution`) | `.js` | Strict `.ts` |
| **Finalisering** (`boardWeekendFinalization`, `finalizeInstrumentation`, `raceFinalize*`) | `.js` | Strict `.ts` |
| **Scheduler** (`stageScheduler*`, `raceCalendarScheduling`) | `.js` | Strict `.ts` |
| **Routes** (`backend/routes/`) | `.js` | Runtime-validering ved graensen; typerne begynder dér, hvor dataene kommer ind |
| **Frontend data-lag** | `.ts`/`.tsx` er allerede strict (`frontend/tsconfig.json`), `checkJs: false` | Data-laget (hooks/klienter mod API og Supabase) i `.ts` |

Uden for listen — UI-komponenter, admin-scripts, tests — er der **ingen** kurs.
De maa gerne blive `.js`/`.jsx` for altid.

**Tests er bevidst udenfor.** `*.test.js` er ekskluderet i `tsconfig.core.json`,
og nye `.test.js`-filer i kerne-mapperne er stadig helt i orden. En TS-konvertering
af fixture-tunge tests koeber ingen produktions-sikkerhed.

## 3. Mekanikken: skralde-gaten

Gaten maaler tre tal og tillader kun at de **falder**:

1. **Antal utjekkede `.js`-filer** pr. omraade.
2. **Antal `tsc`-fejl pr. fil** (`strict` + `checkJs`).
3. **Nye filer.** En ny `.js`-fil i en kerne-mappe er en fejl: *"skriv den i
   TypeScript"*. En ny `.ts`-fil skal vaere fejlfri fra foerste commit.

Falder et tal, siger gaten `baseline kan saenkes` og bliver **groen**. Den retter
aldrig baseline selv — det skal committes:

```bash
node scripts/check-ts-core-ratchet.mjs --update-baseline
```

Baseline pr. 11/9-2026: **35 `.js`-filer, 1070 `tsc`-fejl** i kernen. Tallet er
en maaling, ikke en opgaveliste for én PR.

**Gaten stopper haardt hvis `tsc` klager over configen i stedet for over koden.**
En knaekket `tsconfig.core.json` giver nul fejl i kerne-filerne, hvilket udefra
ligner en perfekt ren kerne — og `--update-baseline` ville saa nulstille hele
skralden. Derfor: en diagnose uden fil-placering (`TS18003`) eller placeret i
selve configen (`tsconfig.core.json(19,25): error TS5095`) faelder gaten med
det samme i stedet for at blive laest som en forbedring.

### Tre ting der overrasker foerste gang

- **`backend/tsconfig.core.json` fejler med vilje.** Den er ikke i stykker; den
  maaler. `npx tsc -p tsconfig.core.json` giver over tusind fejl i dag.
- **Globs er uden filendelse** (`lib/economy*`, ikke `lib/economy*.js`). En
  `.js`-only glob ville tavst tabe filen i samme sekund den blev konverteret —
  praecis den fil vi lige havde gjort strict.
- **Fejl uden for kerne-globs ignoreres.** `tsc` type-checker hele
  importgrafen (i dag ~186 filer), men gaten taeller kun kerne-filer. Ellers
  kunne en aendring i en vilkaarlig hjaelpefil faelde en PR der slet ikke roerer
  kernen.

### Naar kerne-listen skal udvides

Tilfoej glob'en **begge** steder — `areas.<id>.globs` i baseline-JSON'en **og**
`include` i `tsconfig.core.json`. Gaten fejler med det samme hvis de to
divergerer; en glob der kun staar det ene sted er et hul i daekningen.

## 4. Konvertér naar du roerer

Reglen er ikke "konvertér alt". Den er: **skal du alligevel ind i en kerne-fil,
saa tag den med over.** Sammen med "nye filer er altid TS" betyder det, at
kernen bliver typet dér hvor der faktisk sker noget — og ikke i de filer ingen
har rørt i et halvt aar.

### Opskrift: én fil fra `.js` til `.ts`

1. **`git mv lib/foo.js lib/foo.ts`**, og ret **alle** importstier til filen fra
   `./foo.js` til `./foo.ts` (`grep -rn "foo.js" backend/`).

   Det er ikke kosmetik. Backenden koerer uden build-trin — Node 24 stripper
   typerne ved indlaesning — og Node remapper **ikke** `./foo.js` til `foo.ts`.
   Glemmer du en importstil, faelder den i runtime, ikke i `tsc`. Eksplicitte
   `.ts`-specifiers er allerede etableret moenster i repoet: se
   `backend/lib/raceEngineV4Bridge.js`, der importerer `./engine/v4/index.ts`.
   `allowImportingTsExtensions` i begge tsconfigs er praecis det der tillader
   den skrivemaade.
2. **Koer `npx tsc -p tsconfig.core.json --pretty false | grep lib/foo.ts`.**
   Det er din opgaveliste, og kun den.
3. **Start med parametre.** `TS7006 implicitly has an 'any' type` er langt
   stoerste klasse i dag. Skriv den type funktionen faktisk kraever — ikke
   `any`, og ikke en bredere type end kaldestederne bruger.
4. **JSDoc bliver til rigtige typer.** Findes der allerede
   `/** @param {number} value */`, er typen allerede besluttet: flyt den ind i
   signaturen og slet JSDoc-typen (behold prosaen).
5. **Supabase-rows: smalt foerst.** Backenden har i dag **ingen** genereret
   `Database`-type (den genererede fil ligger i
   `frontend/src/types/database.types.ts` og er frontendens). Skriv derfor en
   smal, lokal `type` med praecis de kolonner filen laeser:

   ```ts
   type RiderValueRow = Pick<
     { id: string; team_id: string | null; market_value: number },
     "id" | "team_id" | "market_value"
   >;
   ```

   Kolonnenavne slaas op i `database/schema-snapshot.json`
   (`relations.<tabel>.columns`) — **gaet aldrig**; `riders` har
   `firstname`/`lastname`/`birthdate`, ikke `name`/`age`.
   Foerst naar to eller flere konverteringsspor har brug for de samme rows,
   er det tid til en backend-lokal genereret `Database`-type (Supabase MCP
   `generate_typescript_types`). Det er et **eget** spor, ikke noget man
   smugler ind i en konvertering.
6. **`erasableSyntaxOnly` er slaaet til.** Ingen `enum`, ingen
   `private`-felter i konstruktoer-parametre, ingen `namespace`. Brug
   `const`-objekter + union-typer — samme stil som
   `backend/lib/engine/v4/types.ts`.
7. **Koer filens tests** (`node --test lib/foo.test.js` fra `backend/`) og
   **saenk baseline** (`--update-baseline`). Begge dele i samme PR.

### Naar en fil er for stor til én PR

`JSDoc`-annotationer taeller ogsaa: `// @ts-check`-stil typer paa en `.js`-fil
saenker fejltallet uden en omdoebning. Gaten er ligeglad med *hvordan* tallet
falder. Det eneste den ikke tillader, er `// @ts-nocheck` eller
`// @ts-expect-error` som maade at naa nul paa — det flytter ikke risiko, det
skjuler den.

## 5. Raekkefoelge for konverteringsspor

**Ét konverteringsspor pr. boelge.** Parallelle konverteringer i samme
kerne-omraade giver merge-konflikter i importgrafen og en baseline to spor
skriver til samtidig.

| # | Spor | Hvorfor i denne raekkefoelge |
|---|---|---|
| 1 | `backend/lib/economyEngine.js` (221 fejl) | Stoerste enkeltfil i kernen og den med flest kaldesteder. Typerne herfra forplanter sig til resten af oekonomien |
| 2 | `financeForecast.js` (57) + `salaryDecoupling.js` (27) | Ligger ned ad stroemmen fra economyEngine; arver dens typer |
| 3 | `auctionRules.js` (42) -> `auctionEngine.js` (28) -> `auctionFinalization.js` (88) | Regler foerst: de er rene funktioner uden DB, saa de definerer vokabularet finaliseringen skal bruge |
| 4 | `transferExecution.js` (103) + `ownership*` | Ejerskabs-mutationerne. Faar mest ud af typerne fra spor 3 |
| 5 | `academyGraduation.js` (104), `academyIntake.js` (61), resten af `academy*` | Stoerste omraade i filantal (15), men mest isoleret |
| 6 | `boardWeekendFinalization.js` (63), `raceFinalize*`, `stageScheduler*` | Finalisering/scheduler til sidst: de kalder alt det oevrige, saa de er billigst naar resten er typet |

Tallene er fejl pr. fil i baseline pr. 11/9-2026 og aendrer sig efterhaanden.
Den aktuelle sandhed staar altid i `scripts/ts-core-ratchet-baseline.json`.

## 6. CI

Gaten er sin egen workflow, `.github/workflows/ts-core-ratchet.yml`, med
check-navnet **`ts-core-ratchet`**. Den roerer ikke `ci.yml` — race engine v4's
type-check bliver hvor den er.

Skal checket vaere **required**, skal det ind **begge** steder: i branch
protection paa GitHub (sandheden) og i spejlet
[`scripts/ci-required-checks.json`](../scripts/ci-required-checks.json)
(kontrakt-kopien, se dens header).

Lokalt:

```bash
node --test scripts/check-ts-core-ratchet.test.mjs   # gatens egen selftest
node scripts/check-ts-core-ratchet.mjs               # selve gaten
```
