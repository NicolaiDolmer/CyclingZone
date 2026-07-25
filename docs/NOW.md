# NOW — Aktuel arbejdsstatus

> **Produktkompas:** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) ([#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145)). **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md). **Vision:** verdensklasse-managerspil + økonomisk levebrød. **Arbejdsform:** Fable = arkitekt, sonnet-subagenter i worktrees; PR der afventer justering = draft.

## Aktiv styring — ALT handler om cutoveren

**Sidste S1-etape søndag 26/7 19:00 · cutover-vindue ~19:30-20:30 · første S2-etape mandag 27/7 11:00.** Drejebog: [SEASON_TRANSITION_CHECKLIST](SEASON_TRANSITION_CHECKLIST.md) (8 skridt + rollback pr. skridt, generalprøvet 23/7 med dry-run uden fejl; #2805-spærren live). Post-cutover-tjekliste: [#2846](https://github.com/NicolaiDolmer/CyclingZone/issues/2846).

> **🎯 Next action (ejer):**
> 1. 🔴 **[#2851](https://github.com/NicolaiDolmer/CyclingZone/issues/2851) pyramide-komprimering BYGGES I DAG** (ejer-beslutning 25/7 — fallback-vejen forladt; auditen anbefalede fallback, ejeren valgte byg). Global rank fylder D2=48 + D3=96; ingen motor-nedrykning i dette skifte. **Gates før den må køre:** økonomi-sim ejer-set (divisions-upkeep ~4,5 → ~10,6 mio. når 48 hold betaler D2-sats) · fordelings-funktion unit-testet · motor-gate så `processSeasonEnd` springer divisions-flytningen over · navngiven 48/96/6-liste. Endelig liste genereres søndag ~19:30, ejer-godkendes FØR "Afslut sæson".
> 2. 🔴 **To P0'er skal merges før søndag:** [#2907](https://github.com/NicolaiDolmer/CyclingZone/issues/2907) `loadHumanSeasonEndTeams` mangler paginering — 2.652 ryttere mod PostgREST's 1.000-loft, så **første payroll nogensinde og bestyrelses-evalueringen kører på ~38 % af feltet**; løn kan efterbetales, men bestyrelsesdommen skriver `budget_modifier` der binder sponsorindtægt i 3 sæsoner · [#2908](https://github.com/NicolaiDolmer/CyclingZone/issues/2908) sæsonsiden renderer kun D1-3 og grupperer på NY division: 57 af 153 hold kan ikke finde sig selv på præcis den side `season_ended` sender dem til.
> 3. **Go til pensions-/kontraktvarsel `--live`** ([#2700](https://github.com/NicolaiDolmer/CyclingZone/issues/2700)) — deterministisk beregnet 25/7: **30 ryttere på 27 menneskehold stopper** (11 garanteret ved 40 år; 5 af 6 på 39, 3 af 10 på 38, 11 af 24 på 37; ingen på 36). Scriptet dedup'er 24 t → skal ud lørdag aften. 0 varsler sendt nogensinde.
> 4. **Mandagsvagt 10:45-11:30** — hvem? Ellers en selvkontrol kl. 11:30 (antal completede S2-løb ≥ 1).
> 5. Ikke-cutover: #1903 Alunta-testkøb + #2806 `/pro` (1 sidevisning på 30 d — linket har aldrig eksisteret) · e-mail-loop #2853 (3 tekster + 2 Railway-keys) · markeds-valg [#2884](https://github.com/NicolaiDolmer/CyclingZone/issues/2884)/[#2885](https://github.com/NicolaiDolmer/CyclingZone/issues/2885) · [#2905](https://github.com/NicolaiDolmer/CyclingZone/issues/2905)/[#2906](https://github.com/NicolaiDolmer/CyclingZone/issues/2906) planner-UX + Mit Hold.

> **🩺 Cutover-audit 25/7** (16 agenter, 127 fund, 119 overlevede adversariel verifikation) → **[#2907-#2926](https://github.com/NicolaiDolmer/CyclingZone/issues/2907)**, rapport `docs/audits/season-cutover-audit-2026-07-25.md`, prioriteret i MASTERPLAN 3c/9f/11d/11e/12/12b. **PITR verificeret AKTIV** (archive_mode=on, wal-g, archive_timeout=120 s, 60.237 segmenter) — rollback findes, granularitet ~2 min. Tunge motorfund til efter skiftet: [#2909](https://github.com/NicolaiDolmer/CyclingZone/issues/2909) sponsor-fornyelsen taber renown-multiplikatoren ved divisionsskifte (permanent, hvert skifte) · [#2913](https://github.com/NicolaiDolmer/CyclingZone/issues/2913) sponsor-rate divideres med 28 dage men udbetales pr. etape · [#2910](https://github.com/NicolaiDolmer/CyclingZone/issues/2910) træthed nulstilles ikke (feltet starter S2 på 86,7/100) · [#2911](https://github.com/NicolaiDolmer/CyclingZone/issues/2911) akademiet: 21 ud, 0 ind.

> **📈 Prod:** 161 brugere · 134 nye på 30 d hvoraf **~62 % aldrig kommer igen** (korrigeret fra 73 % — consent-gaten skjuler 35 %, rodårsag #2041) · 41 WAU / 8 DAU · **0 abonnementer**. Anskaffelsen virker, fastholdelsen gør ikke.

> **Afsluttede spor (detaljer i issue-tråde + git-log):** Design #2849 **LUKKET** 25/7 — alle 52 sider på T1/T2/T3, 9 brugerrettede defekter fundet, bundle 918 → 836 KB; rest i [`ELEVATION_2849.md`](design/ELEVATION_2849.md) · Driftsaudit 25/7 → #2891-#2902, 13 af 23 fund afkræftet (backup, nedbrudsdetektion, transferbetalinger, auktionspriser er sunde — jag dem ikke); PR #2878/#2844/#2904 merged · Discord-sweep 25/7 → #2879-#2889 · Løbsmotor Sub-1/2/3/4 LIVE · Akademi #2796 LIVE · Peak-planner LIVE.

> **Før søndag, ikke ejer-gated:** [#2892](https://github.com/NicolaiDolmer/CyclingZone/issues/2892) 26/27 Sentry cron-monitorer disabled siden 16/7 · [#2902](https://github.com/NicolaiDolmer/CyclingZone/issues/2902) 1.327 NULL kontraktudløb · [#2879](https://github.com/NicolaiDolmer/CyclingZone/issues/2879)/[#2881](https://github.com/NicolaiDolmer/CyclingZone/issues/2881) rammer begge skiftet.

> **Åbne ejer-beslutninger:** #2699 akademi-overflow · #2697 scout-slot · #2670 ROI-loft · #2452/#2176 (når v4 kan måles). **Ejer-klik:** #929+#2258 OTP+leaked-pw · #2588 · #2680.

> **🤖 Working agent:** Ingen aktiv session. Cutover-audit-sessionen 25/7 afsluttet (docs + 20 issues, ingen kode rørt). **Næste kritiske: [#2851](https://github.com/NicolaiDolmer/CyclingZone/issues/2851)** (Fable, alene, worktree — rører op/nedryknings-motoren) · parallelt **#2907+#2908 P0-PR** (sonnet, worktree, uafhængig) · derefter #2879/#2881, #2861. Princip: parallelisér udførelse, serialisér dømmekraft. Workers rører ikke NOW.md/MASTERPLAN.md — orkestrator samler close-out.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer 22/6):** 4-divisions-pyramide 1/2/4/8; ægte managere ind fra bunden.
- **Sikkerhed:** #691 · #929 · #2802/#2803 — alle åbne. **Skalering:** #323 (genbesøg ved ~300 brugere).
- **Overlap intended** (alle divisioner); 1 rytter = 1 løb/dag. Grace afvist (#1941 = design, ikke bug).

_Trimmet 25/7 (cutover-audit). Historik i git-log, issue-tråde + docs/audits/._
