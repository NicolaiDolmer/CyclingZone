import { buildKeyedNotification } from "./notificationKeys.js";
import { translate } from "./i18nServer.js";

// Structured rows let the inbox translate squad labels and format values locally.
export function contractNoticeRider(rider) {
  const squad = rider.squad === "u23" || rider.squad === "junior"
    ? rider.squad : rider.is_academy ? "academy" : "senior";
  return {
    rider: `${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim(),
    squad,
    value: rider.market_value != null && Number.isFinite(Number(rider.market_value)) ? Number(rider.market_value) : null,
  };
}

export function contractRosterFallback(rows) {
  return rows.map((row) => translate(row.value == null ? "notif.contractRoster.entryUnknown" : "notif.contractRoster.entry", {
    rider: row.rider,
    squad: translate(`notif.contractSquad.${row.squad}`),
    value: new Intl.NumberFormat("en").format(row.value),
  })).join("\n");
}

export function buildContractRosterNotification({ riders, seasonNumber, released = false }) {
  const contractRiders = riders.map(contractNoticeRider);
  const code = released ? "contractReleasedSummary" : "contractExpiringSummary";
  const payload = buildKeyedNotification({
    titleCode: `notif.${code}.title`,
    messageCode: `notif.${code}.message`,
    messageParams: { season: seasonNumber, contractRiders: contractRosterFallback(contractRiders) },
  });
  return {
    ...payload,
    type: released ? "contract_expired_release" : "contract_expiring",
    relatedId: null,
    metadata: {
      ...payload.metadata,
      messageParams: { season: seasonNumber, contractRiders },
    },
  };
}
