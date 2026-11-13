/** Decisions shared by the dashboard's first render and request failure paths. */
export function retainKnownList<T>(previous: T[] | null): T[] {
  return previous ?? [];
}
