# Startprompt: pc1 (efter DolmerPC 17/10)

Ny session på pc1. Kør `git pull --ff-only`, læs `docs/NOW.md` og denne fil. Svar på dansk i ALLE beskeder. Stil spørgsmål ét ad gangen med en anbefaling. Vis billeder (PNG via SendUserFile) før et UI- eller designspørgsmål. DolmerPC arbejder ikke mere 17/10.

## Leveret 16-17/10 på DolmerPC (#6740, Discord: Friis + knud)

- #6742: hold der ikke stillede op vises som "Did not start" (Planlægning, Taktik, Race Centre, Daily Training), skade-besked + "Injured"-mærke, Train now advarer og spørger (tjekkes igen ved trykket, bundet til de viste løb).
- #6745: gulv-regel B. Mister et hold udtagne ryttere til skade efter udtagelsen, starter det med de raske (mindst 1).
- #6747: hold der ikke stillede op får rytterne frie med det samme (`race_withdrawals.withdrawn_reason = 'did_not_start'`, afstemt ved hver senere etape). Engangsfrigivelse kørt 17/10 på ejerens "kør": 73 hold, 280 ryttere, 0 bundne tilbage.
- Alle tre er merget og deployet med grøn smoke. #6740 er `claude:done`; ejeren lukker selv.

## Spørg ejeren først

1. **#6739: små trupper mister hele etapeløb.** Ejeren valgte 17/10 at tage beslutningen her. Hele grundlaget med tal står i issuet (kommentar 17/10). Spørg A eller B med anbefaling A:
   - **A (anbefalet):** start med færre ryttere, når de manglende kørte et andet løb samme løbsdag. Mindst N; af 73 ville 41 have startet ved N=4 og 53 ved N=3. Motorregel uden kalenderændring.
   - **B:** kalenderregel mod at dele løbsdag ved løbsskifte. Genåbner den låste overlap-andel og kræver ny S5-kalender før 28/10.
   - Ved A: spørg derefter om N (ét spørgsmål), og så design + målt baseline før første PR (motor, AGENTS 36).

## Ejeren skal selv

- Svare Friis og knud i Discord. Udkast fra DolmerPC-sessionen: Friis' ryttere er frigivet, og skade efter udtagelsen koster ikke længere starten. knud: badget på Daily Training er rettet.
- Lukke #6740.
