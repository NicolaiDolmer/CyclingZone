# NOW historik — 2026-05-10 token-audit compact

Arkiveret 2026-05-10 for at bringe `docs/NOW.md` tilbage under 30 linjer og mindske Claude/Codex cold-start context.

- **#287 Backwards-audit 'deployed kode + 0 data' LIVE som v3.10** — nyt `audit-feature-liveness.js` med 4 detector-klasser (A=write-no-data, B=orphan-endpoint, C=migration-drift, D=schema-drift). Workflow `feature-liveness-audit.yml` blokerer PR-merge ved nye findings + ugentligt cron mandag 04:00 UTC åbner `quality-drift`-tracking-issue. Helper-RPCs i `database/2026-05-10-feature-liveness-helper.sql`. PR #291 merged. Deploy success SHA `4d24c4d`.
- **#286 Brugerverifikation-gate i PR-template LIVE** — `PULL_REQUEST_TEMPLATE.md` har krævet verification-section; workflow `pr-verification-check.yml` blokerer merge hvis sektionen mangler eller alle checkboxes er tomme. PR #290 merged.
- **#87 GitHub Projects v2 board fuldt LIVE** — `CyclingZone Roadmap` project #2 oprettet og linket til repo. Auto-add via `.github/workflows/add-to-project.yml` med `PROJECTS_PAT`. PR #275, #278, #282 merged.
- **GitHub-cleanup-pass** — 9 issues lukket efter prod-verifikation. Discord-bridge-workflow indført for bekræftelse i original-tråde.
- **#247 Maks én aktiv transfer-listing pr. rytter LIVE som v3.09** — backend pre-check + partial unique index `uniq_transfer_listings_one_active_per_rider`.
- **#246 + #244 Auktionshistorik fix LIVE som v3.08** — købt/solgt filtrerer server-side, stats loader separat, self-purchase får neutral visning.
- **#270 Follow-up silent CHECK-violation LIVE som v3.07** — transfer-delete skifter til `withdrawn` og propagater UPDATE-fejl.
- **#14 + #245 Banken -> AI rename LIVE som v3.06** — prod-række omdøbt, UI-strenge og docs opdateret.
- **#270 Fjern rytter fra transferlisten LIVE som v3.05** — ejer-knap i `TransferCard`, eksisterende backend DELETE eksponeret i UI.
- **#269 Race-window fix LIVE som v3.04** — DB-trigger `reject_late_auction_bid`; app-lag oversætter `P0001` til 400.
- **#257 Auktioner forlænges kun ved reelt leder-skift LIVE som v3.03** — ny `applyLeaderShiftExtension` efter proxy-cascade.
- **#250 Forsidens squad-tæller tager højde for transfers LIVE som v3.02** — `computeDashboardSquadStats` med 11 unit-tests.
- **#254 Byd direkte fra rytter-profil LIVE som v3.01** — bud-flow på `/riders/:id`, delt `useAuctionBidding` hook + `auctionLogic`.
