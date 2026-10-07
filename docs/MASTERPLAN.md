# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> **Ejer-godkendt regel 6/9: tre baner, aldrig flere.** 🔴 brand · 🟠 i gang · 🔵 ejer-go · ⚪ ikke startet. ≤1.500 tok. Spørg før omprioritering. Områdernes tilstand: `docs/FEATURE_REGISTRY.yml`. **Intentionen** ejes af GDD'en; MASTERPLAN ejer kun rækkefølgen. Færdigt står IKKE her (patch notes + git-log).

**Reglen:** 🔴 brand foran alt (10/9; motor + rytterudvikling er brand fra 7/10) · klare PR'er merges én ad gangen morgen og aften · **gør det lovede færdigt** (21/9; dato først, ældste først, samme dato parallelt) · beta → alle før nyt · Bane 2 forretning viger aldrig · Bane 3 færdiggør (>70 %) før nyt. Rytme: [`OPERATING_PLAN.md`](OPERATING_PLAN.md) (ejer 3/10) og [`WEEKLY_STEERING.md`](WEEKLY_STEERING.md).

## Ro på spillet (ejer 7/10, til S5 25/10)

**Kvalitet og fastholdelse foran nyt.** Vigtige ting sænkes aldrig uden god grund. Datolovede ting bygges stadig.

## 🔴 Brand (nu)

**Ejer 7/10 eftermiddag:** Tailwind 4, databasen og løbsmotoren gøres FÆRDIGE først, med resultat hver dag. Så snart én lukker, kommer træningspakken ind (#6139 #6027 #6123 #6314 #6053). Derefter rytterudvikling. Sæsonskiftet (#6320 #5904) parallelt.

1. **Stabilitet:** Supabase (#5878; Medium ✅ · #5692 Codex · #6265 · alarm #6272 · #6276) · **chunk-fejl #5162 flyttet frem** (43 spillere, siden går i stå efter deploy).
2. **Løbsmotoren fejlfri** (spillerne mærker den): tidsforskelle #5951 #6284 #6199 → mærker #6294 #6234 #6185d2 → udbrud/klatring #6201 #6200 #6299 #6187 #5978 → #6285 motor-tests som gate før hver tænding → `orders_gc_v3` (tændes ved grønt scorecard, ejer-only) → **form #6156 EFTER v3, designes grundigt med ejeren** (PR #6305 draft-udgangspunkt; toppe tilbage #6158). Hjælp = motor i samme PR (#6186).
3. **Rytterudvikling + scoutens forventede udvikling** (spillerne har ret: den er forkert): Udvikling 2.0 #6110 (spec `2026-10-03-udvikling-2-design.md`; kurve B #3564 · #5950 · #6109 · #6059) · #5965 · projection #5764 #5683 · træningens rod #5928 · #6248 maks +1 (A/B 7/10).

## 🟠 Rødderne bag de andre klager (parallelt)

Bestyrelse #5946 #6130 #5897 #6122 #6298 · sæsonskifte uden fejl #5864 (rod) #5904 lasttest #5842 #5833 · låste budpenge #6261-#6264 · U23/junior #5843 #5945 #6124 #5943 #6206 · tal der ikke stemmer #6207 #6238 #5733. Tailwind 4 #6271 (Codex-review først, merge senest 17/10) · vagter #6290.

## Luk sløjfen (fast, dagligt)

Hver spillerrapport: issue + svar inden 24 t (Claude skriver udkast i ejerens tone, ejeren poster) · Known issues følger patch notes · ugentligt "Status på jeres rapporter" · feedback-formularen aldrig `new` > 48 t · **GitHub: 0 `triage:new` > 24 t, `needs-decision`/`needs-design` tages i morgenblokken, intet blokeret uden næste skridt, done-flip ved merge** · roadmap på siden = denne fil (ejeren godkender hvad spillerne ser).

## Venter til 7 rolige dage

Taktik lag 2-4 #5575 · U23 del 2 #4620 · nye features uden dato. Målinger (#4321 #6273 #6275) og Codex-spor kører videre.

## Roadmap · Planned (spejles i `roadmap_items.sort_order`)

**Next:** stabilitet (#5878 #6184 #5911) · #3984 · #4522 · #4714 · #5833 · #2887 B · #6190 · #5831 · #5917 · #6060 · #1140 · #5105 · #3813 · #5981 · #5074 · #5238 · #5865 · #5131 · race sharpener · værdier uden potentiale. **Later:** se roadmap_items. **Not planned for 2026:** [`2026-10-05-2027-list.md`](superpowers/plans/2026-10-05-2027-list.md). **Næste roadbook-opslag:** #5268-historien · #5912-svar · upkeep 0 · #5833-afstemning.

## Bane 1 · Træning færdig (ejer 1/10: "så hurtigt som muligt")

🔵 **Flip-liste beta → alle** (flip lukker alle i samme tur): `training_train_now` (#6006/#6027/#4847) · `training_programs` (#4629) · `training_groups` (#6000) · `season_matrix_mobile` (#5124) · `race_role_scope_choice` (#6095) · historik #5947. **Træningspakke man 5/10:** #6035 (PR #6053) · #6123 nulstil til holdprogram · #6060 · #5915 løbsdag-numre · #5485 · **lovet:** #5965 analyse.

## Bane 1 · Lovet til spillerne (dato først)

31/8 #4522 · 19/8+15/9 #3984 · 27/9 #5831 · 28/9 #5917 · 30/9 #5979 #5940 · 1/10 #6035 · 2/10 #6060 · 4/10 #4714 (rækkefølge = roadmap).

## Release-gate (beta → "færdigt spil", ejer 30/9)

1. **Stabilitet:** 0 brand i 7 dage · #5911 < 2 min · #5904 · #6134  · chunk #5162 · Supabase-stabilisering #5893 (#6102 #6104 #6105) · API på eget domæne. 2. **Motor:** #6156 · v4-drift-vagt grøn · v2-etaper holder mod testen · #5978 · #5951 · #4914. 3. **Træning:** alle beta-features til alle. 4. **Økonomi:** #5916 · #5842 · #5443-tjekliste ajourført. 5. **Fastholdelse:** #4964. 6. **Mobil:** #5131. 7. **Billing:** #4514 · #4512 · #4511 · #6062 periode uden faktura.

## Bane 2 · Forretning (SSOT: [`GROWTH_STACK.md`](GROWTH_STACK.md))

D7 ≥ 45 % · aktive/7d ≥ 100. Måling #5305 · SEO #5249 #5250 · billing #4514 #4512 · #6047 · spiller-kommunikation #428/#4820 (ejeren poster selv).

## Bane 3 · Færdiggør

#6081 merge-køen melder rød for tidligt · #5792 smoke + #6132 + #6120 · #2259 backup-tabeller · #5678 · #5681 · #3556 · #5507 · #4812 → #5157 · #5151 → #5152 · #5113 · #6064/#6065 · #5145 (parkeret).

## Ejer-beslutninger (ét kort ad gangen)

**Åbne:** Udvikling 2.0 D1-D7 + #4765 (#6110) · #5842 (før 25/10) · #5878 compute · #4269 token · kort F statusfejl · #6122 bestyrelse · #6248 maks +1 · #6291 D2-måling (presence-tabel).

## Skubbet til S5 (meldt ud) + venteliste

TTT #3463 (+ følgesager #4915) · ungdoms-op/nedrykning · taktik-epic #5575 lag 2-4 · omdømme for nation/klub #4957 og løb/personale #5106.

## Stående (viger aldrig)

**Doktrin:** styrke straffes ALDRIG · 1 rytter = 1 løb pr. LØBSDAG · simulér-før-ship · et gulv er aldrig en godkendelse · synlige ratings falder aldrig uden ejerens vidende · maks +1 pr. evne pr. dag. **Ejer 28/8 (låst):** løbsdage 1-baseret · afmeldt hold stiller ikke op · minimum 6, fladt · to regenereringer forbudt. **Race engine:** ÉN v4 (on siden 28/9); flip af regler ejer-only. **FROSSET:** #2217/#2218 · #4100.
