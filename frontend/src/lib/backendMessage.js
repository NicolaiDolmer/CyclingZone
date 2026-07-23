// Backend message-codes renderer — Refs #666.
//
// Backend lib-files (financeForecast, economyEngine, loanEngine, board*, squad*,
// proxy*) emitter strukturerede { code, params }-payloads i stedet for færdig-
// formaterede DA-strings. Dette modul oversætter via i18next-namespace
// `backendMessages` med locale-aware formattering af numeriske felter.
//
// Brug i komponenter:
//
//   import { useTranslation } from "react-i18next";
//   import { renderBackendMessage } from "../lib/backendMessage";
//
//   const { t } = useTranslation("backendMessages");
//   const text = renderBackendMessage(tx.metadata, t, tx.description);
//   //                                              ↑ fallback for legacy rows
//
// Notifs (title + message hver med kode):
//
//   const title   = renderBackendMessage({ code: meta.titleCode,   params: meta.titleParams   }, t, n.title);
//   const message = renderBackendMessage({ code: meta.messageCode, params: meta.messageParams }, t, n.message);

import { formatNumber } from "./intl.js";

// Param-keys der formateres med 2 decimaler (modifier-faktorer 1.00 osv).
const TWO_DECIMAL_KEYS = new Set(["modifier"]);

// Param-keys der IKKE locale-formateres (heltal/pct/små counts hvor tusind-
// separator ville være forkert).
const RAW_KEYS = new Set([
  "rank", "division", "season", "count", "ratio", "rate", "satisfaction",
  "goalsMet", "goalsTotal", "percent", "daysLeft", "penaltyPoints",
  "feeRate", "interestRate", "pct", "delta", "id", "layer",
  "seasonsCompleted", "planDuration",
  // #2174 · sæson-numre i leje-forslag (fx 3, 5) må ikke få tusind-separator.
  "seasonFrom", "seasonTo",
  // #2523 · etape-nummer + placering (stage_result) er små heltal, ikke beløb.
  "stage", "position",
  // #1980 · nedrykningsfaldskærm — division-numre, ikke beløb.
  "oldDivision", "newDivision",
  // #2700 · sæsonskifte-risiko-varsel — antal ryttere, ikke beløb.
  "expiringCount", "retirementRiskCount",
  // #2748 · pensionsbeskedens alder er et lille heltal, ikke et beløb.
  "age",
]);

/**
 * Konverter raw backend-params til locale-formaterede strings klar til t().
 * - Numbers ud over RAW_KEYS gennemgår formatNumber() (tusind-separator).
 * - TWO_DECIMAL_KEYS forced til 2 decimaler.
 * - Keys der ender på "Key" sub-resolves via t() — fx `planLabelKey:
 *   "planLabel.3yr"` bliver til `planLabel: "3-year plan"`. Lader backend
 *   referere genbrugte labels (planLabel, midMessage, layer-label, ...)
 *   uden at duplikere strenge i alle message-templates.
 */
export function formatBackendParams(params, t = null) {
  if (!params || typeof params !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    if (v == null) {
      out[k] = v;
    } else if (k.endsWith("Key") && k.length > 3 && typeof v === "string") {
      const resolved = t ? t(v) : v;
      const base = k.slice(0, -3);
      // Hvis resolved === key, manglede oversættelsen → behold raw value som fallback
      out[base] = resolved === v ? v : resolved;
    } else if (typeof v === "number" && Number.isFinite(v)) {
      if (TWO_DECIMAL_KEYS.has(k)) {
        out[k] = formatNumber(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      } else if (RAW_KEYS.has(k)) {
        out[k] = String(v);
      } else {
        out[k] = formatNumber(v);
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Render et { code, params }-payload til lokaliseret tekst via i18next.
 *
 * @param {{ code: string, params?: object }|null|undefined} meta - Backend payload
 * @param {(key: string, params?: object) => string} t - i18next t() bundet til "backendMessages" namespace
 * @param {string} [fallback] - Vises hvis meta er null/missing eller key ikke findes (typisk tx.description for legacy rows)
 * @returns {string}
 */
export function renderBackendMessage(meta, t, fallback = "") {
  if (!meta || typeof meta !== "object" || !meta.code) {
    return fallback || "";
  }
  const params = formatBackendParams(meta.params, t);
  const translated = t(meta.code, params);
  // i18next returnerer key som-er hvis translation mangler — så fall back hellere
  // til legacy-strengen end at vise "tx.sponsor.seasonStartIntro" i UI.
  if (translated === meta.code) {
    return fallback || translated;
  }
  return translated;
}
