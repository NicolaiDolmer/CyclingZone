# Prompt til næste session — torsdag 13/8

> Kopiér alt under linjen ind som din session-prompt. Designet sammen med ejeren 12/8.

---

Læs `docs/NOW.md` og `docs/superpowers/specs/2026-08-09-3564-progressionskaede-samlet-design.md` §12. Verificér før du kalder noget løst.

**Sessionen har ét emne: lofterne. [#3593](https://github.com/NicolaiDolmer/CyclingZone/issues/3593) og [#3591](https://github.com/NicolaiDolmer/CyclingZone/issues/3591) pkt. 2. Intet andet.** Ejeren valgte scope eksplicit 12/8: færre opgaver løst fremragende. #3449 og markedssweepen er fredag og lørdag, ikke i dag.

## Hvorfor netop i dag, og hvorfor før sweepen

Markedsmodellen (`backend/scripts/marketValueModelV1.draft.json`) har et offset pr. ryttertype i selve formlen: `offset[primary_type]`. Baroudeur er reference på 0, sprinter står på +0,586, puncheur på +0,611. Modellen er logaritmisk, så et typeskift fra baroudeur til sprinter er alene **cirka 80 % højere modelleret pris** — samme rytter, samme evner, kun etiketten er en anden.

#3591 siger at **2.139 af 3.473 AI-ryttere (61,6 %) skifter type** i det sekund race-day-motoren tændes 23/8. Kører markedssweepen før det, prissætter vi dem mod en type de mister en uge senere, og deres værdi flytter sig anden gang samme dag som markedsvægten går til 1,0. To store bevægelser oven i hinanden på cutover-dagen.

Derfor: identiteten gøres færdig først. Det er også hvad spec §12 har sagt hele tiden.

## Rod-årsagen (verificeret i kode 12/8)

`buildCapsForRider` kaldes to steder med forskellig signatur:

- `backend/lib/dailyTrainingEngine.js:314` — `buildCapsForRider(abilities, { ...rider, age }, primary, secondary)` **MED alder**
- `backend/lib/backfillCores.js:261` — `buildCapsForRider(baseline, { potentiale: rider.potentiale }, ...)` **UDEN alder**

Alderen bruges kun af `taperedAbsoluteCap`, som først bider efter `peakAge`. AI-ryttere er aldrig blevet tikket af motoren (`race_day_engine_enabled = 'off'`), så deres lofter kommer fra backfill-stien og er aldrig blevet aftrappet. Kun **46 af 3.473** AI-ryttere har caps der matcher noget `buildCapsForRider`-output overhovedet.

Det er ikke et backfill-uheld. Det er to kaldsteder der kan divergere, og som gjorde det i månedsvis uden at nogen opdagede det. **Rettelsen er ikke færdig før divergensen er gjort umulig** — ét kaldested, en påkrævet parameter, eller en test der fejler hvis signaturerne skilles ad igen. Ejerens standard: rod-årsag, permanent løsning, og en vagt der beviser at fejlen ikke kan komme igen.

## #3593 — sekundæren er stadig et gæt

`resolveRiderTypes(archetype_draw, caps, baseline)` tager kun **primæren** fra det persisterede anlæg; sekundæren udpeges stadig af klassifikatoren. 84,6 % af nye akademi-ryttere har `secondary: null`, så for dem er sekundæren altid et gæt.

Det er ikke kosmetik: sekundæren former loftet direkte via `youthRoleFactor` (`naturalSecondaryFactor` 0,82 mod `neutralFactor` 0,45 mod `oppositeFactor` 0,12). Målt: skifter man ungdoms-baselinen, får **51,5 %** en anden sekundær og dermed andre `ability_caps` — median 13 loft-point, p90 76, max 209. På den eksisterende bestand ville **25,8 %** få en anden sekundær afhængigt af baseline.

Leverancen her er ren forankring: udfyld anlægget for de 577 fra `secondary_type`-kolonnen. **Intet synligt må skifte.** Verificér det, påstå det ikke.

## #3591 pkt. 2 — den kontrollerede re-derive

Rækkefølgen er #3593 først, så #3591. Re-deriven af AI-caps skal ske **kontrolleret nu** i stedet for som sideeffekt af flippet 23/8.

**Hård gate: dry-run + ejerens go før nogen prod-mutation.** Han skal se absolutte tal, ikke procenter alene:

- hvor mange ryttere skifter synlig type, fordelt på fra-type → til-type
- hvor mange taber loft, og hvor meget (p10/median/p90 i rating-point)
- hvad det gør ved deres markedsværdi, givet type-offsettet ovenfor
- hvad spillerne kan se: AI-ryttere er synlige på markedet og i løb

Snapshot før mutation. Rollback-vej skrevet ned før du kører — den hører også hjemme i [#3645](https://github.com/NicolaiDolmer/CyclingZone/issues/3645).

## Det du skal spørge ejeren om

1. **Go på re-deriven**, med tallene ovenfor. Ét spørgsmål, klart sprog, din anbefaling.
2. **Skal typeskiftet meldes ud?** 2.139 AI-ryttere der skifter synlig type er noget spillerne kan se på markedet. Patch note, Discord, eller ingen af delene — det er hans kald, ikke dit.

## Efter i dag

- **Fredag 14/8:** [#3449](https://github.com/NicolaiDolmer/CyclingZone/pull/3449)'s otte CodeRabbit-fund + T4-niveau-gates i verify-steppet. To af fundene (sweep/trainingSweep-race på søndage, dedup-log efter writes) er reelle korrekthedsfejl. Dry-run-scorecard til ejeren fredag aften.
- **Lørdag 15/8:** markedssweepen kører efter ejerens go. Drejebog i [#3448](https://github.com/NicolaiDolmer/CyclingZone/issues/3448).
- **Søndag 16/8:** kun [#3632](https://github.com/NicolaiDolmer/CyclingZone/issues/3632)-målingen — de første ryttere født med begge anlæg kommer med akademi-drippet. Måling, ingen handling. Luk issuet når det er målt.

## Arbejdsform

- Verificér i prod/kode før du kalder noget løst. Ingen evidens → sig det eksplicit.
- **Læs den eksisterende aftale før du stiller et spørgsmål.** Bidt 12/8 på #3503, hvor "A nu, B senere" stod ordret i både issue og spec, og blev genåbnet som et nyt valg alligevel. Se `feedback_dont_reopen_locked_decisions`.
- Mål langs den rigtige akse. Der er fire dokumenterede instanser af den fejl på to dage.
- Migrationer: du applier selv efter merge (idempotent + post-verify). Destruktive klasser er ejerens.
- Gen-tænd aldrig et live spiller-vendt system uden ejer-go.
- Postmortem i `.claude/learnings/` ved bugfix — læg det i en eksisterende fil hvis fejlen er samme klasse.
- Close-out per CLAUDE.md.
