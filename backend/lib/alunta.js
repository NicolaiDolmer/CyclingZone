// Alunta API-klient (provider-agnostisk wrapper). Verificeret mod OpenAPI v1
// (app.alunta.com/docs/v1) 2026-06-26: base https://app.alunta.com/api/v1,
// Bearer-auth. Feltnavne (plan_id på checkout) bekræftes i test_mode før prod.

export function createAluntaClient({
  token = process.env.ALUNTA_API_TOKEN,
  baseUrl = process.env.ALUNTA_BASE ?? "https://app.alunta.com/api/v1",
  fetchImpl = fetch,
} = {}) {
  async function call(path, { method = "GET", body } = {}) {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Alunta ${method} ${path} -> ${res.status}: ${text}`);
    return text ? JSON.parse(text) : null;
  }

  return {
    async ensureCustomer({ externalCustomerId, name, email }) {
      try {
        return await call("/customers", {
          method: "POST",
          body: { name, email, external_customer_id: String(externalCustomerId) },
        });
      } catch (err) {
        // Idempotens: Alunta 422'er hvis kunden allerede findes på external_customer_id
        // (ramte første testkøb 20/7 — retry #2 fejlede på duplikatet). "Findes
        // allerede" ER succes for en ensure-operation.
        const msg = String(err?.message || "");
        if (msg.includes("-> 422") && msg.includes("external_customer_id already exists")) return null;
        throw err;
      }
    },
    async createCheckoutSession({ externalCustomerId, planId, successUrl, backUrl }) {
      const session = await call("/checkout-sessions", {
        method: "POST",
        body: {
          external_customer_id: String(externalCustomerId),
          plan_id: planId,
          success_url: successUrl,
          back_url: backUrl,
        },
      });
      // Alunta wrapper 201-svaret i en data-envelope: { data: { id, checkout_url } }
      // (verificeret i OpenAPI-spec 20/7 — udokumenteret envelope bed første testkøb:
      // undefined checkout_url -> frontend navigerede til /undefined -> dashboard).
      const url = session?.data?.checkout_url ?? session?.checkout_url;
      if (!url) throw new Error(`Alunta checkout-session uden checkout_url: ${JSON.stringify(session)?.slice(0, 200)}`);
      return url;
    },
    // #2813: signeret auto-login-link til Aluntas self-service-portal (opsigelse
    // m.m.). Verificeret mod OpenAPI 30/7: POST /portal-link/{uuid} — med gyldig
    // customer-UUID returneres en auto-login-URL (default 15 min udløb, behandles
    // som credential); uden/ukendt UUID returneres portalens login-side (magic
    // link). Samme data-envelope som checkout-sessions.
    async createPortalLink({ customerUuid, expiresInMinutes } = {}) {
      const path = customerUuid ? `/portal-link/${customerUuid}` : "/portal-link";
      const body = expiresInMinutes ? { expires_in_minutes: expiresInMinutes } : {};
      const link = await call(path, { method: "POST", body });
      const url = link?.data?.url ?? link?.url;
      if (!url) throw new Error(`Alunta portal-link uden url: ${JSON.stringify(link)?.slice(0, 200)}`);
      return url;
    },
    // #2736 — daglig subscription-reconcile (invoice.paid findes ikke hos Alunta,
    // se aluntaSubscriptionReconcile.js). Lister abonnementer sideviseret, samme
    // konvention som GET /plans?per_page=100 i alunta-setup-plans.js. Returnerer
    // det RÅ svar (data-envelope IKKE unwrapped her) — fetchAllAluntaSubscriptions
    // i aluntaSubscriptionReconcile.js gør det sideløbende, da paginerings-
    // afslutningen afhænger af envelope-formen.
    async listSubscriptions({ page = 1, perPage = 100 } = {}) {
      return call(`/subscriptions?page=${page}&per_page=${perPage}`);
    },
    // #4514/#4555 — fakturaliste. GET /invoices har INGEN status-filter
    // (verificeret mod OpenAPI 31/8: kun per_page, page, customer_uuid,
    // date_from, date_to), så forfaldne fakturaer må findes klient-side på
    // `outstanding` + `due_date`. customerUuid/dateFrom/dateTo er valgfrie —
    // #4514's forfalds-vagt henter ufiltreret (hele fakturalisten dagligt),
    // #4555's periode-rul-vagt scoper til ÉN kunde + dato-vindue. Returnerer
    // det RÅ svar med data/meta-envelope; fetchAllAluntaInvoices håndterer
    // pagineringen.
    async listInvoices({ page = 1, perPage = 100, customerUuid, dateFrom, dateTo } = {}) {
      const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
      if (customerUuid) params.set("customer_uuid", customerUuid);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      return call(`/invoices?${params.toString()}`);
    },
  };
}

export default createAluntaClient;
