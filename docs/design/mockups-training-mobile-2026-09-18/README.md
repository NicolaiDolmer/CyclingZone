# Mobil-design for træningssiden · tre mockups på 412 px (18/9 2026)

Designsession til [#3643](https://github.com/NicolaiDolmer/CyclingZone/issues/3643). **Ingen produktionskode.**
Dette er den mobil-designsession ejeren bad om 15/9 ([#5124](https://github.com/NicolaiDolmer/CyclingZone/issues/5124)-kommentaren):
tre former på 412 px, så retningen kan vælges før der bygges.

Navne og tal er opdigtede eksempler. Den venstre søjle i `side-by-side.png` er derimod et **ægte skærmbillede**
af `/training` som den ser ud i dag.

| Fil | Hvad |
|---|---|
| `side-by-side.png` | **Start her.** I dag vs. de tre forslag, 412 px side om side, med nummererede pins og forklaring |
| `m1-cards.html` / `.png` | 1 · Kort pr. rytter |
| `m2-table.html` / `.png` | 2 · Tabel |
| `m3-hybrid.html` / `.png` | 3 · Hybrid |
| `landscape-892.html` / `.png` | Landskabs-skitse af alle tre på 892 × 412 (svar på [#4982](https://github.com/NicolaiDolmer/CyclingZone/issues/4982)) |
| `today-412-*.png` | Det ægte skærmbillede af siden i dag (lys, mørk, høj, landskab) |
| `compose-side-by-side.html` | Kilden til `side-by-side.png` |

## Den regel alle tre er tegnet efter (ejer 18/9, låst)

**Enheden er løbsdagen: én dato i cykelåret.** På en løbsdag kører rytteren ét løb ELLER træner, aldrig begge,
og aldrig "træn i det slot du ikke kørte løb i". En rigtig kalenderdag rummer flere løbsdage (i dag 1-5,
sandsynligvis 4 fremover). Nogle løbsdage er rene træningsdage uden løb. Derfor:

- **Dagen læses kronologisk** som en række løbsdage, ikke som klokkeslæt. Alle tre har den samme stribe øverst.
- **Programmet er 7 ugedage × N løbsdage** (mockuppene viser 4). Det står som et gitter, ikke som en liste.
- **Udregningen sker samlet om aftenen** (sweep fra kl. 20). Den ene gold-knap kører dagen tidligere, uden bonus.
- Designet bærer 1-5 løbsdage pr. kalenderdag; stribe og gitter skalerer med antallet.

Kortindholdet fra [#3643-kommentaren 13/8](https://github.com/NicolaiDolmer/CyclingZone/issues/3643) er bindende og
ligger i alle tre: fremgangsbar for den trænede evne, "tæller for"-chips med rollens opskrift, ugens kvittering,
loftet som chip i evnelisten, og tempo formuleret som **hastighed** ("ca. 1 rating-point om ugen"), aldrig som
ankomsttid.

## Hvad hver mockup vælger og fravælger

### 1 · Kort pr. rytter (`m1-cards.png`)

**Vælger dybde.** Hver rytter får sit eget kort med hele beslutningsgrundlaget synligt på én gang:
dagens fire løbsdage, fremgangsbaren, rollens opskrift, loftet, tempoet og ugens kvittering. Intet er
gemt bag et tryk. Det er formen der bedst svarer på klagen fra #3649 ("der sker ikke noget"), fordi det
eneste der flytter sig hver dag står i fuld bredde.

**Fravælger overblik.** Tre ryttere fylder en skærm. Med 14 ryttere er siden ca. 4.700 px lang, og du
kan ikke sammenligne to ryttere uden at scrolle. Bulk-valg ("anvend på de valgte") har ingen naturlig plads.

### 2 · Tabel (`m2-table.png`)

**Vælger overblik.** Rækker er ryttere, kolonner er dagens fire løbsdage. Ni ryttere i den højde hvor
kort viser tre, uden en eneste kolonne bag skærmkanten. Hele truppens dag kan skimmes på ét blik, og
programgitteret ligger lige over. Den rytter du trykker på får det fulde kort under tabellen, ÉN gang
i stedet for i hver række.

**Fravælger dybden pr. række.** Fremgangsbar, "tæller for"-chips og kvittering er ikke synlige i rækken,
kun for den valgte rytter. Er det de daglige fremskridt spilleren kommer efter, ligger de et tryk væk.
Dette er **ikke** D-047-formen (navn + tre talkolonner), som ejeren afviste for træning 15/9: kolonnerne
er dagens løbsdage, ikke rating/værdi/løn.

### 3 · Hybrid (`m3-hybrid.png`)

**Vælger dagens todeling.** Listen deles efter hvad rytteren faktisk laver: "Racing now" (skrivebeskyttet
intention, link til etapen) og "Training now" (session + fremgang som en sliver i rækken). Rækken du
trykker på folder hele kortet ud på stedet. Seks rækker plus ét åbent kort på en skærm.

**Fravælger tabellens tæthed og kortets ro.** Du ser hverken hele truppen som et gitter eller alle
detaljer på én gang, og en side med ét åbent kort midt i en liste hopper når du folder ud og ind.

## Fælles for alle tre

- Én gold primary pr. view ("Run today's training now"). Sessionschips er **ikke** guld, som de er i dag.
- Fremgangsbaren er monokrom, ikke guld: den guldfarvede fylding ville give to guldkald pr. skærm.
- Ingen vandret scroll. Målt: `scrollWidth` = 412 i alle tre. Den ægte side i dag måler 494 px tabel i et
  412 px dokument, altså 82 px bag kanten.
- Alle tryk-mål ≥ 44 px (primary, sekundære knapper, rækker, kvitteringslinje, assistentpanelet).
- Assistenten er et lukket panel med tælling, ikke et åbent kort.
- Overblik først, faner ud: Today / Program / Development / History. Intet af det detaljerede stables
  som nye kort ned ad siden.
- Hairline-borders, 5 px radius, tabulære tal, stroke-ikoner, ingen emoji, ingen gradient/glow/skygge.

## De to spørgsmål du skal svare på

**1. Må mobil og computer vise forskelligt INDHOLD, ikke bare et andet layout?**
Alle tre mockups gør det: telefonen viser dagens løbsdage pr. rytter, mens desktop-tabellen også har
form, træthed, fokus og "næste +1" som egne kolonner. Siger du ja, bliver mobil sin egen visning med
sit eget udvalg af data (det du meldte ud i Discord 11/8). Siger du nej, skal alle kolonner kunne nås
på telefonen, og så er tabel-formen den eneste af de tre der kan holde.

**2. Skal "Gruppér efter type" væk på mobil?**
Den fylder en hel række over rytterne i dag, på den skærm der har mindst plads (pin 2 i `side-by-side.png`),
og to spillere har peget på den. Ingen af de tre mockups har den. @egomadsen foreslog 6/9 at tjekke i
Clarity om nogen bruger den før den fjernes. Svarer du "væk", ryger den på mobil og bliver stående på
desktop; svarer du "behold", skal den flyttes ind i tabellens toolbar-slot i stedet for at stå som
en løsrevet række.

## Copy · EN først, DA under

Mockuppene er renderet på EN, som den rigtige flade vises ét sprog ad gangen. Her er strengene i begge:

| EN | DA |
|---|---|
| Training | Træning |
| Race day 3 of 4 today. Results land at 20:00. | Løbsdag 3 af 4 i dag. Resultaterne lander kl. 20. |
| Run today's training now | Kør dagens træning nu |
| No bonus. It only runs the day earlier. | Ingen bonus. Den kører bare dagen tidligere. |
| Today / Program / Development / History | I dag / Program / Udvikling / Historik |
| Racing / training | Løb / træning |
| Yesterday: 9 trained · 5 raced · 3 points landed | I går: 9 trænede · 5 kørte løb · 3 point landede |
| Counts for sprinter | Tæller for sprinter |
| at cap | på loftet |
| Next point in 2 race days | Næste point om 2 løbsdage |
| Next point tonight | Næste point i aften |
| Pace · About 1 rating point a week | Tempo · Ca. 1 rating-point om ugen |
| This week: +2 sprint · +1 flat · +1 rating | Denne uge: +2 sprint · +1 flad · +1 rating |
| Racing now / Training now | Kører løb nu / Træner nu |
| 7 weekdays × 4 race days · a race day is one race or one session | 7 ugedage × 4 løbsdage · en løbsdag er ét løb eller én session |
| Assistant · 3 suggestions | Assistent · 3 forslag |
| Show 3 more | Vis 3 mere |
| Change | Skift |

## Render igen

Mockuppene er standalone HTML uden byggetrin. Fra `frontend/`:

```
npx playwright screenshot --viewport-size=412,900 --full-page "file:///C:/Dev/CyclingZone/docs/design/mockups-training-mobile-2026-09-18/m1-cards.html" ../docs/design/mockups-training-mobile-2026-09-18/m1-cards.png
```

`landscape-892.html` renderes på bredde 892, `compose-side-by-side.html` på bredde 1810 (gemmes som
`side-by-side.png`). Det ægte "i dag"-skud er taget med en vite-server i worktreet plus Playwright på
412 px, med e2e-fixtures som datakilde (14 ryttere) og serveren dræbt igen bagefter.

## Kilder

`../TASTE.md` · `../PAGE_TEMPLATES.md` · `../../TONE_OF_VOICE.md` · `../../TRAINING_RULES.md` §13 + §13.3 ·
`../mockups-training-2026-09-06/` (m1-m3, aldrig afgjort; m4/m5 afvist) · `../wireframes-training-2026-09-02/` ·
#3643 (kommentar 13/8, bindende kortindhold) · #4613 · #5124 (kommentar 15/9) · #5350 · #4982
