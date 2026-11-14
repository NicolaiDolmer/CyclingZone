# Natbølge 2026-11-14 (PC1, 14/11 00:20 → 03:30)

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | 00:23 → 02:07 for bølgen (`wave.js`, én bølge, 6 baner); rettelsesrunder og domme til 03:10 |
| Spor | 8 bygget (7 i startlisten + #7855 lagt i køen undervejs); 0 frys, 0 døde baner, 0 sprunget over |
| Agenter i bølgen | 43 startet / 43 fuldført / 0 døde |
| Sidespor uden for bølgen | 3 dommer-domme + 3 gentjek (Fable), 2 gentjek (Opus), 3 rettelsesrunder (`WAVE-FOLLOWUP`, Opus), 2 læsespor (Sonnet) |
| PR'er åbnet / merged | 3 nye (#8154, #8155, #8156) + 5 eksisterende opdateret (#8141, #8138, #8148, #8056, #8059) / 0 merged (ejerens ramme: ingen natmerge) |
| Lagt klar til ejer | #8156, #8141, #8138, #8140, #8056, #8059, #8154, #8155; #8148 venter på dommen over trin 3 |
| Issues → claude:done | ingen (intet merget) |
| Til dørs-markeringer med set bevis | #8108 (5, 8 ok), #8129 (4, 5 ok), #8089 (5 ok), #8099 (5 ok); #8110, #8089, #8099 står med "8 mangler" |
| gh-401-retries | 0 set |
| Recoveries | 0 |
| Preflight | GO kl. 00:21 (12 ok, 2 advarsler; `.codex.local/night-wave-preflight.json`) |

Kort til ejeren: OneDrive `private-handoffs/2026-11-13-nat-pc1/MORGENKORT.md`. Domme: samme mappe, `domme/`. Reviewernes ikke-blokerende fund: #8157.

## Afvigelser/læringer

- **Bølgens reviewer er ikke nok på penge og motor.** Tre af fire Fable-domme på nyt HEAD fandt noget, bølgens egen reviewer ikke fandt: en opdateringsstorm i #8138 (ramte spillere med kontakten slukket), et resthul i #7855 (hul 1 kun lukket på fire af fem dage) og otte "dårligere"-punkter i #8056. Dommer på endeligt HEAD før merge-kort bør være fast for de spor.
- **En rettelsesrunde kan lave en ny fejl.** Stormen i #8138 kom fra nattens egen rettelse af dommens punkt 5. "Ændret ud over de aftalte punkter" udløste fuld gendom, og det var den, der fangede den. Behold reglen.
- **Dommerens oplæg kan selv være hullet.** Resthullet i #7855 skyldtes dommerens egen besked til byggeren ("kan ikke afgøres"). Dommeren fandt det selv med en sonde på etapernes egne spurter. Dommer skriver prøve først, bygger bagefter, gentjek til sidst virkede.
- **Prøver "set røde på main" passer ikke altid.** Planen krævede det for fire prøver; én (rent udbrud) var grøn, fordi fejlen ikke findes på main. Den blev stående som vagt, bevist rød med indsat fejl. Skriv kravet som "rød på main ELLER rød med indsat fejl".
- **Aflyste CI-job ligner røde tjek.** Skiftet kladde → klar afbryder den ældre kørsel, og dens job står som `fail` i oversigten (set på fem PR'er). `gh pr checks --required` er sandheden; se #8157.
- **Lane-loftet 6 holdt, og køen blev brugt:** #8152 startede, da første bane var færdig, og #7855 blev optaget fra køen ca. 40 min efter `enqueue`. Planens "bevis inden 30 min" passer ikke, når alle baner er optaget; kravet bør være "optaget ved første frie bane".
- **Kravet til UI-sporet var større end en nat.** #8056 nåede fem af otte punkter i en ekstra runde; tre kræver ejerens valg (Ryd dag/Ryd alt, fuld ruteprofil, "Efter løbet").
- **Tider:** bane-længde 50 til 100 min; Fable-dom 10 til 27 min; rettelsesrunde 13 til 45 min. Disk 26,4 GB → 17,5 GB fri (dommernes arbejdskopier ligger i scratchpad og er ikke slettet).
