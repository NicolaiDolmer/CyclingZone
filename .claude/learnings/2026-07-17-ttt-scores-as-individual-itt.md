# TTT (holdtidskørsel) scorede som individuel enkeltstart

## Root cause
`terrainBucket("ttt")` i `backend/lib/raceTerrain.js` mapper "ttt" → "itt" for
score-formål. Race-simulatoren har ingen ægte hold-TTT-mekanik (delt starttid,
holdets samlede tid, drafting-effekt) — så ni ryttere fra samme hold fik hver
deres individuelle enkeltstarts-tid i en TTT-etape. Synligt forkert for enhver
cykelfan.

## Fix (#2411)
Fjernede "ttt"-filler-vægten (var 2) fra `grand_tour`-arketypen i
`backend/lib/raceStageProfileGenerator.js` — den eneste arketype der kunne
rulle ttt. Fremtidige genereringer producerer nu kun "itt" for enkeltstarter.

## Bevidst IKKE gjort
- Ingen migration/data-write: eksisterende persisterede parcours med ttt-etaper
  (verificeret: 1 fremtidig scheduled løb, "Tour de l'Hexagone" div. 1, stage 14)
  er urørt. Regenerering er ejerens beslutning.
- Ingen ægte hold-TTT-simulering bygget — det er et separat, større fremtidigt
  issue (delt starttid + holdtid + drafting).

## Læring
Når en terræn-type bucket'es til en ANDEN type for scoring-formål
(`terrainBucket`), betyder det scoringen ikke matcher terrænets navn 1:1 —
tjek altid om bucket-mappingen faktisk giver mening for den specifikke
terræn-type, ikke kun at den "scorer et eller andet".
