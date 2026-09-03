# Rolle vs. ordre — beslutningsoplæg, vokabular-vagt og svar på dobbelt-jæger

> Formaliserer ejer-beslutningerne på [#4246](https://github.com/NicolaiDolmer/CyclingZone/issues/4246) (27/8 + 2/9) i skrift, lægger målte prod-tal ved, og besvarer [#2405](https://github.com/NicolaiDolmer/CyclingZone/issues/2405) (flere ryttere i samme rolle). Refs #4246 #2405 #4615.

## 1. Problemet i klar tekst

Cycling Zone har to steder en spiller kan udtrykke "denne rytter skal jage udbruddet":

- **Rollen** (`race_entries.race_role = "hunter"`) sættes ved holdudtagelsen og gælder hele løbet, medmindre den ændres.
- **Ordren** (`TeamOrder.riders[].try_break = true`) sættes på taktik-kortet pr. etape.

Samme mønster gælder `sprint_captain` (rolle) vs. `leadout_for` (F3-udvidelse af ordren). Før 2/9 sagde intet dokument hvilken der vinder når begge er sat, eller hvad fladen skal vise når de peger forskelligt (fx `hunter` + `try_break: false`). Det var kritisk fordi `TeamOrder` er ved at fryse ind i engine v4's `types.ts`, og en rettelse efter frysning rammer en frossen kontrakt.

## 2. Målte tal (prod, 2026-09-03, kun tal — ingen id'er)

**Rolle-fordeling, `race_entries.race_role`** (103.304 rækker, holdudtagelses-niveau):

| Rolle | Antal | Andel |
|---|---:|---:|
| `helper` | 77.520 | 75,0 % |
| `captain` | 17.474 | 16,9 % |
| `sprint_captain` | 6.261 | 6,1 % |
| `hunter` | 1.793 | 1,7 % |
| `free_role` | 256 | 0,2 % |

**Rolle-fordeling, `race_stage_roles.race_role`** (8.847 rækker, etape-taktik-niveau, under udfasning jf. RACE_ENGINE_RULES §1):

| Rolle | Antal |
|---|---:|
| `helper` | 4.882 |
| `captain` | 1.219 |
| `hunter` | 1.015 |
| `free_role` | 958 |
| `sprint_captain` | 773 |

**Overlap pr. (løb, hold) — er "højst én" reelt håndhævet?**

- `race_entries` (holdudtagelsen): 0 hold har to `hunter` samtidig. `captain`/`sprint_captain` har 1 hold hver med et historisk overlap (sandsynlig binding-span-artefakt fra et rollebytte midt i sæsonen — uden for dette issues scope, ikke undersøgt videre her).
- `race_stage_roles` (etape-taktikken): af 760 (løb, etape, hold)-grupper med mindst én `hunter` har **119 (15,7 %) mere end én `hunter` samtidig**, med op til **6 huntere på samme hold i samme etape** i det yderste tilfælde. `captain`/`sprint_captain` har ingen af den slags overlap her — de er de eneste to roller `validateStageRoleOverrides` og `EXCLUSIVE_ROLES` faktisk håndhæver (`backend/lib/raceStageRolesApi.js:80`, `frontend/src/lib/stageRoleMatrixLogic.js:71`).

## 3. #4246 — de tre spørgsmål, besvaret

Alle tre er allerede afgjort af ejeren (kommentarer 27/8 og 2/9 på #4246). Dette dokument formaliserer beslutningen — ingen af de tre er stadig åbne A/B-valg.

### 3.1 Hvem ejer intentionen?

**Rollen er den varige beslutning og default. Ordren er en per-etape-afvigelse.**

`race_entries.race_role` er skrevet 103.304 gange i prod og er allerede den model AI-holdene bruger (`aiTactics.ts:200`). Ejer-beslutning 2/9: "Rollen fra holdudtagelsen er STANDARD-ordren for alle etaper i løbet. Sætter spilleren noget andet på taktik-kortet for en etape (TeamOrder), gælder kortet for DEN etape alene." Rollen skrives aldrig om af kortet — kortet er et etape-scoped overlay, ikke en ny sandhed.

*Begrundelse:* alternativet (ordren vinder permanent, eller de to felter forhandles case-by-case) ville kræve at hver mekanik-forfatter selv opfinder en tie-break-regel. Ét retningsbestemt hierarki — rolle er default, ordre er overlay for netop den etape — er den eneste model der er entydig for M5/M6/M14 uden yderligere specifikation.

### 3.2 Hvad viser fladen?

**Begge, i samme sætning, ordren fremhævet når den findes.** Ejer-eksemplet (2/9): *"Standard: jæger. I dag: bliv i feltet."* Har spilleren intet sat for etapen, viser fladen kun rollen. `TacticsCard.jsx` viser i dag rollen som tag ved rytterens navn (`ROLE_LABEL_KEY`, linje 32) og `try_break` som separat toggle — de to er endnu ikke sammensat til én sætning der viser afvigelsen. Se §4.

### 3.3 Overlever `hunter` v4?

**Ja, som default.** `RiderRole` (fem værdier, `backend/lib/engine/v4/types.ts:27`) er uændret den kanoniske rollemodel. `try_break` er ikke en erstatning for `hunter` — det er den bounded per-etape-modulator af den, "matcher mønstret M14/aiTactics.ts allerede bruger for AI-hold" (ejer 27/8). v4 skal wire `entrant.role` ind i breakaway-mekanikken (M5) for menneskehold, så en hunter mærker noget uden en eksplicit ordre; den wiring er balance-følsom og tages separat med dry-run (ejer 27/8, punkt 3) — **ikke i denne PR**.

## 4. Hvad skal ændres i v4/UI (nu hvor beslutningen er skrevet ned)

Fire konkrete afvigelser mellem kode og den besluttede kontrakt, fundet ved gennemgang 3/9. Ingen af dem rettes i denne PR (docs+test-only), men de bør blive selvstændige opgaver:

1. **`race_role` er stadig et sat-bart felt i selve ordren, ikke kun i rollen.** `backend/lib/raceTeamOrdersApi.js` (`validateTeamOrder` + `normalizeTeamOrder`) validerer og normaliserer `r.race_role` pr. rytter i `TeamOrder`-bodyen, og `backend/lib/engine/v4/orders/teamOrdersAdapter.ts`s `TeamTacticsOrder.riders[]` har et `race_role`-felt. Det matcher hverken den frosne ordre-kontrakt i `docs/superpowers/specs/2026-08-21-race-tactics-orders-v1-design.md` §Ordre-kontrakten (`riders: Array<{rider_id, effort, try_break}>` — intet rolle-felt) eller ejer-beslutningen 27/8 punkt 1 ("`race_role` fjernes fra per-rytter-ordren"). Frontendens egen kontrakt (`frontend/src/lib/tacticsPlan.js:7`) har allerede kun `{rider_id, effort, try_break}` — det er kun API-laget og adapteren der stadig bærer det overflødige felt. Uskadt i dag (ingen rigtig klient sender feltet), men det er præcis den slags "guard der tæller et felt ingen sender" #4344-postmortemen advarer imod hvis det senere bruges til at OVERSKRIVE rollen.
2. **`TacticsCard.jsx` skal sammensætte rolle + ordre til én sætning** ("Standard: X. I dag: Y") i stedet for at vise rollen som statisk tag og ordren som separate kontroller uden synlig kobling. Kræver nye i18n-nøgler i `tacticsOrders.*` (en+da).
3. **M5 (udbrud) skal læse `entrant.role === "hunter"` som et bounded baseline-bidrag**, additivt til `try_break`, når den mekanik kobles på (jf. §5.10 i RACE_ENGINE_RULES — M5 er skrevet men ikke kaldt af `index.ts` endnu). Tages i egen dry-run-PR, ikke her.
4. **RACE_ENGINE_RULES.md §7 modsigelse 1-2 og 3** opdateres i denne PR til at pege på denne beslutning (se den fils diff).

## 5. #2405 — er flere ryttere i samme rolle tilsigtet?

**Nej — det er et implementerings-hul, ikke en truffet beslutning.**

Koden modsiger sig selv på tværs af de to lag, og ingen af dem er redigeret siden hullet blev fundet (verificeret uændret 3/9, jf. `git log` mod `raceStageRolesApi.js` og `stageRoleMatrixLogic.js` — kun #4353's tælle-fix rører filerne, og den rører ikke `hunter`):

- **Holdudtagelsen** (`race_entries`) håndhæver "højst én `hunter`" via en partiel unique-constraint (`database/2026-06-12-race-entries-roles.sql:11-16`, `uq_race_entries_hunter`) OG enkeltværdi-felter i API'et (`backend/lib/raceSelection.js:13,43,53`). Målt: 0 overtrædelser i prod.
- **Etape-taktikken** (`race_stage_roles`) håndhæver det samme KUN for `captain`/`sprint_captain` — `EXCLUSIVE_ROLES` (`frontend/src/lib/stageRoleMatrixLogic.js:71`) og `validateStageRoleOverrides` (`backend/lib/raceStageRolesApi.js:80`) udelader `hunter` uden begrundelse, og kommentaren ovenover `EXCLUSIVE_ROLES` hævder fejlagtigt at sættet spejler ALLE partielle unique-indexes på `race_entries`, mens `uq_race_entries_hunter` faktisk findes og bliver tavst ignoreret. Målt: 119 af 760 hold-etape-hunter-grupper (15,7 %) har mere end én hunter, op til 6 samtidig.

Hverken `docs/RACE_ENGINE_RULES.md` eller `docs/GAME_INVARIANTS.md` udtaler sig om kardinalitet pr. rolle. Den oprindelige #1307-model (enkeltværdi + DB-constraint) er den eneste eksplicitte regel der findes, og etape-taktik-laget bærer den ikke videre. 15,7 % afvigelse — og et enkelt tilfælde med 6 huntere på samme hold i samme etape — er for højt til at være et sjældent kant-tilfælde; det er systematisk, hver gang en spiller sætter en anden hjælper til hunter på taktik-matricen uden at rulle den forrige tilbage, degraderer `demoteOtherHoldersOfRole` den ikke (kun `EXCLUSIVE_ROLES`-medlemmer degraderes).

**Håndhævelse foreslået, IKKE bygget i denne PR** (jf. opgavens afgrænsning):

- **A — gør `hunter` unik også på etape-taktikken.** Udvid `EXCLUSIVE_ROLES` til `{"captain", "sprint_captain", "hunter"}`, ret backend-validatoren til at tælle `hunter` med samme mønster (inkl. #4344-fixet: mod `baseRoleByRider`, ikke kun bodyen), og læg en tilsvarende partiel unique-constraint på `race_stage_roles`. Konsistent med holdudtagelsens regel og med at `hunter` er en "leder-rolle" (samme kommentar-kategori som captain/sprint_captain i den oprindelige SQL).
- **B — flere huntere er tilsigtet på etape-niveau.** Så skal `uq_race_entries_hunter` droppes fra holdudtagelsen (så de to lag siger det samme), og hjælpeteksten/`HunterExplainer.jsx` skrives om så den ikke antyder enkelthed.

Da `race_stage_roles` selv er under udfasning efter v4-flippet (RACE_ENGINE_RULES §1) og v4's `TeamOrder`/rolle-model (§3 ovenfor) ikke har nogen tilsvarende cardinality-regel skrevet endnu, anbefales **A** — hunter er en leder-rolle på linje med captain/sprint_captain i alle andre henseender, og retningen bør skrives ind i v4-kontrakten samtidig, ikke kun rettes i det udfasende lag.

## 6. Forward-guard

Rolle-vokabularet (`backend/lib/raceRoles.js` `VALID_RACE_ROLES`, spejlet i `backend/lib/engine/v4/types.ts:27`s `RiderRole`) havde ingen test der låser de fem værdier. Tilføjet i denne PR: `backend/lib/raceRoles.test.js` — en test der låser præcis `["captain", "sprint_captain", "helper", "hunter", "free_role"]` og fejler på et sjette ord, med henvisning til `docs/RACE_ENGINE_RULES.md` §1 som SSOT.

## 7. Kilder

- `docs/RACE_ENGINE_RULES.md` §0, §1, §5 (F3-noten), §7 (modsigelse 1-3)
- `docs/superpowers/specs/2026-08-21-race-tactics-orders-v1-design.md` (Ordre-kontrakten, T1-T4)
- [#4246](https://github.com/NicolaiDolmer/CyclingZone/issues/4246) (kommentarer 27/8, 28/8, 2/9)
- [#2405](https://github.com/NicolaiDolmer/CyclingZone/issues/2405) (kommentar 30/8)
- `.claude/learnings/2026-08-28-delta-payload-guard-blind-to-base-state.md` (#4344-postmortem, samme guard-form som §5 punkt 5 advarer imod)
