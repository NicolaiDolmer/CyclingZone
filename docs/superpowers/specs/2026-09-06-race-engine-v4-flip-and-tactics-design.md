# Løbsmotor v4: flip og taktik. Ejerbeslutninger 5-6/9 2026

> **Status: låste ejerbeslutninger fra design-session 5-6/9 (Claude Code, ét spørgsmål ad gangen, billeder i hvert kort). Grundlag: [`docs/audits/race-engine-v4-audit-2026-09-05.md`](../../audits/race-engine-v4-audit-2026-09-05.md) (7 laner + skeptiker pr. lane). Reglerne i kort form står i [`docs/RACE_ENGINE_RULES.md`](../../RACE_ENGINE_RULES.md) §9; denne fil er rationalet og byggekøen. Genåbn ikke beslutningerne.**

## 0. Udgangspunkt (målt 5/9)

Der findes præcis én v4: `backend/lib/engine/v4` (25 filer, 291 grønne tests). Fem mekanikker er koblet ind (bjergselektion, nedkørsel, finale, udbrud, sprint-tog). Otte mekanikker er bygget med grønne tests, men kaldes aldrig (uheld, bonussekunder, vejr, brosten/grus, distance-slid, indsatsvalg, holdtidskørsel, ordre-adapter). Der er ingen tænd/sluk-knap, intet kaldssted i prod, ingen vej fra motorens output til `race_results`, og ingen kill-switch til v3. "Bygget" og "koblet ind" er to forskellige kolonner, og de skal altid stå adskilt i mekanik-kataloget.

## 1. De syv beslutninger

| # | Beslutning | Ejerens valg | Konsekvens |
|---|---|---|---|
| 1 | **Flip-scope** | **B: mindst v3-paritet + de tre krav** | Flip-minimum = alt spillerne har i v3 i dag koblet ind i v4 (styrt, bonussekunder, indsatsvalg, holdspil med hold-id på rytteren, vejr/brosten/grus/distance-slid), plus #2789, #2944, #2582, plus flag, kaldssted, output-mapping og kill-switch. Ankre grønne før "klar". 28/9 er et mål der måles mod, ikke en garanti; S3 kører færdig på v3 |
| 2 | **Intention: hvor** | **B: etape-vælger øverst, rolle = standard, intention = dagens overlay** | Rollen gælder hele løbet. Intentionen vælges pr. rytter pr. etape; "ikke valgt" vises som "kører sin rolle". Endagsløb: samme kolonne uden etape-vælger. Mobil: stablede kort. Mockups: `docs/design/mockups-intention-2026-09-05/` |
| 3 | **Intention: pris** | **Model C** (spec 3/9 §4) | Fem trin i SAMME felt (`race_stage_roles.effort` 3 → 5: grupetto, save, normal, protect, all_out). Træthed bagefter (grupetto < save, all_out > protect), chance i løbet via holdarbejdets pris (all_out fjerner prisen, loftet til 0, aldrig bonus over egen evne), træningsudbytte den dag (S4). v4 M12 (kraftbudget) lægges oveni ved flip med samme enum. Shippes mod v3 nu bag eget flag |
| 4 | **Styrt og mekaniske uheld** (#2944) | **A: trappen** | Let styrt = tidstab, kører videre. Hårdt styrt = stort tidstab + skade i dage. Alvorligt styrt = udgår + skadedage, sjældent. Mekanisk uheld = altid kun tid, aldrig udgåelse, aldrig skade; hjælper tæt på = hurtigere hjulskift. Kun styrt kan skade (#4520). v4 arver v3's loft over antal uheld pr. etape; hyppighed kalibreres i harnesset mod ca. 1-2 % pr. etape |
| 5 | **Tidsgrænse** (#2582) | **B: UCI-reglen** | Uden for tidsgrænsen = ude af løbet (etapeløb), DNF (endagsløb). Stor gruppe der kommer samlet i mål reddes. Grænse pr. etapetype (udgangspunkt UCI 5-20 %), tallet vises aldrig, kun "uden for tidsgrænsen" (OTL). AI-hold rammes af samme regel. Kun v4 |
| 6 | **Rute-huller** (#2789) | **A: luk alle seks før flip** | Fire lukkes af segmentmodellen (efterprøves mod rigtige S3/S4-ruter), dronningeetaper kræver bjerg-kalibrering (#4707), brostens-finaler kræver sektorer tæt på mål i rutegeneratoren + at v4 læser `sectors` + brostens-mekanikken koblet ind. Enkeltstarters 80 hm rettes i samme spor |
| 7 | **PR #4864** (hjælp om Mandatet) | gennemgås i morgen | ikke merget |

## 2. Tre regler der holder på tværs

1. **Aldrig gratis alt-ud.** All_out koster altid strengt mere træthed end normal.
2. **Styrke straffes aldrig.** Inden for samme gruppe kan lavere evne aldrig give bedre tid, uanset intention, uheld eller tidsgrænse (RACE_ENGINE_RULES §3 invariant 3).
3. **Mere fog of war.** Ingen procenter, multiplikatorer eller grænser på spillerens skærm. Han ser "taber 40 sek.", "ude i 4 dage", "uden for tidsgrænsen".

## 3. Byggekø (én PR-kø, ingen patch notes i PR'erne, én samlet note til sidst)

| Rk. | PR | Branch | Status 6/9 kl. 01 |
|---|---|---|---|
| 1 | v4 flip-infrastruktur: flag `race_engine_v4`, kaldssted i raceRunner, output → race_results, engine_version 4, kill-switch, ydelsesmåling | `feat/v4-flip-infrastructure` | bygges |
| 2 | Intention backend mod v3: enum 3 → 5, træthed + work-cost med loft, træningskrog, migration, tre invarianter | `feat/4632-intention-backend` | bygges |
| 3 | Uheldstrappen i v4 (M10 koblet ind) + mekaniske uheld + hjælper-hjulskift + harness-måling | `feat/2944-v4-incident-ladder` | bygges |
| 4 | Tidsgrænse i v4 (ny mekanik, OTL-udfaldsklasse, grupetto-redning) + harness-måling | `feat/2582-v4-time-limit` | bygges |
| 5 | Intention UI (holdudtagelsen, variant B) på PR 2's kontrakt | efter PR 2 | ejer-go på preview |
| 6 | Paritets-bølge: bonussekunder, indsats (M12), holdspil (hold-id i kontrakten), vejr, brosten/grus, distance-slid koblet ind, hver med harness-måling | efter PR 1+3+4 (samme filer) | workflow |
| 7 | Rute-huller: sektorer tæt på mål i rutegeneratoren, v4 læser `sectors`, brostens-mekanik ind, 80 hm på enkeltstarter, verifikation af alle seks på rigtige ruter | efter PR 6 | |
| 8 | Bjerg-kalibrering + gate-pin (population + seeds låst, aggregering rettet) | #4707 | |
| 9 | Doc-reparation: de 21 modsigelser i RACE_ENGINE_RULES.md rettet til målt tilstand; ankertabellen skrives af harnesset | efter PR 2-4 | |
| 10 | Samlet patch note + help.json (en+da) + sæsondrejebog med v4-flip | ved close-out af bølgen | |

**Gate før "klar til flip":** alle ankre grønne på pinnet population + 5 seeds, uheldsrate og OTL-rate målt, andel S4-ruter med ægte segmentdata målt (S3 målt 6/9: 1.239 af 1.239 etaper har segmenter, 102 har brostens-sektorer, 66 er brostens-etaper; S2 havde 0 segmenter, så syntetiske segmenter rammer kun historik), én v4-etape med 180 ryttere under 60 sekunder, kill-switch-test grøn. Flip er ejerens valg alene.

## 4. Åbne punkter (stilles ét ad gangen, senere)

- Hvad sker der med bonussekunder og bjerg-/spurtpoint ved flip: v4's egen mekanik eller det eksisterende lag uden for motoren (dobbelt-tildeling må ikke ske).
- Hvor sjældent er "sjældent" (alvorligt styrt): fastsættes af harness-målingen, ejeren ser tallet før klar.
- Rollen som standardordre på fladen ("Standard: jæger. I dag: bliv i feltet") er dækket af beslutning 2; ordre-kæden fra spiller til motor (adapteren kaldes af ingen) lukkes i paritets-bølgen.
- Gennemgang af PR #4864.
