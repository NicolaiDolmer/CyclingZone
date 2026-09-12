# #5176: matviews bag backend

Ejer-go: 12/9 2026 i Codex-sessionen; engangsundtagelse fra PR-loftet.
To-trinsudgivelse godkendt 12/9: først ny læsning, derefter særskilt revoke.
Merge kræver fortsat ejerens ordrette "merge".
SSOT: [SUPABASE_SECURITY_ADVISORS](../SUPABASE_SECURITY_ADVISORS.md),
[GAME_INVARIANTS](../GAME_INVARIANTS.md). Ingen ændring af spilregler eller UI.

## Kontrakt og implementering

Læsningerne er kortlagt før kode i
[#5176-kommentaren](https://github.com/NicolaiDolmer/CyclingZone/issues/5176#issuecomment-5647210272).
10 direkte reads i 9 filer; kontrakten blev lagt i draft-PR #5183 før kode.
Review fandt desuden honours-INVOKER-afhængigheden i SeasonEndPage:
11 læsestier i 10 filer i den endelige kontrakt.

- [x] `backend/routes/rankings.ts`: separat router med injiceret eksisterende
  `requireAuth`, service-client og fejllogger. Zod afviser ukendte filtre,
  ugyldige UUID'er og for store lister før databasekald.
- [x] GET `/api/rankings/global`: alle offentlige rangfelter, valgfrit team_id.
  GET `/api/rankings/riders`: season_id kræves, valgfri rider_ids eller top=5.
  GET `/api/rankings/standings`: season_id kræves.
  GET `/api/rankings/race-points`: season_id eller race_ids kræves.
  GET `/api/rankings/race-count`: team_id kræves; alle sæsoner bevares.
  GET `/api/rankings/honours`: season_id kræves; aggregater via service_role,
  rytter/hold-display via brugerens RLS før top-5. Ingen skjulte kandidater.
  Eksplicitte SELECT-kolonner; serveren paginerer med stabil sortering.
- [x] `frontend/src/lib/rankingsApi.ts`: authHeaders + fetch; transportfejl
  returneres som `{ data: null, error }`; liste-helpers kaster til eksisterende
  sidefejlhåndtering. Ingen rå Supabase-matview-reads fra komponenter/hooks.
- [x] `mockHandlers.js` og `seedData.js`: samme datasæt, filtre og response-shape
  via de nye API-stier; preview og Playwright bruger samme matchers.
- [x] Idempotent revoke-forslag i `database/proposals/`, uden for auto-migrate.
  Lokal test af genkørsel og grants; kommenteret verify-blok til Claude.
- [x] SSOT opdateret med målingen 7 WARN / 117 INFO og de tre beslutningsfund.
  Founder INVOKER er ikke adfærdsneutral med subscriptions_select_own.
  Ejeren har valgt B (loginpligtige rider-data); ingen policy er appliceret.

## Verifikation

- [x] Node-route-tests: 401/403 før læsning, 400 ved ulovlige filtre, tom sæson,
  fulde paginerede rækker, korrekt count og whitelistede felter.
- [x] Frontend-hooks med mock-svar, transportfejl og preview-filterparitet.
- [x] TIER FULL på e96475c4: 9.658 backend, 3.266 frontend og 558 Chrome/Android
  e2e bestået; lint, TypeScript, build og preflight passerer. Filflytningen
  genverificeres med SQL/staging-test og preflight; runtime-koden er uændret.
- [x] Preview: stillinger, globale/rytter-ranglister, sæsonafslutning,
  dashboard-widget og holdstatistik; Android/Chrome + desktop.
- [ ] CI grøn; aflevering med ændret/selv tjekket/antaget før merge-go.
- [ ] Trin 1: ejerens merge-go, backend/frontend-deploy og authenticated kontrol.
- [ ] Trin 2: gamle klienters overgang dokumenteret, ny godkendt PR flytter
  SQL til auto-migrate-mappen, Claude verificerer grants og advisor bagefter.

Patch note: ikke spillerrettet, ingen adfærdsændring.
Fire revokes forventes at fjerne fire WARN. De tre accepterede/udestående
funktionsfund forsvinder ikke ved dokumentation; 0 WARN er ikke verificeret.
