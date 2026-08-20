// #3697 · Route-niveau ready-gate for lazy-loadede i18n-namespaces.
//
// Baggrund: alle namespaces var inlinet i language-chunken (186-192 KB gzipped
// alene) fordi `useSuspense: false` betyder at en flade der mounter FØR
// HttpBackend har hentet sit namespace renderer rå nøgler ("board:dna.title")
// — bug-klassen fra #412/#470. Konsekvensen var at ALT nyt brugervendt copy
// vejede i den initiale bundle, også copy til flader de fleste spillere aldrig
// åbner. Det er rod-årsagen bag 26 hævninger af bundle-budgettet.
//
// Fixet: namespaces hvis eneste forbrugere ligger bag en lazy route hentes nu
// via HttpBackend fra /locales/{lng}/{ns}.json — filerne shippes ALLEREDE
// statisk i dist/locales/, så det er ren fjernelse af JS-vægt, ikke ny payload.
// Denne gate holder raw-key-flashen væk: fladen mountes først når namespacet
// er hentet for både aktivt sprog og en-fallback.
//
// Brug (App.jsx / hub-sider):
//   <I18nReadyGate ns="board"><BoardPage /></I18nReadyGate>
//
// Bemærk: `children`-elementet er skabt men IKKE renderet mens gaten venter, så
// en lazy sides chunk-fetch starter efter namespace-fetchen i stedet for
// parallelt. Det er samme serialisering som den eksisterende in-page-gate på
// HelpPage/RulesPage (chunk først, så namespace) — bare i omvendt rækkefølge —
// og rammer kun de sjældent besøgte flader.
//
// Forward-guard: scripts/i18n-check-namespace-inline.mjs kræver at hvert
// namespace i INLINE_EXEMPT har mindst én ready-gate i src/.

import { useTranslation } from "react-i18next";
import { PageLoader } from "./ui";

export default function I18nReadyGate({ ns, fallback = null, children }) {
  const { ready } = useTranslation(ns);
  if (!ready) return fallback ?? <PageLoader />;
  return children;
}
