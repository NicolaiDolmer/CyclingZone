# En "skal-være-fuld-for-at-gemme"-regel brækker rearrange/move-flows + stale-binding-fælder

**Dato:** 2026-06-26 · **Issues:** #1906/#1823/#1800 (#1924), #1925/#1932 · **Type:** design-interaktion + rod-årsag

## Hvad skete der

To sammenhængende ting i holdudtagelses-arbejdet:

1. **Ghost-rod-årsag (#1924):** committede `race_entries` blev ikke krydset mod rytterens NUVÆRENDE tilstand på ALLE binding/lås-stier — kun 2 af ~6. En solgt/fyret/akademi/pensioneret/udlånt rytter phantom-bandt en ægte rytter → 409 "kan ikke gemme opstilling" + dobbeltbooking. #1893 fiksede 2 stier; resten lækkede.

2. **Reglen brækkede en nabo-arbejdsgang (#1925→#1932):** #1924 indførte "fuld opstilling KRÆVES for at gemme". Det brækkede "flyt rytter mellem to overlappende løb": at fjerne rytteren fra løb A gjorde A underbemandet → kunne ikke gemmes → server-bindingen opdateredes aldrig → popoveren (som læste GEMT binding, ikke kladden) blokerede løb B. En kladde-bevidst popover alene var ikke nok: backend afviste at gemme B mens A's DB stadig bandt rytteren, og A kunne ikke gemme underbemandet for at frigive ham. Krævede en atomisk **move**-operation (`move_race_entry`-RPC) + kladde-bevidst binding.

## Læring (forward-guards)

- **Når du indfører en "skal-være-komplet-for-at-gemme"-regel, audit ALLE flows der efterlader en mellemtilstand:** rearrange/flyt/bytte mellem enheder, fjern-uden-erstatning. En global completeness-gate gør per-enhed-mellemtilstande ugemmelige → arbejdsgange der bygger på dem brækker stille. Tilbyd en atomisk multi-enheds-operation (move/swap) for de flows.
- **Stale binding/lås fra GEMT state vs. live UI-kladde:** hvis UI'et har en lokal kladde-model men låse/binding kommer fra serverens gemte snapshot, divergerer de så snart kladden ikke kan gemmes. Udled afledte tilstande (binding, lås, "tilgængelig") fra den EFFEKTIVE (kladde-overlejrede) tilstand, ikke kun server-snapshottet.
- **"Anvend invarianten på ALLE stier, ikke kun de oplagte":** da #1893 kun dækkede 2 af ~6 race_entries-læse-stier, overlevede rod-årsagen. En udtømmende discovery (find ALLE call-sites) + adversarisk completeness-kritik fangede de resterende. Brug det mønster for invariant-fixes (#1924's loader rutede ALLE binding-læsninger gennem ét eligibility-lag).
- **Verificér migrationen er APPLIED, ikke kun merged:** Auto-migrate-jobbet kører apply-trinet ~3 min inde i kørslen; en pg_proc/trigger-tjek umiddelbart efter merge er for tidligt. Tjek `pg_proc`/`pg_trigger` efter jobbet er grønt OG apply-trinet er logget ("✅ ... applied + recorded").
