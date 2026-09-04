# Løbs-afslutningen var ikke atomar, og det hul der gjorde mest skade var ikke det man så

**Dato:** 2026-09-04 · **Issue:** #4147 · **PR:** #4767

## Hvad der var galt

Afslutningen af en etape er en kæde af skrivninger: result-write, standings, matview-refresh, berigelse, træthed, board-weekend, notifikationer, status-flip. Dør processen midtvejs, er de trin der nåede at køre committet, og resten sker aldrig. Der var intet der huskede hvor langt man kom.

Det synlige symptom 23/8 var Gran Premio de Llanera division 9: resultater skrevet, præmier beregnet, `status` stadig `scheduled`. Det blev opdaget ved en manuel gennemgang, ikke af systemet.

## Det der faktisk gjorde mest skade

Backwards-checket fandt en anden klasse, som ingen havde ledt efter: **34 etaper med skrevne `race_results` og INGEN `race_simulation_runs`-række** (S1 29, S2 4, S3 1), de nyeste også med 0 `race_incidents`. Berigelsen kørte aldrig og kunne aldrig køre igen.

Årsagen er værd at holde fast i: `apply_stage_result`-RPC'en (#1598) bumper `stages_completed` ATOMÆRT sammen med result-writen. Det lukkede ét crash-vindue - og åbnede et andet. Efter bumpet peger scheduleren på næste etape, og den halve etape har intet slot der peger tilbage på den. Recovery-stien fra P0 2/7 fangede kun løb hvor ALLE etaper var kørt, så en mellem-etape var permanent tabt.

**Læringen:** en atomær write der også flytter en fremadrettet markør gør det umuligt at genoptage alt det der ligger EFTER writen. Atomaritet på ét trin er ikke det samme som atomaritet på kæden, og det kan aktivt skjule at kæden er brudt.

## To fejl testene fandt, som review ikke ville have

1. **Fejl-swallow slugte også markerings-skrivningen.** Standings-trinnet var pakket ind i en `.catch(() => {})` for at bevare #2877-adfærden (en standings-fejl må ikke vælte berigelsen). Men markerings-skrivningen lå inde i samme blok, så et simuleret SIGKILL under den blev usynligt og kørslen fortsatte til status=completed. Fixet var at flytte markeringen ud af den swallowende blok og markere på et eksplicit `standingsOk`-flag. **En catch-all der dækker mere end den fejl den blev skrevet til, skjuler den næste fejl der lander i samme blok.**

2. **`completed` + ufuldstændig markering kastede "already simulated".** Gen-afviklings-guarden (FIX 3) kunne ikke skelne "nogen prøver at køre løbet om" fra "den samme afslutning kom tilbage for at gøre de sidste trin færdige". Fixet er at guarden nu spørger om der findes en `write`-markering for præcis denne etape.

Begge blev fundet fordi testen simulerer afbrydelse efter HVERT trin, ikke efter et repræsentativt udvalg. De to fejl lå i trin 2 og i et randtilfælde efter trin 8.

## Metoden der virkede

Brug markerings-skriveren som crash-injektor: persistér markeringen, kast derefter. Det er præcis rækkefølgen ved et SIGKILL lige efter et trins commit - det farligste tidspunkt at dø på, fordi trinnet ER kørt og næste kørsel derfor SKAL springe det over. Kør så samme etape igen mod den samme markerings-butik og tæl hvert sideeffekt-bærende kald over BEGGE kørsler.

## Design-detaljen der gør genoptagelse forsvarlig

Simuleringen er seedet (`stableSeed(raceSeedInput(race.id, stageNumber))`) og feltet er frosset til etape-1-snapshottet (#1844). Uden det ville en genoptagelse producere andre rækker end dem der allerede står i `race_results`, og berigelsen ville modsige resultaterne. Determinisme var indført af en helt anden grund (#2072) og viste sig at være forudsætningen for at kunne genoptage overhovedet.

Trinnene deles i to: idempotente markeres efter SUCCES (fejler de, køres de om), engangs-trin (`fatigue`, `rest-day`, `notify`) markeres efter FORSØGET. De akkumulerer på `rider_condition.fatigue` eller sender udad; en manglende skrivning er billigere end en dobbelt.
