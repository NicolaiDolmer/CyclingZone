# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) godkendt; [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145) styrer alignment. Fire motorer: løb, træning, ungdom, transfer/auktion.

## Aktiv styring

> **🟢 MOTOR TÆNDT — løb genstarter man 29/6 08:00 (27/6):** `race_engine_v2_enabled` + `stage_scheduler_enabled` + `auto_prize_enabled` = **on**. Verificeret garanti ved tænding (ejer-betinget go): tidligste løb man 29/6 08:00, **0 forfaldne før mandag** → intet kører i weekenden. Nødstop = sæt `race_engine_v2_enabled='off'` (kill-switch).
>
> **Kalender-kronologi-rebuild (28/6 — anvendt + verificeret i prod):** `game_day` adskilt fra IRL-dag; hver etape = sin egen game-dag (GT = 21 game-dage = fuldt commitment). **Overlap-cap pr. division: Div 1/2 = 3, Div 3/4 = 2** — Div 3's x3 fjernet (blanding solo+2, 0 straddle, verificeret max 2 i prod). Tæthed præcis 5/4/3/2, 0 tomme dage, kvoter 140/112/84. **263 løb, 700 etape-tider.** Binding-kode uændret (nøgler på game_day). Manuelle lineups nulstillet (8 hold må sætte trup igen). Backup `backup_chronrebuild_20260628_*`. **Merged + live ([#1958](https://github.com/NicolaiDolmer/CyclingZone/pull/1958)/#1960).** Spec: `2026-06-28-race-calendar-chronology-rebuild-design.md`.
>
> **Trup-board: eksplicit Gem + delvis trup (28/6):** auto-gem afløst af "Gem ændringer"-knap + forlad-vagt; redigér frit (fjern → straks genbrugbar); delvis trup gemmes nu og **top-fyldes auto ved race-tid** (`raceEntryGenerator` gap-fill, `validateSelection` lempet). PR [#1961](https://github.com/NicolaiDolmer/CyclingZone/pull/1961) (afventer merge). Spec: `2026-06-28-racehub-save-ux-redesign-design.md`.
>
> **💰 CZ Pro Slice 1 — PR [#1909](https://github.com/NicolaiDolmer/CyclingZone/pull/1909) afventer ejer-merge** (har `database/*.sql`). **Åbne ejer-beslutninger:** #1276 · #1278 · #1487 · #929 · #691. [PLAN.md](PLAN.md)=SSOT.

> **🎯 Next action:** Pre-live audit (28/6, multi-agent) → mandags-gate **GRØN** (0 forfaldne, 0 overlap-kollision i samme division, økonomi koherent efter ÷20, 0 negative). **Shippet før mandag:** ex-akademi frie agenter frigjort (#1947) · 2 ghost-auktioner annulleret (#1773) · rentefrit 'reset'-lån skjult fra UI + kort/langt lån bevaret (#1948→#1957; #1955 var for bred → reverteret) · løbskategorier→fiktive (#1780→PR #1956 merged) · **kalender-kronologi-rebuild: Div 3 x3-overlap → max 2, game-dag adskilt fra IRL-dag (28/6, branch `feat/calendar-chronology-rebuild` afventer merge; lineups nulstillet → 8 hold sætter igen)**. Backups: `backup_academy_freeagent_fix_20260628`, `backup_ghost_auctions_fix_20260628`, `backup_chronrebuild_20260628_*`. Ejer-valg: lån står · omkørsel #1861/#1848 = lad stå · form #1949 = accepter nuværende. **Weekend-polish (ikke mandags-blockers — bundt til 1 PR):** #1781 · #1832 · #1936/#1937 · #1954 · #1949 (reset-script form-nulstilling).

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer-besluttet 22/6):** 4-divisions-pyramide, puljer 1/2/4/8 (=15). Div 1+2 = altid AI; div 3+4 = AI fylder kun puljer med ≥1 ægte manager. Ægte managere ind fra bunden (div 4). Klar til 100 managers. Path (A): frys FORM (gjort), byg mekanik additivt efter (#1688 b-e merged via #1701). **Op/nedrykning: ejer-besluttet 23/6 = aktivér NU (intet låst), per-pulje — gennemregnet forslag i [#1152](https://github.com/NicolaiDolmer/CyclingZone/issues/1152) ([spec](superpowers/specs/2026-06-23-promotion-relegation-design.md)) afventer godkendelse før build.**
- **Sikkerhed:** [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) SERVICE_KEY-rotation · #929 leaked-password — åbne.
- **Skalering:** infra bærer 100 managers; Supabase Pro (#1181). Perf post-launch (#1375).

_Trimmet 27/6 close-out (prestige-kalender-rebuild); fuld historik i git-log + issue-tråde._
