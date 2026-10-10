# Den rene motor-revision: alle kendte løbsmotor-fejl rettet i én tænding

> **Status:** ejer-design 10/10 (motor-designsession i morgenblokken). Spec skrevet til ejerens godkendelse; ingen kode før godkendt spec og plan.
> **Kompas:** MASTERPLAN 🔴 brand punkt 2 ("Løbsmotoren fejlfri"), ejer 8/10 "motor + træning = tillid, ikke flere fejl nu".
> **Refs:** #6200 #6201 #6428 #6185 #6156 #6158 #6349 #6352 #6338 #6350 #6186 #5907 #2783 #6285 #6397 #6305

## 1. Mål

Løbsmotoren er fejlfri: alle kendte motorfejl er rettet, bevist og tændt i prod i **én** samlet revision, så hurtigt som gaten (§4) tillader. Bagefter bygges løftet (nye etapetyper, taktik i lag, vind og vejr) på en ren motor.

**Succes:** den dag revisionen tændes, er fejl-områderne i §2 tomme. De første løb efter tænding verificeres i prod, og spillerne melder ikke nye motorfejl i de første 7 dage.

## 2. Ejerens beslutninger 10/10 (låst, genåbnes ikke)

| # | Spørgsmål | Valg |
|---|---|---|
| U | Udrulning | **Én samlet ren revision**, tændt så hurtigt som muligt, når gaten er grøn (ikke låst til S5) |
| D1 | Hvor tit vinder den bedste klatrer en bjergetape (nedkørselsfinale)? | **5-8 af 12** (ca. 40-65 %); nr. 10 er 60-150 s efter vinderen og **varierer** fra løb til løb |
| D2 | Udbrud dagen efter en bjergetape | Afgjort af de låste udbrudsmål fra 8/10 (RACE_ENGINE_RULES "Udbrudsmål"); ingen ny regel, men et gate-krav |
| D3 | Hvornår er det "nedkørsel mod mål"? | Nedkørslen er sidste stykke, **eller** der er højst **5 km** uden stigning fra bunden af nedkørslen til mål |
| G | Gaten før tænding | 7 trin, alle grønne (§4) |
| F | Form | **Form er med** i revisionen; **formtoppe tændes først ved S5**; alle S4-toppe gives tilbage (#6158) |
| B | Hvem må selv prøve at gå i udbrud uden ordre? | **Rollerne `hunter` og `free_role`** må selv forsøge. **`helper` aldrig** uden managerens ordre. Kaptajner aldrig. En eksplicit ordre vinder altid |
| T | Touren 11/10 | Kører på `official_times_v2` (målt bedre end `orders_gc_v2`: 63 mod 53 bestået) |

Allerede låst før 10/10 og uændret: 5/10-tidsreglerne (#6199/#6200), udbrudsmålene 8/10 (#5578), udbrudsstørrelsens trappe 5/10 (#6201), "styrke straffes aldrig", "1 rytter = 1 løb pr. løbsdag".

## 3. Indhold

Revisionen hedder `official_times_v3` (den findes allerede slukket fra PR #6397) og bygges som arvelinje oven på `official_times_v2`. Alt nedenfor gates på `isOfficialTimesV3OrLater` (eller tilsvarende); ældre revisioner er byte-identiske (frosne digests).

### Spor 1: Udbrud, klatring og tider (#6200 #6201 #6428 #6185)
- **Grundlag:** PR #6397 (5/10-kontrakten holder på alle 12 seeds; Fable-dom 10/10: merge-klar som slukket).
- **D1:** den afgørende stigning er i dag næsten deterministisk under v3 (Giro e7: bedste klatrer vinder 11/12, nr. 10 præcis ~100 s i 9/12). Tilføj varians fra dagsform og angreb, så D1-båndet holder. Målt 10/10: `orders_gc_v2` og `official_times_v2` giver 0/12 og nr. 10 på 3-26 s (`balance-internals/d1-compare/`).
- **D3:** `finishDescentIndexFor` og `isDescentFinishDecidingClimb` deler allerede definitionen (commit 06644dc66). RACE_ENGINE_RULES §"Nedkørsel mod mål" opdateres til 5 km.
- **B (udbrudsstørrelse #6201):** R1 (scorecard dømmer ejerens trappe), R2a (AI-hold uden klassementschance sender flere), R2b efter ejer-valg B (`hunter` og `free_role` uden ordre må forsøge på bjerg og kuperet), R3 (et farligt forsøg fra de forreste tæller ikke i trængslen). Spec-udkast: `docs/drafts/spec-6201-official-times-v3-2026-10-11.md`.
- **#6428:** kuperet endagsløb gav udbrudssejr med nr. 10 på 9-16 min (4/4 divisioner). Trin 0: genskab løbet; rettelse + test, der fejler i dag; udbrudsmarginen på kuperet/rullende måles mod ankertabellen.
- **#6185:** afsat udbryder mærkes rigtigt for nye løb (backfill af historik er kørt 6/10). Trin 0 bekræfter, om roden er løst under v2/v3.
- **Allerede løst, kun regressionstest:** #5951 (udbrud trækkes baglæns) og #6187 (hold jagter egne) er løst for alle revisioner/under v2; deres tests indgår i gaten.

### Spor 2: Form uden formtoppe (#6156)
- Grundlag: PR #6305 (`Entrant.form`, `combinedFormForStage`, `formCpModifier`, jour sans får rigtig form). **Toppens tillæg udelades**: kun `rider_condition.form` sendes. Toppe kobles på ved S5 under en senere revision.
- Spec for form: `docs/superpowers/specs/2026-10-04-form-og-formtoppe-i-v4-design.md` §3 (gælder, minus toppen).
- Effektens størrelse ("form kan mærkes, men afgør ikke løbet alene") vises som tal i ejerens go-billede (gate-trin 7).
- #6158 (toppe tilbage): dry-run nu, apply efter ejer-go på tallene, samtidig med tænding.

### Spor 3: Enkeltstart (#6349)
- På kuperet enkeltstart vejer bjergevnen mere end enkeltstartsevnen. Rettelse: enkeltstartsevnen er altid den primære evne på en enkeltstart; klatring vægter kun efter stigningernes andel. Test pr. profil (flad, kuperet, bjergenkeltstart).

### Spor 4: Taktik og regler (#6352 #6338)
- #6352: en sprinter som kaptajn i et fladt endagsløb får sit tog og togets effekt.
- #6338: holdklassementet i etapeløb bruger tiden uden bonussekunder (UCI). Gælder kun nye løb.

### Spor 5: Gaten som ét script
- `backend/scripts/dev/cleanRevisionGate.mjs`: kører trin 1-5 (§4) og skriver ét svar, GRØN eller RØD, med årsag pr. trin. Tal går til `balance-internals/clean-revision/` (privat, hard rule 17).
- Kører dagligt under byggeriet. Ejeren ser røde trin, ikke enkeltfejl.

### Ved siden af (ikke motor-revision, almindelige PR'er)
- #6350 race-film-tidspunkter · #6186 hjælp = motor (skrives færdig samtidig med tænding) · #5907 U23-løb uden resultat · #2783 GT-arketype med 2/10 højbjergsetaper.

## 4. Gaten (ejer-godkendt 10/10)

Alle 7 trin skal være grønne. Ét rødt trin = ingen tænding, og ejeren får besked med årsag og ny vurdering.

1. **Låste regler holder på hver simulering, ikke i snit:** 5/10-tidsreglerne, udbrudsmålene 8/10 (inkl. D2), D1, D3, udbrudsstørrelsens trappe. Tour-cachen (`balance-internals/tour-11-10/cache.json`) og Giro-fixturen, alle etaper, 12 seeds.
2. **Hver meldt fejl har en test, der fejlede før og består nu** (én pr. issue i §3). Testene bliver liggende.
3. **Rigtig cykelsport og den tidligere motor:** ankertabellen (vindermargin, udbrud pr. terræn, nr. 10 og nr. 30) og før/efter mod `official_times_v2`.
4. **Styrke straffes aldrig:** monotoni-tests over alle evner.
5. **Løb der kører, røres ikke:** ældre revisioner byte-identiske (frosne digests); kun løb der starter efter tænding får revisionen.
6. **Uafhængig dommer (Fable)** læser hele diffen og gate-tallene; dommen vises ordret.
7. **Ejeren ser ét billede pr. spor** med rigtige tal og siger "tænd". Hjælpetekst (EN+DA) og patch note er klar samtidig.

## 5. Før tænding (teknisk tjekliste)
- Migration: `official_times_v3` tilføjes `races_engine_rules_revision_check` (additiv; apply post-merge via auto-migrate, verificeret).
- Frontend: `ORDERS_GC_LINEAGE` i `frontend/src/lib/ordersGcSurface.ts` kender v3.
- `CURRENT_RACE_RULES_REVISION` flippes til `official_times_v3` i en separat flip-PR efter ejerens "tænd" (ejer-only).
- RACE_ENGINE_RULES.md, help.json (EN+DA), patch note.
- Efter tænding: de første løb på hver profil verificeres i prod samme dag (samme tjek som 10/10 kl. 12 og 15).

## 6. Byg

- Én bølge (`wave.js`), 4 laner: spor 1 (opus/high), spor 2 (opus/high), spor 3+4 (opus), spor 5 (sonnet). Alle motor-filer gates på v3; delte filer i spor 1 og 2 (`types.ts`, `segmentLoop.ts`, `groups.ts`) koordineres med `touches` og merge-rækkefølge spor 1 → 2 → 3+4.
- Hvert spor starter med **trin 0**: genmål på main, om fejlen stadig findes (stop-klausul som i #6200).
- Skøn: tænding ca. torsdag 15/10. Datoen er et skøn; tændingen sker, når gaten er grøn.

## 7. Ikke i denne revision
Nye etape- og finaletyper til S5 (#6360 #6362 #6363 #6368), taktik i 4 lag (#5575), vind/vifter/vejr (#2476 #939), dagsform-modifikatorer (#4599), formtoppe (S5). De bygges på den rene motor bagefter.
