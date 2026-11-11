// App-shell probes use an explicit app route; never synthesize an auth cookie.
export function appShellHeaders(extraHeaders = {}) {
  return { ...extraHeaders };
}
export async function fetchAppShell(url, init = {}) {
  const target = new URL(url);
  if (['/', '/da', '/da/'].includes(target.pathname)) target.pathname = '/dashboard';
  return fetch(target.href, { ...init, headers: appShellHeaders(init.headers) });
}
