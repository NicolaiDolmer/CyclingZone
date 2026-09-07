# Prompt til næste session: v4-kalibrering mod den rigtige population (#4914)

> **Model + indsats:** hovedtråd **Fable, high** (kalibrering er trade-offs mellem ankre, ikke mekanik). Workers: **opus** til kalibrerings-lanen (skal kunne modsige sig selv på 5 seeds), **sonnet** til småfund (#4947 aggregering, #4949 test-rigge). Én byg-lane ad gangen på motoren: tuning-knapperne overlapper, og to laner på samme knapper kan ikke tilskrives.
>
> Skrevet 7/9 kl. 09:00 ved close-out af natbølgen (audit: `docs/audits/night-wave-2026-09-07.md`). Kopiér teksten under stregen ind som første besked i en ny Claude Code-session i `C:\Dev\CyclingZone`.

---

Ny session. Læs `docs/NOW.md` først, derefter `docs/RACE_ENGINE_RULES.md` §7b (ankertabel, pinnet) og §9 (låste beslutninger 1-13), og den seneste kommentar på #4914 (kalibreringsbrief 7/9). Du er arkitekt; workers bygger med `model` eksplicit i hvert kald.

**Emne: kalibreringspakken #4914, målt mod den rigtige population.** Alt før 7/9 blev kalibreret mod et forældet juli-snapshot (median-evne 1 af 99). Snapshottet er re-eksporteret og pinnet (PR #4946: 5.955 hold-ryttere, følger prod). Med det rigtige felt gælder, samme motor, samme etaper, 3 seeds:

- Sprinter-vinderrate flat: 96,2 % (91,4-100), GRØN (var rød med juli-feltet)
- Bjergetape top-10-spredning: **132 s (121-148), RØD** mod 180-240 (var 212 s)
- Højbjerg-hale p90: **5,2 %, RØD** mod det låste bånd 6-12 % (var 7,3 %); bjerg 9,1 % grøn; fladt 0,2 % grøn
- Felt-sammenhæng flade: 31 % rød mod 80-95 % (rod-årsag: `finale.ts`' placerings-tiers, ikke fart-modellen)
- Felt-favoritters win-rate: 57 % rød mod 25-40 %
- Nedkørsels-/summit-ratio: 0,39 grøn, men s2 = 0,52 over loftet 0,50 (kun middel gates)
- Holdspil-gab (M16): 3,0 pladser mod v3's 19,4; niveauet er MIT valg

Læsning: det rigtige felt er stærkere og tættere i toppen, så bjergene splitter for lidt.

**Rækkefølge (én byg-lane ad gangen på motoren):**

1. **Bjerg-spredning + højbjerg-hale sammen** (opus, 5 seeds, pinnet population + etaper): knapperne er `STRENGTH_SPEED_EXTRA_TUNING` (overskuds-grenen blev dæmpet i #4935 for at spare ankeret), `PHYSIOLOGY_WPRIME_*` (udmattelse i tærsklen) og M2-selektion (`climbSelection`). Mål: top-10 inden for 180-240 s OG højbjerg-hale inden for 6-12 %, uden at sprinter, nedkørsel eller brosten går rødt. Rapportér alle ankre før/efter pr. seed; ingen anker må gå PASS→FAIL på middel.
2. **Felt-sammenhæng på fladt**: kalibrér tier-tærsklen i `finale.ts`, ikke jagt-modellen (målt i #4935: 99,7 % af feltet inden for 2 % af vinderen, men 4 målgrupper).
3. **Holdspil-gab**: A/B-måling af to niveauer (nuværende 3,0 vs. v3-paritet ~19) på alle ankre. Vis mig tallene i ét kort med anbefaling; jeg vælger.
4. **M12** (all_out gratis på fladt, tvillinge-arm 8 pladser på bjerg) og **grupetto-tempo**: genmål først efter 1, ret derefter.
5. Slet `population-snapshot-2026-07-11.json` når 1-3 er inde. Refresh §7b efter hver merge: `node backend/scripts/buildV4AnchorBaseline.mjs && node backend/scripts/renderV4AnchorTable.mjs --write`, commit på main som docs. Hale-gate: `node backend/scripts/v4TailSpread.js --population=backend/scripts/baselines/population-snapshot-2026-09-07.json --stages=backend/scripts/baselines/v4-proxy-stages-2026-09-06.json --seeds=s1,s2,s3 --field-size=180 --gate`.

**Sidespor (sonnet, kan køre parallelt fordi de ikke rører tuning):** #4947 (aggregering mangler 3 ankre + stale grus-kommentar), #4949 (test-rigge spejler ikke segment-nøgling), #4950 (descent-småfælder), #4951 (flag-rækker i app_config så registret kan vise dormant).

**Regler for sessionen:**
- Genåbn ALDRIG §9. Hale-bånd er låst (beslutning 13). Styrke straffes aldrig (invariant 3). Ingen tidsgrænse-procenter trimmes.
- Gaten er 5-seed-middel med spænd (§7 række 8). Kalibrering der flytter ét anker op og et andet ned stopper ved målingen og viser mig A/B-tal; den vælger ikke selv.
- TIER WAVE for workers (målrettede tests + tsc + preflight, CI er fuld gate), push inden 10 min og hvert 15. min, `scripts/wave-lane-watch.ps1` hvert 15. min, ny baseline i `backend/scripts/out/baseline/` efter hver engine-merge, merges én ad gangen med `scripts/merge-queue.ps1` (aldrig HH:57-HH:03).
- Vent aldrig blokerende på en worker; svar på hver besked fra mig med det samme.
- Backend-PR'er der følger beslutningerne her må du merge selv når CI er grøn (én linje til mig). Alt jeg kan se, og alt der skriver i prod, kræver mit ordrette "merge" eller "kør".
- Done-flip pr. issue efter merge. Close-out: NOW.md under 1.200 tokens, working agent nulstillet, uafsluttet som issues.

**Venter på mig, ikke på dig:** hjælpeteksten om løbsdag (#4948, usynlig til flip), #4915 TTT-punkter, #4616 EUR-nøgler, #4404 `AUTO_MERGE_PAT`, #4924 orphan-worktrees.
