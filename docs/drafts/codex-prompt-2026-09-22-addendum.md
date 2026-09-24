# Codex-prompt 22/9, tillæg (ejeren sender det til Codex når opgave 1 er i PR)

> Ejer-beslutninger 22/9 eftermiddag: (1) løbsmotor v4 går live ved sæsonstarten for S4 (28/9), kalibreringen skal derfor ind som opgave 2; (2) win-back-mailens tekst er godkendt og skal ind i koden.

```
TILLÆG til prompten fra i dag. Samme faste regler. Indsæt disse to opgaver FØR den nuværende opgave 3 (#5327), i denne rækkefølge:

2A. LØBSMOTOR v4 KLAR TIL SÆSONSTART (ejer 22/9: live 28/9, ikke "når den slår v3"). Læs docs/RACE_ENGINE_RULES.md §5 (F5 kalibrering) + #4914 #4707 #4915 #4948 #4916. Én PR pr. punkt, alle bag flaget race_engine_v4 (off), CI + v4-testsuiten grøn:
   a) #4914: all_out må ikke være gratis på fladt, grupetto-tempo, feltspredning; scorecard på 5 seeds i PR-body (før/efter).
   b) #4707: jagt-model vs. bjerg-anker.
   c) #4915: TTT uheld, tidsgrænse, point.
   d) #4948: hjælpe-sektionen på raceDay er hardkodet skjult; vis den bag flaget.
   Derefter: sammenligning v3 mod v4 på de 5 seeds som én rapport (docs/audits/2026-09-2x-v4-scorecard.md) så jeg kan sige "flip". Flippet er mit, på cutover-dagen.

6-FORUDSÆTNING (ejer-direktiv 22/9, gælder mobil-træning #3643 og træningssiden generelt): ingen lange scroll-sider under træning; faner/modals; det mest brugte øverst; 'programmet' i toppen skal have en mere forståelig løsning; landscape må ikke falde tilbage til desktop-layout. FØR byg: Clarity-analyse + mockup til ejer-valg. Se #5485 (design-issuet) og #5486 (træningsscore-grafen uden huller på løbsdage). Bygges som del af opgave 6, ikke som ekstra scroll.

2B. WIN-BACK-MAIL, GODKENDT TEKST (#2760). Ret backend/lib/emailTemplates.js buildWinbackEmail (EN + DA) til teksten i docs/drafts/2026-09-22-winback-mail.md ordret (emne, statuslinje, seks punkter, afslutning, knap "Go to your team"/"Gå til dit hold"). Opdatér emailTemplates-testene + snapshot. Ingen afsendelse, ingen flag. PR med rendret HTML-skærmbillede (EN + DA). Når merget siger Claude/ejeren tørkørsel + send.
```
