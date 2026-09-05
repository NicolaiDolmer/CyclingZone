# Prompt til næste session (designet sammen med ejeren 6/9)

Kopiér teksten under stregen ind som første besked i en ny Claude Code-session i `C:\Dev\CyclingZone`.

---

Ny session. Læs `docs/NOW.md` først. Brug workflows (ultracode) til alt der kan parallelliseres; du er arkitekt, workers (opus til byg og design, sonnet til mekanik) bygger, model eksplicit i hvert kald.

**Emne: løbsmotor v4 og taktik.** Mål: v4 klar til flip ved sæson 4-start 28/9. S3 kører færdig på v3. Flip er mit valg alene.

**Rækkefølge:**

1. **Audit først (ingen design før den er færdig):** kør en read-only workflow der kortlægger hvad der reelt er bygget og grønt i v4: `backend/lib/engine/v4/*`, ankre og kalibrering (#4707, #3855), rolle/ordre (#4246), de tre krav fra 4/9 (#2789 rute-huller, #2944 graduerede styrt + mekaniske uheld uden DNF, #2582 tidsgrænse), løbsdagens intention (#4632, beslutning 6/9: vælges i holdudtagelsen pr. etape, `race_entries` mangler kolonnen), og `docs/RACE_ENGINE_RULES.md` mod koden. Levér én liste: FÆRDIGT og verificeret / bygget men ikke verificeret / ikke bygget / modsigelser mellem doc og kode. Vis mig listen i klart sprog før du spørger om noget.
2. **Design sammen, ét spørgsmål ad gangen,** med billeder i selve beslutningskortet: intention + rolle i taktikken (hvad jeg vælger pr. etape, hvor, hvad det koster), derefter styrt og mekaniske uheld, tidsgrænsen, rute-hullerne. Skriv beslutningerne i `docs/RACE_ENGINE_RULES.md` og en spec i `docs/superpowers/specs/`.
3. **Byg-bølge** på beslutningerne: én PR-kø, ingen patch notes i PR'erne, én samlet note til sidst. Harness-målinger (ankre) skal være grønne før du kalder noget klar.
4. **Sidespor i baggrunden, bestyrelsen:** #4856 (bonusmål skrives til mandatet), #4855 (hjælp en+da, patch note, Discord-udkast), #4857 (backfill af de to hold, KUN på mit "kør"), #4859 (flip beta til on, KUN på mit "go").

**Regler for sessionen:**
- Vent ALDRIG blokerende på en worker. Alt kører i baggrunden, og du svarer på hver besked fra mig med det samme, også hvis svaret er "stadig i gang".
- Når jeg skal tage stilling: billeder (mockups, skærmbilleder) sendes som filer i SAMME besked som spørgsmålet, hver gang.
- Ét spørgsmål ad gangen, klart sprog fra spillerens side, A/B + din anbefaling. Ingen jargon, ingen lange lister af spørgsmål.
- Merge: backend-PR'er der bygger på en beslutning vi har truffet i sessionen må du merge selv når CI er grøn (meld det med én linje). Alt jeg kan SE (UI, tekster) og alt der skriver i prod-data (scripts, flag-flip, kalender) kræver mit ordrette "merge" eller "kør", med billeder eller tal i kortet.
- TASTE.md og PAGE_TEMPLATES.md er bindende for al UI, inkl. ejer-reglen "overblik først + faner ud, aldrig lange scroll-sider". TONE_OF_VOICE.md for al tekst. Mere fog of war: foreslå aldrig mekanikker der afslører lofter eller skjult info.
- Done-flip pr. issue efter merge. Close-out med NOW.md under 1.200 tokens, working agent nulstillet, og en liste over alt uafsluttet som GitHub-issues.

**Låst, genåbn ikke:** træning pr. løbsdag med samme antal løbsdage i alle divisioner (epic #4850, live senest S4-start), træningsscore (#4851), Belastning/Holdpas/Trætheds-grænse (#4852-#4854), S4-kalenderen må ikke lægges i databasen før #4845 (kalenderpakker). #4801 venter på mit "merge". #4789 tages i en anden session. #4835 venter på at jeg opretter `AUTO_MERGE_PAT`.
