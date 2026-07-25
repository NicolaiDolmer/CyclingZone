# NOW — Aktuel arbejdsstatus

> **Produktkompas:** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) ([#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145)). **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md). **Vision:** verdensklasse-managerspil + økonomisk levebrød. **Arbejdsform:** Fable = arkitekt, sonnet-subagenter i worktrees; PR der afventer justering = draft.

## Aktiv styring — ALT handler om cutoveren

**Sidste S1-etape søndag 26/7 19:00 · cutover-vindue ~19:30-20:30 · første S2-etape mandag 27/7 11:00.** Drejebog: [SEASON_TRANSITION_CHECKLIST](SEASON_TRANSITION_CHECKLIST.md) (8 skridt + rollback pr. skridt, generalprøvet 23/7 med dry-run uden fejl; #2805-spærren live). Post-cutover-tjekliste: [#2846](https://github.com/NicolaiDolmer/CyclingZone/issues/2846).

> **🎯 Next action (ejer):**
> 1. 🔴 **[#2851](https://github.com/NicolaiDolmer/CyclingZone/issues/2851) BYGGET + MERGED 25/7** (PR #2934: unit-testet fordeling, motor-gate `season_end_skip_division_movement` (fail-safe off), `compressPyramid.js` med snapshot-rollback, drejebog skridt 3-0/3b). **Foreløbig 48/96/9-liste + økonomi-sim ligger på issuet** (upkeep 3,84 → 10,56 mio. bekræftet; 153 managerhold nu, cutline-144-margin kun 4 p). **Ejer-gates søndag:** endelig liste ~17:30 (dry-run) godkendes FØR "Afslut sæson"; Discord-tekst godkendes ordret (udkast i session-opsummering 25/7).
> 2. 🔴 **Go til pensions-/kontraktvarsel `--live`** ([#2700](https://github.com/NicolaiDolmer/CyclingZone/issues/2700)) — **30 ryttere på 27 menneskehold stopper**. Dedup 24 t → **skal ud i aften (lørdag)**. 0 varsler sendt nogensinde.
> 3. **Mandagsvagt 10:45-11:30** — hvem? Ellers en selvkontrol kl. 11:30 (antal completede S2-løb ≥ 1).
> 4. **Ejer-ja til datareparation #2881** (48 ryttere, SQL klar i `database/proposals/`, løn kan ikke genskabes) + **#2892 Sentry-kvote-afklaring** (26/27 cron-monitorer disabled).
> 5. Ikke-cutover: #1903 Alunta-testkøb + #2806 `/pro` · e-mail-loop #2853 (3 tekster + 2 Railway-keys) · markeds-valg [#2884](https://github.com/NicolaiDolmer/CyclingZone/issues/2884)/[#2885](https://github.com/NicolaiDolmer/CyclingZone/issues/2885) · [#2905](https://github.com/NicolaiDolmer/CyclingZone/issues/2905)/[#2906](https://github.com/NicolaiDolmer/CyclingZone/issues/2906) planner-UX + Mit Hold.

> **🩺 Cutover-audit 25/7** (16 agenter, 127 fund, 119 overlevede) → **[#2907-#2926](https://github.com/NicolaiDolmer/CyclingZone/issues/2907)**, rapport `docs/audits/season-cutover-audit-2026-07-25.md`. **PITR verificeret AKTIV** — rollback findes, granularitet ~2 min. **P0-bølgen MERGED 25/7 (7 PR'er):** #2907 payroll-paginering (PR #2931) · #2908 sæsonside alle divisioner (PR #2930) · #2879 pulje-faner (PR #2928) · #2881 akademi-kontrakt (PR #2929, reparation ejer-gated) · [#2909](https://github.com/NicolaiDolmer/CyclingZone/issues/2909) sponsor-renown (PR #2927) · #2894+#2902 kontraktfelt-kilden (PR #2933, drift bekræftet; backfill af 1.326 ryttere EFTER cutover) · #2851 (PR #2934). Søster-fund [#2932](https://github.com/NicolaiDolmer/CyclingZone/issues/2932) board-weekend-paginering: PR #2935 MERGED. Tunge motorfund til efter skiftet: [#2913](https://github.com/NicolaiDolmer/CyclingZone/issues/2913) sponsor-rate /28 men pr. etape · [#2910](https://github.com/NicolaiDolmer/CyclingZone/issues/2910) træthed nulstilles ikke (86,7/100) · [#2911](https://github.com/NicolaiDolmer/CyclingZone/issues/2911) akademiet: 21 ud, 0 ind.

> **📈 Prod:** 161 brugere · 134 nye på 30 d hvoraf **~62 % aldrig kommer igen** (korrigeret fra 73 % — consent-gaten skjuler 35 %, rodårsag #2041) · 41 WAU / 8 DAU · **0 abonnementer**. Anskaffelsen virker, fastholdelsen gør ikke.

> **Afsluttede spor (detaljer i issue-tråde + git-log):** Design #2849 **LUKKET** 25/7 — alle 52 sider på T1/T2/T3, 9 brugerrettede defekter fundet, bundle 918 → 836 KB; rest i [`ELEVATION_2849.md`](design/ELEVATION_2849.md) · Driftsaudit 25/7 → #2891-#2902, 13 af 23 fund afkræftet (backup, nedbrudsdetektion, transferbetalinger, auktionspriser er sunde — jag dem ikke); PR #2878/#2844/#2904 merged · Discord-sweep 25/7 → #2879-#2889 · Løbsmotor Sub-1/2/3/4 LIVE · Akademi #2796 LIVE · Peak-planner LIVE.

> **Før søndag:** kun [#2892](https://github.com/NicolaiDolmer/CyclingZone/issues/2892) tilbage (Sentry-kvote = ejer-klik). #2902 afklaret 25/7: drift, cutover-sikker (NULL udelades stille), kilde lukket i PR #2933. #2879/#2881 merged.

> **Åbne ejer-beslutninger:** #2699 akademi-overflow · #2697 scout-slot · #2670 ROI-loft · #2452/#2176 (når v4 kan måles). **Ejer-klik:** #929+#2258 OTP+leaked-pw · #2588 · #2680.

> **🤖 Working agent:** Ingen aktiv session (25/7 aften: patch-notes-gap-audit lukket med 7.60 — 3 huller fra ugen; Discord-roundups 20-25/7 afventer ejer-godkendelse i chat). **Bølge 1+2 afsluttet 25/7 (16 PR'er merged):** P0-bølgen (se 🩺 ovenfor) + bølge 2: #2896 terræn-nøgler (PR #2939, +CI-guard) · #2880/#2165/#2603 én z-index-skala (PR #2940) · #2883 planner-S2-banner + silent-fail-hardening (PR #2942) · #2889/#2915 hjælp: penge ved skiftet + bund 4 (PR #2941) · #2918 auktions-pensions-guard (PR #2947) + drejebogs-query rettet · audit-checket grønt igen (PR #2937 fjernede dødt endpoint). **Næste session: SØNDAGENS CUTOVER-VAGT** — drejebogen skridt 0-8; kræver ejer-go på endelig #2851-liste (~17:30) + #2700-varsel lørdag aften.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden.
- **Sikkerhed:** #691 · #929 · #2802/#2803 — alle åbne. **Skalering:** #323 (genbesøg ved ~300 brugere).
- **Overlap intended** (alle divisioner); 1 rytter = 1 løb/dag. Grace afvist (#1941 = design, ikke bug).

_Trimmet 25/7 (cutover-audit). Historik i git-log, issue-tråde + docs/audits/._
