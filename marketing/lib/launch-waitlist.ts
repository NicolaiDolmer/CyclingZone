// Porteret fra frontend/src/lib/launchWaitlist.js (+ isValidEmail/parseUtm fra
// waitlistForm.js) — ren logik uden React. Samme implementations-locks:
//   1. .insert() UDEN .select() (anon har ingen SELECT-policy).
//   2. Duplicate via error.code '23505' = soft success.

const MAX_NAME = 80;

export type LaunchFormState = {
  email: string;
  name: string;
  consent: boolean;
  honeypot: string;
};

export const INITIAL_STATE: LaunchFormState = {
  email: "",
  name: "",
  consent: false,
  honeypot: "",
};

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

export function parseUtm(search: string) {
  const params = new URLSearchParams(search);
  return {
    source: params.get("utm_source"),
    campaign: params.get("utm_campaign"),
    medium: params.get("utm_medium"),
  };
}

type TFn = (key: string) => string;

export function validateLaunchForm(state: LaunchFormState, t: TFn) {
  const errors: { email?: string; consent?: string } = {};
  const email = state.email.trim();

  if (!email) errors.email = t("waitlist.errors.emailRequired");
  else if (!isValidEmail(email)) errors.email = t("waitlist.errors.emailInvalid");

  if (!state.consent) errors.consent = t("waitlist.errors.consent");

  return { ok: Object.keys(errors).length === 0, errors };
}

export function isHoneypotTripped(honeypotValue: string): boolean {
  return honeypotValue.length > 0;
}

export function buildLaunchPayload(
  state: LaunchFormState,
  utm: ReturnType<typeof parseUtm>,
) {
  const name = state.name.trim();
  return {
    email: state.email.trim(),
    name: name ? name.slice(0, MAX_NAME) : null,
    consent_given_at: new Date().toISOString(),
    source: utm.source ?? null,
    utm_campaign: utm.campaign ?? null,
    utm_medium: utm.medium ?? null,
  };
}

export type MappedError = { kind: "duplicate" | "rls" | "network" | "unknown"; message: string };

export function mapLaunchInsertError(
  error: { code?: string; message?: string } | null | undefined,
  t: TFn,
): MappedError | null {
  if (!error) return null;
  const code = error.code ?? "";
  const msg = (error.message ?? "").toLowerCase();

  if (code === "23505" || msg.includes("duplicate") || msg.includes("unique constraint")) {
    return { kind: "duplicate", message: t("waitlist.errors.duplicate") };
  }
  if (code === "42501" || msg.includes("row-level security") || msg.includes("policy")) {
    return { kind: "rls", message: t("waitlist.errors.rls") };
  }
  if (msg.includes("failed to fetch") || msg.includes("network")) {
    return { kind: "network", message: t("waitlist.errors.network") };
  }
  return { kind: "unknown", message: t("waitlist.errors.unknown") };
}
