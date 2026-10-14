// #6590 · /api/push/*: abonnementer og kategori-valg for web push.
//
//   GET    /push/config         { enabled, publicKey, categories, timezone }
//   POST   /push/subscriptions  { subscription, timezone? }  → gemmer abonnementet
//   DELETE /push/subscriptions  { endpoint }                  → sletter det (fravalg/log ud)
//   PATCH  /push/prefs          { categories: { auctions: bool, ... } }
//
// Al politik bor i lib/pushService.js; ruten er auth + validering. Svaret er
// aldrig det raa flag-stadie eller viewerens beta-status, kun `enabled`.
// Oprettelse kraever at push er slaaet til for viewer (flag + VAPID). Sletning
// og kategori-valg virker altid, saa en spiller altid kan slaa fra.
import { Router } from "express";
import type { Request, RequestHandler } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isValidTimeZone,
  parseSubscription,
  readPushAvailability,
  resolveCategoryPrefs,
  sanitizeCategoryPatch,
} from "../lib/pushService.js";

type AuthedRequest = Request & { user?: { id?: string } };

export function createPushRouter({
  supabase,
  requireAuth,
  isViewerBetaTester,
  readLimiter,
  writeLimiter,
  reportError = () => {},
}: {
  supabase: SupabaseClient;
  requireAuth: RequestHandler;
  isViewerBetaTester: (req: Request) => Promise<boolean>;
  readLimiter: RequestHandler;
  writeLimiter: RequestHandler;
  reportError?: (error: unknown, context?: Record<string, unknown>) => void;
}) {
  const router = Router();

  function userIdOf(req: Request): string | null {
    return (req as AuthedRequest).user?.id ?? null;
  }

  router.get("/config", requireAuth, readLimiter, async (req, res) => {
    const userId = userIdOf(req);
    if (!userId) return res.status(401).json({ error: "unauthorized" });
    try {
      const availability = await readPushAvailability(supabase, { isBetaTester: await isViewerBetaTester(req) });
      const { data, error } = await supabase.from("users").select("push_prefs, timezone").eq("id", userId).maybeSingle();
      if (error) throw new Error(`users: ${error.message}`);
      return res.json({
        enabled: availability.enabled,
        publicKey: availability.publicKey,
        categories: resolveCategoryPrefs(data?.push_prefs),
        timezone: data?.timezone ?? null,
      });
    } catch (error) {
      reportError(error, { tags: { route: "/push/config" } });
      // best-effort: rapporteret ovenfor; en fejl skjuler bare push-sektionen.
      return res.json({ enabled: false, publicKey: null, categories: resolveCategoryPrefs(null), timezone: null });
    }
  });

  router.post("/subscriptions", requireAuth, writeLimiter, async (req, res) => {
    const userId = userIdOf(req);
    if (!userId) return res.status(401).json({ error: "unauthorized" });
    const sub = parseSubscription(req.body?.subscription);
    if (!sub) return res.status(400).json({ error: "Invalid push subscription", errorCode: "push_subscription_invalid" });
    try {
      const availability = await readPushAvailability(supabase, { isBetaTester: await isViewerBetaTester(req) });
      if (!availability.enabled) {
        return res.status(403).json({ error: "Push notifications are not available", errorCode: "push_not_available" });
      }
      const userAgent = String(req.get("user-agent") ?? "").slice(0, 512) || null;
      // Samme enhed kan skifte konto: endpointet flyttes til den aktuelle spiller.
      const { error } = await supabase.from("push_subscriptions").upsert(
        { user_id: userId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, user_agent: userAgent, failure_count: 0 },
        { onConflict: "endpoint" },
      );
      if (error) throw new Error(`push_subscriptions: ${error.message}`);
      const timezone = typeof req.body?.timezone === "string" ? req.body.timezone.trim() : "";
      if (timezone && isValidTimeZone(timezone)) {
        const { error: tzError } = await supabase.from("users").update({ timezone }).eq("id", userId);
        // best-effort: abonnementet er allerede gemt; tidszonen er sekundaer (default Europe/Copenhagen).
        if (tzError) reportError(new Error(`users.timezone: ${tzError.message}`), { tags: { route: "/push/subscriptions", method: "POST" } });
      }
      return res.json({ ok: true });
    } catch (error) {
      reportError(error, { tags: { route: "/push/subscriptions", method: "POST" } });
      return res.status(500).json({ error: "Could not save the subscription", errorCode: "push_subscription_failed" });
    }
  });

  router.delete("/subscriptions", requireAuth, writeLimiter, async (req, res) => {
    const userId = userIdOf(req);
    if (!userId) return res.status(401).json({ error: "unauthorized" });
    const endpoint = req.body?.endpoint;
    if (typeof endpoint !== "string" || !endpoint || endpoint.length > 2048) {
      return res.status(400).json({ error: "endpoint required", errorCode: "push_endpoint_required" });
    }
    try {
      const { error } = await supabase.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", endpoint);
      if (error) throw new Error(`push_subscriptions: ${error.message}`);
      return res.json({ ok: true });
    } catch (error) {
      reportError(error, { tags: { route: "/push/subscriptions", method: "DELETE" } });
      return res.status(500).json({ error: "Could not remove the subscription", errorCode: "push_unsubscribe_failed" });
    }
  });

  router.patch("/prefs", requireAuth, writeLimiter, async (req, res) => {
    const userId = userIdOf(req);
    if (!userId) return res.status(401).json({ error: "unauthorized" });
    const { categories, unknownKeys, invalid } = sanitizeCategoryPatch(req.body?.categories);
    if (unknownKeys.length || invalid) {
      return res.status(400).json({ error: "Invalid categories", errorCode: "push_prefs_invalid" });
    }
    try {
      const { data, error } = await supabase.from("users").select("push_prefs").eq("id", userId).maybeSingle();
      if (error) throw new Error(`users: ${error.message}`);
      const current = data?.push_prefs && typeof data.push_prefs === "object" ? data.push_prefs : {};
      const merged = { ...current, categories: { ...(current.categories ?? {}), ...categories } };
      const { error: updError } = await supabase.from("users").update({ push_prefs: merged }).eq("id", userId);
      if (updError) throw new Error(`users.push_prefs: ${updError.message}`);
      return res.json({ ok: true, categories: resolveCategoryPrefs(merged) });
    } catch (error) {
      reportError(error, { tags: { route: "/push/prefs" } });
      return res.status(500).json({ error: "Could not save your choices", errorCode: "push_prefs_failed" });
    }
  });

  return router;
}
