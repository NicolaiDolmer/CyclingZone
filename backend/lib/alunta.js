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
    ensureCustomer({ externalCustomerId, name, email }) {
      return call("/customers", {
        method: "POST",
        body: { name, email, external_customer_id: String(externalCustomerId) },
      });
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
      return session.checkout_url;
    },
  };
}

export default createAluntaClient;
