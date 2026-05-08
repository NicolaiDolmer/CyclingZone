// #203: Pure DM-routing-logik. Holdt i separat modul (uden @supabase/supabase-js
// import) så unit-tests kan køre på Node.js 20 uden websocket-factory init-fejl.

export function resolveDmTargetFromInput({ envValue, isTestAccount }) {
  if (isTestAccount) return "stdout";
  if (envValue === "stdout" || envValue === "test-channel") return envValue;
  return "webhook";
}
