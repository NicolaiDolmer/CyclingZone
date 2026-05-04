# Slice S-04 · Admin annullér auktion

**Status:** P0, ikke startet. Opdateret 2026-05-04.

## Mål
Admin kan annullere en aktiv auktion fra UI'et med ét klik. Alle bud refunderes (balance + reservation), rytter sættes tilbage til oprindelig ejer (eller AI-pool hvis bank-rytter), notifikationer sendes til budgivere.

## Runtime-evidens
- [backend/lib/auctionFinalization.js](backend/lib/auctionFinalization.js) — eksisterende finalize-path
- [backend/routes/api.js](backend/routes/api.js) — auction CRUD endpoints
- [frontend/src/pages/AdminPage.jsx](frontend/src/pages/AdminPage.jsx) — admin-tabs
- `auctions.status TEXT CHECK (status IN ('active', 'completed', 'cancelled'))` — eksisterende; verificér 'cancelled' allerede er valid status

## Invariant der beskyttes
- Betaling går aldrig til forkert hold (kritisk invariant fra GUARDRAILS_CORE).
- Ingen rytter ender i konfliktende ejer-state.
- Reserveret balance på alle bud frigives præcist.

## Minimal change

1. **Backend `POST /api/admin/auctions/:id/cancel`:**
   - `requireAdmin` middleware
   - Ny funktion `cancelAuction(auctionId, adminUserId, supabase)` i `backend/lib/auctionCancellation.js`:
     - Lås auktion i transaktion: SELECT FOR UPDATE
     - Hvis status != 'active' → 409 Conflict
     - For hvert bud (`auction_bids` WHERE `auction_id`): refundér til budger via `unreserveBidAmount` (genbrug eksisterende balance-reservation-helper)
     - Opdatér rytter: hvis bank/AI-auktion → tilbage til AI-pool (sæt `team_id = ai_team_id`); hvis manager-auktion → tilbage til seller (`team_id = seller_team_id`)
     - UPDATE `auctions` SET `status='cancelled'`, `cancelled_at=now()`, `cancelled_by_user_id=adminUserId`
     - Send `notifyAuctionCancelled` til alle budgivere (in-app + Discord DM hvis enabled)
     - Log admin action (genbrug eksisterende admin_audit_log hvis findes; ellers ny tabel)
2. **Frontend `AdminPage.jsx`:**
   - Ny tab eller sektion "Auktioner" hvis ikke findes — søg eksisterende admin-auktion-rendering først
   - Per-aktiv-auktion: "Annullér"-knap (rød)
   - Confirm-modal: "Du annullerer auktion på {rytter}. {N} bud refunderes. Sikker?"
   - Efter confirm → POST → success-toast + reload listen
3. **DB-migration hvis behov:**
   - Tilføj `auctions.cancelled_at TIMESTAMPTZ`, `cancelled_by_user_id UUID REFERENCES users(id)` (hvis ikke allerede der — verificér)
   - Tilføj 'cancelled' til CHECK constraint hvis ikke allerede inkluderet
4. **Notification type:**
   - Tilføj `auction_cancelled` til `notifications_type_check` constraint
   - Discord-embed via `discordNotifier`
5. **Patch notes:** ny version-entry.

## Verification path

1. **Unit test `auctionCancellation.test.js`:**
   - 3 budgivere, 100K, 150K, 200K bud → cancel → verificér alle 3 har balance + reservation tilbage
   - AI-rytter → cancel → verificér rytter tilbage på AI-team
   - Manager-rytter → cancel → verificér rytter tilbage på seller
   - Allerede afsluttet auktion → cancel returnerer 409
2. **Manuelt på beta:**
   - Opret testauktion på AI-rytter, byd fra 2 testkonti
   - Admin → AdminPage → Auktioner → Annullér
   - Verificér: rytter tilbage på AI-team, begge budgivere notificeret, balancer korrekte

## Out of scope
- Admin-cancel af completed auctions (kan ikke fortrydes — handel er afsluttet).
- Bulk-cancel (ét ad gangen er fint).
- Reason-felt på cancel (kan tilføjes senere hvis ønsket).

## Forudsætninger
- Ingen.

## Risiko og mitigation
- **Risiko:** Race condition hvis auction finalizer kører samtidig.
- **Mitigation:** SELECT FOR UPDATE + status-check. Hvis finalizer vinder, returnér 409.
- **Risiko:** Notifikation til mange budgivere bremser endpoint.
- **Mitigation:** Best-effort try/catch på hver notify-call (matcher Discord DM-mønstret); endpoint returnerer success efter DB-changes.

## Estimat
0.5-1 session.
