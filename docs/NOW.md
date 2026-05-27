# NOW — Aktuel arbejdsstatus

> **🟢 2026-05-27 close-out (#657):** Lockfile drift check workflow tilføjet på `main` pushes der rører root/backend/frontend `package.json` eller `package-lock.json`: kører `npm ci` i alle tre workspaces, parser `agent-doctor` `install-parity`, og opretter/opdaterer markeret GitHub issue ved drift. Verification: actionlint grøn; `npm ci` root/backend/frontend grøn uden lockfile-diff; lokal `agent-doctor.ps1 -Json` viser `install-parity=OK` (unrelated eksisterende doctor-fails: `main-protection`, `feature-liveness`). PatchNotes ikke opdateret: intern CI/agent-infra.

> **🟢 2026-05-27 close-out (#695):** Klub-DNA på BoardPage renderes nu via DA/EN `board.json` i stedet for backend-DA strings: DNA labels/descriptions, suggestion rationales og tradition-goal labels. Verification: targeted `boardClubDna` 19/19, backend pattern-suite 79/79, frontend build grøn, i18n checks grønne, lint uden nye errors (kun eksisterende warnings). PatchNotes v4.07 + FEATURE_STATUS opdateret.

> **🟢 2026-05-27 close-out (PR [#700](https://github.com/NicolaiDolmer/CyclingZone/pull/700)):** UCI scraper decimal-points fix restored 296 riders after PCS returned decimal point totals as `0`; raw PCS HTML parsing now recovers values. PatchNotes 4.05 + postmortem done. Follow-ups: [#701](https://github.com/NicolaiDolmer/CyclingZone/issues/701), [#702](https://github.com/NicolaiDolmer/CyclingZone/issues/702).

> **🟢 2026-05-27 close-out (#649):** Country names on rider surfaces now follow active i18next locale via `Intl.DisplayNames`; `/riders` filter dropdown/chip and `/riders/:id` nationality line fixed, plus localized sort and regression coverage. PR [#699](https://github.com/NicolaiDolmer/CyclingZone/pull/699) merged til main (PatchNotes bumpet til v4.06 efter kollision med PR #700's v4.05). Verification: `countryUtils` targeted 11/11, frontend tests 116/116, frontend build green, Playwright `core-smoke.spec.js` 12/12 grøn på alle 3 projekter efter refresh af pre-existing `mobile-webkit auctions` baseline (#646 follow-up).

> **🟢 2026-05-27 close-out (#638):** `sanitize-secrets` regression guard tilføjet for `openssl rand -hex 2`/kort hex-output, og PowerShell-testen resolver nu Git Bash eksplicit. Verification: sanitizer-suite 32/32 grøn + hook-suite 16/16 grøn. PatchNotes/FEATURE_STATUS ikke opdateret: intern agent-tooling.

> **📚 Arkiv:** Tidligere detaljer ligger i `docs/archive/NOW-2026-05-22.md` til `docs/archive/NOW-2026-05-26.md` samt relevante GitHub issues/PRs.

## Aktiv styring

> **🎯 Next action:** [#702](https://github.com/NicolaiDolmer/CyclingZone/issues/702) safety-gate matched-with-zero eller [#701](https://github.com/NicolaiDolmer/CyclingZone/issues/701) backup-trigger + monitoring. Også åbent: [#705](https://github.com/NicolaiDolmer/CyclingZone/issues/705) service-key verification, [#697](https://github.com/NicolaiDolmer/CyclingZone/issues/697), [#452](https://github.com/NicolaiDolmer/CyclingZone/issues/452), [#667](https://github.com/NicolaiDolmer/CyclingZone/issues/667). Pending bruger-actions: #355, #621 item 1, NICOLAIPC Infisical bootstrap + #684 trace-verify.
>
> _Format: `<#issue eller fil-path> — <1-sætnings opgave>`. Cross-device handoff PC1↔mobil↔PC2._

> **🤖 Working agent:** _Ingen aktiv session._
>
> _Nulstil til "Ingen aktiv session" ved close-out._
