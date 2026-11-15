import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { appRuntime } from "./useDataScope.ts";

// #6494: the QueryClient provider for migrated pages. Every page that reads through
// frontend/src/data renders inside it; all of them share the one browser runtime, so a
// cache entry survives navigation between migrated pages. It wraps the page (not the app)
// while the migration is page by page, so pages that are not migrated never load Query.
export function DataProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={appRuntime().client}>{children}</QueryClientProvider>;
}
