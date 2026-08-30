# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md — læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action — ejer-frister:** **#4376 divisions-tillægget: PR #4388 UDSKUDT til 31/8 — ejer 30/8, må IKKE merges før han har overvejet den** (migration + balance). Ved go: jeg applier migrationen + dry-run (~79 hold, +4,8 mio CZ$) · **#3494 blokerer #4265** — sponsor-vækstmålet er umuligt (`sponsor_income` = 240.000 for ALLE 230 hold) · **#4265 vs MASTERPLAN** stadig åben · **#4213** de to tekster + NUA-køen (19 venter) · **#4098** senest **søn 31/8** (124 hold ramt) · **#4176** kalender-SSOT **senest 4/9 OG før S4**. **Ejer-rest:** post [kommunikationspakken](drafts/2026-08-27-kommunikationspakke-saesonstart.md) + trup-linje + RET "Fra i morgen"-varslet · **#886** Sentry-token → Infisical · **#4361** 10 stars vs PAT · **Z1 #1146** PR #4323 grøn, spillertest før merge. Derefter: #4259 · #4355 · #4367. **Klar til merge:** PR #4450 (#4448 exhaustive-deps → useCallback, e2e 592/0, ren refaktor).

> **📦 Backlog-bølge 30/8 (autonom) — AFSLUTTET, alt merget.** 19 issues leveret, 8 lukket som allerede løst, 3 nye oprettet (#4433 #4440 #4446). Alle PR'er merget 30/8 inkl. patch notes 7.221 + 7.222 og #4447 (exhaustive-deps-gennemgang, 1 reel fejl i NotificationsPage rettet). **Migration #2892 er APPLIED + verificeret:** `cron_checkins` live, 46 job melder sig, 0 overskredne. Verificeret mod prod: alle 3 spiller-vendte rettelser serveres. Screenshots i `pr-screens/wave-30aug/` + `pr-screens/queue/`.

> **🩹 Triage-fund 30/8 — ryttere forsvandt ud af KØRENDE etapeløb.** [#4418](https://github.com/NicolaiDolmer/CyclingZone/issues/4418): 5 ryttere væk fra 3 igangværende S3-løb, alle menneskehold. To årsager. **A skade** — udtagelsen er KORREKT (ejer 30/8), manglede bare at blive registreret → **PR #4422 klar, DU merger** (migration + rører motoren mens løb kører). **B akademikontrakt midt i løbet** → [#4423](https://github.com/NicolaiDolmer/CyclingZone/issues/4423), stadig åben fejl. **Ejer-valg B truffet:** træningsskader på løbsdage får LOV at stå i S3, løses strukturelt i S4 hvor træning flytter til løbsdage ([#3459](https://github.com/NicolaiDolmer/CyclingZone/issues/3459)). De 5 ramte ryttere: afgøres sammen med #4356. E2E-flake noteret: [#4424](https://github.com/NicolaiDolmer/CyclingZone/issues/4424).

> **⚠️ Åbne fra 28/8:** **#4103** falsk done-flag (højbjerg brudt i alle 4 divisioner) · **#4370** React #421 på forsiden.

> **⚠️ Udskilt af #4344 (PR #4353 merged 28/8):** **#4356** ejer-beslutning: de 34 allerede koerte etaper, re-sim eller staa ved dem · **#4357** `loadEntrantsForRace` mangler ORDER BY (tie-break bevidst uroert indtil #4356 er afgjort).

> **✅ S3 kører:** 529 løb / 1.239 etaper, 28/8 → søn 27/9. Løbsdags-udvikling (#4277) er **off** i S3, retur i S4.

> **⚠️ Invariant-fund:** #4146 (24 hold over trupgrænse) · #4204 (verify-invariants tager 20 min).

> **⚠️ Katalog-lofter + åbent valg (#4272):** D1 brosten 4,5 % (mål 6) · D4 ITT 8,1 % · D4 trækker 5/6 `summit_tour` → 16 % højbjerg og 41,9 % opad. Kræver arketype-LOFT eller flere flade Class1/2-etapeløb. **Spildesign-valg, afventer ejer. To regenereringer er forbudt.**

> **💰 Værdier/løn S3 (låst, intet udestående flip):** base_value = model(c 0,811 + type-dæmpning k=100, #4000 flippet 23/8 i PR #4135) · CPV dæmpet · løn = CPV × 0,35, frosset FØR transitionen · `wage_deduction_mode = season_upfront` · upkeep 220k/70k/20k/0.

> **⚖️ Fair play:** #3818 + #4154 eksekveret 23-24/8. **Prisloft sættes IKKE** → #3138 er eneste værn. Løs ende: Wheelbarrels banned uden Discord-forklaring.

> **📣 Forum:** L1 (#4238), dashboard-kort (#4249), opbakning (#4250) live. SSOT: `FORUM_RULES.md` · `DASHBOARD_RULES.md`. Rolle mod Discord afgøres 15/9 (#4235). Rest: ingen åbne.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag**. **Pension:** måles på AFSLUTTET sæsons alder.
- **Race engine:** v3 er låst fallback. v4-flippet (F6) er ejer-only. v4-gaten var rød 23/8 (#4132).
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben, plus **#4256** (forældreløs branch med sikkerhedsfix, urørt). **#4446 PR #4451 klar, ejer-go mangler** (global 600/min-limiter på /api + 12 skrive-ruter; tærskler er ejer-valg, rører live S3). De 164 code-scanning-alarmer 30/8 var et navne-artefakt fra #4392 (`getUser` → `verifyBearerToken` matcher CodeQL's autorisations-regex), ikke en ny sårbarhed. **Spiller-kommunikation:** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik, svar inden 48t ([#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428)); tråd-bank #4117.

> **🤖 Working agent:** Ingen aktiv session.

_Historik i git-log, issue-tråde + docs/audits/._
