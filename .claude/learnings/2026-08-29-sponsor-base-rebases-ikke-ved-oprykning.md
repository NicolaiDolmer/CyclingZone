# Sponsor-basen rebases ikke ved oprykning (#4376) — og fejlen lærte spillerne en forkert regel

**Dato:** 2026-08-29 · **Område:** økonomi/sponsor · **Fundet af:** spiller (forum-tråd), ikke af en vagt

## Hvad skete der

En sponsoraftale prissættes mod `teams.division` som den er på **valg-tidspunktet**. Manageren
vælger midt i sæsonen — altså før op-/nedrykningen er skrevet. `expireAndRenewContracts` genberegner
ved aktivering **kun** `per_race_day_rate` (#2913); `guaranteed_base` bæres uændret med hele
løbetiden.

Målt mod prod 29/8: **36 af 230 hold** havde et kontrakt-target under deres divisions gulv —
**21 af 24 D1-hold**. Ét D1-hold kørte på D4's base (315.000) mens et korrekt baseret D1-hold fik
840.000. De ramte hold betalte D1-upkeep på 220.000 fra dag ét mod en sponsor prissat til D3.

## Hvorfor ingen opdagede det i tre måneder

1. **Der fandtes ingen invariant.** Reglen `base[div] ≤ renownTarget ≤ base[div] × 1,40` er triviel
   at tjekke og fanger fejlen på ét SELECT. Den var bare aldrig skrevet ned nogen steder, fordi
   sponsoren ikke havde et SSOT-dokument.
2. **Motoren gør det rigtige når manageren ikke gør noget.** Default-fornyelsen genererer et FRISKT
   tilbud mod den nye division, så de tre hold der ikke valgte selv fik korrekt base. Skellet er
   skarpt: sidste forkerte kontrakt tegnet 23/8 kl. 17:35, de tre korrekte kl. 18:22:19-18:22:38.
   Et stikprøve-tjek af "virker sponsoren?" ville ramme de rigtige tal i 3 ud af 24 forsøg.
3. **Designet tog aldrig stilling.** Spec 21/6 §4.3 siger at basen er låst i løbetiden — men den
   handler om at aftalen ikke skal følge dine RESULTATER. Divisions-ankeret blev aldrig holdt op
   mod den sætning. Fase-3-spec'en 5/7 siger derimod ordret at "højere sponsor-base er opsiden" ved
   oprykning. To dokumenter, to svar, ingen der opdagede at de var uenige.

## Den dyreste konsekvens var ikke pengene

To erfarne spillere skrev i forum-tråden at sponsoren betaler **det samme i alle divisioner** — den
ene tilføjede at han havde påpeget det urimelige i det tidligere og aldrig fået svar. De læste data
korrekt. Med 36 hold på et fremmed anker var den observerbare spredning mellem divisionerne
kollapset. **Fejlen havde lært spillerne en forkert regel om spillet**, og den regel var på vej til
at blive etableret sandhed i community'et.

Det er den egentlige omkostning ved en langtidslevende balance-fejl: ikke det udbetalte beløb, men
at spillerne bygger deres strategi på en model der ikke findes.

## Hvad der blev gjort

Reglen blev ikke valgt af os. Ejeren stillede spørgsmålet direkte i #staff-chat, og de to mest
engagerede spillere svarede begge at en aftale skal være låst "på godt og ondt" — men begge åbnede
for at op-/nedrykning **justerer lidt**. Det blev til divisions-tillægget: aftalen røres ikke, og en
separat korrektion på 0,5 × forskellen mellem de to divisioners baser lægges oveni.

Faktoren 0,5 er ikke valgt for at være pæn: den er `PARACHUTE_FACTOR`, så fradraget ved nedrykning
ophæver nedrykningsfaldskærmen **eksakt**. Det fjerner samtidig et andet fund — at 4 hold fik
faldskærm for et sponsor-fald deres låste aftale forhindrede i at ske.

## Forward-guards der landede med fixet

- `divisionAdjustment.test.js` fejler hvis faktoren afkobles fra `PARACHUTE_FACTOR`, eller hvis
  fradrag + faldskærm ikke summer til nul. Symmetrien er en test, ikke en kommentar.
- `divisionAdjustmentParity.test.js` fejler hvis frontendens projektion afviger fra motoren for
  nogen kombination af divisioner.
- `signed_division` **lagres** på kontrakten. Den nærliggende genvej — rekonstruér fra
  `season_standings` i sæsonen før `start_season` — er udefineret for 23 af 230 hold, fordi de blev
  oprettet midt i en sæson. En rekonstruktion der virker for 90 % er en fejl der venter.

## Efterspil: rekonstruktionen var ikke bare ufuldstændig, den var forkert

Backfillen i migrationen brugte den samme standings-rekonstruktion — og den er **forkert for 38 af
230 aktive kontrakter**, ikke bare tom for 23. Årsagen er sekvensen ved et sæsonskifte:
komprimeringen skriver den nye division **før** `expireAndRenewContracts` genererer default-aftaler.
En transitions-skabt kontrakt er derfor prissat mod holdets NYE division, mens dets standing fra
forrige sæson stadig peger på den gamle.

Konkret: et hold med `guaranteed_base` 772.800 — altså target 840.000, som kun kan komme fra
D1 × 1,40 — fik standings-division 3. Backfillen ville have udløst +130.000 til et hold der
allerede var korrekt baseret. På tværs af populationen: ~924.000 CZ$ udbetalt til hold uden noget
misforhold, og forskellen mellem 79 og 54 berørte hold.

**Hvordan det blev fundet:** ikke af en test. Ejeren bad om en gennemgang af hvordan tillægget
rammer de mest aktive hold, og i den tabel stod et hold med en sponsorudbetaling på 927.360 — et
tal der kun kan opstå fra en D1-base — ved siden af kolonnen "prissat i D3". De to tal kunne ikke
begge være sande.

**Læren, som er skarpere end den ovenfor:** en rekonstruktion fra en anden tabel er en *hypotese om
en historisk tilstand*, ikke en måling af den. Den skal valideres mod noget rækken selv bærer.
Her fandtes valideringen allerede — invarianten `base[d] ≤ target ≤ base[d] × 1,40` stod i
`SPONSOR_RULES.md` §1, skrevet samme dag. Jeg brugte den bare ikke på min egen backfill.
Reglen er nu: kandidat-divisioner fra båndet, standingen vinder kun hvis den er blandt dem,
entydig enekandidat ellers, og NULL frem for et gæt.

**Og den generelle:** at bede om en gennemgang af hvem der rammes er ikke rapportering — det er
verifikation. Tabellen fandt en fejl to tests og en grøn preflight ikke fandt.

## Den generaliserbare lære

**Et område uden SSOT producerer regler der kun findes som hensigter.** Den samme audit fandt fem
andre steder hvor en truffet beslutning ikke gjorde det den sagde — heriblandt et bestyrelsesmål der
matematisk aldrig kan opfyldes (`teams.sponsor_income` = 240.000 for alle 230 hold) og et
sponsor-loft på `/rules` som ingen kode håndhæver. Ingen af dem var svære at finde. De var bare
aldrig blevet ledt efter, fordi der ikke fandtes et dokument der påstod noget man kunne modbevise.

Konkret: **skriv invarianten ned samtidig med reglen.** En regel uden en maskinlæsbar invariant er
en hensigt, og hensigter driver.

Se `docs/SPONSOR_RULES.md` (SSOT) og
`docs/audits/2026-08-29-sponsor-board-decision-inventory.md` (beslutnings-arkæologien, 8 fund).
