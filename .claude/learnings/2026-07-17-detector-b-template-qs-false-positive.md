# 2026-07-17 — Detector B falsk-positiv: `${qs}` suffixet direkte på API-path

## Symptom
Feature-liveness-auditten (Detector B, orphaned-endpoints) fejlede på ALLE
pull_request-runs efter 17/7-formiddagsbølgen med 2 findings:
`GET /peak-plans/board` og `GET /races/calendar`. Main-runs (workflow_run =
kun Detector C) var grønne, så checket var permanent rødt kun på PR'er.

## Rod-årsag
#2449 (S2-sæson-vælger) indførte mønstret

```js
const qs = seasonNumber != null ? `?season_number=${seasonNumber}` : "";
fetch(`${API}/api/races/calendar${qs}`, ...)
```

Detector B's frontend-regex fanger `races/calendar${qs}` og substituerer
template-udtryk til `:param` → path'en blev `/races/calendar:param`. Fordi
`${qs}` sidder DIREKTE på sidste segment (ingen `/` imellem — det er en
query-string, ikke et path-segment), blev sidste segment `calendar:param`,
som hverken er wildcard (`tokenize` krævede `startsWith(":")`) eller matcher
backend-segmentet `calendar`. Endpointet så derfor "orphaned" ud, selvom
frontend kalder det hver dag.

Tidligere kald skrev query-strings inline (`...?foo=${x}`), og `?` er
excluderet i regex'ens char-class, så capturen stoppede før query-strengen.
Falsk-positiv-klassen opstod først da query-strengen selv blev en
template-variabel.

## Fix (PR-branch fix/audit-detector-b-qs-suffix)
`tokenize()` i `backend/scripts/audit-feature-liveness.js` behandler nu også
segmenter der INDEHOLDER `:param` som wildcard (`board:param` → `*`).
Bidirektionel wildcard-match gør resten: `/races/*` matcher backend
`/races/calendar`. Ingen allowlist-entries nødvendige.

## Klasse + forward-guard
- Klasse: statisk detektor-matcher antager at template-udtryk altid er
  path-segmenter; en variabel query-string bryder antagelsen.
- Trade-off accepteret: `.../X${qs}`-kald wildcard'er sidste segment og kan
  i teorien maskere et ægte orphaned sibling-endpoint under samme prefix.
  Det matcher detektorens eksisterende wildcard-filosofi (samme risiko
  fandtes allerede for `/${action}`-kald).
- Hvis Detector B igen fejler på et endpoint frontend beviseligt kalder:
  tjek FØRST hvordan URL'en konstrueres (grep efter endpoint-navnet) før
  der tilføjes whitelist-entries — matcher-gap, ikke drift, var årsagen her.
