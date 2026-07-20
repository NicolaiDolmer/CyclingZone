// Email unsubscribe route-handler (#2725). One-click opt-out, INGEN auth —
// linket lever i selve e-mailen og læses/klikkes af mailklienter der aldrig
// er logget ind (samme "no requireAuth, delt secret/token i stedet"-mønster
// som aluntaWebhook.js).
//
// GET: browser-klik åbner en minimal bekræftelses-side (EN først, kort DA-
// linje under, ingen styling-dependencies).
// POST: mailklientens List-Unsubscribe-Post: List-Unsubscribe=One-Click
// kalder samme path uden side-visning og forventer en hurtig 2xx (jf.
// resend:email-best-practices-skillets krav: "Accept POST requests — return
// 200/202 with a blank page").
//
// Begge metoder muterer SAMME række: users.email_prefs.all = false. Ugyldigt
// token → 400 + generisk besked (ingen detaljer om HVORFOR det er ugyldigt,
// for ikke at lække noget til en ikke-autentificeret kalder).

import { verifyUnsubToken } from "./emailUnsubToken.js";
import { captureException } from "./sentry.js";

const UNSUB_INVALID_HTML = `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:48px auto;padding:0 16px;color:#1a1a1a;">
<p>This unsubscribe link is invalid or has expired.</p>
<p style="color:#767676;font-size:14px;">Dette afmeldingslink er ugyldigt eller udløbet.</p>
</body></html>`;

const UNSUB_CONFIRMATION_HTML = `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:48px auto;padding:0 16px;color:#1a1a1a;">
<p>You have been unsubscribed from Cycling Zone emails.</p>
<p style="color:#767676;font-size:14px;">Du er nu afmeldt Cycling Zone e-mails.</p>
</body></html>`;

export async function handleEmailUnsubscribe({ req, res, supabase, secret = process.env.EMAIL_UNSUB_SECRET, captureExceptionFn = captureException }) {
  const isPost = req.method === "POST";
  const token = req.query?.token;
  const userId = verifyUnsubToken(token, secret);
  if (!userId) {
    if (isPost) return res.sendStatus(400);
    return res.status(400).type("html").send(UNSUB_INVALID_HTML);
  }

  try {
    const { data: userRow, error: fetchErr } = await supabase
      .from("users").select("email_prefs").eq("id", userId).maybeSingle();
    if (fetchErr) throw fetchErr;
    const mergedPrefs = { ...(userRow?.email_prefs ?? {}), all: false };
    const { error: updateErr } = await supabase
      .from("users").update({ email_prefs: mergedPrefs }).eq("id", userId);
    if (updateErr) throw updateErr;
  } catch (err) {
    // En fejlet unsubscribe er et compliance-problem — SKAL til Sentry, ikke
    // kun console (brugeren tror de er afmeldt). Aldrig DB-detaljer til en
    // uautentificeret kalder; mailklienten retry'er en non-2xx selv.
    console.error("[email-unsubscribe] update failed:", err.message);
    captureExceptionFn(err, { tags: { flow: "email-loop", route: "unsubscribe" }, extra: { userId } });
    return res.sendStatus(500);
  }

  if (isPost) return res.sendStatus(200);
  return res.status(200).type("html").send(UNSUB_CONFIRMATION_HTML);
}
