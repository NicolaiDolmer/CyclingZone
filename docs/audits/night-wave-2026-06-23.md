# Natbølge 2026-06-23

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | ~00:36 → (close-out TBD) |
| Agenter launched / fuldført / døde | 16 / 16 / 0 |
| PR'er åbnet / merged | 15 / (TBD ved close-out) |
| Issues → claude:done | (TBD ved close-out) |
| gh-retries | 0 observerede fejl (gh-retry-wrapper i alle agenter) |
| Recoveries (type) | 0 |
| Preflight | GO kl. ~00:34 (`.codex.local/night-wave-preflight.json`) |

## Workflow
- Run ID: `wf_8f8a17e2-dc5` — canary-gate (#1735) → 15-agent parallel-fanout.
- ~2,05M subagent-tokens, 912 tool-kald, ~44 min wall-clock.
- Scope: launch-bug-klynge + backend-wins (A) + træthed-recovery (B) + board-polish (C) + editorial-sweep (D). Ejer-godkendt scope + merge-politik (backend/lav-risiko løbende, resten morgen).

## PR-oversigt
| Issue(s) | PR | Klasse | Merge-anbefaling | Status |
|---|---|---|---|---|
| #1735 akademi 409 | #1757 | backend-only | safe-overnight | TBD |
| #1742 pensionerede i frie ungdom | #1758 | backend-only | safe-overnight | TBD |
| #1739 AI-hold trim ved indrykning | #1759 | backend-only | safe-overnight | TBD |
| #1650 + #1669 KNOWN_EVENTS | #1768 | infra | safe-overnight | TBD |
| #1745 op/nedrykning-visning | #1760 | frontend | owner-morning | open |
| #1741 transferhistorik retning | #1761 | frontend | owner-morning | open |
| #1738 + #1750 + #1240 board | #1766 | mixed | owner-morning | open |
| #1749 founder-copy EN | #1762 | copy | owner-morning | open |
| #1747 holdudtagelse | #1765 | frontend | owner-morning | open |
| #1746 konto e-mail/brugernavn | #1767 | auth + migration | owner-morning | open (migration!) |
| #1755 rytter universel sort | #1769 | frontend | owner-morning | open |
| #1756 academy_intake reconcile | #1764 | data-script | owner-morning | open (ejer kører script) |
| #1666 achievement-leak | #1763 | security | owner-morning | open |
| #1676 træthed daglig recovery | #1770 | balance | owner-morning | open |
| #1675 fuld-bredde layout (#1590 udskudt) | #1771 | frontend | owner-morning | open |
| #1580 + #1591 tokens/copy-slop | — | frontend | already-done | ingen PR (verificeret merged tidligere; status-kommentarer postet) |

## Centrale fund
1. **Pre-eksisterende CI-blocker — patchNotes v5.97 `category: "added"`:** ugyldig kategori (gyldige: new/improved/fixed) i `frontend/src/data/patchNotes.js` (entries #1744 + #1674) fik `patchNotes.data.test.js` til at fejle på `origin/main` → `frontend-build` (required) rød på ALLE fleet-PR'er, fordi de branchede fra den buggede main. **Fixet via PR #1772** (category → "new", test grøn 4/4). Alle fleet-branches skal opdateres fra main efter #1772-merge for at blive grønne.
2. **Vercel hobby rate-limit ALLEREDE ramt** ("retry in 24 hours") fra dagens mange merges/preview-builds. Konsekvens: frontend-prod frosset på sidste gode deploy; frontend-merges (inkl. ejerens morgen-merges) går IKKE live før limit'en nulstiller (~24t) eller Vercel Pro. **Backend (Railway) upåvirket** — backend-merges går live. Vercel er ikke en required check.
3. **#1580/#1591 work-already-done:** det mekaniske arbejde var merged tidligere (#1638-1654 + #1645); agenten verificerede + postede status-kommentarer. Ét åbent punkt på #1591 (founder-copy "Free players stay competitive, forever" — grænser til forbudt "free forever", afventer ejer-formulering).

## Adversarisk dybde-review + hærdning (`wf_33c41d0e-548`)
4 højeste-risiko-PR'er reviewet adversarisk mod prod-DB (read-only); kommentarer postet på hver. **Ingen blockers — alle mergebare.**

| PR | Fokus | Verdict | Handling |
|---|---|---|---|
| #1770 (#1676) | balance | ✅ ship-ready | Recovery-model verificeret sund (træthed sidder aldrig fast); 2 kosmetiske lows. |
| #1767 (#1746) | auth+migration | 🟡 minor → **hærdet** | MEDIUM: username case-insensitiv unikhed ikke DB-håndhævet (TOCTOU, samme klasse som #1264). **Fix: `users_username_lower_unique_idx` tilføjet til migrationen (`937db230`).** Low (e-mail bypasser app-rate-limit) efterladt. |
| #1763 (#1666) | security | 🟡 minor → **hærdet** | LOW: `GET /api/achievements` lækkede samme secret-felter. **Fix: hideSecret-redaktion tilføjet (`265cf27c`).** Low (fragil guard) efterladt. |
| #1759 (#1739) | signup-hook | 🟡 minor | LOW: top-up kan lave 23 AI-hold inline ved første signup i tom entry-pulje (ikke nåbar nu — relevant efter relaunch); nedarvet frozen-team-edge. Begge dokumenteret på PR, ikke ændret. |

**Review-bølge 2** (`wf_a7d66153-2f2`) — de 7 resterende frontend-PR'er:

| PR | Verdict | Handling |
|---|---|---|
| #1766 board, #1765 holdudtagelse, #1761 transferhistorik, #1771 layout | ✅ ship-ready | Kun kosmetiske noter (PR-body-unøjagtigheder). Klar. |
| #1769 (#1755) sort | 🟡 minor → **hærdet** | MEDIUM: Watchlist "Hold"-header sorterede ikke (team_id UUID → NaN), kamufleret som klikbar. **Fix: team_id→team.name-gren i comparatoren (`58f0556d`).** |
| #1762 (#1749) founder-copy | ✅ ship-ready | Priser verificeret mod pricing.js (ingen opfundne tal); kun upræcis key-antal i PR-body. |
| **#1760 (#1745)** op/nedrykning | 🔴 **needs-fix — KRÆVER EJER-BESLUTNING** | HIGH: vist per-pulje-regel (N×2 op/ned) modsiger backend (2 op/2 ned **pr. division**, pulje-blindt; live fra sæson 3). Vildledende. Design-fork bundet til åbne **#1152** (per-pulje promotion, needs-contract). **Valg A** (anbefalet): behold division-bred zone + tekst "pr. division" (matcher koden). **Valg B**: byg per-pulje-backend + luk #1152 først. Ikke auto-fixet — din beslutning. |

## Afvigelser/læringer
- **Fleet arvede en rød main.** 16 agenter branchede fra en `origin/main` med en pre-eksisterende test-fejl → `frontend-build` rød på alle. **Læring/forslag:** tilføj et `node --test` + build-sanity-tjek mod `origin/main` i `preflight-night-wave.ps1`, så en pre-eksisterende rød main fanges (NO-GO eller auto-fix) FØR en bølge launches — ellers arver hele fleeten fejlen og det ligner 16 separate regressioner.
- **Canary-gaten holdt** (billig forsikring): #1735 validerede pipelinen før fanout. Worktree-isolation + `agentType: claude` virkede; 15/15 fanout-agenter åbnede PR (én fandt korrekt at arbejdet allerede var gjort).
- **Klassifikation virkede:** agenterne selv-klassificerede backend/frontend/auth/security/migration/data, så merge-politikken kunne håndhæves uden manuel triage.

---
_Refs #605 (velocity-måling). Bølge-protokol: `docs/NIGHT_WAVE_RUNBOOK.md`._
