# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) godkendt; [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145) styrer alignment. Fire motorer: løb, træning, ungdom, transfer/auktion.

## Aktiv styring

> **💰 CZ Pro Slice 1 — PR [#1909](https://github.com/NicolaiDolmer/CyclingZone/pull/1909) afventer ejer-merge:** Billing-rails (Alunta hosted checkout + entitlement `is_pro` + Founder-badge, [#1903](https://github.com/NicolaiDolmer/CyclingZone/issues/1903)). Har `database/*.sql` → **ejer merger**. Før go-live: opret CZ Pro-plan i Alunta (49/md + 265/6mdr) + `ALUNTA_API_TOKEN`/`_WEBHOOK_SECRET`/plan-id'er → Infisical.
>
> **🎯 Next action (27/6 — 3 PRs MERGED):** #1926→[#1935](https://github.com/NicolaiDolmer/CyclingZone/pull/1935) (orphaned endpoints fjernet, audit-gate grøn) + #1916→[#1939](https://github.com/NicolaiDolmer/CyclingZone/pull/1939) (help-tal pinnet) = **done**. #1904→[#1940](https://github.com/NicolaiDolmer/CyclingZone/pull/1940) merged + **config flippet 27/6 (08–24 live i prod, 0 aktive auktioner ved cutover)** + patch note v6.27 ([#1943](https://github.com/NicolaiDolmer/CyclingZone/pull/1943)) → **#1904 LUKKET, 08–24 live**. **Din hånd venter på:** holdudtagelse #1906/#1823/#1800 (real-konto-bekræftelse), CZ Pro [#1909](https://github.com/NicolaiDolmer/CyclingZone/pull/1909). **Næste kandidater:** [#1941](https://github.com/NicolaiDolmer/CyclingZone/issues/1941) (grace=0-beslutning), [#1922](https://github.com/NicolaiDolmer/CyclingZone/issues/1922) træningsfokus, [#1875](https://github.com/NicolaiDolmer/CyclingZone/issues/1875) Vercel preview-env, race-hub S2b (#1825/#1712).
>
> **Issue-hygiejne (27/6):** Nye follow-up-fund: [#1941](https://github.com/NicolaiDolmer/CyclingZone/issues/1941) (prod auktions-grace=0, mangler kolonne — ejer-beslutning) + [#1942](https://github.com/NicolaiDolmer/CyclingZone/issues/1942) (orphan FAQ-key). [#1927](https://github.com/NicolaiDolmer/CyclingZone/issues/1927) (frossen løn) **holder åben** — systemisk salary-refresh + demote-gulv mangler.
>
> **Ejer-beslutninger (åbne):** #1276 PCM-IP · #1278 spiller-comms · #1487-budget · #929 leaked-pw · #691 key-rotation. [PLAN.md](PLAN.md)=SSOT.

> **🤖 Working agent:** Claude (Opus) — race-kalender-rebuild + Division 3-nulstilling (Fase 1: read-only recon → build/dry-run → ejer-godkendelses-gate FØR prod). Spec: `superpowers/specs/2026-06-27-race-calendar-model-design.md`. Intet rører prod før ejer-go.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer-besluttet 22/6):** 4-divisions-pyramide, puljer 1/2/4/8 (=15). Div 1+2 = altid AI; div 3+4 = AI fylder kun puljer med ≥1 ægte manager. Ægte managere ind fra bunden (div 4). Klar til 100 managers. Path (A): frys FORM (gjort), byg mekanik additivt efter (#1688 b-e merged via #1701). **Op/nedrykning: ejer-besluttet 23/6 = aktivér NU (intet låst), per-pulje — gennemregnet forslag i [#1152](https://github.com/NicolaiDolmer/CyclingZone/issues/1152) ([spec](superpowers/specs/2026-06-23-promotion-relegation-design.md)) afventer godkendelse før build.**
- **Sikkerhed:** [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) SERVICE_KEY-rotation · #929 leaked-password — åbne.
- **Skalering:** infra bærer 100 managers; Supabase Pro (#1181). Perf post-launch (#1375).

_Trimmet 27/6 close-out (token-gate #1275); fuld historik i git-log + issue-tråde._
