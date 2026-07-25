# Notifikation bundet til en tilstands-OVERGANG kan efterlade hele straf-kæden tavs

**Dato:** 2026-07-25 · **Issue:** [#2976](https://github.com/NicolaiDolmer/CyclingZone/issues/2976) (fundet under [#2912](https://github.com/NicolaiDolmer/CyclingZone/issues/2912), PR [#2975](https://github.com/NicolaiDolmer/CyclingZone/pull/2975))

## Symptom

Et hold med gæld over divisionsloftet 2 sæsoner i træk fik sin dyreste rytter
tvangssolgt af `processTeamSeasonPayroll` uden nogen form for besked. Manageren
kunne logge ind og opdage at truppen var mindre, uden at kunne se hvorfor.

## Rod-årsag (to lag, ikke ét)

1. **Selve tvangssalget havde aldrig en notifikation.** Grenen krediterede,
   flyttede rytteren, afdragede lån og loggede til konsollen. Konsol-log er ikke
   spiller-vendt kommunikation.

2. **Advarslen fandtes, men var bundet til den forkerte betingelse.** #2912
   tilføjede dagen før en frysnings-besked ved streak 1, og den advarer eksplicit
   om det kommende tvangssalg. Men den er gated på
   `transferFrozen && !alreadyFrozenBeforeDebtBranch`, altså på *overgangen* til
   frosset. Et hold der allerede var frosset af nødlåns-eskaleringen (#2301)
   ramte aldrig den overgang. For dem var hele kæden tavs: streak 0 til 1 gav
   ingen besked, og streak 1 til 2 tog rytteren.

Lag 2 er den interessante: en notifikation der *findes* og ser dækkende ud, men
hvis gate deler variabel med et andet delsystem, dækker kun den ene indgangsvej.

## Fix

Gældseskaleringen sender nu præcis én besked pr. kørsel, valgt efter hvad der
faktisk skete: tvangssalg (navngiver rytterne) > frysnings-overgang > sidste
varsel ved første brud uanset frysnings-tilstand. Den tredje gren er den der
lukker hullet; de to første er gensidigt udelukkende med den, så ingen får to
beskeder om samme begivenhed.

## Læring

- **Notifikationer på "overgang" skal spørges: overgang i hvilken variabel, og
  hvem andre skriver i den?** `transfer_frozen` deles af nødlåns-eskaleringen og
  gældsloftet. Så snart to delsystemer deler en kolonne, er "har den ændret sig"
  ikke længere det samme som "er der sket noget nyt for brugeren".
- **Advarsel før straf er en selvstændig kontrakt, ikke en bivirkning.** Varslet
  må ikke være en sætning inde i en anden besked hvis den anden besked kan udeblive.
- **Test straffe-kæden fra begge indgangsveje.** #2912's egne tests dækkede
  overgangs-vejen og bestod; den allerede-frosne vej var utestet og tavs.
- **Idempotency-skip er ikke det samme som "allerede gjort".** Ved tvangssalget
  betyder et skip at pengene er bogført mens rytteren stadig står på holdet, så
  netop dér må beskeden IKKE sendes. "Vi solgte X" ville være usandt.
