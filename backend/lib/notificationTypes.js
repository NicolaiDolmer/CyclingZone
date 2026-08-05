// Kanonisk liste over tilladte notifikationstyper — SKAL matche
// notifications_type_check i prod (senest: database/2026-08-05-3334-scout-
// changed-notification-type.sql). Paritet håndhæves af
// notificationTypes.test.js; en type der kun tilføjes ét af stederne
// fejler testen i stedet for at fejle tavst i prod (#3016, 3. gentagelse).
export const NOTIFICATION_TYPES = [
  "bid_received",
  "bid_placed",
  "auction_won",
  "auction_lost",
  "auction_outbid",
  "auction_proxy_outbid",
  "transfer_offer_received",
  "transfer_offer_accepted",
  "transfer_offer_rejected",
  "transfer_counter",
  "transfer_offer_withdrawn",
  "transfer_interest",
  "new_race",
  "race_results_imported",
  "race_result",
  "season_started",
  "season_ended",
  "board_update",
  "board_critical",
  "salary_paid",
  "sponsor_paid",
  "watchlist_rider_listed",
  "watchlist_rider_auction",
  "loan_created",
  "emergency_loan",
  "emergency_loan_breach",
  "loan_paid_off",
  "deadline_day_warning",
  "auction_cancelled",
  "squad_enforced",
  "rider_retired",
  "academy_intake_ready",
  "academy_signed",
  "academy_rejected",
  "academy_graduation_ready",
  "academy_graduated",
  "contract_expiring",
  "academy_promoted",
  "academy_demoted",
  "watchlist_departed",
  "admin_notice",
  "stage_result",
  "academy_intake_expired_compensation",
  "academy_drip",
  "scout_report_ready",
  "contract_expired_release",
  "squad_below_minimum",
  "selection_warning",
  "welcome",
  "scout_changed",
];

const TYPE_SET = new Set(NOTIFICATION_TYPES);

export function isKnownNotificationType(type) {
  return TYPE_SET.has(type);
}
