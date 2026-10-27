# MASTERPLAN: prioriteret rækkefølge (SSOT)

> Struktur ejer-godkendt 13/10: Brand, Nu (højst fem), Forretning. Rækkefølgen er uændret. Status afstemt 27/10 mod #7153 og ejerens private beslutninger 26-27/10. Intention: GDD. Detaljer: områdets SSOT og issues. Færdigt står i patch notes/git-log. Release-gate: #6553 ved S6-start.

**Reglen:** brand først; motor og rytterudvikling er brand. Dato-løfter færdiggøres ældste først. Nyt prøves på beta før release efter ejerens valg. Forretning har fast torsdag. PC1-Claude ejer merge-køen, flag og prod; Codex leverer kommunikations-PR'er. Arbejdsstandard: [GITHUB_WORKFLOW](GITHUB_WORKFLOW.md), rytme: [OPERATING_PLAN](OPERATING_PLAN.md) og [WEEKLY_STEERING](WEEKLY_STEERING.md).

**Verdensklasse efter S5-skiftet, ejer 19/10:** fundament #6917 parallelt med motor #6914, derefter mobil #6916, desktop #6918 og palet #6915, så vækst #6919. [Spec](superpowers/specs/2026-10-19-world-class-roadmap.md). Kvalitet og fastholdelse foran nyt.

## Brand

- **Stabilitet ved vækst:** aftenafregningen #6490 til dørs; måling af parallel-knappen, så job-kø #6491 og direkte Postgres #6492 (design #7070). Ranglisten #6765: skyggen følges op. Postgres-genstart og akademisidens belastning #7223.
- **Sikkerhed:** nøglerotation #7029; #7034 er nødvej. Aktuel kontrol og næste handling står på de respektive issues.
- **Løbsmotoren:** v3 er live; åbne delmål og rækkefølge står i [RACE_ENGINE_PLAN](RACE_ENGINE_PLAN.md). GT/monumenter har et særskilt målespor #6649/#7214. Intet kaldes godkendt alene fordi et regressionsgulv holder. Målinger og kalibrering forbliver private.
- **Forkert information:** resterne af #6935, rytterkort #6934 og rutematch #6207. De nye Discord-rapporter er triageret på #7294-#7298; de ændrer ikke denne rækkefølge.

## Nu, højst fem

1. **Før første etape 28/10 kl. 11:** PC1 afslutter den godkendte kø på #7153. Modsatte ordrer #7281, etapeplan og dagens intention er tændt og læst tilbage 27/10. Luksushjælper #7276 må merges slukket, men effektmålet er ikke nået og ejeren beslutter tænding. Dagsform #7272 før kobling og tænding af bakker A #7291. Bakker B #7293 måles bagefter. AI-ungdom #6668 har frist før 14:30; #7223 består som stabilitetsspor.
2. **Udvikling 2.0 #6110:** efter daglig træning mellem sæsoner #7282 og sæsonens fælles starttræthed #7288 følger kontrol af afregningen og unges udvikling 28/10. Kurve B #3564 er uden belastningsbremse; topalder og udvikling efter ungdomsårene kalibreres videre mod ejerens mål. Udviklingsscore (PR #7194) og catch-up #6950 følges til dørs, derefter Træn nu B #6461 (PR #7191) som separat tænding. Ingen belønning eller tilbageførsel loves uden verificeret grundlag.
3. **Taktik, roller og ruter:** hver klar del går live efter sit go. Alt ud #7280, én fælles etapeprofil #7292, #7275 og #7274 får go-kort. Beslutningsfilen markerer S7B #7277 som ikke startet. Dagens mål: ejer-valgt retning, mockup afventer godkendelse. Taktiklagene (angrebspunkt, følg rival, sent soloangreb, hvis-så, trøjejagt, sidevind) og udbrud #6299 består; udbrud følger ejerens første trin nu, næste trin bagefter. #7164 følger #7272. Ingen ny motor- eller taktikopgave til Codex her.
4. **Alt lovet, dato først (#6947):** TTT #3463, U23 del 2 #4620, omdømme #4957/#5106, indstillinger #3984 (A), bestyrelsen #7101 (A) med gennemgang #7167. #7191/#7101 kræver go-kort. Auktionsporten #7215: ejerbeslutning torsdag 29/10. #6665 afventer ejeren. PC1 håndterer lukning af #7240 og P1/konflikten i #7143.
5. **Beta til live:** løbskort/historik #6636/#6634 og Kalender | Tabel #6683 skal have go-kort; ingen Done før faktisk aktivering. Udviklingsscore/træningsside og catch-up/Træn nu følger trin 2. Ryttertype-kontakten #5327 bygges og måles før ejerens tænding. Sprog er leveret og skal ikke stå som kommende.

## Forretning, fast torsdag

**Ejerens mål 31/12:** 2.000 kr. MRR og 200 aktive/7d. Aktuelle målinger læses i [GROWTH_STACK](GROWTH_STACK.md); gamle målinger kopieres ikke her.

- S5-kommunikation pr. målgruppe (GDD D-005), annoncetest #2759 efter ejerens budget-go.
- Pro-sporet #2806: rytterhistorik, gemte filtre og /pro; afstem leveret scope før næste trin.
- Fornyelser i marts: fastholdelsesplan fra januar.
- Bogføring, abonnementsgennemgang, moms EU-privat #4511 og billing #4514/#4512/#6062.
- Måling #5305, SEO #5249/#5250 og samtaler med betalende og stoppede spillere.

## Faste rutiner

Rapport får issue og svarudkast; ejeren poster. Known issues følger faktisk live-status. Patch notes: daglig træning, grundtræthed, rettelse af Alt ud-løftet; ordrer, dagsform og bakker først efter observeret aktivering. Roadmap spejler den godkendte plan, ingen opfundet prioritet eller leveringsdato. Hver tænding kræver patch note, EN/DA Hjælp ved mekanikændring og registry/status. NOW/merge-close-out ejes af PC1. Beslutningskort ét ad gangen, med testplan og visuelt bevis.

## Doktrin

Styrke straffes aldrig. Én rytter, ét løb pr. løbsdag. Simulér før ship. Et regressionsgulv er ikke et godkendt mål. Synlige ratings falder ikke uden ejerens vidende. Én motor, revisionsskift og flag er ejer-gated. Frosset: #2217/#2218 og #4100. Regler og konkrete spilgrænser står i områdets SSOT.
