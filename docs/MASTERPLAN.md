# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> **Struktur ejer-godkendt 13/10: tre baner + to faste afsnit, aldrig flere.** 🔴 Brand · 🟠 Nu (højst 5) · 💰 Forretning. Alt andet bor som labels på GitHub (`priority:next`, `icebox`), ikke her. ≤1.500 tok. Spørg før omprioritering. **Intentionen** ejes af GDD'en; MASTERPLAN ejer kun rækkefølgen. Færdigt står IKKE her (patch notes + git-log). Release-gaten: #6553 (dato S6-start).

**Reglen:** 🔴 brand foran alt (motor + rytterudvikling er brand fra 7/10) · klare PR'er merges én ad gangen morgen og aften · **gør det lovede færdigt** (dato først, ældste først, samme dato parallelt) · 💰 Forretning viger aldrig: fast torsdag. Rytme: [`OPERATING_PLAN.md`](OPERATING_PLAN.md) + [`WEEKLY_STEERING.md`](WEEKLY_STEERING.md).

**Ro på spillet (ejer 7/10, til S5 25/10):** kvalitet og fastholdelse foran nyt. Datolovede ting bygges stadig.

## 🔴 Brand

Kun det der ødelægger spillet i dag. Tomt = godt.

- **Stabilitet:** aftenspidsen #6490 (målt 15/10: 39-50 min, max 50 s mod 60 s-loft; ejer-kort DROP INDEX) → job-kø #6491 + Postgres #6492 (spec #6655, ejer-valg). Verificeret 15/10: databasevagten #5878 kører, #5692 matview 0 låsefejl, chunk #5162 restsymptom (klar til lukning).
- **Løbsmotoren:** v4-bjergetaper pr. division (#6456 #6464, luk kun på ejer-go) · Tour-bjerg 13/10 + 15/10 · D3-rute #6486 · "Long day" #6475 · udbrud vinder kuperet endagsløb #6428.

## 🟠 Nu · højst 5

1. **S5-etapeprofiler #6369** (kalender #5841): live senest 18/10.
2. **Udvikling 2.0 del 1 #6499** (#6110): tilbagegang D4 + ingen udvikling uden for managerhold, til 25/10.
3. **Sæsonskifte uden fejl 25/10:** #5904 lasttest · #5864 · #5833 · bestyrelse #6130 #6122.
4. **Træningens rest:** #5947 historik · #5915 · #6210 maks +1 (PR #6248) · #5965 analyse.
5. **Lovet med dato:** #3984 (19/8+15/9) · #4714 (4/10) · meldt til S5: TTT #3463, taktik #5575 lag 2-4, U23 del 2 #4620, omdømme #4957 #5106.

## 💰 Forretning · fast torsdag (SSOT: [`GROWTH_STACK.md`](GROWTH_STACK.md))

**Mål 31/12 (ejer 13/10): 2.000 kr. MRR · 200 aktive/7d.** Målt 12/10: 620 kr. / 17 betalende / 61 aktive. Flaskehalsen er tilgang, ikke konvertering.

- **S5-lancering 25/10:** opslag pr. målgruppe (GDD D-005), postes torsdag 22/10 · annoncetest #2759 (500-1.000 kr.).
- **Pro-sporet #2806** 19-25/10 (rytterhistorik, gemte filtre, /pro).
- **Marts-fornyelser:** 11 halvårsabonnementer 2.-8/3; fastholdelsesplan fra januar.
- **Drift af virksomheden:** bogføring ajour · abonnementsgennemgang · moms EU-privat #4511 (revisor) · billing #4514 #4512 #6062.
- Måling #5305 · SEO #5249 #5250 · spillersamtaler (2 betalende + 2 stoppede).

## Faste rutiner

**Luk sløjfen (dagligt):** hver spillerrapport får issue + svar inden 24 t (Claude skriver udkast, ejeren poster) · Known issues følger patch notes · ugentligt "Status på jeres rapporter" · 0 `triage:new` > 24 t · intet blokeret uden næste skridt · done-flip ved merge. **Ejer-beslutninger:** ét kort ad gangen i morgenblokken (08:30); åbne kort står på issues med `needs-decision`. **Merge:** morgen og aften via `scripts/merge-queue.ps1`. **Roadmap på siden** spejler Brand + Nu + `priority:next` (ejeren godkender hvad spillerne ser).

## Doktrin (viger aldrig)

Styrke straffes ALDRIG · 1 rytter = 1 løb pr. LØBSDAG · simulér-før-ship · et gulv er aldrig en godkendelse · synlige ratings falder aldrig uden ejerens vidende · maks +1 pr. evne pr. dag. **Ejer 28/8 (låst):** løbsdage 1-baseret · afmeldt hold stiller ikke op · minimum 6, fladt · to regenereringer forbudt. **Race engine:** ÉN v4 (on siden 28/9); flip af regler ejer-only. **FROSSET:** #2217/#2218 · #4100.
