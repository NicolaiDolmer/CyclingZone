# NOW — Aktuel arbejdsstatus

> **Produktkompas (8/6):** [Living World Product Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) godkendt; [#1145](https://github.com/NicolaiDolmer/CyclingZone/issues/1145) styrer alignment. Fire motorer: løb, træning, ungdom, transfer/auktion.

## Aktiv styring

> **💰 CZ Pro Slice 1 — PR [#1909](https://github.com/NicolaiDolmer/CyclingZone/pull/1909) afventer ejer-merge:** Billing-rails (Alunta hosted checkout + entitlement `is_pro` + Founder-badge, [#1903](https://github.com/NicolaiDolmer/CyclingZone/issues/1903)). Har `database/*.sql` → **ejer merger**. Før go-live: opret CZ Pro-plan i Alunta (49/md + 265/6mdr) + `ALUNTA_API_TOKEN`/`_WEBHOOK_SECRET`/plan-id'er → Infisical.
>
> **🎯 Next action (27/6 — 3 PRs åbne fra denne session, alle uden migration):** [#1926](https://github.com/NicolaiDolmer/CyclingZone/issues/1926)→PR [#1935](https://github.com/NicolaiDolmer/CyclingZone/pull/1935) (fjern 4 orphaned endpoints, backend-only, **alle gates grønne** — merge **FØRST**, fikser audit-gaten på de to andre). [#1916](https://github.com/NicolaiDolmer/CyclingZone/issues/1916)→PR [#1939](https://github.com/NicolaiDolmer/CyclingZone/pull/1939) (pin help-tal til RULES_NUMBERS; audit grøn efter #1935-merge+rebase). [#1904](https://github.com/NicolaiDolmer/CyclingZone/issues/1904)→PR [#1940](https://github.com/NicolaiDolmer/CyclingZone/pull/1940) (auktions-vindue: engine-fix close=24 grøn, men **config-flip + patch note venter på dig** — SQL+cutover i PR-body). frontend-smoke-fejl på #1939/#1940 = urelaterede flaky race-hub-tests (advisory). Holdudtagelse #1906/#1823/#1800 = verificeret live, venter kun din real-konto-bekræftelse. **Næste kandidater:** [#1922](https://github.com/NicolaiDolmer/CyclingZone/issues/1922) træningsfokus-rework, #1925 rest-edges, [#1875](https://github.com/NicolaiDolmer/CyclingZone/issues/1875) Vercel preview-env, race-hub S2b (#1825/#1712).
>
> **Issue-hygiejne (27/6):** Nye follow-up-fund: [#1941](https://github.com/NicolaiDolmer/CyclingZone/issues/1941) (prod auktions-grace=0, mangler kolonne — ejer-beslutning) + [#1942](https://github.com/NicolaiDolmer/CyclingZone/issues/1942) (orphan FAQ-key). [#1927](https://github.com/NicolaiDolmer/CyclingZone/issues/1927) (frossen løn) **holder åben** — systemisk salary-refresh + demote-gulv mangler.
>
> **Ejer-beslutninger (åbne):** #1276 PCM-IP · #1278 spiller-comms · #1487-budget · #929 leaked-pw · #691 key-rotation. [PLAN.md](PLAN.md)=SSOT.

> **🤖 Working agent:** Ingen aktiv session.

## Standing context (forever-relaunch)

- **Liga-struktur (ejer-besluttet 22/6):** 4-divisions-pyramide, puljer 1/2/4/8 (=15). Div 1+2 = altid AI; div 3+4 = AI fylder kun puljer med ≥1 ægte manager. Ægte managere ind fra bunden (div 4). Klar til 100 managers. Path (A): frys FORM (gjort), byg mekanik additivt efter (#1688 b-e merged via #1701). **Op/nedrykning: ejer-besluttet 23/6 = aktivér NU (intet låst), per-pulje — gennemregnet forslag i [#1152](https://github.com/NicolaiDolmer/CyclingZone/issues/1152) ([spec](superpowers/specs/2026-06-23-promotion-relegation-design.md)) afventer godkendelse før build.**
- **Sikkerhed:** [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) SERVICE_KEY-rotation · #929 leaked-password — åbne.
- **Skalering:** infra bærer 100 managers; Supabase Pro (#1181). Perf post-launch (#1375).

_Trimmet 27/6 close-out (token-gate #1275); fuld historik i git-log + issue-tråde._
