# 2026-05-27 — countryUtils active locale (#649)

## Symptom
EN-mode rider screens still showed Danish country names such as `Slovenien` and `De Forenede Arabiske Emirater` in `/riders` filters and `/riders/:id` nationality display.

## Rod-årsag
`countryUtils` had already moved to `Intl.DisplayNames`, but `getCountryName()` still defaulted to `da-DK`. UI callsites often called `getCountryName(code)` without passing `i18n.language`, so the helper's default overrode the active app language.

## Læring
Locale-aware pure helpers should default to the i18next singleton language, not a product default locale, when they are used directly from React components. Add a regression that sets `i18n.language` and calls the helper without an explicit locale; otherwise tests can pass while callsites still leak the old default.
