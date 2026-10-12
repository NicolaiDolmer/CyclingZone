# #6490: godkendt membership-design efter L4

**Status: A godkendt 12/10; L1–L3 skal tilpasses sekventielt med review.**
[Ejer-go](https://github.com/NicolaiDolmer/CyclingZone/issues/6490#issuecomment-6118488960).
SSOT: [TRAINING_RULES](../../TRAINING_RULES.md). Dette er et addendum til det
[godkendte design](2026-10-11-6490-training-seen-design.md), ikke en ny spillerregel.

## Problem og måling

Den godkendte repræsentation med én tællerrække pr. rider_key låser samme række
fra forskellige rapporter. Rigtige PostgreSQL 17.11-transaktioner reproducerer
40P01 både ved blandede UPSERTs og ved flere statements med modsat nøgleorden.
Pr. event sortering er utilstrækkelig. [Native rapporter og metode](../../snapshots/6490/README.md).
L4's krav om ingen nye deadlocks er derfor ikke opfyldt, og L5 kan ikke bruges
til at godkende denne kandidat.

## Anbefaling A

Skift den interne projektion til **én række pr. rapport og eksakt rider_key**,
primærnøgle `(report_id, rider_key)` og et ikke-unikt indeks på `rider_key`.
Forskellige rapporter deler dermed ikke en tællerrække, de skal låse.
Skrivninger til samme rapport serialiseres allerede på kilderækken.

Bevar rå tekst/C-kollation, distinct inden for hver rapport, den atomiske
kilde/projektion-transaktion og markeret, genoptagelig backfill. Brug OLD/NEW
set-difference, så uændrede medlemskaber ikke omskrives. Boolean-læsere bruger
indekseret EXISTS; recovery-count bruger antallet af matchende rapportrækker.
Nul-tombstones bortfalder: ingen medlemsrække betyder intet hit. Spillerens
udbytte, timing, form/træthed, idempotens og historikbetydning ændres ikke.

En isoleret prototype består begge konflikter samt deduplikering, uændret
membership uden rewrite, rollback og delete. Dette er mekanismebevis. Der er
**ingen** påstand om samlet korrekthed eller kapacitet.

Prisen er flere projektionsrækker, proportionalt med rapportreferencer, og et
indeksinterval ved COUNT frem for én tællerrække. Lager, WAL, write- og read-
percentiler skal måles i L5; eksisterende tærskler sænkes ikke.

## Fravalgt alternativ B

Behold den nuværende repræsentation som blokeret kandidat og undersøg en anden
counter-låsestrategi. En samlet flush pr. statement løser ikke generelt flere
statements i samme transaktion. Global serialisering har umålte ventetids- og
lock-order-konsekvenser; at acceptere deadlocks med retry bryder den godkendte
testkontrakt. Ingen af delene anbefales uden et nyt målt design.

## Afgrænset fortsættelse ved A-go

1. Revidér de manuelle L1–L3-kandidater og SSOT til membership-kontrakten;
   bevar de eksisterende læseres præcise betydning og readiness før overgang.
2. Gentag deres semantik-, grants-, backfill-, parity-, restore-,
   TRUNCATE/cascade-, idempotens- og rollbacktests. Faste ure og nul falske GO.
3. Gentag hele L4 på native PG17, inklusive begge påviste konflikter,
   rolle-writes og source-rowkonflikter, med uafhængigt review.
4. Fortsæt først derefter L5's kapacitetsbevis. Stagingmiljøets schema/volumen
   skal stadig klargøres og verificeres; lokal prototype kan ikke erstatte det.

Ingen merge, prodændring, flagændring eller GIN-drop følger af et A-go. De
hidtidige separate ejergrænser består. Der bygges ingen spillervendt ændring,
så patch notes er ikke nødvendige for dette tekniske addendum.
