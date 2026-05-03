# NOW historik — 2026-05-03 session-batch

Flyttet fra NOW.md ved S3 close-out (token-disciplin: NOW.md maks 30 linjer).

## Senest leveret (frosset snapshot)
- 2026-05-03: **Lint-guard udvidelse** (v2.10) — `(text|border|ring|divide|outline)-(white|black)/\d+` blokeret i `frontend/eslint.config.js`; `bg-(white|black)/N` bevidst tilladt for modal-scrims (5 callsites). `text-white/20` i `DeadlineDayBanner.jsx:92` ryddet.
- 2026-05-03: **Panic Board fix** (v2.09) — `/deadline-day` nav-link under Marked; DeadlineDayBoard tokeniseret. Afsløret af manuel smoke.
- 2026-05-03: **Tema finpudsning** (v2.08) — PotentialeStars og statBg-fallback fulgte ikke temaet; rettet.
- 2026-05-03: **Discord-privatliv-fix** (v2.07) — DM-only for outbid/won/transfer-offer/response. Smoket: ✅
- 2026-05-03: **S8 Discord DM live i prod** (`e0362d9`) — sendDM verified end-to-end mod admin-konto, opt-out + status-badge + Dashboard nudge + input-validering på discord_id (afviser brugernavne, kun 17-19 cifre)
- 2026-05-03: 3 nye GUARDRAILS_CORE-regler (soak-gate, runtime-anchored brief, doc-drift sweep)
- v2.04 (2026-05-02): Dark mode S1 — token-foundation + ThemeProvider + chrome + top-5 sider
- v2.03 (2026-05-02): Deadline Day S4 — T-24h/T-2h/T-30min cron + Final Whistle Discord-rapport

## Værktøjer (snapshot — flytteres til REFERENCE.md hvis genbrug)
- `backend/scripts/verifyRidersAgainstSheets.js` — read-only Gate #5 verifikation (target: 0/0/0)
