// #6514 · Ren, afhængighedsfri: hvilke auth-events skifter viewer (og tømmer viewer-bundne caches).
export function isViewerChangeEvent(event: string): boolean {
  return event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED";
}
