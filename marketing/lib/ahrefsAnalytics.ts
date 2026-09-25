// #5493: ren funktion så nøgle-håndteringen kan unit-testes uden en
// React-renderer. Komponenten (components/ahrefs-analytics.tsx) er kun et
// tyndt <script>-wrap omkring denne.
export function getAhrefsAnalyticsKey(env: Partial<NodeJS.ProcessEnv> = process.env): string | null {
  const key = (env.NEXT_PUBLIC_AHREFS_ANALYTICS_KEY || "").trim();
  return key || null;
}
