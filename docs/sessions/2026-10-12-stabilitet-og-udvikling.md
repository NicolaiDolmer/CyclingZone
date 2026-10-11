# Næste session: stabilitet + Udvikling 2.0 (+ sæsonskiftets værdier og spillernes småting)

Planlagt 11/10 sammen med ejeren (svar 11/10 ca. 12:15). Ejeren er med fra start. Alle beslutninger herunder er hans. Genåbn ingen af dem.

## Startprompt (kopiér ind i en ny Claude Code-session)

```
Ny session efter docs/sessions/2026-10-12-stabilitet-og-udvikling.md. Læs FØRST den fil, derefter docs/NOW.md, docs/MASTERPLAN.md og issue #6110 inkl. kommentarer. Jeg er med fra start. Rækkefølge: (1) tjek overdragelsen fra sessionen 11/10 (punkt "Overdraget" i filen) og sig hvad der er åbent, (2) start en bølge med stabilitets-sporene og småting-lanen, (3) tag Udvikling 2.0-beslutningerne D1-D7 med mig ét kort ad gangen med billede, mens bølgen kører, (4) sæsonskiftets værdier (#5842) som kort, (5) byg Udvikling 2.0 når D1-D7 er besluttet. Formtoppe (#6156 #6158) er IKKE med i denne session. Svar på dansk.
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

## Overdraget fra sessionen 11/10 (tjek status først)

- **#6464 + #6456 bjerg-tidsgab** (ny revision): rapport var lovet 11/10 kl. 16, derefter gate + Fable-dom + tænd-kort, så 37 løb 12/10 kl. 12 (18 med bjerg) kan få den. Tjek om den er tændt, ellers er det første punkt.
- **#6384 tidsgab i ungdoms-/holdklassement:** UI-PR med før/efter-billede; merges kun efter ejerens visuelle go.
- **#6470 træningsafstemning:** dry-run viste ingen reparation; tjek efter aftentræningen 11/10, at Sentry-rytteren blev afregnet og at der ikke kom nye karantæner, luk så.
- **Touren (official_times_v3):** drift-tjek pr. etape, især bjerg 13/10 kl. 13 og højfjeld 15/10; e1 var som testet.
- **#6472 rullende etaper** og **#6471 rutematch følger ikke motoren**: mål før der bygges.
- **#6476 svar-sløjfen:** 4 ubesvarede i feedback-formularen + 10 spillersvar; ejeren vil have hjælp "inden for de kommende dage".
- **Discord:** patch 7.354-7.355 i `docs/drafts/discord-patch-7354-7355-2026-10-11.md` (ejeren poster selv).
- **Mandag:** betaling #4511 #4514 #4512 + Sentry CYCLINGZONE-62 (faktura 63 dage over forfald, ét Pro der ikke passer).

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
