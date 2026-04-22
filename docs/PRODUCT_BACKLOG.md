# PRODUCT BACKLOG — Cycling Zone

_Formål: Samlet backlog for bugs, features, integrationer og forbedringer._
_Regel: Kun aktive/top-prioriterede ting spejles til NOW.md. Kun statusændringer spejles til FEATURE_STATUS.md._

---

## 🔴 Kritiske bugs

- P1: Auktionsdomænet driver stadig mod domænereglerne. `seller_team_id` sættes til initiatoren ved oprettelse, men finalisering krediterer kun sælger når rytteren faktisk står på `seller_team_id`; AI-ejede auktioner mangler derfor en entydig økonomisk sælger-path, og sluttids/finaliseringsflowet skal verificeres samlet
- P1: Parallelle admin-routes i `backend/server.js` og `backend/routes/api.js` for `POST /api/admin/import-results`, `POST /api/admin/seasons/:id/start` og `POST /api/admin/seasons/:id/end` skaber drift-risk i season-flowet
- P2: Achievements tæller ikke korrekt; backend unlocker kun `watchlist_add`, mens frontend også sender `auction_bid` og `transfer_done`
- P3: Evne-filter/slider kræver frisk reproduktion på rigtige data; nuværende kodegennemgang fandt ingen entydig root cause
- P3: Transferfunktioner skal stadig verificeres end-to-end mod nuværende runtime, men cleanup af relaterede market rows er allerede samlet i shared transfer execution path

---

## 🟠 Høj prioritet — features

- Discord webhooks skal forbedres
- Direkte Discord-besked til manager ved events
- Notifikation når ønskeliste-rytter sættes til salg
- Klik på notifikation → deep-link til relevant side
- Admin skal kunne slette en bruger
- "Glemt password" skal være tilgængelig fra auth-flowet
- Managernavn bør matche Discord-navn
- Vis tidspunkt for hvornår rytter sættes til transfer
- Vis ryttertype på rytterside
- Vis land på ryttere
- Klik på logo → dashboard (pc + mobil)

---

## 🟡 Data / integrationer

- Scraper til UCI-ranglisten
- Google Sheets integration
- Teams PCM mapping
- Cyclists PCM mapping
- UCI rangliste sync
- Løbsresultater sync

---

## 🟢 Produktdybde

- UCI-point udvikling over tid
- Stats-udvikling over tid
- Oprykningsindikator under ranglisten

### Rytterhistorik
- Vis AI-salg med pris
- Vis alle transfers
- Manager-handler vises uden pris

---

## 🟣 Økonomi / tuning

- Opdatere økonomien i spillet
- Gange priser med faktor 4000

---

## 🔵 System

- FAQ auto-opdatering
- Patch notes auto-opdatering
