# React 18 automatic batching kan stille æde et setState-resultat

**Dato:** 2026-06-12
**Fil:** `frontend/src/components/admin/SeasonCycleSection.jsx`

## Symptom
Blokken "✅ Sæsonskifte udført" (per-fase-log + PayrollSummaryTable, #535) blev
aldrig vist efter et succesfuldt sæsonskifte — featuren var bygget netop så
admin kan verificere finance_transactions uden manuel SQL.

## Rod-årsag
`executeTransition()` kaldte `setResult(data)` og umiddelbart efter
`await fetchPreview()`, som startede **synkront** med `setResult(null)`.
React 18 automatic batching lægger begge kald i samme render-pass, så
`result`-state blev aldrig observeret som data — ingen fejl, ingen warning,
UI'et så bare ud som om intet skete.

## Fix
`setResult(null)` flyttet ud af `fetchPreview()` til en `reloadPreview()`-
wrapper. Reload-stier (mount, "Forsøg igen", "Genindlæs") clearer; succes-
stien kalder `fetchPreview()` direkte og bevarer resultatet.

## Læring / forward-guard
- En "refresh data"-helper må ikke selv cleare urelateret resultat-state —
  clearing hører til i de call-sites der semantisk er en reset.
- Mønstret `setX(data); await refresh()` hvor refresh starter med `setX(null)`
  er en stille no-op under React 18 batching. Grep efter `set\w+\(null\)` i
  starten af fetch-helpers når et "vises aldrig"-symptom rammes.
- Verificér ALLE call-sites når en delt helper ændrer adfærd (her var der 4,
  ikke de antagne 3).
