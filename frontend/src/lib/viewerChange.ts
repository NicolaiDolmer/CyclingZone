// #6514 · #7439 · Ren, afhængighedsfri: hvornår skifter viewer (og viewer-bundne
// caches skal tømmes)?
//
// #7439: Supabase sender SIGNED_IN, når fanen bliver synlig igen
// (GoTrueClient._onVisibilityChanged → _recoverAndRefresh), også for SAMME bruger.
// Et event-navn siger derfor ikke, om vieweren har skiftet; det gør bruger-id'et.
// Kun login (null → id), logout (id → null) eller en anden bruger tæller.
// Faneskift, token-refresh og profilopdateringer for samme bruger gør ikke.

export type ViewerSessionLike = { user?: { id?: string | null } | null } | null | undefined;

export type ViewerAuthLike = {
  onAuthStateChange: (callback: (event: string, session: ViewerSessionLike) => void) => unknown;
};

const UNKNOWN = Symbol("unknown-viewer");

/**
 * Husker sidste bruger-id. Returnerer true, når id'et reelt har skiftet siden
 * sidste kald. Første kald (Supabases INITIAL_SESSION ved abonnement) er
 * udgangspunktet og tæller ikke som et skift.
 */
export function createViewerTracker(): (session: ViewerSessionLike) => boolean {
  let last: string | null | typeof UNKNOWN = UNKNOWN;
  return (session) => {
    const id = session?.user?.id ?? null;
    if (last === UNKNOWN) {
      last = id;
      return false;
    }
    if (id === last) return false;
    last = id;
    return true;
  };
}

/** Kalder `callback`, kun når viewerens bruger-id reelt skifter (inkl. til/fra null). */
export function onViewerChange(auth: ViewerAuthLike, callback: () => void): () => void {
  const changed = createViewerTracker();
  const result = auth.onAuthStateChange((_event, session) => {
    if (changed(session)) callback();
  }) as { data?: { subscription?: { unsubscribe?: () => void } } } | null | undefined;
  return () => result?.data?.subscription?.unsubscribe?.();
}
