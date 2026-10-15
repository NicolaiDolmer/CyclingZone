# S5-etapeprofiler: design (ejer-beslutninger 12/10)

Epic **#6369** (delopgaver #6359-#6368, #3463, #5841, #5833). Designgrundlag: [`2026-10-08-s5-etapeprofiler-design-brief.md`](2026-10-08-s5-etapeprofiler-design-brief.md). Kort og billeder: `pr-screens/s5-design-12-10/kort1-6.png`. Hver beslutning er også noteret på #6369. Kalender live senest **lørdag 18/10**.

## 1. Model: tre akser pr. etape + løbets karakter (kort 1)

- **A. Terræn** (af stigningerne): flad · bølget · kuperet · mellembjerg · bjerg · højbjerg.
- **B. Afslutning** (de sidste km, geometri, ikke udfald): flad spurt · stigende spurt · bakke · mur · bjergtop · nedkørsel · enkeltstart · holdtidskørsel.
- **C. Underlag**: asfalt · brostenssektorer · grussektorer (antal, længde, sværhed).
- **Løbets karakter** (løbsniveau): monument/klassiker · Grand Tour · kort etapeløb (distance → udholdenhed).

## 2. Terræn-regel B+ (kort 2, rettet på kort 5)

Første regel der passer, oppefra:

| Terræn | Regel |
|---|---|
| Højbjerg | ≥ 1 HC eller ≥ 3 × kat. 1 |
| Bjerg | ≥ 1 × kat. 1 |
| Mellembjerg | ≥ 2 × kat. 2 på mindst 5 km, eller 1 × kat. 2 på mindst 8 km, eller kat. 2 på mindst 5 km som bjergtopmål |
| Kuperet | kat. 3 eller kort kat. 2 (**kat. 4 tæller aldrig mod kuperet**, kort 5) |
| Bølget | 2 × kat. 4; endelig regel når højdemeter regnes af ruten (#6366) |
| Flad | højst 1 × kat. 4 |

S4 (prod 12/10) med B+: flad 407 · bølget 20 · kuperet 200 · mellembjerg 278 · bjerg 137 · højbjerg 164. Tallene viser fejlmærkningen i dag; S5-fordelingen styres af kvoterne (§5).

## 3. Afslutninger og matrix (kort 3, rettet på kort 5)

- Flad spurt afløser massespurt + reduceret spurt (feltets størrelse er motorens udfald).
- Stigende spurt (ny): sidste 0,5-1 km på 2-5 %. Mur (ny): under 1,5 km på 10-20 %. Bakke: 1-3 km på 5-8 %. Bjergtop: mål på kat. 2/1/HC. Nedkørsel: sidste top 5-25 km før mål, **og den top er kat. 3 eller hårdere** (kort 5).
- **Udbrud fjernes som afslutning** (motoradfærd, #6368).

| Terræn | Tilladte afslutninger |
|---|---|
| Flad | flad spurt, stigende spurt |
| Bølget | flad spurt, stigende spurt, bakke |
| Kuperet | flad spurt, stigende spurt, bakke, mur, nedkørsel |
| Mellembjerg | flad spurt (langt efter sidste top), bakke, mur, bjergtop (kat. 2), nedkørsel |
| Bjerg | bjergtop (kat. 1), nedkørsel |
| Højbjerg | bjergtop (kat. 1/HC), nedkørsel |

Generatoren vælger kun inden for matrixen; motor-tests fejler ved en ulovlig kombination.

## 4. Rytterevner pr. afslutning (kort 4)

- Uændret: flad spurt, bjergtop, nedkørsel, enkeltstart (motorens vægte i `backend/lib/engine/v4/tuning.ts`).
- **Korte eksplosive afslutninger (mur, bakke, stigende spurt):** fast grundsæt + 20 point fordelt efter etapens hårdhed: 0-1 tidligere kategoriserede stigninger → punch, flere → **durability** (op til 20). Mur: punch 40 · acceleration 30 · position 10 + 20. **Klatring indgår ikke i mur-finalen** (ejer). Bakke: klatring 15 og taktik 15 erstattes af hybriden. Stigende spurt: sprint-tungt grundsæt + hybriden.
- Holdtidskørsel følger #3463. Udbrudsvægtene flyttes til motorens udbrudsadfærd.
- Præcise vægte fastlægges i byg-spec og måles mod motor-bench før live.

## 5. Kvoter og Grand Tour-struktur (kort 5)

Benchmark: 315 etaper, Tour/Giro/Vuelta 2021-2025 (ProCyclingStats + cyclingstage), data i `backend/lib/__fixtures__/s5Benchmark.gt-2021-2025.json` (flyttet fra `docs/design/s5-benchmark/` 15/10, #6367: Railway bygger kun `backend/`; kilder og noter står i `docs/design/s5-benchmark/README.md`).

| Antal etaper | Tour-typen (18) | Giro-typen (17) | Vuelta-typen (17) |
|---|---|---|---|
| Højbjerg | 5 | 2 | 2 |
| Bjerg | 1 | 4 | 6 |
| Mellembjerg | 1 | 2 | 2 |
| Kuperet | 5 | 4 | 2 |
| Bølget | 1 | 0 | 0 |
| Flad | 3 | 3 | 3 |
| Enkeltstart | 2 | 2 | 1 + holdtidskørsel |
| Heraf bjergtop | 4 | 4 | 7 |

Ugestruktur: ingen højbjerg i første tredjedel; kongeetapen i sidste tredjedel; én kort enkeltstart tidligt og én sent (eller sidste dag); sidste dag flad eller enkeltstart.

Motor-facit (median tidsgab vinder → nr. 10): bjergtop 116 s (80-194) · nedkørsel 64 s · enkeltstart 63 s · mur 43 s · bakke 21 s · stigende spurt 2 s · flad spurt 0 s. Pr. terræn: højbjerg 164 s, bjerg 97 s, mellembjerg 8 s, kuperet 10 s.

## 6. Etapekortet (kort 6)

Ét kort pr. etape (Løb-siden + Holdudtagelse): de tre akser hver for sig, profilen én gang med kategori-mærker og den afgørende stigning markeret, "her afgøres etapen" (sidste afgørende stigning + afstand til mål), "dagen kræver" som høj/mid/lav. Erstatter etiketten og den dobbelte profil. TASTE: hairline-kort, ingen farvede piller, tabulære tal. Spillertekst efter TONE_OF_VOICE, EN først.

## 7. Byg (efter design-go)

Bølge (`wave.js`), opus på motor/generator: generator (typen afledes af stigningerne, matrix, kvoter, ugestruktur) · ny DB-CHECK (medium_mountain, uphill_sprint, wall_finish, underlag) · motor (vægte, durability-hybrid, udbrud som adfærd) · rigtige højdemeter (#6366) · benchmark-gate i kalender-gaten · etapekortet (frontend) · i18n EN/DA + Hjælp · tørkørsel af hele S5-kalenderen → før/efter-billede → ejer-go → live senest 18/10. Hard rule 36: motor/DB-dele får målt baseline før første PR.
