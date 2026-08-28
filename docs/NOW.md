# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md — læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action — ejer-frister:** **#4213** spørg igen **lør 29/8** (pakken klar, venter kun på de to tekster; flet main ind først, #4248 rørte 70 spec-filer) · **#4098** spørg igen **senest søn 31/8** (unge ryttere står færdige 65 pt før loftet, 124 hold ramt) · **#4176** SSOT for kalenderreglerne **senest 4/9 OG før S4-kalenderen**. **Ejer-rest:** post [kommunikationspakken](drafts/2026-08-27-kommunikationspakke-saesonstart.md) + trup-linje + RET "Fra i morgen"-varslet · **#886** Sentry-token → Infisical · **#4361** beslut 10 stars (anbefalet) vs PAT · **Z1 #1146** PR #4323 grøn, spillertest på preview før merge. Derefter: #4317 · #4259 · #4355 · #4367.

> **✅ 28/8 leveret:** sæsonen startede kl. 11 (deploy-verify grøn 11:36, motorflag armeret). #4307 opfyldning (411 ryttere/89 hold) · #4311 · #4306 · **#4301/#4295 minimum-6 LIVE** (gulvets pris: 42 starter) · auth-klyngen (PR #4368) · #4324 kanal-funnel · #4334 typecheck-gate · **#4248 e2e-fejlguard merged** (PR #4371) · **#4350 session-afvisning merged** (PR #4372, patch 7.218 — appen opdager nu en afvist session og sender til login; to værn mod fejl-udlogning, rod-årsag udskilt som **#4369**). Sentry ikke ren: **#4213** (278 stale intake).

> **🧹 Audit + SSOT-gæld 28/8:** 642→615 åbne, done-pukkel 32→5 (27 lukket, evidens på #627). **#4103 bar et falsk done-flag** — højbjergs-målet er brudt i alle fire divisioner, nu åben igen. **#4176 ejer-frist: senest 4/9 OG før S4-kalenderne bygges** — de tre beslutninger der kun står her (regenererings-forbud, tie-break, katalog-lofter) skal ind i SSOT'erne. NYT: **#4370** React #421 på forsiden + SEO-ruterne, fundet af #4248's guard på første kørsel.

> **⚠️ Udskilt af #4344 (PR #4353 merged 28/8):** **#4356** ejer-beslutning: de 34 allerede koerte etaper, re-sim eller staa ved dem · **#4357** `loadEntrantsForRace` mangler ORDER BY (tie-break bevidst uroert indtil #4356 er afgjort).

> **⚠️ Aabne fra 27/8:** #4288 (de 3 GT'er koerer 17-18 etaper, baandet kraever 21 = umaalte) · #4282 (hold transfer-frosset af renter alene, ejer-beslutning) · #4318 (to flader siger "Race day" om to forskellige tal).

> **✅ S3 kører:** 529 løb / 1.239 etaper, 28/8 → søn 27/9. Løbsdags-udvikling (#4277) er **off** i S3, retur i S4.

> **⚠️ Invariant-fund:** #4146 (24 hold over trupgrænse) · #4204 (verify-invariants tager 20 min).

> **⚠️ Katalog-lofter + åbent valg (#4272):** D1 brosten 4,5 % (mål 6) · D4 ITT 8,1 % · D4 trækker 5/6 `summit_tour` → 16 % højbjerg og 41,9 % opad. Kræver arketype-LOFT eller flere flade Class1/2-etapeløb. **Spildesign-valg, afventer ejer. To regenereringer er forbudt.**

> **⚖️ Ejer-beslutninger 26/8:** løbsdage i træk ("løbsdag 4-5-6-7, ikke 3-5-7-12") · GT = **2** hviledage der OPTAGER løbsdagen · **monument-eksklusiviteten ophævet** (0 delte ryttere målt i alle 9 kombinationer efter #4217 — gevinsten var væk, hullerne blev betalt) · #4174: alle hold udtages ens, assistenten 1 t før.

> **💰 Værdier/løn S3 (låst, intet udestående flip):** base_value = model(c 0,811 + type-dæmpning k=100, #4000 flippet 23/8 i PR #4135) · CPV dæmpet · løn = CPV × 0,35, frosset FØR transitionen · `wage_deduction_mode = season_upfront` · upkeep 220k/70k/20k/0.

> **⚖️ Fair play:** #3818 + #4154 eksekveret 23-24/8. **Prisloft sættes IKKE** → #3138 er eneste værn. Løs ende: Wheelbarrels banned uden Discord-forklaring.

> **📣 Forum:** L1 (#4238), dashboard-kort (#4249), opbakning (#4250) live. SSOT: `FORUM_RULES.md` · `DASHBOARD_RULES.md`. Rolle mod Discord afgøres 15/9 (#4235). Rest: #4252 · #4255.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag**. **Pension:** måles på AFSLUTTET sæsons alder.
- **Race engine:** v3 er låst fallback. v4-flippet (F6) er ejer-only. v4-gaten var rød 23/8 (#4132).
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben, plus **#4256** (forældreløs branch med sikkerhedsfix, urørt). **Spiller-kommunikation:** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik, svar inden 48t ([#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428)); tråd-bank #4117.

> **🤖 Working agent:** Claude Code (Opus 5) — session 28/8 aften — #4248 merged, audit kørt. Næste: planlægning sammen med ejeren.

_Historik i git-log, issue-tråde + docs/audits/._
