# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> **Ejer-godkendt regel 6/9: tre baner, aldrig flere.** 🔴 brand · 🟠 i gang · 🔵 ejer-go · ⚪ ikke startet. ≤1.500 tok. Spørg før omprioritering. Områdernes tilstand: `docs/FEATURE_REGISTRY.yml`. **Intentionen** ejes af GDD'en; MASTERPLAN ejer kun rækkefølgen. Færdigt står IKKE her (patch notes + git-log).

**Reglen:** 🔴 brand foran alt (10/9; motor + rytterudvikling er brand fra 7/10) · klare PR'er merges én ad gangen morgen og aften · **gør det lovede færdigt** (21/9; dato først, ældste først, samme dato parallelt) · beta → alle før nyt · Bane 2 forretning viger aldrig · Bane 3 færdiggør (>70 %) før nyt. Rytme: [`OPERATING_PLAN.md`](OPERATING_PLAN.md) + [`WEEKLY_STEERING.md`](WEEKLY_STEERING.md).

## Ro på spillet (ejer 7/10, til S5 25/10)

**Kvalitet og fastholdelse foran nyt.** Vigtige ting sænkes aldrig uden god grund. Datolovede ting bygges stadig.

## 🔴 Brand (nu)

**Ejer 7/10 eftermiddag:** databasen og løbsmotoren gøres FÆRDIGE først, med resultat hver dag. Derefter rytterudvikling. Sæsonskiftet (#6320 #5904) parallelt.

1. **Stabilitet:** Supabase (#5878 · #5692 · #6265 · #6272 · #6276) · chunk #5162 (#6477 efter secret) · **aftenspidsen: træning ved 10× #6490** (job-kø #6491, Postgres #6492).
2. **Løbsmotoren fejlfri** (spillerne mærker den): **`official_times_v4` live 11/10 16:30** (#6464 #6456; accepter på #6484; Touren på v3) → **nu:** v4-bjergetaper pr. division 12/10 · Tour-bjerg 13/10 + 15/10 · D3-rute #6486 · "Long day" #6475 · film-huller → **form #6156 (S5)**. Hjælp = motor i samme PR (#6186).
3. **Rytterudvikling:** Udvikling 2.0 #6110 **besluttet 11/10**. **Del 1 til 25/10:** tilbagegang D4 + ingen udvikling uden for managerhold D6. **Del 2 bag flag i S5:** kurve, løbsdag, potentiale 1-99 (levende talent), træningsscore, skjult potentiale på unge, salg efter 5, prognoser #5764 #5683, #2798 først. Træning: 7×5 (tjek status først) · #6248 · UX-ønsker.

## 🟠 Rødderne bag de andre klager (parallelt)

Bestyrelse #5946 #6130 #5897 #6122 · sæsonskifte uden fejl #5864 (rod) #5904 lasttest #5842 #5833 · **S5-etapeprofiler #6369** (design først, kalender #5841 senest 18/10) · U23/junior #5843 #5945 #6124 #5943 #6206 · tal der ikke stemmer #6207 #6238 #5733. Vagter #6290.

## Luk sløjfen (fast, dagligt)

Hver spillerrapport: issue + svar inden 24 t (Claude skriver udkast i ejerens tone, ejeren poster) · Known issues følger patch notes · ugentligt "Status på jeres rapporter" · feedback-formularen aldrig `new` > 48 t · **GitHub: 0 `triage:new` > 24 t, `needs-decision`/`needs-design` tages i morgenblokken, intet blokeret uden næste skridt, done-flip ved merge** · roadmap på siden = denne fil (ejeren godkender hvad spillerne ser).

## Venter til 7 rolige dage

Taktik lag 2-4 #5575 · U23 del 2 #4620 · nye features uden dato. Målinger (#4321 #6273 #6275) og Codex-spor kører videre.

## Roadmap · Planned (spejles i `roadmap_items`, ejer-godkendt 11/10)

**I gang:** stabilt spil #5878 · løb næste skridt #6464 #6384 · sæsonskifte uden overraskelser #5904 · næste sæsons kalender + pausen #5841 #5833 · etapetyper der passer til ruten #6369. **Planned (kø):** Udvikling 2.0 #6110 · #3984 · #4714 · træningsrettelser #5915 #6210 · formtoppe #6156 · delt kaptajn #5981 · bedre start #1140 · egne unge stjerner #5105. **Later:** #5573 · #5574 · #3463. Resten af Next (#2887 B, #6190, #3813, #5074, #5238, #5131, værdier uden potentiale) står som idéer, til der er plads. **Not planned for 2026:** [`2026-10-05-2027-list.md`](superpowers/plans/2026-10-05-2027-list.md).

## Bane 1 · Træning færdig (ejer 1/10: "så hurtigt som muligt")

🔵 **Rest:** historik #5947 · #5915 løbsdag-numre · #5485 · #6210 maks +1 (PR #6248) · **lovet:** #5965 analyse. Leveret 10/10: #6123 #6060 #5825.

## Bane 1 · Lovet til spillerne (dato først)

19/8+15/9 #3984 (beslutning) · 4/10 #4714 (beslutning). Leveret 10/10: #4522 #5831 #5917 #5979 #6060.

## Release-gate (beta → "færdigt spil", ejer 30/9)

1. **Stabilitet:** 0 brand i 7 dage · #5911 < 2 min · #5904 · #6134  · chunk #5162 · Supabase-stabilisering #5893 (#6104 #6105) · API på eget domæne. 2. **Motor:** #6156 · v4-drift-vagt grøn · v2-etaper holder mod testen · #5978 · #5951 · #4914. 3. **Træning:** rest #5947. 4. **Økonomi:** #5842 · #5443-tjekliste ajourført. 5. **Fastholdelse:** #4964. 6. **Mobil:** #5131. 7. **Billing:** #4514 · #4512 · #4511 · #6062 periode uden faktura.

## Bane 2 · Forretning (SSOT: [`GROWTH_STACK.md`](GROWTH_STACK.md))

D7 ≥ 45 % · aktive/7d ≥ 100. Måling #5305 · SEO #5249 #5250 · billing #4514 #4512 · #6047 · spiller-kommunikation #428/#4820 (ejeren poster selv).

## Bane 3 · Færdiggør

**Tekniske standarder #6496:** #519 #6493 #6494 #6495 #5158. #6081 merge-køen · #5792 smoke + #6132 + #6120 · #2259 backup-tabeller · #5678 · #5681 · #3556 · #5507 · #4812 → #5157 · #5151 → #5152 · #5113 · #6064/#6065.

## Ejer-beslutninger (ét kort ad gangen)

**Åbne:** pengene tilbage fra 4 hold #6474 (vis saldo live først) · GitHub-secret `POSTHOG_PERSONAL_API_KEY` (#5162) · UI-billeder #6482 #6483 · #4765 svaghedernes fart · #5878 compute · #4269 token · kort F statusfejl · #6122 bestyrelse · #6248 maks +1 · #6291 D2-måling. **Besluttet 11/10:** Udvikling 2.0 · #5842 · v4 tændt · merget #6478 #6480 #6481 #6479 · tekniske standarder #6496.

## Skubbet til S5 (meldt ud) + venteliste

TTT #3463 (+ følgesager #4915) · ungdoms-op/nedrykning · taktik-epic #5575 lag 2-4 · omdømme for nation/klub #4957 og løb/personale #5106.

## Stående (viger aldrig)

**Doktrin:** styrke straffes ALDRIG · 1 rytter = 1 løb pr. LØBSDAG · simulér-før-ship · et gulv er aldrig en godkendelse · synlige ratings falder aldrig uden ejerens vidende · maks +1 pr. evne pr. dag. **Ejer 28/8 (låst):** løbsdage 1-baseret · afmeldt hold stiller ikke op · minimum 6, fladt · to regenereringer forbudt. **Race engine:** ÉN v4 (on siden 28/9); flip af regler ejer-only. **FROSSET:** #2217/#2218 · #4100.
