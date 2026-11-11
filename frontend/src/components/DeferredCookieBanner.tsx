import { Suspense } from "react";
import { lazyWithRetry } from "../lib/lazyWithRetry.js";
import { useConsent } from "../lib/consent.jsx";

const CookieBanner = lazyWithRetry(() => import("./CookieBanner.jsx"));

/** Keep settings UI out of returning players' first view; consent stays default-denied. */
export default function DeferredCookieBanner() {
  const { bannerOpen } = useConsent();
  return bannerOpen ? <Suspense fallback={null}><CookieBanner /></Suspense> : null;
}
