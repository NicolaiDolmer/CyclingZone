# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> **Ejer-godkendt regel 6/9: tre baner, aldrig flere.** 🔴 brand · 🟠 i gang · 🔵 ejer-go · ⚪ ikke startet. ≤1.500 tok. Spørg før omprioritering. Områdernes tilstand: `docs/FEATURE_REGISTRY.yml` (#4921).

**Reglen (ejer 6/9, afløser S3-køen 27-28/8):** **Bane 1 deadline** = kun det der er låst til S4-cutover, fast rækkefølge, intet nyt ind. **Bane 2 forretning** = indtjening, kunder, fastholdelse; viger aldrig, kører parallelt. **Bane 3 færdiggør** = alt over 70 % færdigt, ordnet efter afstand til lukning; tømmes FØR noget nyt startes. **Ventelisten** rangeres efter langsigtet værdi (hvor mange områder det løfter) og fylder bane 3 når den er tom. **Målt 6/9:** 589 åbne (34 done-gated) · 99 nye issues siden 2/9 · 12 betalende (MRR 436 kr) · S3 529 løb. **Hard regel 23/8:** ingen prod-mutation uden ejer-GO på netop det skridt.

## Bane 1 · S4-cutover 27-28/9 (deadline; ca. 3 ugers arbejde, nul buffer)

1. 🔵 **Løbssiden som faner** PR #4913 → ejer-go på preview. Opfølgere #4917.
2. 🟠 **v4 før flip** (`RACE_ENGINE_RULES.md` §9, spec 6/9): **7/9 merget: #4885 #4886 #4905 #4934 #4911 (§7b pinnet) #4910 #4936.** Rest: **#4914 kalibrering mod 7/9-populationen** (bjerg-top-10 + højbjerg-hale + felt-sammenhæng røde, holdspil A/B til ejer, M12, grupetto; prompt i `docs/drafts/next-session-prompt-2026-09-08-v4-kalibrering.md`) · #4915 TTT/passage (ejer-valg) · #4917 løbsside-opfølgere · #4948 raceDay-hjælp flag.
3. 🔵 **v4-flip** (ejer-only) → #4916 følg løbet live (efter flip).
4. 🔵 **S4-kalender:** #4270 apply (ejer inden 10/9) · #4845 kalenderpakker · #4203 monumenter ud af GT (done-gated).
5. 🟠 **Træning pr. løbsdag #4850** (ejer-go 6/9, live senest 28/9): #4846 tick → #4847 fjern Træn i dag → #4851 score → #4852/#4853/#4854 D1-D3 → #4848 vagter → #4849 tests+help+patch note. #4801 +1-loft merges i pakken; #4874 brosten/aggression.
6. 🔵 **Mandatet flip** (G1, deadline 27/9): #4857 backfill (ejer-go) → #4859 flip → #4858 slet BoardPage. #4837-4839/#4855/#4856 done-gated.
7. 🔵 **Cutover-pakke:** #4592 inaktive (ejer godkender liste) → #452 → #4759 late_fill · #4619 trup-datamodel bag flag · #4860 sponsorpris mod S4 · #4376 base ved oprykning.

**Risiko (Fable 6/9):** pkt. 5-7 ryger hvis v4 driller. Claude skærer ikke selv; ejeren vælger.

## Bane 2 · Forretning (viger aldrig; SSOT [`2026-09-02-30-dages-pengeplan.md`](superpowers/specs/2026-09-02-30-dages-pengeplan.md))

Mål 2/10: ≥ 450 kr / ≥ 10 · checkout ≥ 60 % · D7 ≥ 45 % · aktive/7d ≥ 100. **Målt 7/9: 90 — under målet.**
8. 🔴 **BRAND · Brugerfald #4960** (kører 7/9): 142→90 aktive/uge (-37 %). Skil S3-launch-decay (start 28/8) fra chunk-frafald FØR konklusion. Supabase = primærkilde. Måling, ikke fix.
9. 🔴 **BRAND · Chunk-fejlen #4595** (CYCLINGZONE-56, `escalating`): 866 events / **50 af 90 brugere**. Culprit `src/lib/lazyWithRetry` — retry-værnet fanger den ikke. Framet som deploy-verify-støj (#2423); kan være forkert. Ejer 7/9: efter #4960, før #4914.
10. 🔵 **Nøgleblok #4616** (ejer ~30 min) låser op: Pro i euro PR #4608 → #4645 pris-synk → #4646 frafald · #4074 · #4005.
11. 🔵 **Mail-loop:** Mail v2 merget (#2853) → ejer-GO dry_run → on pr. type → #2760 win-back (77 m. samtykke).
12. 🔴 **Spiller-kommunikation #428:** MAN uge-note · ONS spørgsmål · SØN ugens øjeblik · #4820 indholdsplan + spørgeskema · tråd-bank #4117. Ejeren poster selv.
13. ⚪ **Nye spillere:** #4067 SEO-site (1 indekseret side i dag) · #3796 "hvor hørte du om os" · #4811 signup-sprog · #4321 PostHog. **Fastholdelse:** #4751 social-pakke · #4818/#4819/#4821 forum · #4235 forum vs Discord 15/9.
14. 🔵 **Billing-vagter:** #4514 ubetalt m. Pro-adgang · #4512 fornyelsessti.

## Bane 3 · Færdiggør (>70 %; tømmes før nyt)

15. **Lukkesession (ejer, 30 min):** 34 done-gated issues lukkes. Ingen kode.
16. 🟠 #4921 feature-register (PR på vej) · #4918/#4919/#4920 bølge-drift.
17. 🔵 Akademi: #4495 fangne graduates (ejer-valg) · #4213 tilbud på AI-ejede · #4750 +2 intake · #4423/#4418 rytter væk midt i løb (done-gated).
18. Design-rest (#4622): #4627 spejl · #4628 anti-slop-luk · #4813 · #4814 (ejer-valg) · #4815 · #4613 træningsside.
19. Drift: #4147 atomar afslutning (done-gated) · #4866 timeout (done-gated) · #4869 406 · #4877/#4900/#4899/#4896/#4903 vagt-støj · #4867 db-genstart · #4828/#4829 AI-trim · #2423 skew (ejer: rør ikke).
20. Spillerfund: #4872 værdi står stille · #4589 løn ved holdskifte · #4702 bunch-tid · #4873 status · #4875 ikoner · #4861.

## Venteliste · langsigtet værdi (fylder bane 3 når tom; ejerens område-rækkefølge 2/9)

1 **design-kit/anti-slop** (løfter alle 16 områder) · 2 **drift/tempo** · 3 **rytterudvikling/træning** (#4629 programmer · #4630 workshop · #4633 formtræning · #3664 rating v3 · #3709 · #4765 · #4831 · #4206 identiske stats) · 4 **løbsmotor/taktik** (#3855 intra-etape · #4599/#4600 dagsform · #4611 team radio · #4612 scout løb · #4614 · #4596) · 5 **dashboard/indbakke/dag 1** (onboarding: død `OnboardingModal` væk) · 6 **planlægning** (P0 #3329 · P2 #3049/#2794 · P3 #4201) · 7 **kalender** (#4176 · #4103 · #4122 · #4123) · 8 **trupper** (#4620/#4621 U23/junior) · 9 **økonomi** (B2: #3732 · #3360 · #3720 · #1441 · #1310 AI-bud/uopfordrede) · 10 **fair play/roller** (#3131 · #3818 · #4537 · #4268) · 11 **vision** (verdenshistorik #2359 · klubmuseum #1154 2027).

**Grundreglerne B/B2/C (ejer 28/8):** efter 27/9; kun rene FEJL rettes før (#4098 done-gated).

## Stående (viger aldrig)

**Doktrin:** styrke straffes ALDRIG · 1 rytter = 1 løb pr. LØBSDAG · simulér-før-ship · et gulv er aldrig en godkendelse · mere fog of war (6/9) · maks +1 pr. evne pr. dag (5/9). **Ejer-beslutninger 27-28/8 (genåbn ikke):** løbsdage 1-baseret · afmeldt hold stiller ikke op · løbsdag = bindings-enhed · minimum 6, fladt · to regenereringer forbudt. **Balance:** #2557 ENESTE åbne. **Race engine:** ÉN v4; v3 låst fallback; flip ejer-only. **FROSSET:** #2217/#2218 · #4099/#4100 · #2960.
