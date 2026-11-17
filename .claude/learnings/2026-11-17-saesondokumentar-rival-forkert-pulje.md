# Postmortem · 2026-11-17 · Sæsondokumentaren valgte rival fra en anden pulje

## Hvad skete der?
Sæsondokumentaren (teksten hvert hold får ved sæsonskiftet) nævnte i sæson 4 oftest en "rival" fra en anden pulje, og et topresultat uden sejr blev skrevet som "vandt sammenlagt". Teksterne var usande for spilleren.

## Root cause
`rival`-CTE'en i `get_season_documentary_facts` filtrerede på `division`, ikke på puljen (`league_division_id`), og grammatikken stolede blindt på facts. Placering og sejr delte samme sætningsskabelon.

## Fix
PR #8369 (merget 17/11, `a670a59f`): migration `database/2026-11-17-8361-season-documentary-rival-same-pool.sql` (rival = nabo i samme pulje, ingen AI-/bank-/testhold), grammatikken tjekker pulje og nabo-rang igen, placeringer skrives som placeringer. Migrationen er applied og verificeret i prod 17/11 aften.

## Forhindret-fremover
PGlite-test med den ægte migration (to puljer i samme division, AI-nabo, hold uden pulje) og tone-test over alle varianter. Efter sæsonskiftet 28/11 læses en sæson 5-dokumentar i prod (#8361).

## Læring
Tekst, der genereres automatisk for alle hold, skal have en test, der beviser, at hver påstand er sand for netop det hold (samme pulje, samme løb), ikke kun at sætningen kan dannes.
