# Manuel-only SQL i auto-migrate-globben blev kørt mod prod ved merge

**Dato:** 31/8 2026 · **Refs:** #4482, PR #4508, PR #4524

## Hvad skete

PR #4508 indeholdt et oprydningsscript (`database/2026-08-31-expire-stale-bonus-offers-4482.sql`) hvis header
eksplicit sagde at det IKKE måtte køres automatisk - spillerbesked skulle ud først (ejer-beslutning). Men filen
lå i `database/2026-*.sql`, som `.github/workflows/auto-migrate.yml` auto-applier mod prod ved push til main.
Orkestratoren læste headeren, besluttede korrekt ikke at køre scriptet manuelt - og mergede PR'en. 3 minutter
senere kørte CI scriptet: alle 36 gamle bonustilbud udløb i prod uden ejerens go og uden spillerbesked.

## Rod-årsager

1. **Forfatteren** (natbølge-worker) lagde et manuel-only-script i auto-stien - en fil-placering var en
   eksekverings-beslutning, uden at nogen så det sådan.
2. **Orkestratoren** verificerede scriptets indhold men ikke stien's semantik: "jeg kører den ikke" er ikke
   det samme som "den bliver ikke kørt". Auto-apply-mekanismer skal tælles med i konsekvensanalysen af en merge.

## Sekundært fund (fanget i oprydningen)

Selve #4508-wiringen havde en følgefejl: sæson-slut-tilbud stemples med den afsluttende sæson, som udløbs-hooket
netop udløber - fremtidige sæson-slut-tilbud ville dø øjeblikkeligt i samme transition. Fixet (Regel A, PR #4524)
havde aldrig fundet fejlen uden uheldets måling.

## Forward-guards (implementeret i PR #4524)

- auto-migrate fejler hårdt hvis en pending fil bærer manuel-only-markøren (`KØRES IKKE AUTOMATISK` / `MANUAL-ONLY`).
- Manuelle scripts bor i `database/manual/` - uden for globben. Det gamle script er flyttet derhen.

## Læring

Før merge af ENHVER PR med filer i `database/2026-*.sql`: læs filens header. Er den ikke ment til auto-kørsel,
skal den flyttes til `database/manual/` FØR merge. CI-vagten fælder det nu, men reglen gælder også reviews af
vagten selv.
