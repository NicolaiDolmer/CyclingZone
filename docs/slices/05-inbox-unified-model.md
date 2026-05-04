# Slice S-05 · Indbakke unified content-model ✅ Leveret v2.30 (2026-05-04)

**Status:** P0 LEVERET — runtime-divergens fra brief håndteret med 3 polish-bidder. Se `LAUNCH_ROADMAP.md` for fuld kontekst.

**Kort version af leverancen:** Brief'en antog problemet "spredte hændelser over flere tabeller" var større end runtime — men `notificationService.notifyUser/notifyTeamOwner` med dedup centraliserede allerede alt i `notifications`-tabellen, og NotificationsPage havde allerede tabs + kategori-filtre + realtime + mark-read. I stedet for at rebrande siden leveredes (1) drift-fix på `activity_feed`-skema, (2) orphan-cleanup, (3) nyt "Skal handles"-tab der aggregerer pending decisions (transfer/swap/loan) hvor brugeren skal handle.

---

**Original brief (bevaret som historik):**

## Mål
Gør indbakken til primær spil-loop. Alle hændelser samles ét sted med kategori-filtre og klik-til-destination, så manager ikke skal hoppe mellem 5 forskellige sider for at fange hvad der er sket.

## Runtime-evidens
- [frontend/src/pages/NotificationsPage.jsx](frontend/src/pages/NotificationsPage.jsx) — eksisterende indbakke-side, viser kun `notifications`-tabellen
- [frontend/src/pages/ActivityFeedPage.jsx](frontend/src/pages/ActivityFeedPage.jsx) — separat aktivitets-feed
- [frontend/src/pages/ActivityPage.jsx](frontend/src/pages/ActivityPage.jsx) — manager-egen aktivitet
- [frontend/src/pages/TransfersPage.jsx](frontend/src/pages/TransfersPage.jsx) — modtagne/afsendte tilbud
- DB-tabeller: `notifications`, `activity_feed`, `transfer_offers`, `auction_bids`, `swap_offers`, `loan_agreements` — hver med eget timestamp og state
- [backend/routes/api.js](backend/routes/api.js): `GET /api/notifications` og separate endpoints for hver tabel
- Layout.jsx:309-314: notification bell-badge bruger `unread`-count fra notifications-tabellen

## Invariant der beskyttes
- Notification type-kontrakt afstemt i schema/migration/test (eksisterende invariant).
- Klik på indbakke-item navigerer til ÉN korrekt destination i app (aldrig dead-link).
- Ingen duplikater (samme event vises ikke som både "notification" og "activity").

## Minimal change

### Database

1. **Ny VIEW `inbox_items`** der UNION'er relevante tabeller:
   ```sql
   CREATE OR REPLACE VIEW inbox_items AS
   SELECT 
     'notification'::text AS source,
     id, user_id, type AS subtype, message AS body,
     created_at, read_at, related_id, related_type,
     CASE type
       WHEN 'auction_won' THEN '/auctions/' || related_id
       WHEN 'outbid' THEN '/auctions/' || related_id
       WHEN 'transfer_offer' THEN '/transfers'
       WHEN 'transfer_accepted' THEN '/transfers'
       WHEN 'season_event' THEN '/seasons'
       WHEN 'race_completed' THEN '/race-archive/' || related_id
       ELSE '/'
     END AS link_to
   FROM notifications
   UNION ALL
   SELECT
     'transfer_offer'::text, id, receiving_team_id (resolve to user_id), 'received_offer', ...
   -- osv. for hver relevant kilde
   ;
   ```
   Pr. Postgres-konvention: VIEW returnerer det forenede sæt med kategori-tag.

2. **Migration:** ingen tabel-ændringer, kun VIEW-creation.

### Backend

3. **`GET /api/inbox?category=&unread_only=&limit=`:**
   - Query `inbox_items` view filtreret på user
   - Kategorier: `auction`, `transfer`, `board`, `season`, `race`, `loan`, `system`
   - Returnér `{items: [...], unread_count_per_category: {auction: 3, transfer: 0, ...}}`
   - Pagineret (default 30 items)

4. **`POST /api/inbox/:id/mark-read`:**
   - Til notifications: opdatér `read_at`
   - Til afledte items (transfer-offers etc.): tracking i ny tabel `inbox_read_state(user_id, source, item_id, read_at)` — undgår at ændre eksisterende kontrakter

### Frontend

5. **Refaktorer `NotificationsPage.jsx` til `InboxPage.jsx`:**
   - Kategori-tabs øverst: Alle / Marked / Bestyrelse / Sæson / Løb / Lån / System (med unread-badges)
   - Liste med ikon pr. type + relativ tid + body + klikbar
   - Filter "Kun ulæste" toggle
   - "Markér alle som læst"-knap pr. kategori

6. **Klik på item → navigation:**
   - Brug item.link_to fra view → `navigate(link_to)` + mark-as-read
   - Hvis link_to er `/auctions/:id` men auktionen er afsluttet → fallback til `/auction-history`

7. **Layout-badge øverst højre:**
   - Skift fra `notifications.unread`-count til `inbox.total_unread` (sum af alle kategorier)
   - Klik på bell → `/inbox` (ny route, redirector fra `/notifications`)

8. **Mobile: indbakke-knap i bottom-nav** (eller header) — ikke kun via menu.

### Routing

9. **`App.jsx`:** `/notifications` redirecter til `/inbox` (backwards-compat).

## Verification path

1. **Manuel test:**
   - Trigger 5 forskellige hændelser (vinde auktion, modtage tilbud, sæson-slut, race-completed, lån-tilbud)
   - Åbn indbakke → verificér alle 5 dukker op i korrekte kategorier
   - Klik hver item → verificér navigation til rigtige destination
   - Markér som læst → verificér badge falder
2. **Unit test `inbox.test.js`:**
   - VIEW returnerer items i kronologisk orden
   - Filter på kategori returnerer kun den kategori
   - Mark-as-read er idempotent
3. **Backwards-compat:** `/notifications` redirecter korrekt.

## Out of scope
- Mobil push-notifikationer (separat feature).
- Indbakke-arkiv/slet (kan tilføjes senere).
- Søgning i indbakke (P1 polish hvis efterspurgt).
- Discord-DM-mirroring i indbakken (DM forbliver privat kanal).

## Forudsætninger
- Ingen kode-forudsætninger.
- VIEW kræver at alle source-tabeller har stabile schemas (de har).

## Risiko og mitigation
- **Risiko:** VIEW langsom på 10K+ items hvis user har masser af aktivitet.
- **Mitigation:** LIMIT 30 default; index på user_id + created_at i alle source-tabeller.
- **Risiko:** Eksisterende NotificationsPage-callers brydes.
- **Mitigation:** Redirect + bevaring af samme bell-pattern i Layout.

## Estimat
1-2 sessioner. Anbefalet split: 05a (backend VIEW + endpoint) + 05b (frontend refaktorer + routing).
