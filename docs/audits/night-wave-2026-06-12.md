# Natbølge 2026-06-12 — "Dagbølge 3" (relanceret natbølge 3)

Kørt om dagen efter 2× Modern Standby-død om natten. Scope = natbølge 3-planen (ejer-go 10/6, re-bekræftet 12/6).

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | 08:43 → 10:05 (fleet wall-clock 81 min) |
| Agenter launched / fuldført / døde | 19 / 19 / 0 |
| PR'er åbnet / merged | 19 + 1 sidefund (#1317) / 19 merged, #1328 afventer ejer-review (bevidst uden auto-merge: rører AGENTS.md + Stop-hook) |
| Issues → claude:done | Afventer bulk-go (>5-reglen): #982 #981 #788 #817 #824 #802 #950 #778 #903 #1166 #785 #987 #645 #1068 #1076 #1084 #1131 #1170 #1197 (+#1180 med ejer-residualer) |
| gh-401-retries (preflight-probe) | 0 (1. forsøg OK) |
| Recoveries (type) | 0 |
| Preflight | GO kl. 08:42 (.codex.local/night-wave-preflight.json) |
| Ressourcer | 19 agenter, ~3,1M subagent-tokens, 1.593 tool-kald |

## Afvigelser/læringer

- **Dagbølge virker:** ejeren ved maskinen + ingen standby-risiko; 0 døde agenter mod 2× total-død om natten. Overvej dag som default for store bølger indtil S0-standby er løst.
- **Preflight-script-bug:** StrictMode `.Count`-crash når git status har præcis 1 linje — fixet (`caae311c`) før GO.
- **Sikkerhedsfund (ejer-action):** `frontend/.env` på dev-maskinen indeholder backend-secrets (bl.a. SUPABASE_SERVICE_KEY) i strid med antagelsen "kun VITE_-vars". Sanitize-hook fangede dump-forsøg; intet lækket. Ejer bør flytte backend-vars ud af frontend/.env.
- **Sidefund fixet i selvstændig PR:** SeasonCycleSection sendte 'Bearer undefined' → 401 på sæsonskifte-preview (#1317, merged).
- **Kryds-PR-risiko der IKKE bed:** #1334 (board-E2E, asserter DA-copy) mergede rent efter #1329 (board-i18n) — i18n-PR'en ændrede backend-koder/resolvers, ikke de DA-strenge testene asserter.
- **i18n-ratchet-protokollen virkede:** #1068-guarden var grøn under hele bølgen (baseline-mekanik); baseline strammet 28→23 i dedikeret commit efter merges.
- **Auto-merge-salven kørte konfliktfrit:** 18 PR'er self-mergede på ~1 time uden manuel konflikt-løsning — branch-fra-origin/main + domæne-disjunkte spor holdt.

_Refs #605._
