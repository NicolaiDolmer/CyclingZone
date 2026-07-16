# Ren-ASCII-dansk er usynligt for æ/ø/å-baserede i18n-guards

**Dato:** 2026-07-16 · **Refs:** #2508 (OnlineBadge-leak), #1068/#1170 (guards)

## Symptom

`OnlineBadge.jsx` (delt af TeamProfilePage + ManagerProfilePage) viste hardcodet
dansk i EN-UI'et: "Online nu", "aldrig", "X min siden", "Xt siden", "Xd siden".
Live-repro: `/teams/:id` med engelsk valgt → "Manager: X · aldrig".

## Hvorfor slap det igennem tre guards

1. **`i18n-check-lib-strings.mjs`** (dækker `components/`) og
   **`i18n-check-leaks.mjs` detektor B** (kode-scan) flagger kun linjer med
   **æ/ø/å**. "Online nu", "aldrig" og "siden" indeholder ingen danske tegn —
   ren-ASCII-dansk er en systemisk blind vinkel i begge.
2. **Stopords-detektoren** i `i18n-check-leaks.mjs` (som HAR "siden" i listen)
   anvendes kun på **locale-JSON-værdier** (detektor A), aldrig på kode.
3. **e2e-leak-testen** (`core-smoke.spec.js` "translated manager pages do not
   leak...") dækkede kun de 9 sider i `TRANSLATED_PAGE_SMOKE` — hverken
   `/teams/:id` eller managerprofilen var med, så siderne hvor badgen renderer
   blev aldrig EN-tjekket.

## Fix + forward-guard

- Badge keyificeret via `common:time.*` (genbrug af `justNow`/`minutesAgo`/
  `hoursAgo`/`daysAgo` + nye `onlineNow`/`never` i en+da) — samme mønster som
  `AuctionHistoryPage.timeAgo(dateStr, t)`.
- `/teams/team-e2e` føjet til `TRANSLATED_PAGE_SMOKE`. Mock-detalje der gør
  guarden deterministisk: `restObject("teams")` har intet `manager:user_id`-
  embed → `lastSeen` er null → badgen rammer netop "never"-stien.
- **Guard-bid verificeret:** testen kørt mod den gamle danske badge-version →
  rød; mod fixet → grøn.

## Læring (generaliserbar)

- **Tegn-heuristik ≠ sprog-detektion.** Ved i18n-audit af en komponent: grep
  også for ren-ASCII-danske ord ("aldrig", "siden", "nu", "ingen", "kun", …) —
  æ/ø/å-scan alene giver falsk tryghed.
- **En delt komponent er kun så dækket som dens MEST dækkede caller.** Da
  OnlineBadge blev ekstraheret fra ManagerProfilePage til delt komponent, fulgte
  ingen leak-dækning med. Ved ekstraktion af player-facing komponenter: tjek at
  mindst én rendering-side er i `TRANSLATED_PAGE_SMOKE`.
- **Muligt statisk follow-up** (bevidst ikke gjort her, false-positive-afvejning
  kræves): udvid stopords-scan til kode-linjer i `i18n-check-leaks.mjs`.
