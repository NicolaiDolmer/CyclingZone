# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> **Struktur ejer-godkendt 13/10: tre baner + to faste afsnit, aldrig flere.** 🔴 Brand · 🟠 Nu (højst 5) · 💰 Forretning. Alt andet bor som labels på GitHub (`priority:next`, `icebox`), ikke her. ≤1.500 tok. Spørg før omprioritering. **Intentionen** ejes af GDD'en; MASTERPLAN ejer kun rækkefølgen. Færdigt står IKKE her (patch notes + git-log). Release-gaten: #6553 (dato S6-start).

**Reglen:** 🔴 brand foran alt (motor + rytterudvikling er brand fra 7/10) · klare PR'er merges løbende af merge-sessionen efter arbejdsstandarden ([`GITHUB_WORKFLOW.md`](GITHUB_WORKFLOW.md), merge-tog #6861) · nyt testes på beta først, kun det vi er sikre på releases (ejer 18/10) · **gør det lovede færdigt** (dato først, ældste først, samme dato parallelt) · 💰 Forretning viger aldrig: fast torsdag. Rytme: [`OPERATING_PLAN.md`](OPERATING_PLAN.md) + [`WEEKLY_STEERING.md`](WEEKLY_STEERING.md).

**Ro på spillet (ejer 7/10, til S5 25/10):** kvalitet og fastholdelse foran nyt. Datolovede ting bygges stadig. **Verdensklasse-køreplan (ejer 19/10, efter S5-skiftet; [`spec`](superpowers/specs/2026-10-19-world-class-roadmap.md)):** fundament #6917 ∥ race engine #6914 → oplevelse (mobil #6916 · desktop #6918 · palet #6915) → vækst #6919.

## 🔴 Brand

Kun det der ødelægger spillet i dag. Tomt = godt.

- **Stabilitet ved 10x:** aftenafregningen #6490 (ejer 24/10: meget høj prioritet, følges til dørs; parallel-knappen måles → job-kø #6491 + direkte Postgres #6492, design #7070) · ranglisten #6765 (M1.5 merget, skyggen on (prod 26/10)) · Postgres-genstart under S5-start + /api/academy/me én query #7223.
- **Sikkerhed:** nøglerotation #7029 (tilbagekald + Resend/Discord/VAPID; webhook-secret efter 25/10) · #7034 klar som nødvej.
- **Løbsmotoren v3 er live siden 26/10 (#7237; alle valg på #6804):** udbrud og forspring #6912 · pointjagt #2757 · bjergpoint #6937 · lead-out · udgåede + sygdom #6938 · GT-enkeltstart #6595 · bjergudbrud #7160 · 5 indsatstrin kalibreret #6641 · D3 #6486 · løbsfilmen med motoren (#6814 #6803) · formtoppe #6156 (tændt 26/10) + Form 2.0 #6984 (tændt 25/10). Plan og backlog: [`RACE_ENGINE_PLAN.md`](RACE_ENGINE_PLAN.md).
- **Spillerne må aldrig se forkert information (ejer 20/10):** #6935 rest (PR #7145) · rytterkortets forrige værdi #6934 (afventer ejer) · ét rutematch-tal #6207.

## 🟠 Nu · højst 5 (ejer-godkendt 20/10, opdateret 25/10 aften)

1. **Før første etape 28/10 kl. 11 (ejer 26/10):** klassement og favoritter i udbrud #7258 · taktik-pakken #7266 (ordrer før start #7264, femtrins-indsats, etapeplan, delt kaptajn #7239, sande tekster #6746) · AI-ungdomsløft #6668 (før 14:30) · genstarten og akademisidens belastning #7223 · løbsbiblioteket #6636.
2. **Udvikling 2.0 #6110 (aldring, maks +1, kurve B og potentialet live 25/10):** tilbage er catch-up + Udviklingsscore #6950 (PR #7194) → Træn nu B #6461 (PR #7191) som separat tænding.
3. **Taktik, roller og ruter, endnu ikke færdige (ejer 25/10 + 26/10):** taktik-pakken #7266 og taktiklag 1-6 (angrebspunkt, følg rival, sent soloangreb, hvis-så, trøjejagt, sidevind; designet 26/10) · luksushjælper #5982 · udbrud-navne + ordre bagefter #6299.
4. **Alt lovet, dato først (#6947):** TTT #3463 · U23 del 2 #4620 · omdømme #4957 #5106 · indstillinger #3984 (A) · bestyrelsen #7101 (A) + gennemgang #7167 · auktionsporten #7215 (beslutning torsdag 29/10).
5. **Beta → live:** Form 2.0 og potentialet live 25/10 · næste beta: løbskort/historik + Kalender | Tabel #6683 (ejer-go 25/10) · Udviklingsscore + træningsside · catch-up/Træn nu · ryttertype-kontakten #5327 ("kun superstjerner") bygges og måles før tænding.

## 💰 Forretning · fast torsdag (SSOT: [`GROWTH_STACK.md`](GROWTH_STACK.md))

**Mål 31/12 (ejer 13/10): 2.000 kr. MRR · 200 aktive/7d.** Målt 12/10: 620 kr. / 17 betalende / 61 aktive. Flaskehalsen er tilgang, ikke konvertering.

- **S5-lancering 25/10:** opslag pr. målgruppe (GDD D-005), postes torsdag 22/10 · annoncetest #2759 (500-1.000 kr.).
- **Pro-sporet #2806** 19-25/10 (rytterhistorik, gemte filtre, /pro).
- **Marts-fornyelser:** 11 halvårsabonnementer 2.-8/3; fastholdelsesplan fra januar.
- **Drift af virksomheden:** bogføring ajour · abonnementsgennemgang · moms EU-privat #4511 (revisor) · billing #4514 #4512 #6062.
- Måling #5305 · SEO #5249 #5250 · spillersamtaler (2 betalende + 2 stoppede).

## Faste rutiner

**Luk sløjfen (dagligt):** hver spillerrapport får issue + svar inden 24 t (Claude skriver udkast, ejeren poster) · Known issues følger patch notes · ugentligt "Status på jeres rapporter" · 0 `triage:new` > 24 t · intet blokeret uden næste skridt · done-flip ved merge. **Ejer-beslutninger:** ét kort ad gangen i morgenblokken (08:30); åbne kort står på issues med `needs-decision`. **Merge:** morgen og aften via `scripts/merge-queue.ps1`. **Roadmap på siden** spejler Brand + Nu + `priority:next` (ejeren godkender hvad spillerne ser); en feature i beta kommer selv på roadmappet med tekst godkendt ved byg (#6693).

## Doktrin (viger aldrig)

Styrke straffes ALDRIG · 1 rytter = 1 løb pr. LØBSDAG · simulér-før-ship · et gulv er aldrig en godkendelse · synlige ratings falder aldrig uden ejerens vidende · maks +1 pr. evne pr. dag. **Ejer 28/8 (låst):** løbsdage 1-baseret · afmeldt hold stiller ikke op · minimum 6, fladt · to regenereringer forbudt. **Race engine:** ÉN v4 (on siden 28/9); flip af regler ejer-only. **FROSSET:** #2217/#2218 · #4100.
