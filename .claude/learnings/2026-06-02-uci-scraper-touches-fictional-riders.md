# UCI-scraper gulvede fiktive ryttere (pcm_id NULL)

**Dato:** 2026-06-02
**Symptom:** En manuel kørsel af `uci_sync.yml` satte 16 af de 25 fiktive ryttere (#669) ned til MIN (5 point). Opdaget fordi ejeren spurgte "vores egne ryttere skal ikke have opdateret værdien".

## Rod-årsag

`fetch_db_riders` i `scripts/uci_scraper.py` hentede **alle** ryttere uden filter:

```
riders?select=id,firstname,lastname,uci_points,popularity&order=id.asc
```

Fiktive ryttere (pcm_id NULL) findes aldrig på ProCyclingStats → `not_found` → de under high-value-tærsklen (pop <70 OG <100 point) blev gulvet til MIN. De 8 over tærsklen blev beskyttet og overlevede tilfældigt.

## Hvorfor det ikke blev fanget

- Fiktive ryttere blev introduceret i #669 (fase 5, prod) **efter** scraperen var bygget. Scraperen havde ingen grund til at kende `pcm_id`-diskriminatoren.
- RLS skjuler fiktive for ikke-admin, men scraperen kører med `service_role` (bypasser RLS) → så den "så" dem alligevel.
- Lav player-impact (admin-only, ingen ejede dem) → ingen alarm udløst.

## Fix

`pcm_id=not.is.null` i fetch-URL'en → scraperen rører **kun** ægte PCM-ryttere. Test `test_sync_supabase_fetches_all_db_rider_pages` asserter nu filteret er på alle DB-fetch-URLs.

## Læring (generaliserbar)

**Bulk-data-jobs der kører med service_role skal selv håndhæve samme diskriminator som RLS'en.** Når en RLS-policy deler data i to klasser (her: `pcm_id IS NOT NULL OR is_admin()`), skal ethvert baggrunds-job der bypasser RLS gentage filteret eksplicit — ellers rammer det den klasse der er skjult for brugerne. Samme mønster som #962: tælle-/værdi-/"findes"-logik skal bruge **samme filter som UI'et viser data med**.

Forward-guard-tjek ved nye RLS-klasser: grep efter alle `service_role`/`SUPABASE_SERVICE_KEY`-jobs og verificér de respekterer den nye diskriminator.

## Relateret

- Max Poole (rigtig rytter, pcm_id 14321) var et separat fund: frosset på 342 point siden 28. april fordi navnet ikke matcher PCS, og high-value-beskyttelsen fastfryser stale-værdien hver uge. Rettet manuelt til 5 (ejer: reelle UCI-point = 0). Beskyttelsen gen-fryser ham ikke, fordi den kræver `uci_points > MIN`.
