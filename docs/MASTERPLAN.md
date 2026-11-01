# MASTERPLAN: prioriteret rækkefølge (SSOT)

> Struktur ejer-godkendt 13/10: Brand, Nu, Forretning. **Byggestop fra 29/10** (#7336, [design](superpowers/specs/2026-10-29-foelg-til-doers-design.md)): kun brand, loftet og de åbne PR'er bygges, se `scripts/build-stop.json`. Rækkefølgen er ejer-afstemt 29/10, og intet er udskudt uden ejer-aftale. Intention: GDD. Detaljer: SSOT og issues. Release-gate: #6553 ved S6-start.

**Reglen:** brand først; motor og rytterudvikling er brand. Færdig = bygget, merget, tændt, synligt, gammelt væk, hjælp + patch note. Højst 3 områder i gang ad gangen; næste område starter først når ét er færdigt. Dato-løfter færdiggøres ældste først. Nyt prøves på beta før release efter ejerens valg. Forretning har fast torsdag. PC1-Claude ejer merge-køen, flag og prod; Codex leverer kommunikations-PR'er og får ingen ny motor- eller taktikopgave. Standard: [GITHUB_WORKFLOW](GITHUB_WORKFLOW.md), [OPERATING_PLAN](OPERATING_PLAN.md), [WEEKLY_STEERING](WEEKLY_STEERING.md).

**Verdensklasse efter S5-skiftet, ejer 19/10:** #6917 #6914, så #6916 #6918 #6915 #6919 ([spec](superpowers/specs/2026-10-19-world-class-roadmap.md)). I kø under byggestoppet.

## Brand (kører løbende, uden for loftet)

- **B1 Træning og udvikling:** rapport #6971 åben.
- **B2 Løbsdag og motor:** åbne: udbrud 15 min #6912, dronningeetaper #7236, auto-fyld med for få ryttere #7339, Spar trætter mere end Normal på bjerg #7473. Bygget, mangler til-dørs: etapeplan #7333, formtoppe #6156, udgåede #7411.
- **B3 Kontrakter, transfer, sæsonskifte:** åbne: kontrakthistorik #7246 (PR #7459), ungdom #6882, graduering/auktion #7323. Bygget, mangler til-dørs: transfer #7285, værdier #5842.
- **Stabilitet ved vækst:** aftenafregningen #6490; ranglisten #6765; Postgres-genstart #7223. Job-kø #6491 og direkte Postgres #6492 (design #7070) bygges når målingen i #6490 viser behov.
- **Sikkerhed:** nøglerotation #7029; nødvej #7034.
- **Forkert information:** gennemgang #6935, rutematch #6207 (bygget). Discord #7294 #7296 bygget, #7297 #7298 åbne.

## Nu: loftet (ejer-rangeret 29/10)

1. **Udvikling 2.0 #6110:** kurve B + katalog v3 tændt 30/10. Rolle-udbytte på løbsdage #5950 tændt 1/11 med Hjælp; prod-verifikation 2/11. Catch-up #6950: beslutningskort 2/11 (frist 8/11). Udviklingsscore #6853, Træn nu B #6461, progressionskæden #3564 (kurve B: topalder og udvikling efter ungdomsårene kalibreres videre mod ejerens mål). Intet loves uden verificeret grundlag.
2. **Race engine #7260:** de 19 punkter, de slukkede motorkontakter (tænd eller fjern) og én sand status i [RACE_ENGINE_PLAN](RACE_ENGINE_PLAN.md). GT/monumenter #6649/#7214. Bakker B #7293 måles før tænding. Udbrud følger ejerens første trin nu, næste trin bagefter; #7164 følger dagsform #7272. Hvis-så-ordrer, sidevind og bakket enkeltstart afventer ejer-valg om 2027. Rutematch medtager finalen #6472, og automatisk udtagelse bruger rutematch #6471 (ejer-gated, design + måling før PR). Punch i stigende spurt #7472. Målinger og kalibrering er private.
3. **Taktik synlig overalt:** taktik-pakken #7266, delt kaptajn #7239/#7326, kladder #7327, ordrer #7003/#6746/#6299, luksushjælper live 1/11 (effekten #7466), angreb bag feltet tæller som arbejde #7465, løbsintention #6641. Taktiklagene (angrebspunkt, følg rival, sent soloangreb, trøjejagt) består.

**Åbne PR'er fra 29/10:** løbsbibliotek #6634/#6636, forside #6665 (ejeren 3/11). Bestyrelsen: issue #7167.

**Opfølgere fra 1/11 (ikke brand, bag byggestoppet):** transferlisting #7464, sen registrering #7470, Beskeder/forside #7467, gates #7468/#7469.

## Kø (i denne rækkefølge, når et loft-område er færdigt)

1. **Dato-løfter (#6947):** TTT #3463, U23 del 2 #4620, omdømme #4957/#5106, indstillinger #3984. Auktionsporten #7215: besluttet 29/10, lukkes (koden fjernes).
2. **Tracking af nye spillere:** feltet "Hvor hørte du om os?" og den ugentlige Google-rapport #3796/#3797. UTM på alle links i opslag, mails og Discord sker allerede nu uden kode (ejer 29/10).
3. **Etapeside og beta til live:** etapeside 2.0 er eneste side, den gamle fjernet 1/11. Kalender | Tabel og terræn-ikoner #6683, ryttertype-kontakten #5327, AI-ungdom #6668.
4. **Discord-løfterne #6947:** sorteres i brand / kø / 2027 med en ærlig besked til spillerne.
5. **Akademi og ungdom:** akademi-påmindelsen, junior-pyramiden, løbstyper for junior/U23 #7471.

## Forretning, fast torsdag

**Ejerens mål 31/12:** 2.000 kr. MRR og 200 aktive/7d. Aktuelle målinger læses i [GROWTH_STACK](GROWTH_STACK.md); gamle målinger kopieres ikke her.

**Markedsføring 3 gange om ugen (ejer 29/10):** mandag tal og ugens plan · onsdag ét opslag i et fællesskab (Reddit, Hattrick, PCM-Discord; det største hop var r/procyclingmanager 29/6) · fredag indhold/SEO. Claude laver udkast og tal, ejeren poster; uden kode = ikke omfattet af stoppet.

- S5-kommunikation pr. målgruppe (GDD D-005), annoncetest #2759 efter ejerens budget-go.
- Pro-sporet #2806: rytterhistorik, gemte filtre og /pro; afstem leveret scope før næste trin.
- Fornyelser i marts: fastholdelsesplan fra januar.
- Bogføring, abonnementsgennemgang, moms EU-privat #4511 og billing #4514/#4512/#6062.
- Måling #5305, SEO #5249/#5250 og samtaler med betalende og stoppede spillere.

## Faste rutiner

Rapport får issue og svarudkast; ejeren poster. Known issues = faktisk live-status. Patch notes kun efter observeret aktivering. Roadmap spejler den godkendte plan, ingen opfundet prioritet eller leveringsdato. Sprog er leveret og står ikke som kommende. Hver tænding kræver patch note, EN/DA Hjælp ved mekanikændring og registry/status. NOW/merge-close-out ejes af PC1. Beslutningskort ét ad gangen, med testplan og visuelt bevis.

## Doktrin

Styrke straffes aldrig. Én rytter, ét løb pr. løbsdag. Simulér før ship. Et regressionsgulv er ikke et godkendt mål. Synlige ratings falder ikke uden ejerens vidende. Én motor, revisionsskift og flag er ejer-gated. Frosset: #2217/#2218 og #4100. Regler og konkrete spilgrænser står i områdets SSOT.
