# Postmortem · 2026-08-14 · Akademi-flyt forkortede kontrakter igen (#3620)

## Hvad skete der?

Spillere rapporterede to gange i Discord-forummet #bugs, EFTER at #2881 var
lukket med "0 ramte i prod":

- **@thelamba, 10/8 20:38 UTC:** "the riders I had extended to season 5 are now
  season 4 instead", efter at have "shuffled around" i akademiet.
- **@egomadsen, 12/8 18:51 UTC:** "Promoted an academy rider with season 5 to
  senior and now he is season 3."

To forskellige tal (minus 1 og minus 2 sæsoner) fra to forskellige spillere.
Hypotesen i issuet var, at forkortelsen afhang af hvor længe rytteren havde
ligget i akademiet. Den holdt ikke: det var **to uafhængige fejl på hver sin
kodesti**, som tilfældigvis giver hver sit tal i sæson 2.

## Root cause

### 1. promote(): guarden blev udvidet, SELECTen fulgte ikke med

`contractOnAcquirePatch` er hele erhvervelses-invarianten (#1309):
"kontraktløs rytter giver frisk standardkontrakt; eksisterende kontrakt arves
UÆNDRET". PR #2929 (25/7) fik `academyTransfer.js promote()` til at bruge den,
og en regressionstest låste adfærden fast.

Senere samme dag udvidede PR #2933 (#2894/#2902) guarden fra

```js
if (rider && rider.salary != null) return {};
```

til

```js
if (rider && rider.salary != null && rider.contract_end_season != null) return {};
```

`promote()`s rider-SELECT hentede aldrig `contract_end_season`. Feltet var
derfor `undefined`, og `undefined != null` er **false**. Fra det øjeblik var
guarden permanent falsk på netop den sti: promote regenererede **hver eneste**
kontrakt, `contract_length` 3 til 2 og `contract_end_season` til aktiv sæson
plus 1. I sæson 2 giver det udløb i sæson 3, altså @egomadsens 5 til 3.

Ingen af de to PR'er var forkerte hver for sig. Fejlen opstod i mellemrummet:
den ene ændrede *hvilke felter guarden læser*, den anden ejede *hvilke felter
kalderen henter*, og der var intet der koblede de to.

### 2. demote(): kontrakten blev nulstillet på vej ind i akademiet

`demote()` skrev ubetinget en frisk 3-sæsoners akademi-kontrakt forankret i den
**aktuelle** sæson (`computeContractEndSeason(seasonNumber, 3)`). I sæson 2 giver
det sæson 4, uanset hvad rytteren havde i forvejen. Det er @thelambas 5 til 4.

Det blev faktisk fundet under #2881 og noteret som "ligner bevidst design (frisk
3-sæsoners ungdomsaftale), men flag'et hvis det skal ændres", og så aldrig
afgjort. Et flag uden en beslutning er ikke en beslutning; symptomet blev i
mellemtiden rapporteret af spillere.

## Evidens (prod, read-only, 14/8, aktiv sæson 2)

Fordelingen af kontraktfelter for ryttere med en `academy_promoted`-notifikation,
grupperet efter hvornår de blev promoveret:

| Promoveret | length=2, end=3 | length=3 |
|---|---|---|
| før 25/7 (før #2933) | **0** | 71 |
| sæson 2 (fra 27/7) | **20** | 12 |

`length=2, end=3` er præcis `contractOnAcquirePatch`s signatur i sæson 2
(`DEFAULT_ACQUIRE_LENGTH=2`, `end = 2 + 2 - 1`). Signaturen findes ikke én eneste
gang før #2933 og 20 gange efter. De 12 med `length=3` har efterfølgende fået
forlængelser.

Demote-siden: `Feng F. Gao` fik en `academy_demoted`-notifikation
**2026-08-10 20:37:42 UTC**, 56 sekunder før @thelamba skrev sin besked.

Der findes ingen historik-tabel for kontraktfelter, så før-værdierne kan ikke
læses. Reparation af de allerede forkortede kontrakter er derfor et separat,
ejer-gated spørgsmål.

## Hvorfor fangede regressionstesten det ikke?

Den mockede Supabase i `academyTransfer.test.js` ignorerede kolonne-listen og
returnerede hele fixturen. Fixturen `ACADEMY_RIDER_WITH_SURVIVING_CONTRACT` havde
`contract_end_season: 3`, så testen fodrede `contractOnAcquirePatch` et felt som
produktionens SELECT aldrig hentede. Testen beviste logikken oven på et objekt
ingen rute nogensinde bygger, og stod grøn hele vejen igennem.

Det er samme klasse som [[feedback_test_real_endpoint_not_just_mocked]]: en mock
der ikke håndhæver sin egen kontrakt, beviser ingenting om kontrakten.

## Fix

1. `contractSeed.js`: `contractOnAcquirePatch` **kaster** nu, hvis `salary` er sat,
   men nøglen `contract_end_season` slet ikke findes på objektet. "Kolonnen blev
   ikke SELECT'et" (`undefined`) må aldrig kunne læses som "rytteren har ingen
   kontrakt" (`null`). Det gør hele fejlklassen umulig fremover: en glemt kolonne
   fejler højlydt i stedet for at regenerere en kontrakt i stilhed.
2. `academyTransfer.js promote()`: henter nu `contract_length` og
   `contract_end_season`.
3. `academyTransfer.js demote()`: kontrakt-TERMEN arves uændret, hvis rytteren har
   en komplet kontrakt; kun en kontraktløs rytter får akademi-aftalen. Lønnen
   gen-beregnes uændret (#2083/#2594). Promote og demote er dermed hinandens
   inverse på termen, og en tur gennem akademiet kan hverken forkorte eller
   forlænge en kontrakt.
4. Backwards-check af alle 11 kaldesteder for `contractOnAcquirePatch`: tre andre
   havde samme manglende kolonne og er rettet.
   `transferExecution.js` (swap-stien; køb-stien fik kolonnen i #1836),
   `squadEnforcement.js` (auto-køb-kandidater) og
   `api.js /admin/override-rider`. Auktions-stierne henter `rider:rider_id(*)`
   og var aldrig ramt.

## Forhindret-fremover

- Mocken i `academyTransfer.test.js` **projekterer** nu fixturen ned til de
  kolonner kalderen faktisk beder om, som PostgREST gør. Negativt kontrolforsøg
  kørt: med den gamle SELECT fejler #2881-regressionstesten (6 af 20 tests
  falder). Før projektionen fejlede den ikke.
- Eksplicit test på at `promote()`s SELECT indeholder kontrakt-kolonnerne, så et
  fremtidigt trim af listen fejler med en læsbar besked.
- Test på demote-til-promote-rundturen: termen skal være urørt begge veje.
- `contractSeed.test.js` låser guarden fast i begge retninger: manglende kolonne
  kaster, eksplicit NULL heales (uændret #2902-adfærd).

## Læring

Når en delt guard udvides til at læse **et felt mere**, er ændringen ikke færdig
i guarden. Den skal følges hele vejen ud til hvert eneste sted, der bygger det
objekt guarden læser. Et felt der ikke blev hentet, ser i JavaScript nøjagtig ud
som et felt der er tomt, og en `!= null`-guard kan ikke se forskel. Derfor skal
guarden selv afvise det tvetydige input i stedet for at gætte: `"felt" in obj` er
det tjek, der skiller "ikke hentet" fra "tomt".

Sekundær læring: et fund, der noteres som "ligner bevidst design, flag'et hvis det
skal ændres" og aldrig besvares, er en åben bug med en pæn etiket. Enten træffes
beslutningen, eller også bliver den til et issue med en ejer.
