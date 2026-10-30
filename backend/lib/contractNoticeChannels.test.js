import test from "node:test";
import assert from "node:assert/strict";
import { buildContractRosterNotification } from "./contractNoticeRoster.js";
import { buildContractExpiringNotification } from "./notificationService.js";
import { buildSeasonTransitionRiskNotification } from "./seasonTransitionNotice.js";
import { buildInstantPayload } from "./pushService.js";

test("existing push rendering localizes structured contract rows and single-rider squad labels", () => {
  const labels = { en: "Academy", da: "Akademi", fr: "Académie", es: "Academia", nl: "Academie" };
  const rider = { firstname: "Rider", lastname: "A", is_academy: true, market_value: 1200 };
  const notifications = [
    buildContractRosterNotification({ riders: [rider], seasonNumber: 5 }),
    buildContractRosterNotification({ riders: [rider], seasonNumber: 5, released: true }),
    buildContractExpiringNotification({ riderName: "Rider A", riderId: "r-a", seasonNumber: 5, squad: "academy" }),
    buildSeasonTransitionRiskNotification({ expiringCount: 1, retirementRiskCount: 0, expiringRiders: [rider] }),
  ];
  for (const [language, label] of Object.entries(labels)) {
    for (const notification of notifications) {
      const payload = buildInstantPayload({
        category: { key: "transfers", url: "/team?tab=contracts" }, notifications: [notification], language,
      });
      assert.ok(payload.body.includes("Rider A"), `${language}: rider name`);
      assert.ok(payload.body.includes(label), `${language}: squad label`);
      assert.doesNotMatch(payload.body, /\[object Object\]|\{(?:squad|contractRiders)\}|notif\./);
    }
  }
});

test("a missing market value stays unknown rather than becoming a zero value", () => {
  const payload = buildContractRosterNotification({
    riders: [{ firstname: "Rider", lastname: "A", squad: "junior", market_value: null }], seasonNumber: 5,
  });
  assert.equal(payload.metadata.messageParams.contractRiders[0].value, null);
  assert.match(payload.message, /value unavailable/);
  assert.doesNotMatch(payload.message, /0 CZ\$/);
});
