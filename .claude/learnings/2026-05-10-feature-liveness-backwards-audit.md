# 2026-05-10 — Backwards-audit der finder "deployed kode + 0 data / 0 brugere"

**Issue:** [#287](https://github.com/NicolaiDolmer/CyclingZone/issues/287)
**Bygger på:** [#279](https://github.com/NicolaiDolmer/CyclingZone/issues/279) + [PR #285](https://github.com/NicolaiDolmer/CyclingZone/pull/285) (RLS-audit)
**Bekræfter / subsumerer:** [#284](https://github.com/NicolaiDolmer/CyclingZone/issues/284)

## Hvad mønstret er

Slice 14 lærte os: *deployed kode + 0 effektiv brug = mistænkeligt*. RLS-audit
fanger én klasse (RLS blokerer authenticated-reads). Men der er flere klasser:

- **Backend skriver tabel, men 0 rows i prod** — write-pathen fyrer ikke
- **Backend Express-endpoint findes men ingen frontend-caller** — orphaned API
- **Migration committed men ikke applied i prod** — repo og DB driver
- **Prod-tabel uden CREATE TABLE i repo** — Studio-drift (slice 14 selv)

## Implementation

`backend/scripts/audit-feature-liveness.js` med 4 detectors (A–D), helper-RPCs
i `database/2026-05-10-feature-liveness-helper.sql`, weekly cron-workflow
`.github/workflows/feature-liveness-audit.yml`, og agent-doctor-check.

Whitelist-mekanisme i scriptet: tilføj entry **med kommentar der dokumenterer
hvorfor** når en finding er bekræftet intentional. Manglende kommentar = dårlig
whitelist-disciplin.

## Første kørsel — fandt drift, alle bekræftet kendte

| Detector | Findings | Verdict |
|---|---|---|
| A — write-but-no-data | 3 | Board-tabeller, milestone-gated per #284 + b53d831. Whitelisted. |
| B — orphaned-endpoints | 14 | Mix af cron-trigger, admin-curl, frontend-bypass-via-supabase. Whitelisted med kategori-kommentarer. |
| C — migration-drift | 0 (efter whitelist af legacy schema-files) | `database/schema.sql` + `supabase_setup.sql` er pre-migration-workflow dumps. |
| D — schema-drift | 0 (efter whitelist af 15 legacy tables) | Studio-oprettede tabeller fra før 2026-05-04 migration-workflow. |

Backwards-check resultatet: ingen *nye* slice-14-mønstre eksisterer. Boardtabellerne
i Detector A-listen er præcis det samme mønster #284 allerede bekræftede er
intentional (skrive-paths fyrer ved sæson-end / manager-action, ikke broken).

## Læringspunkter

1. **RLS-audit + feature-liveness er komplementære, ikke duplikerede.** RLS-audit
   fanger "data findes men frontend kan ikke læse"; feature-liveness fanger
   "data findes ikke selvom backend skriver" + 3 andre klasser. Begge lever side
   om side i CI.

2. **Whitelist-pattern skal kræve kommentar.** Ellers bliver whitelist'en til
   skraldespand. Strukturér scripts så hver entry har "hvorfor" inline.

3. **Første kørsel er selv backwards-audit'en.** Ingen separat scan-script
   nødvendig — første run mod main producerer rapporten der siger "her er
   alt der eksisterer som mistænkeligt drift". Whitelist defines baseline,
   alle senere findings = ny drift.

4. **Detector D (schema-drift) afslører Studio-managed legacy.** Vi har 15
   tabeller oprettet via Studio før migration-workflow. Følge-arbejde:
   backfill `CREATE TABLE` til repo så de er eksplicit dokumenteret.

## Handlinger fremad

- [x] Helper RPC + audit-script + workflow + agent-doctor-check live
- [x] Postet rapport på #284 (subsumerer mistanken med konkret bevis)
- [ ] Følge-issue: backfill 15 legacy CREATE TABLE statements til repo (Detector D-cleanup)
- [ ] Følge-issue: cleanup af 14 orphaned Express-endpoints (Detector B-cleanup)
