# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> **Ejer-godkendt 2026-08-13** (#3662; spørg før omprioritering). Status: 🔴 brand/deadline · 🟠 i gang · 🔵 ejer · ⚪ ikke startet. Budget ≤1.500 tok. Visuel udgave: [masterplan-artifact](https://claude.ai/code/artifact/e12714cc-8f93-482d-a87a-eba4e05e1635).

**Ejer-mandat 13/8:** *"Uden at der er styr på rytterne, har vi nærmest slet ikke nogen sæson 3."* Alt viger for spor B undtagen det dato-bundne.

**Målt:** **529** åbne issues (20/8) · 232 brugere, 1 abo · **S2-finale søn 23/8 kl. 19; cutover 19:30-22:30; S3-løb fra tir 25/8.** Næste session: [trin 7-finale + merge-tog](sessions/2026-08-20-aften-trin7-finale-merge-session-prompt.md).

## A · Cutover 23/8 (dato-bundet, viger ikke)

1. 🟠 **#3449 niveau-korrektion:** maskineri MERGED; gate RØD, apply ejer-gated tidligst 30/8. **#4000 k=100: PR #4007 KLAR** (draft, flag off, flip = én linje) — flippes SAMMEN med c; rækkefølge c FØR #3353 bindende.
2. 🟠 **#4013 Supabase-perf** — 3 målte fixes IND før cutover (sponsor-sweep læser 203.849×/døgn; `balanceDriftWatch` 3,3 TB pr. boot; realtime dødt, 7.727 fejl/døgn — skal virke 25/8). **Auth-commit'en REVERTERET ud af PR'en** (ejer 20/8) → `cherry-pick ac0d81200` i uge 35. **Restore-drill kører kun d. 1.** → dispatch manuelt LØRDAG med generalprøven.
3. 🟠 **#3514 mandat** — 1a/1b merged inert (PR #3834); backfill 23/8 ejer-gated, gate GRØN. Rest: staging-apply med ejer-nøgle.
4. **Løn:** rest = søndagens genberegning af frosne kontrakter (drejebogen). #3393 PARKERET.
5. 🟠 **#3901:** D1-plan LÅST+BYGGET (PR #3930, dry-run godkendt). **Cutover = søndag AFTEN 19:30-22:30** · **generalprøve LØRDAG** · bufferdag 24/8 (#3467). Drejebog script-verificeret 20/8 (trin 5 → `mandateMigration3514.mjs`; backup-trin 5a tilføjet).
6. 🔵 Auto-accept-floor bliver stående (ejer 13/8); rammer kun inaktive hold nu (#3584), aktive 25/8.

## B · Rytter-pakken — "once and for all" (ALTOVERSKYGGENDE)

Samling #3664; design LÅST 13/8. Spec: [`rating-fundament-v3`](superpowers/specs/2026-08-13-rating-fundament-v3-design.md)

9. **#3592 caps-formning → foldes ind i trin 7** (ejer 18/8; analyse i `docs/audits/2026-08-18-3592-caps-formning/`). `classifierWeights` frosset.
10. **Landing 2-rest:** ejer-gated backfill, 1.840 team-løse frie agenter — foldes ind i trin 7-udrulningen.
11. **Landing 3 = #3709.** Trin 2 (løbslære) er ALLEREDE i trin 7-PR'en (verificeret 20/8). **Trin 7** BYGGET + Week plan-fane 20/8; tester-runde kører, merge ved ejer-go.

**#3668 → #3512 = ét spor lige efter cutover** (+ transparens-sessionen; #3512 bærer et offentligt løfte fra 10/8).

## B2 · Værdi og løn (ejer-ramme 14/8)

- **Løn-pakken merged** ([audit](audits/2026-08-19-loen-design-session.md)). Rest: ⚪ #3755 28-dages-måling (gate for gebyret) · ⚪ #3756 gebyret · 🔴 #3732 pengepolitik · #4001 akademi-intake-værdi modner første søndag (fremtid: 5 træningspas før auktion).
- **Kalibrerings-session EFTER cutover** på ægte S3-tal (ejer 19/8): #3719+#3720 D3/D4-løft + upkeep · #3987 sponsor-skalering efter division/ranking (indtægtssiden skalerer ikke med udgiftssiden) · evt. løn-sats på MÅLT D1-indtægt (0,35 er ekstrapoleret).

## C · Talent-kanalen (rest)

15. 🟠 **#3854 staff-rest** (per-scout kapacitet, routing, harness-rekalibrering FØR flag-flip).
17. **#3550:** rest = flag-flip i drejebogen søndag (#2022 ejes af #3514). Fremtid: #3970.
18. ⚪ **#3853** scout-kadence-måling (efterregulering af #3846).

## D · Penge og vækst — gate: spor B leveret (ikke en dato)

20. **#2853** e-mail-loop: testes FREDAG 21/8 (kræver Resend-nøgle + 3 tekster). Største fastholdelses-håndtag.
21. ⚪ **#4015 request-budget** — 65 brugere = 4.289 requests hver/døgn. Mål igen en uge efter #4013, sæt loft på det målte. Gate for "compute op fra Small?" FØR #2853/launch bringer flere ind.
22. **#3104 /pro-indgang LIVE** (køb pauset). Rest: moms-tjek i Alunta + support-postkasse → CHECKOUT_PAUSED-flip + ét testkøb → #2813 lukkes. S3-launch-pakke man 24/8.

## E · Løbende (aldrig hovedspor)

23. Gæld: done-men-åbne lukkes løbende (KS3-workflow) · #3513 opsluger #2442/#2583/#2445.
25. Ops-sidestrøm (uge 26.-30./8): **#4014** vagt på log-strømmen (advisors ser den IKKE) · **#4016** maskinlæsbart session-claim (prosa låser intet; 6. bid 20/8) · **#3486** `VERCEL_TOKEN` (2 min ejer-klik, låser #1784) · #2758 · #3487 · #691 service-key-rotation.

## F · Backlog-bølger (mål: 570 → ~200, #3154)

**Lukkemandat:** done/dubletter/opslugte lukkes frit; won't-do i bundter a 15-20.

- **Rest:** #2085 → #2853 · **W7** efter trin 7 (#3714 #3623 #3456 #3412) · **W8**: 53 needs-decision tilbage (bundt 2 = økonomi, efter cutover).
- **Fra design-sessionen 20/8:** #4011 finance A+C ships FØR søndag · #3924 kompakt kvittering efter trin 7-merge · #2748 pension-minimum (evt. før søndag) · #4009 · PR #4008 klar.
- Småbugs: **#4017** (mark-alle-læst omskriver ALLE notifikationer → 92.560 WAL-events/døgn; én linje, før 25/8) · #3896 · #3897 · #3898 · #3917-analyse leveret (fodrer #3855).

## E2 · Race-oplevelsen

**Rest:** #3914 PR B LIVE-broadcast · #3985-fix (PR #4012, afventer ejer-go) · **#3855 motor v4** EFTER cutover (#3917 fodrer den) · #3856 backfill efter S3-bevis · #3864 klassiker-uge (S4) · #3900+#3915 låst i KS3.

## Parkeret — genbesøges når B og C er leveret

VK bølge 2-rest ([plan](superpowers/specs/2026-08-05-verdensklasse-game-plan.md)) · #2223 + #3513 · forum · små ønsker · vækst #2822/#1369/#1140/#2824/#2823 · **#2960** React 19 (uge 1 sept). **FROSSET:** #2217/#2218 · #1712 (≥300 brugere) · #1941 · #450 · live-taktik/replay.

## Stående (viger aldrig)

**Balance:** #2557 hold-dominans er det ENESTE åbne. **Doktrin:** styrke straffes ALDRIG, balance = struktur · 1 rytter = 1 løb/dag · simulér-før-ship.

## 2027-horisont (bevidst ikke i kø)

Verdenshistorik/klubmuseum · #1154 #934 #1113 #1099 #935 #2222 #26 #938 #1108 #1146 #50.
