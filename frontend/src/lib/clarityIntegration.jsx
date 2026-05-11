import { useEffect } from "react";
import Clarity from "@microsoft/clarity";
import { useConsent } from "./consent.jsx";
import { supabase } from "./supabase";

const PROJECT_ID = import.meta.env.VITE_CLARITY_PROJECT_ID;
const ENABLED = import.meta.env.PROD && Boolean(PROJECT_ID);

let clarityStarted = false;

function startClarity() {
  if (clarityStarted || !ENABLED) return;
  try {
    Clarity.init(PROJECT_ID);
    clarityStarted = true;
  } catch (err) {
    console.error("clarity init failed:", err);
  }
}

function setClarityTag(key, value) {
  if (!clarityStarted || value == null) return;
  try { Clarity.setTag(key, String(value)); } catch { /* tagging is best-effort */ }
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
        .select("season_number")
        .eq("status", "active")
        .order("season_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (season) setClarityTag("season_number", season.season_number);
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
