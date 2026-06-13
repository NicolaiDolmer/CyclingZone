import { useEffect } from "react";
import { useConsent } from "./consent.jsx";
import { supabase } from "./supabase";

const PROJECT_ID = import.meta.env.VITE_CLARITY_PROJECT_ID;
const ENABLED = import.meta.env.PROD && Boolean(PROJECT_ID);

// #479: Clarity SDK dynamic-importeres så ~10 KB ikke ender i main bundle.
// Cached i modul-scope efter første load; subsequent re-renders bruger samme ref.
let clarityPromise = null;
let clarityStarted = false;

function loadClarity() {
  if (!clarityPromise) {
    clarityPromise = import("@microsoft/clarity").then((m) => m.default);
  }
  return clarityPromise;
}

async function startClarity() {
  if (clarityStarted || !ENABLED) return;
  try {
    const Clarity = await loadClarity();
    if (clarityStarted) return; // re-entry guard
    Clarity.init(PROJECT_ID);
    clarityStarted = true;
  } catch (err) {
    console.error("clarity init failed:", err);
  }
}

async function setClarityTag(key, value) {
  if (!clarityStarted || value == null) return;
  try {
    const Clarity = await loadClarity();
    Clarity.setTag(key, String(value));
  } catch { /* tagging is best-effort */ }
}

// Mounted inside ConsentProvider. Starts Clarity once analytics consent is granted
// and stamps custom tags (manager_id, division, season_number) so weekly review
// can segment by audience. No teardown on revoke — Clarity SDK has no clean
// stop; the next page load will respect the new consent.
export default function ClarityIntegration() {
  const { hasConsent } = useConsent();
  const analyticsOn = hasConsent("analytics");

  useEffect(() => {
    if (!analyticsOn) return;
    startClarity();
  }, [analyticsOn]);

  useEffect(() => {
    if (!analyticsOn || !ENABLED) return;
    let cancelled = false;

    async function tagFromSession() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const { data: team } = await supabase
        .from("teams")
        .select("id, division")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (team) {
        setClarityTag("manager_id", team.id);
        setClarityTag("division", team.division);
      }

      const { data: season } = await supabase
        .from("seasons")
        .select("number")
        .eq("status", "active")
        .order("number", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      // Tag-key stays "season_number" (analytics convention); the value reads
      // the real column seasons.number (the table has no season_number column).
      if (season) setClarityTag("season_number", season.number);
    }

    tagFromSession();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") tagFromSession();
    });
    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe?.();
    };
  }, [analyticsOn]);

  return null;
}
