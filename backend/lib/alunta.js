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
  };
}

export default createAluntaClient;
