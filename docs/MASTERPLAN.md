# MASTERPLAN: prioriteret rækkefølge (SSOT)

> Struktur ejer-godkendt 13/10: Brand, Nu, Forretning. **Byggestop fra 29/10** (#7336, [design](superpowers/specs/2026-10-29-foelg-til-doers-design.md)): kun brand, loftet og de åbne PR'er bygges, se `scripts/build-stop.json`. Rækkefølgen er ejer-afstemt 29/10, og intet er udskudt uden ejer-aftale. Intention: GDD. Detaljer: områdets SSOT og issues. Release-gate: #6553 ved S6-start.

**Reglen:** brand først; motor og rytterudvikling er brand. Færdig = bygget, merget, tændt, synligt, gammelt væk, hjælp + patch note. Højst 3 områder i gang ad gangen; næste område starter først når ét er færdigt. Dato-løfter færdiggøres ældste først. Nyt prøves på beta før release efter ejerens valg. Forretning har fast torsdag. PC1-Claude ejer merge-køen, flag og prod; Codex leverer kommunikations-PR'er og får ingen ny motor- eller taktikopgave. Arbejdsstandard: [GITHUB_WORKFLOW](GITHUB_WORKFLOW.md), rytme: [OPERATING_PLAN](OPERATING_PLAN.md) og [WEEKLY_STEERING](WEEKLY_STEERING.md).

**Verdensklasse efter S5-skiftet, ejer 19/10:** fundament #6917 og motor #6914, derefter mobil #6916, desktop #6918, palet #6915 og vækst #6919 ([spec](superpowers/specs/2026-10-19-world-class-roadmap.md)). Under byggestoppet kun de dele der er brand eller på loftet; resten står i kø, ikke udskudt.

## Brand (kører løbende, uden for loftet)

- **B1 Træning og udvikling:** hovedevne uden fremgang #7316, to point samme dag #6210, træthed 5x #5928, historik #5947, rapport #6971.
- **B2 Løbsdag og motor:** Alt ud på enkeltstart #7332, etapeplan #7333, rutematch på Taktik #7334, udbrud 15 min #6912, dronningeetaper #7236, formtoppe #6156, Firefox-crash #6698, auto-fyld med for få ryttere (issue mangler).
- **B3 Kontrakter, transfer, sæsonskifte:** varsler #7246 #7180, auktioner under 12 t #7220, transfer #7284 #7285, ungdom #6964 #6882, graduering #7231 #7323, værdier #5842.
- **Stabilitet ved vækst:** aftenafregningen #6490; ranglisten #6765; Postgres-genstart #7223. Job-kø #6491 og direkte Postgres #6492 (design #7070) bygges når målingen i #6490 viser behov.
- **Sikkerhed:** nøglerotation #7029; nødvej #7034.
- **Forkert information:** #6935, rytterkort #6934, rutematch #6207. Discord-rapporterne #7294-#7298 er triageret; hver klassificeres som brand eller kø.

## Nu: loftet (ejer-rangeret 29/10)

1. **Udvikling 2.0 #6110:** daglig træning mellem sæsoner #7282, udviklingsscore og catch-up #6950/#6853, Træn nu B #6461, unges udvikling #6499, progressionskæden #3564 (kurve B: topalder og udvikling efter ungdomsårene kalibreres videre mod ejerens mål). Ingen belønning eller tilbageførsel loves uden verificeret grundlag.
2. **Race engine #7260:** de 19 punkter, de slukkede motorkontakter (tænd eller fjern) og én sand status i [RACE_ENGINE_PLAN](RACE_ENGINE_PLAN.md). GT/monumenter #6649/#7214. Bakker B #7293 måles før tænding. Udbrud følger ejerens første trin nu, næste trin bagefter; #7164 følger dagsform #7272. Hvis-så-ordrer, sidevind og bakket enkeltstart afventer ejer-valg om 2027. Målinger og kalibrering forbliver private.
3. **Taktik synlig overalt:** taktik-pakken #7266, delt kaptajn #7239/#7326, kladder #7327, ordrer #7003/#6746/#6299, luksushjælper #5982 (ejeren beslutter tænding), løbsintention #6641. Taktiklagene (angrebspunkt, følg rival, sent soloangreb, trøjejagt) består; hvis-så og sidevind se punkt 2.

**Åbne PR'er fra 29/10** gøres færdige eller lukkes (engangsoprydning): løbsbibliotek #6634/#6636, forside #6665 (ejeren bestemmer tidspunktet), bestyrelse #7101 med gennemgang #7167, træning #7143, ungdomskontrakter #7274, motor-PR'er #7164 #7240 #7275 #7277 #7279 #7292. Spillervendte PR'er (#7101, #7274, #7275, #7292) og tændingen af Træn nu B (#7191, merget slukket) kræver go-kort.

## Kø (i denne rækkefølge, når et loft-område er færdigt)

1. **Dato-løfter (#6947):** TTT #3463, U23 del 2 #4620, omdømme #4957/#5106, indstillinger #3984. Auktionsporten #7215: ejerbeslutning torsdag 29/10.
2. **Etapeside og beta til live:** etapeside 2.0 overalt med det gamle fjernet, Kalender | Tabel og terræn-ikoner #6683, ryttertype-kontakten #5327, AI-ungdom #6668.
3. **Discord-løfterne #6947:** sorteres i brand / kø / 2027 med en ærlig besked til spillerne.
4. **Akademi og ungdom:** akademi-påmindelsen, junior-pyramiden.

## Forretning, fast torsdag

**Ejerens mål 31/12:** 2.000 kr. MRR og 200 aktive/7d. Aktuelle målinger læses i [GROWTH_STACK](GROWTH_STACK.md); gamle målinger kopieres ikke her.

- S5-kommunikation pr. målgruppe (GDD D-005), annoncetest #2759 efter ejerens budget-go.
- Pro-sporet #2806: rytterhistorik, gemte filtre og /pro; afstem leveret scope før næste trin.
- Fornyelser i marts: fastholdelsesplan fra januar.
- Bogføring, abonnementsgennemgang, moms EU-privat #4511 og billing #4514/#4512/#6062.
- Måling #5305, SEO #5249/#5250 og samtaler med betalende og stoppede spillere.

## Faste rutiner

Rapport får issue og svarudkast; ejeren poster. Known issues følger faktisk live-status. Patch notes kun efter observeret aktivering. Roadmap spejler den godkendte plan, ingen opfundet prioritet eller leveringsdato. Sprog er leveret og står ikke som kommende. Hver tænding kræver patch note, EN/DA Hjælp ved mekanikændring og registry/status. NOW/merge-close-out ejes af PC1. Beslutningskort ét ad gangen, med testplan og visuelt bevis.

## Doktrin

Styrke straffes aldrig. Én rytter, ét løb pr. løbsdag. Simulér før ship. Et regressionsgulv er ikke et godkendt mål. Synlige ratings falder ikke uden ejerens vidende. Én motor, revisionsskift og flag er ejer-gated. Frosset: #2217/#2218 og #4100. Regler og konkrete spilgrænser står i områdets SSOT.
