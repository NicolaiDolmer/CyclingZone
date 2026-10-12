// #1140 — gaten om "Your first race"-kortet. Daekker:
//   1) SELVE GATEN: off/beta/on + fail-safe, og at preview kun virker for
//      beta-testere/admin (aldrig for andre).
//   2) RESULTAT-KRAVET: kortet vises kun uden resultat; preview omgaar det.
//   3) ASSISTENT- og MAIL-saetningerne: kun naar de er sande.
//   4) WIRINGEN: ruten er mountet i api.js, og flaget staar i STAGE_FLAGS.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isStageFlagKey } from "./stageFlagCatalog.js";
import {
  FIRST_RACE_CARD_FLAG_KEY,
  isFirstRaceCardEnabled,
  resolveFirstRaceCardAccess,
  shouldShowFirstRaceCard,
  resolveAssistantPicks,
  resolveMailActive,
  buildFirstRaceCardPayload,
} from "./firstRaceCardFlag.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

// Faelles fake: tabel → raekker. Understoetter select/eq/in/order/limit/maybeSingle.
function fakeSupabase(tables) {
  return {
    from(table) {
      const rows = tables[table];
      const q = {
        select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q,
        maybeSingle: async () => ({ data: Array.isArray(rows) ? (rows[0] ?? null) : (rows ?? null), error: null }),
        then: (resolve, reject) => Promise.resolve({ data: Array.isArray(rows) ? rows : (rows ? [rows] : []), error: null }).then(resolve, reject),
      };
      return q;
    },
  };
}
// app_config-opslag: maybeSingle skal svare paa den noegle der spoerges — her
// returnerer vi en praemuteret raekke pr. kald via en lille tabel-resolver.
function supabaseWith({ stage, day1 = "off", digest = "off", mode = "proactive", results = [], user = null, seasons = [] }) {
  const values = { first_race_card: stage, email_loop_day1: day1, email_loop_race_digest: digest, assistant_selection_mode: mode };
  return {
    from(table) {
      let key = null;
      const q = {
        select: () => q, in: () => q, order: () => q, limit: () => q,
        eq: (col, v) => { if (col === "key") key = v; return q; },
        maybeSingle: async () => {
          if (table === "app_config") return { data: key in values && values[key] !== undefined ? { value: values[key] } : null, error: null };
          if (table === "users") return { data: user, error: null };
          return { data: null, error: null };
        },
        then: (resolve, reject) => Promise.resolve({
          data: table === "race_results" ? results : table === "seasons" ? seasons : [],
          error: null,
        }).then(resolve, reject),
      };
      return q;
    },
  };
}

test("#1140: noeglen er first_race_card og staar i STAGE_FLAGS", () => {
  assert.equal(FIRST_RACE_CARD_FLAG_KEY, "first_race_card");
  assert.equal(isStageFlagKey(FIRST_RACE_CARD_FLAG_KEY), true);
});

test("#1140 isFirstRaceCardEnabled: off/beta/on og fail-safe", async () => {
  assert.equal(await isFirstRaceCardEnabled(fakeSupabase({ app_config: { value: "off" } })), false);
  assert.equal(await isFirstRaceCardEnabled(fakeSupabase({ app_config: { value: "beta" } }), { isBetaTester: false }), false);
  assert.equal(await isFirstRaceCardEnabled(fakeSupabase({ app_config: { value: "beta" } }), { isBetaTester: true }), true);
  assert.equal(await isFirstRaceCardEnabled(fakeSupabase({ app_config: { value: "on" } })), true);
  assert.equal(await isFirstRaceCardEnabled(fakeSupabase({}), {}), false);
  assert.equal(await isFirstRaceCardEnabled({}), false);
});

test("#1140 preview: kun beta-tester/admin, uanset stadie; aldrig for andre", () => {
  assert.deepEqual(resolveFirstRaceCardAccess({ stage: "off", isBetaTester: true, previewParam: "first-race" }), { enabled: true, preview: true });
  assert.deepEqual(resolveFirstRaceCardAccess({ stage: "off", isBetaTester: false, previewParam: "first-race" }), { enabled: false, preview: false });
  assert.deepEqual(resolveFirstRaceCardAccess({ stage: "on", isBetaTester: false, previewParam: "first-race" }), { enabled: true, preview: false });
  assert.deepEqual(resolveFirstRaceCardAccess({ stage: "off", isBetaTester: true, previewParam: "other" }), { enabled: false, preview: false });
  assert.deepEqual(resolveFirstRaceCardAccess({ stage: "off", isBetaTester: true }), { enabled: false, preview: false });
});

test("#1140 gate: resultat lukker kortet, preview omgaar det, flag-off lukker alt", () => {
  assert.equal(shouldShowFirstRaceCard({ enabled: true, preview: false, hasResult: false }), true);
  assert.equal(shouldShowFirstRaceCard({ enabled: true, preview: false, hasResult: true }), false);
  assert.equal(shouldShowFirstRaceCard({ enabled: true, preview: true, hasResult: true }), true);
  assert.equal(shouldShowFirstRaceCard({ enabled: false, preview: false, hasResult: false }), false);
});

test("#1140 assistent: kun naar holdet har den slaaet til OG tilstanden ikke er proactive", () => {
  assert.equal(resolveAssistantPicks({ team: { assistant_autopick_enabled: true }, mode: "opt_in" }), true);
  assert.equal(resolveAssistantPicks({ team: { assistant_autopick_enabled: true }, mode: "late_fill" }), true);
  assert.equal(resolveAssistantPicks({ team: { assistant_autopick_enabled: true }, mode: "proactive" }), false);
  assert.equal(resolveAssistantPicks({ team: { assistant_autopick_enabled: false }, mode: "opt_in" }), false);
  assert.equal(resolveAssistantPicks({ team: {}, mode: "opt_in" }), false);
  assert.equal(resolveAssistantPicks({ team: null, mode: "opt_in" }), false);
});

test("#1140 mail: stadie ikke off + ikke fravalgt; digest kraever samtykke", () => {
  assert.equal(resolveMailActive({ day1Stage: "on", digestStage: "off", emailPrefs: {}, consentPreferences: {} }), true);
  assert.equal(resolveMailActive({ day1Stage: "dry_run", digestStage: "off", emailPrefs: {}, consentPreferences: {} }), true);
  assert.equal(resolveMailActive({ day1Stage: "off", digestStage: "off", emailPrefs: {}, consentPreferences: { email_marketing: true } }), false);
  assert.equal(resolveMailActive({ day1Stage: "on", digestStage: "off", emailPrefs: { all: false }, consentPreferences: {} }), false);
  assert.equal(resolveMailActive({ day1Stage: "on", digestStage: "off", emailPrefs: { day1: false }, consentPreferences: {} }), false);
  assert.equal(resolveMailActive({ day1Stage: "off", digestStage: "on", emailPrefs: {}, consentPreferences: { email_marketing: true } }), true);
  assert.equal(resolveMailActive({ day1Stage: "off", digestStage: "on", emailPrefs: {}, consentPreferences: {} }), false);
});

test("#1140 payload: flag off uden preview rammer aldrig beta-opslaget", async () => {
  let betaCalls = 0;
  const out = await buildFirstRaceCardPayload(supabaseWith({ stage: "off" }), {
    userId: "u1", team: { id: "t1" }, isBetaTester: async () => { betaCalls++; return true; }, previewParam: undefined,
  });
  assert.deepEqual(out, { visible: false, preview: false });
  assert.equal(betaCalls, 0);
});

test("#1140 payload: flag on, intet resultat → synligt med assistent/mail/naeste saeson", async () => {
  const sb = supabaseWith({
    stage: "on", day1: "on", mode: "opt_in",
    user: { email_prefs: {}, consent_preferences: {} },
    seasons: [{ start_date: "2026-11-02" }],
  });
  const out = await buildFirstRaceCardPayload(sb, {
    userId: "u1", team: { id: "t1", assistant_autopick_enabled: true }, isBetaTester: async () => false, previewParam: undefined,
  });
  assert.deepEqual(out, { visible: true, preview: false, assistant_picks: true, mail: true, next_season_start: "2026-11-02" });
});

test("#1140 payload: resultat findes → skjult; preview + beta → synligt trods resultat", async () => {
  const sb = supabaseWith({ stage: "on", results: [{ id: 1 }], user: { email_prefs: {}, consent_preferences: {} } });
  const base = { userId: "u1", team: { id: "t1" } };
  assert.equal((await buildFirstRaceCardPayload(sb, { ...base, isBetaTester: async () => false })).visible, false);
  const pv = await buildFirstRaceCardPayload(sb, { ...base, isBetaTester: async () => true, previewParam: "first-race" });
  assert.equal(pv.visible, true);
  assert.equal(pv.preview, true);
});

test("#1140 payload: preview fra en ikke-beta-tester er uden virkning (flag off)", async () => {
  const out = await buildFirstRaceCardPayload(supabaseWith({ stage: "off" }), {
    userId: "u1", team: { id: "t1" }, isBetaTester: async () => false, previewParam: "first-race",
  });
  assert.deepEqual(out, { visible: false, preview: false });
});

test("#1140 payload: assistent og mail udelades naar de ikke er sande", async () => {
  const sb = supabaseWith({ stage: "on", mode: "proactive", user: { email_prefs: { all: false }, consent_preferences: {} } });
  const out = await buildFirstRaceCardPayload(sb, {
    userId: "u1", team: { id: "t1", assistant_autopick_enabled: true }, isBetaTester: async () => false,
  });
  assert.equal(out.assistant_picks, false);
  assert.equal(out.mail, false);
  assert.equal(out.next_season_start, null);
});

test("#1140 wiring: ruten er mountet i api.js bag requireAuth og beta-opslaget er lazy", () => {
  assert.match(apiSource, /createFirstRaceCardRouter\(\{[^}]*requireAuth[^}]*isViewerBetaTester/);
  const routeSource = readFileSync(resolve(__dirname, "../routes/firstRaceCard.js"), "utf8");
  assert.match(routeSource, /router\.get\("\/me\/first-race-card", requireAuth/);
  assert.match(routeSource, /isBetaTester: \(\) => isViewerBetaTester\(req\)/);
});
