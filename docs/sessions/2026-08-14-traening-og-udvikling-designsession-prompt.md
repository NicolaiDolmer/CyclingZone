# Design-session: rytterudvikling og træning skal kunne stoles på

**Status:** ejer-erklæret **vigtigste opgave i spillet** (14/8). Ingen kode i denne session før designet står.
**Form:** design-session med mange spørgsmål, ét ad gangen, og visuelle forslag før beslutninger.
**Model:** Opus 5. **Ikke** en natbølge, ikke et workflow.

---

## Prompt (kopiér ind som første besked)

> Vi designer rytterudvikling og træning om, så managers kan stole på den igen. Læs
> `docs/sessions/2026-08-14-traening-og-udvikling-designsession-prompt.md` — den bærer alt
> der er målt, besluttet og lovet, så du ikke skal regne det igen.
>
> Ingen kode i denne session. Vi designer først, og jeg vil se tingene visuelt undervejs.
> Stil mig mange spørgsmål, ét ad gangen, og kom med et forslag før hvert spørgsmål.
>
> Trin 3 (det neutrale loft bliver til en lav vækstrate) skal have en harness-kørsel med
> målte tal og et scorecard, så jeg beslutter på tal og ikke på en idé.

---

## Problemet, ordret fra ejeren

13/8, #feedback-from-dolmer (→ [#3659](https://github.com/NicolaiDolmer/CyclingZone/issues/3659)):

> "Vi er simpelthen nød til at gøre sådan, at spillerne har en mere forståelig process for
> dem omkring træning. Hvornår kan ryttere udvikle sig? Hvornår kan de ikke? I hvad?
> Hvordan? Hvornår rammer ryttere loftet. Hvorfor? Hvordan? De skal ikke overfaldes i ord."

14/8, efter landing 1:

> "Det giver ingen mening at managers hele tiden føler, at de løber panden mod en mur med
> de lofter. Det er overhovedet ikke til at forstå for managers. Vi burde arbejde med
> farten hvorpå ryttere udvikler sig, fremfor bare at lave et simpelt loft, der blokerer."

---

## Det vigtigste fund: motoren gør det allerede

`backend/lib/dailyTraining.js` → `dailyAbilityDelta`:

```js
const gap = Math.max(0, (cap ?? current) - current);
if (gap === 0) return 0;
const base = (gap * growthFractionForAge(age) * cfg.dailyBudgetBoost) / cfg.daysPerSeason;
```

Væksten er **proportional med afstanden til loftet**. En evne vokser hurtigt når der er langt
op og langsommere jo tættere den kommer. Det ER fart-modellen ejeren efterspørger. Der findes
ingen blokerende mur i selve væksten.

Muren er **den sidste tomme** — `gap === 0` → nul — plus teksten vi lagde ovenpå:

| Nøgle | Tekst i dag |
|---|---|
| `focusOptionCapped` | "ceiling reached" |
| `focusCappedTitle` | "Training this focus gains nothing more." |
| `focusPartiallyCappedTitle` | "…has reached its lifetime ceiling and will not rise again, no matter how this rider trains." |

Designopgaven er derfor **ikke** at rive lofterne ud. Det er at fjerne den sidste tomme og
erstatte "nej" med "meget langsomt" — og at vise farten FØR spilleren vælger.

## Målt 14/8 (prod, `execute_sql`) — genopfind ikke disse tal

6.853 ryttere med et hold, 102.795 evne-rækker:

| | Andel på loftet | Median luft til loftet |
|---|---|---|
| Evner der tæller for rytterens rolle | **7,6 %** | 27 point |
| Evner uden for rollen | **22,1 %** | 10,4 point |
| Alle | 16,1 % | 15 point |

**Lofterne binder tre gange hårdere uden for rollen.** Det er rolle-faktoren: et neutralt loft
er `0,45 × grundloftet` (`buildCapsForRider` i `riderProgression.js`). Spilleren træner
klatring på sin sprinter, rammer et lavt loft hurtigt, og får at vide at rytteren er *færdig*.

Øvrige målte tal der må bruges direkte: rating-median 13 · p90 29 · maks 85 · potentiale-median
44 · median luft nu→loft 28,5 (landing 1, #3683).

---

## Alt der hænger sammen med dette (læs før du foreslår noget)

**Ejer-direktiver**
- [#3659](https://github.com/NicolaiDolmer/CyclingZone/issues/3659) — gør udvikling, træning og lofter forståeligt i UI. **Forslag først.** Kræver også en gennemgang af Discord-feedback 7 dage tilbage + hjemmesidens feedback, og af hvad ejeren har lovet i tråde.
- [#3643](https://github.com/NicolaiDolmer/CyclingZone/issues/3643) / [#3644](https://github.com/NicolaiDolmer/CyclingZone/issues/3644) — træningssiden mobil + desktop, rework til langt højere standard.
- [#3660](https://github.com/NicolaiDolmer/CyclingZone/issues/3660) — UX-gennemgang: kan spilleren stole på det han ser?

**Mekanikken**
- [#3503](https://github.com/NicolaiDolmer/CyclingZone/issues/3503) — **samme rod-årsag, anden vinkel.** `buildCapsForRider`s `max(potentiale-drevet rolle-loft, current)` giver ved højt potentiale alle 8 roller næsten ens loft. Målt: G3-præcision 90,2 % ved potentiale 1-1,5, encifret ved 5-6. De største talenter har den mindst skarpe rolle-identitet. Ejer-retning 7/8: *"A nu, B senere — B bør laves på sigt for verdensklasse."*
- [#3682](https://github.com/NicolaiDolmer/CyclingZone/issues/3682) — `positioning` har vægt 0 i alle otte typer og får derfor altid 0,45 × loft, selvom fire roller nu belønner evnen. **Første forekomst af trin 3**, ikke en løsrevet fix.
- [#3592](https://github.com/NicolaiDolmer/CyclingZone/issues/3592) — fire typepar er matematisk uadskillelige.
- [#3564](https://github.com/NicolaiDolmer/CyclingZone/issues/3564) — progressionskæden samlet. **Spec §11-12 er SSOT:** `docs/superpowers/specs/2026-08-09-3564-progressionskaede-samlet-design.md`.
- [#3629](https://github.com/NicolaiDolmer/CyclingZone/issues/3629) — talent-kløften: akademiet 3,61 stjerner i snit mod det frie markeds 2,20.
- [#3616](https://github.com/NicolaiDolmer/CyclingZone/issues/3616) / [#3614](https://github.com/NicolaiDolmer/CyclingZone/issues/3614) — ungdomsbåndet er for lavt i bunden og fladt i toppen.
- [#3634](https://github.com/NicolaiDolmer/CyclingZone/issues/3634) — voksen-generatoren giver stadig ingen sekundær i anlægget.

**Fladerne der lyver eller tier**
- [#3649](https://github.com/NicolaiDolmer/CyclingZone/issues/3649) — loft-beskeden på træning modsiger scout-/potentialevisningen. **3 spillerrapporter 11/8.** Verificér om landing 1 har ændret den.
- [#3651](https://github.com/NicolaiDolmer/CyclingZone/issues/3651) — "Limited upside" mangler i træningssektionen på rytterprofilen, altså dér hvor valget faktisk træffes.
- [#2720](https://github.com/NicolaiDolmer/CyclingZone/issues/2720) — scout-rapporten viser modstridende signaler.
- [#3456](https://github.com/NicolaiDolmer/CyclingZone/issues/3456) — hjælpen forklarer hverken hvornår daglig træning kører eller restituerer.
- [#3583](https://github.com/NicolaiDolmer/CyclingZone/issues/3583) — hjælpetekst om træningsudbytte akademi vs seniortrup.
- [#3623](https://github.com/NicolaiDolmer/CyclingZone/issues/3623) — hjælpen mangler en oversigt over de 8 ryttertyper. **Ejerens designspørgsmål i tråden står ubesvaret.**

**Spillerfeedback**
`scripts/discord/.sweep-daily-2026-08-08.md` til `-13.md`. Fire af dem indeholder trænings-,
loft- eller udviklings-feedback. Læs dem, og læs #3639's tråde (loft-transparensen slået til
11/8) — de tre rapporter dér er den direkte anledning.

---

## Retningen der allerede er skitseret (14/8, ikke besluttet)

**Trin 1 — vis farten før valget, ikke muren bagefter.** Ingen motor-ændring. Erstat de
kvalitative chips ("limited for this type") med det tal spilleren kan handle på: *"+1 om ca.
4 dage"* mod *"+1 om ca. 6 uger"*. Og få signalet ind på rytterprofilen, ikke kun på daglig
træning.

**Trin 2 — fjern muren, behold bremsen.** Én funktion: lad evnen krybe videre i stedet for at
stoppe ved `gap === 0`, og slet "will not rise again" fra teksterne. Karrieren er endelig og
forfaldet efter 28 tager over, så balance-prisen er lille — men den skal måles, ikke antages.

**Trin 3 — hæv det neutrale loft, sænk farten i stedet.** `0,45 × loft` som mur bliver til et
højt loft med meget lav rate. Samme udfald (en sprinter bliver ikke bjergrytter i en karriere),
modsat følelse. **Kræver harness** — se gates nedenfor.

Ingen af de tre er besluttet. De er et udgangspunkt for at blive rykket.

---

## Bindende for enhver balance-ændring (spec §4 — genforhandles ikke)

1. Forholds-gate kræver søster-gate på absolut niveau (#3561-læringen).
2. Median-aftale kræver hale-gate — og en nedre niveau-gate.
3. **Flow, ikke stock.** Generator-gates måler pr. kuld; beholdningen er survivorship-forvredet.
4. **Negativ-test:** enhver ny gate skal BEVISES at fejle på den defekte konfiguration.
5. **Snapshot før mutation** + dry-run-diff med absolutte deltaer forelagt ejeren.
6. Kalibrér mod utrænede/daterede populationer, aldrig mod den levende DB.

Harness-værktøjer der findes: `scripts/simulateSeasonDryRun.js` ·
`scripts/raceCompetitionScorecard.js` · `scripts/careerCurveSimulation.js` ·
`balanceSnapshot`-fixturen · `developmentProjectionHarness.js`.

## Hvad trin 3's harness skal svare på

- Hvad gør et højere neutralt loft + lav rate ved **karrierekurven** (bedste evne ved 16/22/28)?
- Ved **markedsværdier** (potentiale driver værdi) og dermed ved økonomien?
- Ved **race-balance** — bliver felterne mere ens, når alle kan lidt af alt?
- Ved **arketype-identitet** (#3503's G3-mål) — bliver den skarpere eller mere udvandet?
- Hvor lang tid tager det en sprinter at nå brugbar klatring? Svaret skal være "længere end en
  karriere", ellers er rolle-identiteten væk.

---

## Spørgsmål der skal stilles ejeren i sessionen (ét ad gangen, forslag først)

1. Skal en evne kunne vokse **uendeligt** langsomt, eller skal der findes et absolut tag den
   nærmer sig men aldrig når? (Sidstnævnte er dagens model minus den sidste tomme.)
2. Skal "hvor hurtigt" være **synligt som tid** ("+1 om ca. 4 dage") eller som **hastighed**
   (hurtig/langsom/næsten stillestående)? Tid er konkret men svinger med form og faciliteter.
3. Skal potentiale fortsat bestemme **hvor højt**, eller skal det bestemme **hvor hurtigt**?
   Det er den største af beslutningerne — den flytter hele #3564-kæden.
4. Hvad skal en manager kunne **gøre** ved en langsom evne? Faciliteter, staff, tid — eller
   skal svaret være "vælg en anden rytter"?
5. Skal akademi-ryttere og seniorer følge samme model? (#3583 siger hjælpen allerede er uklar.)

---

## Leverance fra sessionen

Et design-issue med: den valgte model, målte tal fra harnessen, et scorecard mod dagens
konfiguration, en negativ-test der beviser gaten virker, og en trinvis leveranceplan hvor hvert
trin kan shippes og måles for sig. Plus et forslag til spillerkommunikationen — det er en
ændring der skal forklares, ikke bare shippes.

## Kilder

#3659 · #3503 · #3682 · #3564 (spec §4, §11-12) · #3643 · #3644 · #3660 · #3649 · #3651 ·
#3592 · #3629 · #3616 · #3614 · #3634 · #2720 · #3456 · #3583 · #3623 ·
`backend/lib/dailyTraining.js` · `backend/lib/riderProgression.js` ·
`scripts/discord/.sweep-daily-2026-08-08.md` … `-13.md`
