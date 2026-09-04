# Akademiet som paraply: Junior team, U23 team, Senior team (design 2/9 2026)

> **Status:** ejer-beslutninger låst 2/9 2026 i brainstorm-session (8 spørgsmål, svar nedenfor). Amenderer addendum 16/7; erstatter det ikke.
> **SSOT for området:** [`docs/YOUTH_RULES.md`](../../YOUTH_RULES.md) (oprettet samme dag). Denne spec er hensigt og slice-plan; regler bor i SSOT'en. Hard rule 30(b): et design uden SSOT-citat er ikke godkendt til build.
> **Epic:** [#2492](https://github.com/NicolaiDolmer/CyclingZone/issues/2492). Slice 0 (kommer snart) bygges først; wireframes laves i Claude Design efter [`docs/design/youth-tiers/CLAUDE_DESIGN_BRIEF.md`](../../design/youth-tiers/CLAUDE_DESIGN_BRIEF.md).
> Ingen prod-mutation i denne spec. Migrationer beskrives som udkast og applieres post-merge under #2642-rammerne.

---

## 1. Hvorfor nu

Ejeren vil designe fremtiden for akademi, junior, U23 og senior færdig som wireframes, så spillet allerede nu kan vise strukturen med "kommer snart", og så alle kommende features passer ind. Målbilledet var låst 16/7 (tre trupper med egne kalendere), men (a) området havde intet SSOT, (b) addendum §7's seks parametre var aldrig ejer-reviewet, (c) addendum modsagde den senere potentiale-beslutning (13/8), og (d) MASTERPLAN nævner ikke tre-tier. Denne session lukker a-c. d er ejerens rækkefølge-beslutning (spørg før omprioritering).

## 2. Ejer-beslutninger 2/9 (låst)

| # | Spørgsmål | Svar | Konsekvens |
|---|---|---|---|
| 1 | Akademi vs. junior/U23 | **A+B**: akademiet er paraplyen; 16-årige starter uden løb; junior og U23 er løbshold | Struktur i SSOT §2.1. 16-årige sidder i Junior team, løb fra 17 (teknisk valg, godkendt) |
| 2 | Overgange | Spilleren flytter selv, aldersloft pr. trup (junior maks 18, U23 maks 22), **alle ryttere behandles ens** (kontrakt, løn, auktion, forlængelse, transfer) | Én kontraktmodel (SSOT §2.4). Tvunget valg flytter fra 22 til 23 |
| 3 | Trupper og drift | **A**: loft pr. trup + drift pr. besat plads (tal via økonomi-sim) | Forslag U23 12, junior 10 |
| 4 | Ungdomsløb | Blanding af let og fuld: frivillig udtagelse som nu, taktik kan vælges, ikke nødvendigvis præmiepenge fra start, **men divisioner, grupper og ranglister** | SSOT §2.3 |
| 5 | Pyramide | **B**: egen ungdomspyramide pr. tier med op/nedrykning på egne resultater | Felt-gate C1 hård |
| 6 | Kommer snart | **A**: ny ramme på Akademi-siden med "Coming soon"-pille | Slice 0, SSOT §3 |
| 7 | Skærme til Claude Design | Alle fire: Akademi-siden, ungdomsløb og pyramide, Graduation Day, rytterens rejse | Brief §4 |
| 8 | Navne | **A**: Academy / Junior team / U23 team / Senior team (DA: Akademi / Juniorhold / U23-hold / Seniorhold) | SSOT §1 |

Godkendt samlet 2/9 ("Ja, skriv det").

## 3. Hvad der amenderes i addendum 16/7

| Addendum | Ændring 2/9 | Kilde |
|---|---|---|
| §1.1 "Junior-hold (16-18)" | Trup 16-18, men løbsberettiget fra 17 (UCI junior) | svar 1 + doktrin 8/6 |
| §1.1 "#2454: eksakt 1-99 i DB" | Overhalet af "tredje vej" 13/8: 1-6 internt, scout-bånd i UI | `PROGRESSION_RULES.md` §3 |
| §1.2 "caps pr. tier, drift-princip består" | Bekræftet (svar 3) | |
| §7.1 tidlig oprykning fra 21 | Bortfalder: opad er altid tilladt | svar 2 |
| §7.4 auto-udtagelse default, ingen taktik-cockpit i v1 | Auto default bekræftet; **taktik kan vælges** (svar 4) | |
| §7.5 ingen præmier i v1 | Bekræftet, kan komme efter sim | svar 4 |
| §1.1 "ungdomsauktionen naturligt tier-mærket" | Bekræftet; ungdomskontrakt/signing fee som særregel udgår (svar 2) | |
| (nyt) | Egen pyramide pr. tier | svar 5 |

## 4. Slice 0: "kommer snart" på Akademi-siden

### 4.1 Hvor og hvad (SSOT §3)

`frontend/src/pages/AcademyPage.jsx` er T2 (max 1600 px) med PageHeader "Academy", sektionerne Graduating riders (kun ved pending), Intake candidates, Academy roster (sortérbar DataTable) og akademi-regnskab. Slice 0 tilføjer **ét** section card efter roster-kortet:

```
Youth squads                                      Roadmap →
────────────────────────────────────────────────────────────
Junior team   [Coming soon]  Ages 16-18. Own races and standings.
U23 team      [Coming soon]  Ages 19-22. Own races, divisions and promotion.
```

- Pillen genbruger mønstret fra `frontend/src/components/klub/FacilityTrackCard.jsx` (`facilities.comingSoon`-nøglen eller en akademi-lokal søskende).
- "Roadmap →" er kortets ene quiet action (PAGE_TEMPLATES: card header har ENTEN quiet action ELLER meta label).
- Undertitlen på siden opdateres, så den ikke lover mere end i dag: EN "Sign young talent, develop it, and decide when to promote or sell." kan blive stående.
- Ingen nye nav-punkter, ingen nye sider, ingen tomme tabeller.
- `help.json:1151` (træner-forklaringen der nævner Senior/U23/Junior-struktur) rettes så den peger på "coming soon" i stedet for at beskrive noget der findes.

### 4.2 Copy (EN først, DA under, ingen em-dash)

| Nøgle | EN | DA |
|---|---|---|
| `youthSquads.title` | Youth squads | Ungdomstrupper |
| `youthSquads.junior` | Junior team | Juniorhold |
| `youthSquads.juniorNote` | Ages 16-18. Own races and standings. | 16-18 år. Egne løb og stillinger. |
| `youthSquads.u23` | U23 team | U23-hold |
| `youthSquads.u23Note` | Ages 19-22. Own races, divisions and promotion. | 19-22 år. Egne løb, divisioner og oprykning. |
| `youthSquads.comingSoon` | Coming soon | Kommer snart |
| `youthSquads.roadmap` | Roadmap | Roadmap |

Tone-session før ship (copy-reglen). Help-tekst i `help.json` (en+da) får ét afsnit: hvad akademiet bliver til, og at dagens roster flyttes automatisk efter alder når trupperne åbner.

### 4.3 Fejl, tilstande, test

- Kortet er statisk og har ingen loading/error-body (ingen data). Hvis `academy_enabled` er off, vises hele siden som i dag (EmptyState `disabledNote`), og kortet vises ikke.
- Tests: `AcademyPage.contract.test.js` udvides ikke (ingen kontrakt-ændring). Nyt `node --test` på at kortet renderer med de to pills og roadmap-linket; Playwright-snapshot på alle 3 projekter (mobile inkl.) fordi siden ændrer sig visuelt.
- Patch notes: én kort linje (EN/DA). Ejer-visuelt go på screenshots før merge.

## 5. Slice 1: trup-datamodel (udkast, egen spec før build)

- `riders.squad text not null default 'senior' check (squad in ('senior','u23','junior'))`. `is_academy` bliver afledt (`squad <> 'senior'`) i en overgangsperiode og fjernes derefter.
- Migration (idempotent, snapshot først): `is_academy=true` → `junior` hvis sæsonalder ≤ 18, `u23` hvis 19-22, ellers pending flyt til senior via `academy_graduation`. Dry-run-diff pr. hold forelægges ejeren (antal ryttere pr. mål-trup, hold der overskrider foreslået loft).
- `academyTransfer.promote/demote` generaliseres til `moveRider(riderId, targetSquad)` med reglerne fra SSOT §2.2 (opad frit, nedad kun inden for aldersloft, ledig plads, ingen aktiv auktion, ikke midt i etapeløb).
- `academyGraduation.detectGraduates` udvides til to overgange (junior ved 19, U23 ved 23), samme pending-tabel med `from_squad`/`to_squad`.
- Loft pr. trup i `academyFlag.js` (`SQUAD_CAPS`), drift pr. trup. Ungdomskontrakt og `SIGNING_FEE_RATE` erstattes af standard kontrakt-seed (`TRANSFER_MARKET_RULES.md`).
- Gates: idempotens-test på migration, `potentialeHiding`-gaten urørt, `GAME_INVARIANTS.md` §Akademi rettes i samme PR (frossen fil, ejer godkender).

## 6. Slice 2-3: kalendere og pyramider (principper, egen spec pr. slice)

- Samme race-motor, samme `race_results`, ny `races.squad` (senior/u23/junior) og egne `league_divisions` pr. squad. Deltagelse afgøres af rytterens `squad` + løbets `squad`.
- Udtagelse via assistenten (auto default), taktik via Planning Center. Ingen ny motor.
- AI-hold får ungdomstrupper via samme generator-sti som verdens-influx (#2064). `RIDER_GENERATION.md` opdateres i samme PR.
- Pyramide pr. tier: start 1/2/4/8 som senior; felt-gate C1 skærer antal divisioner, ikke løb. Op/nedrykning på egne resultater. Ranglister pr. gruppe + samlet.
- Præmier: ingen. `PRIZE_PER_POINT` anvendes ikke på ungdomsløb i v1 (eksplicit branch, testet).
- Gates: Scorecard C1-C3, C7 (addendum §5). `CALENDAR_RULES.md` og `RACE_ENGINE_RULES.md` citeres og opdateres.

## 7. Wireframe-arbejdet (Claude Design)

Ejeren designer selv de fire skærme i claude.ai/design efter briefen i `docs/design/youth-tiers/CLAUDE_DESIGN_BRIEF.md`. Handoff-eksporten gemmes i `docs/design/youth-tiers/` (slet aldrig design-planer). Slice 0 bygges mod den godkendte wireframe for Akademi-siden; slice 1-3 mod de øvrige. Wireframes er hensigt; SSOT'en er reglerne.

## 8. Bevidst ude af scope

- Præmiepenge i ungdomsløb (efter sim). Landshold og U23-VM (#934). Krøniken som system (#2490; kun rejse-blokken på profilen designes nu). Akademi-filosofi (#2495). Årgangs-leaderboard (#2493) designes som en linje på Akademi-siden, ikke som egen side.

## 9. Referencer

`docs/YOUTH_RULES.md` · addendum 16/7 · ungdomsdybde 11/7 · graduering 18/6 · doktrin 8/6 §Youth · `PROGRESSION_RULES.md` §3 · `TRAINING_RULES.md` §7 · `RIDER_GENERATION.md` · `GAME_INVARIANTS.md` §Akademi · `PAGE_TEMPLATES.md` · issues #2492 #932 #958 #2456 #2064 #2491 #2493 #4587
