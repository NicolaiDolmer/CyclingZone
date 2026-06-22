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

## Afvigelser/læringer
- **Fleet arvede en rød main.** 16 agenter branchede fra en `origin/main` med en pre-eksisterende test-fejl → `frontend-build` rød på alle. **Læring/forslag:** tilføj et `node --test` + build-sanity-tjek mod `origin/main` i `preflight-night-wave.ps1`, så en pre-eksisterende rød main fanges (NO-GO eller auto-fix) FØR en bølge launches — ellers arver hele fleeten fejlen og det ligner 16 separate regressioner.
- **Canary-gaten holdt** (billig forsikring): #1735 validerede pipelinen før fanout. Worktree-isolation + `agentType: claude` virkede; 15/15 fanout-agenter åbnede PR (én fandt korrekt at arbejdet allerede var gjort).
- **Klassifikation virkede:** agenterne selv-klassificerede backend/frontend/auth/security/migration/data, så merge-politikken kunne håndhæves uden manuel triage.

---
_Refs #605 (velocity-måling). Bølge-protokol: `docs/NIGHT_WAVE_RUNBOOK.md`._
