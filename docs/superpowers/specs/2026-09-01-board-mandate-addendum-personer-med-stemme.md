# Mandatet — addendum 1/9-2026: personer med stemme + S3-flip

**Status:** ✅ Ejer-godkendt 1/9-2026 (grill-session; mockup-retning + stemmer godkendt visuelt).
**Bygger på:** `2026-08-07-board-mandate-rework-design.md` (de 10 låste 7/8-beslutninger STÅR — dette dokument udvider, det genåbner ikke).
**Mockups:** `docs/design/board-mandate-mockups/` + canvas https://claude.ai/code/artifact/4ec4d1c1-fb2f-46aa-bf62-ec5cd3203e31

## Ejer-beslutninger 1/9 (log)

| # | Beslutning | Valg |
|---|---|---|
| A1 | Fundament | Mandatet (7/8-spec) er grundlaget; skærpes, genåbnes ikke |
| A2 | Flip-timing | **Flip i S3 så snart bygget + verificeret** (overstyrer bevidst S3-rammens "vent til S4"; kill-switch = rollback). Migrering re-baselines til midt-i-S3 (23/8-backfillet var kalibreret til sæsonskifte; skyggedata genopbygges før flip) |
| A3 | Ægte personer | **B nu: personer med stemme** (se nedenfor). A (kuraterede portrætter) på sigt, eget spor |
| A4 | #3494 sponsor-vækstmål | **Re-point til `sponsor_contracts`** (7/8-beslutningen fastholdt). Baseline-valget dokumenteres eksplicit i PR'en |
| A5 | #4519/#3575 (gammel flade) | Vent på Mandatet; genbesøges hvis flippet viser sig >2-3 uger væk |
| A6 | Adskillelse (#4265) | Løses AF Boardroom-flippet (sponsor får egen flade; rækkefølge-låsen i BOARD_RULES §5.3 består) |

## Personer med stemme (A3, designkontrakt)

Princip 3 i spec'en ("Personer i front") udvides fra navne til personer:

1. **Hvert medlem har en tone-profil pr. arketype** (kuraterede templates, EN først/DA under, ingen runtime-AI-tekst). Anti-monotoni som trænings-momenterne (#2484): min. 4 varianter pr. besked-type pr. arketype.
2. **Kvitteringer taler i ejerens stemme.** Referat-feedets rækker attribueres til målets ejer og bærer et kort citat i personens tone ("Two wins in a week. That is what I signed up for." · Jørgen Brandt), aldrig "Bestyrelsen er utilfreds: -3".
3. **Formanden taler ved beats:** årsmøde, mid-season check-in, milepæls-afgørelser, formandsskifte.
4. **Medlems-relations-panel** (nyt UI-element, `Member.dc.html`): inline expand fra bestyrelseskortet — personlighed (1-2 sætninger), ejede mål m. status, "In his own words"-feed (citater m. konfidens-bevægelse + dato), stemnings-dot. Portræt-slot forberedt ("Portraits arrive in a later round. The voice is the identity.").
5. **Ingen ansigter i B-runden:** monogram-avatarer (navy, Bebas-initialer) + stemnings-dot. AI-genererede portrætter er fravalgt (anti-slop); A-runden bliver kuraterede/tegnede assets med eget ejer-go.

## Konsekvenser for faseplanen

- Fase 0 (korrekthed) uændret + **#4377** (tællere ignorerer historik) løftes ind: multiårs-mål bliver visions-milepæle ved migrationen, så tæller-historikken SKAL være korrekt før flip.
- Fase 1-rest: wiring + skyggedata-genopbygning + **midt-i-S3 re-baseline** af confidence-migrationen (50/30/20-vægtene består; snapshot-tidspunkt = flipdagen).
- Fase 2 (Boardroom + årsmøde-UI): som spec §3.4/§3.2 + medlems-panelet + stemme-bibliotek (i18n-namespace `board`, lazy jf. #3697).
- Spillerne har aldrig fået Mandatet lovet i patch notes — kommunikationen planlægges som del af flip-PR'en (patch note + help.json en+da + Discord-udkast ejeren selv poster).
