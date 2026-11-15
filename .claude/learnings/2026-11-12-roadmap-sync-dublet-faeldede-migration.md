# Roadmap-sync oprettede en dublet, og roadmap-migrationen fejlede efter merge (12/11)

## Hvad skete der
Roadmap-pakken (#8057, `database/2026-11-12-8051-roadmap-pakke.sql`) fejlede i auto-migrate efter merge med `forkert sluttilstand paa 00006149-...-25` og rullede sig helt tilbage. Spillerne så auto-accept to gange på roadmappet fra kl. 16:44 dansk tid.

## Rodårsag
To af samme dags ændringer stødte sammen:
1. #8058 gav `market-auto-accept` roadmap-tekst i `docs/FEATURE_REGISTRY.yml`. `scripts/roadmap-sync-registry.mjs` er nøglet på `flag_key` og oprettede en NY række med `flag_key = 'auto_accept_enabled'`, fordi ingen række bar nøglen.
2. Roadmap-pakken ville koble samme kontakt på den række, spillerne har stemt på. Dens UPDATE springer over, når en anden række bærer nøglen, og slutkontrollen stoppede transaktionen.

ROLLBACK-beviset for pakken var taget FØR #8058 blev merget, så det dækkede ikke den tilstand, filen mødte.

## Hvorfor det ikke blev fanget
- Beviset mod prod var flere timer gammelt, da filen blev merget.
- Ingen af de to veje til et roadmap-punkt (registry-sync og håndskrevet migration) kender den anden.
- De to PR'er blev merget i samme tog-omgang uden at nogen så, at de rørte samme roadmap-punkt.

## Hvad der virkede
Filens egne vagter og slutkontrol: hele pakken rullede tilbage, og ingen stemmer blev rørt. Fejlmeddelelsen pegede på den præcise række.

## Regel fremover
- En datamigration med slutkontrol mod prod-tilstand får sit ROLLBACK-bevis taget på ny LIGE FØR merge, hvis noget andet er merget siden beviset.
- Når en registerpost får roadmap-tekst, og der allerede findes et stemt punkt for samme funktion: migrationen, der kobler kontakten på det stemte punkt, merges FØRST, eller dubletten håndteres i migrationen.
- Forebyggelse i koden: #8065 (sync genkender et eksisterende punkt på `issue_ref`, før den opretter et nyt).

Rettelse: #8064.
