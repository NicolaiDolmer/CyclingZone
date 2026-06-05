// Resolve a backend API error response to localized text — Refs #678.
//
// Player-facing endpoints return { error: "<legacy DA fallback>", errorCode,
// errorParams }. EN players previously saw the raw Danish `error` (the frontend
// rendered `data.error || t(...)`, and `data.error` always won). Now we prefer
// the structured `errorCode` and resolve it via the shared `errors:api.*`
// namespace, falling back to the legacy `error` string (un-coded endpoints) and
// finally to a caller-supplied default.
//
// Numeric params are run through formatBackendParams so {min}/{available}/{value}
// get locale-aware thousand separators, matching the #666 backend-message path.

import { formatBackendParams } from "./backendMessage.js";

/**
 * @param {{ error?: string, errorCode?: string, errorParams?: object }|null|undefined} data - parsed error response body
 * @param {(key: string, params?: object) => string} t - i18next t() (any namespace; key is `errors:`-prefixed)
 * @param {string} [fallback] - shown when neither a resolvable code nor a legacy `error` string is present
 * @returns {string}
 */
export function resolveApiError(data, t, fallback = "") {
  const code = data?.errorCode;
  if (code) {
    const key = `errors:api.${code}`;
    const params = formatBackendParams(data.errorParams, t);
    const translated = t(key, params);
    // i18next returns the key unchanged when the translation is missing — fall
    // back rather than render "errors:api.foo" / "api.foo" in the UI.
    if (translated && translated !== key && translated !== `api.${code}`) {
      return translated;
    }
  }
  return data?.error || fallback || "";
}
