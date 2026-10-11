# Næste session: stabilitet + Udvikling 2.0 (+ sæsonskiftets værdier og spillernes småting)

Planlagt 11/10 sammen med ejeren (svar 11/10 ca. 12:15). Ejeren er med fra start. Alle beslutninger herunder er hans. Genåbn ingen af dem.

## Startprompt (kopiér ind i en ny Claude Code-session)

```
Ny session efter docs/sessions/2026-10-12-stabilitet-og-udvikling.md. Læs FØRST den fil, derefter docs/NOW.md, docs/MASTERPLAN.md og issue #6110 inkl. kommentarer. Jeg er med fra start. Rækkefølge: (1) GØR FÆRDIG det, sessionen 11/10 stoppede midt i (afsnit "Overdraget"): genoptag #6464-sporet (draft-PR #6465, revision official_times_v4) i en bølge og før det helt til et tænd-kort til mig senest 12/10 kl. 11:00, så de 37 løb kl. 12 får det; send mig før/efter-billedet for #6384 (PR #6466) til merge-go. (2) Start i samme bølge stabilitets-sporene (#5162 #5911 #6184) og småting-lanen. (3) Tag Udvikling 2.0-beslutningerne D1-D7 med mig ét kort ad gangen med billede, mens bølgen kører. (4) Sæsonskiftets værdier (#5842) som kort. (5) Byg Udvikling 2.0, når D1-D7 er besluttet. Formtoppe (#6156 #6158) er IKKE med. Afbryd aldrig et igangværende spor uden at jeg beder om det; nye ting skrives ind i overdragelsen. Svar på dansk.
```

## Mål for sessionen

1. **Stabilitet, hurtigt** (ejer 11/10: "skal fikses meget hurtigt"): ingen sider der fryser efter en opdatering, aftentræningen færdig på under 2 min, ingen tusindvis af timeouts.
2. **Udvikling 2.0** (ejer: "inden for de kommende dage", spillernes nr. 1-klage): beslutninger D1-D7 truffet og bygget. Løbstræning skal kunne betale sig mod at blive hjemme.
3. **Sæsonskiftets værdier** (#5842): værdier og evner står stille ved skiftet 25/10. Løses i samme omgang som udviklingen (ejer 11/10).
4. **Spillernes småting** i én lane ved siden af, med før/efter-billede pr. UI-ændring.

## Spor (bølge, maks 4 laner, opus på motor/DB/penge)

| Lane | Issues | Hvad | Ejer-go |
|---|---|---|---|
| A · Sider der fryser | #5162 (epic, CYCLINGZONE-56) | Rest af rettelsesplanen; 4 spillere ramt 10/10 på auktionssiden | teknisk, merge ved grøn CI + review |
| B · Aftentræning < 2 min | #5911 | Start straks efter sidste etape, færdig på under 2 min | teknisk |
| C · Timeouts | #6184 (PostgREST ca. 3.000/døgn) + #5878 rest | Rodårsag, ikke flere timeouts; compute-beslutning er ejerens | compute = ejer |
| D · Småting | #6385 #6473 #5919 (notifikationer), #6474 #6181 (økonomi), #5843 #5943 #6206 #5903 (U23/junior), #6475 ("Long day") | Én ad gangen, ældste spillerklage først | UI = før/efter-billede før merge |
| E · Udvikling 2.0 | #6110 (#3564 #5950 #6109 #6059 #5965 #6248) + #5842 | Bygges EFTER D1-D7 | design-go pr. D |

## Beslutningskort (ét ad gangen, med billede, nøgletal i spørgsmålet)

- D1-D7 fra #6110 (kurve, tempo, rollevægte på løbsdagen, tilbagegang, eksisterende ryttere, AI-ryttere, indfasning). Spiller-signal 11/10 (friisisch): "løbstræning skal give lige så meget som at blive hjemme"; unge udvikler sig for hurtigt, ældre for langsomt.
- #5842: værdier ved sæsonskiftet (ingen værdiskrivning, ét fast tidspunkt; PR #6403 findes).

## Overdraget fra sessionen 11/10 (lukket kl. ca. 11:45; gør disse FØRST)

1. **#6464 + #6456 bjerg-tidsgab (vigtigst, frist 12/10 kl. 11:30):** branch `fix/6464-mountain-gaps-all-divisions`, draft-PR #6465, ny slukket revision `official_times_v4`. Lanen blev stoppet midt i kalibreringen (rent og pushet). Genoptag sporet i en bølge (allowExistingPr), få tal på prod-felter pr. division + Giro + Tour-cache, kør gaten (`cleanRevisionGate --revision=official_times_v4 --baseline=official_times_v3`) og hele backend-suiten på en LOKAL kombination med v4 sat som current, Fable-dom (read-only, model fable), så tænd-kort til ejeren. Flip = separat PR med migration (mønster: #6453 + #6460 patch note). 37 løb starter 12/10 kl. 12 (18 med bjerg); når den ikke at blive tændt, kører de på v3.
2. **#6384 tidsgab i ungdoms-/holdklassement:** PR #6466 (ikke draft) har før/efter-billede; send billedet til ejeren som fil og merge kun på hans visuelle go.
3. **Tour-drift (official_times_v3):** e1 som testet. Tjek e2 (11/10 17:00, flad) og især bjerg e8 (13/10 13:00) og højfjeld e12-13 (15/10) mod testbænken (`balance-internals/motor-bench/bench-main-live.json`).
4. **#6470 træningsafstemning:** dry-run viste ingen reparation. Tjek efter aftentræningen 11/10, at rytteren `09b377d9…` er afregnet for 11/10 og at der ikke er nye `needs_reconciliation`; luk så.
5. **#6472 rullende etaper** og **#6471 rutematch følger ikke motoren:** mål før der bygges.
6. **#6476 svar-sløjfen:** 4 ubesvarede i feedback-formularen + 10 spillersvar; hjælp ejeren inden for de kommende dage.
7. **Discord:** patch 7.354-7.355 i `docs/drafts/discord-patch-7354-7355-2026-10-11.md` (ejeren poster selv).
8. **Mandag 12/10:** betaling #4511 #4514 #4512 + Sentry CYCLINGZONE-62 (faktura 63 dage over forfald, ét Pro der ikke passer).
9. **Issue-labels:** v3-issues er sat `claude:done` 11/10; ejeren lukker selv. #6327 og #6450 er klar til lukning.

## Ikke i denne session

- Formtoppe (#6156 #6158), ejer 11/10.
- Taktik i lag 2-4 (#5573 #5574), holdtidskørsel (#3463): "Senere" på roadmappet.
- Løbsfilm-backfill (#3856) og intra-etape-motor (#3855): S5/S6.

## Faste regler

- Parallelbyg kun via `wave.js`; ingen håndskrevne Agent-spawns udover `READ-ONLY:`.
- Ingen prod-mutationer, migrationer eller tændinger uden ejerens ordrette go pr. skridt.
- Hver UI-ændring: ét annoteret før/efter-billede, sendt som fil, før merge-go.
- Nøgletal i selve spørgsmålet; ét kort ad gangen.
- Close-out som i CLAUDE.md (NOW 🎯 + 🤖, token-hygiejne, status board, MASTERPLAN + roadmap i sync).
